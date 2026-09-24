import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  type Database, automationRules, automationRuns, domainEvents, hasUsableFeature, loadTenantCapabilities,
  webhookDeliveries, webhookSubscriptions,
} from "@modular-crm/db";
import { automationRunKey, planAutomationRun, type AutomationAction, type AutomationRule, type DomainEvent } from "@modular-crm/automations";
import type { PgBoss } from "pg-boss";
import { enqueueAutomationRun, enqueueDomainEvent, enqueueWebhookDelivery } from "./queues.js";
import { matchesEventPattern } from "./webhook.js";

type EventRow = typeof domainEvents.$inferSelect;
type RuleRow = typeof automationRules.$inferSelect;

const WORKER_ACTION_CONFIG_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  send_email: new Set(["templateKey", "to", "subject", "body", "customerId"]),
  send_sms: new Set(["templateKey", "to", "subject", "body", "customerId"]),
  create_ticket: new Set(["type", "title", "description"]),
  add_note: new Set(["body"]),
  notify_staff: new Set(["title", "body"]),
};
const ACTION_METADATA_KEYS = new Set(["delay", "continueOnError", "dedupeKeyTemplate"]);
const SEEDED_NOTIFICATION_COPY: Readonly<Record<string, string>> = {
  manual_review: "A new signup needs manual review.",
  payment_failed: "A customer's payment failed.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeActionMetadata(item: Record<string, unknown>): Pick<AutomationAction, "delay" | "continueOnError" | "dedupeKeyTemplate"> {
  let delay: AutomationAction["delay"];
  if (item.delay !== undefined) {
    if (!isRecord(item.delay)) throw new Error("Automation delay is invalid");
    if (Object.keys(item.delay).length === 1 && Number.isSafeInteger(item.delay.afterEventMinutes)
      && Number(item.delay.afterEventMinutes) >= 0 && Number(item.delay.afterEventMinutes) <= 525_600) {
      delay = { afterEventMinutes: Number(item.delay.afterEventMinutes) };
    } else if (Object.keys(item.delay).length === 2 && typeof item.delay.relativeToField === "string"
      && /^[a-zA-Z_][a-zA-Z0-9_.]{0,199}$/.test(item.delay.relativeToField)
      && Number.isSafeInteger(item.delay.offsetMinutes) && Math.abs(Number(item.delay.offsetMinutes)) <= 525_600) {
      delay = { relativeToField: item.delay.relativeToField, offsetMinutes: Number(item.delay.offsetMinutes) };
    } else throw new Error("Automation delay is invalid");
  }
  if (item.continueOnError !== undefined && typeof item.continueOnError !== "boolean") throw new Error("Automation continueOnError is invalid");
  if (item.dedupeKeyTemplate !== undefined && (typeof item.dedupeKeyTemplate !== "string" || item.dedupeKeyTemplate.length > 300)) {
    throw new Error("Automation deduplication key is invalid");
  }
  return {
    ...(delay ? { delay } : {}),
    ...(typeof item.continueOnError === "boolean" ? { continueOnError: item.continueOnError } : {}),
    ...(typeof item.dedupeKeyTemplate === "string" ? { dedupeKeyTemplate: item.dedupeKeyTemplate } : {}),
  };
}

function normalizeAutomationAction(item: Record<string, unknown>, source: RuleRow["source"], sourceKey: RuleRow["sourceKey"]): AutomationAction {
  // Signup seeding flattens `{ actionType: "create_ticket", configuration: { type } }`
  // into the same `type` property, so recover this one known recipe by its stable source key.
  if (source === "industry_pack" && sourceKey === "pause-request" && item.type === "plan_change_review"
    && item.actionType === undefined && Object.keys(item).every((key) => key === "type" || ACTION_METADATA_KEYS.has(key))) {
    return { actionType: "create_ticket", configuration: { type: "plan_change_review" }, ...normalizeActionMetadata(item) };
  }
  if (item.actionType !== undefined && item.type !== undefined && item.actionType !== item.type) {
    throw new Error("Automation action type is ambiguous");
  }
  const rawType = item.actionType ?? item.type;
  if (rawType === "message.send") {
    if (item.channel !== "email" && item.channel !== "sms") throw new Error("Legacy message action channel is invalid");
    if (item.template !== undefined && typeof item.template !== "string") throw new Error("Legacy message template is invalid");
    const allowed = new Set(["type", "actionType", "channel", "template", ...ACTION_METADATA_KEYS]);
    if (Object.keys(item).some((key) => !allowed.has(key))) throw new Error("Legacy message action contains an unsupported setting");
    const metadata = normalizeActionMetadata(item);
    return {
      actionType: item.channel === "email" ? "send_email" : "send_sms",
      configuration: { templateKey: typeof item.template === "string" ? item.template : "" },
      ...metadata,
    };
  }
  if (typeof rawType !== "string" || !Object.hasOwn(WORKER_ACTION_CONFIG_KEYS, rawType)) {
    throw new Error(`Automation action ${String(rawType ?? "(missing)")} is not supported by the worker`);
  }

  const isNested = item.configuration !== undefined;
  if (isNested && !isRecord(item.configuration)) throw new Error("Automation action configuration is invalid");
  const configSource = (isNested ? item.configuration : item) as Record<string, unknown>;
  const allowedConfig = WORKER_ACTION_CONFIG_KEYS[rawType]!;
  const configuration: Record<string, unknown> = {};
  const seededNotificationDetails: string[] = [];
  for (const [key, value] of Object.entries(configSource)) {
    if (!isNested && (key === "type" || key === "actionType" || ACTION_METADATA_KEYS.has(key))) continue;
    if (source === "industry_pack" && rawType === "notify_staff" && (key === "when" || key === "reason")) {
      if (typeof value !== "string" || !Object.hasOwn(SEEDED_NOTIFICATION_COPY, value)) {
        throw new Error(`The seeded notify_staff action does not support ${key}=${String(value)}`);
      }
      seededNotificationDetails.push(SEEDED_NOTIFICATION_COPY[value]!);
      continue;
    }
    if (!allowedConfig.has(key)) throw new Error(`The ${rawType} action does not support ${key}`);
    const maxLength = key === "body" || key === "description" ? 5_000 : 254;
    if (typeof value !== "string" || value.length > maxLength) throw new Error(`The ${key} action setting is invalid`);
    configuration[key] = value.trim();
  }
  if (seededNotificationDetails.length) {
    if (configuration.body !== undefined) throw new Error("Seeded notification details cannot be combined with a custom body");
    configuration.body = seededNotificationDetails.join(" ");
  }
  if (rawType === "add_note" && !String(configuration.body ?? "").trim()) throw new Error("The add_note action needs a body");

  const allowedProperties = new Set(["type", "actionType", "configuration", ...ACTION_METADATA_KEYS]);
  if (isNested) {
    if (Object.keys(item).some((key) => !allowedProperties.has(key))) throw new Error("Automation action contains an unsupported setting");
  } else {
    for (const key of Object.keys(item)) {
      if (key === "type" || key === "actionType" || ACTION_METADATA_KEYS.has(key) || allowedConfig.has(key)) continue;
      if (source === "industry_pack" && rawType === "notify_staff" && (key === "when" || key === "reason")) continue;
      throw new Error(`The ${rawType} action does not support ${key}`);
    }
  }
  return { actionType: rawType as AutomationAction["actionType"], configuration, ...normalizeActionMetadata(item) };
}

export function toAutomationEvent(row: EventRow): DomainEvent | undefined {
  if (!row.tenantId) return undefined;
  return {
    eventId: row.id, eventType: row.eventType, eventVersion: row.eventVersion, occurredAt: row.occurredAt.toISOString(),
    tenantId: row.tenantId, organizationId: row.organizationId ?? undefined, locationId: row.locationId ?? undefined,
    entityType: row.entityType, entityId: row.entityId, correlationId: row.correlationId ?? row.id,
    causationId: row.causationId ?? undefined,
    chainDepth: typeof row.payload.chainDepth === "number" ? row.payload.chainDepth : undefined,
    payload: row.payload,
  };
}

/** Converts the one legacy seed recipe while keeping tenant-supplied rules declarative. */
export function normalizeAutomationRule(row: RuleRow): AutomationRule {
  const trigger = row.triggerConfig as { event?: unknown; filters?: AutomationRule["conditions"] };
  if (typeof trigger.event !== "string") throw new Error("Automation trigger event is missing");
  const actions = row.actions.map((raw) => {
    if (!isRecord(raw)) throw new Error("Automation action must be an object");
    return normalizeAutomationAction(raw, row.source, row.sourceKey);
  });
  const conditions = row.conditions && Object.keys(row.conditions).length ? row.conditions as AutomationRule["conditions"] : undefined;
  return {
    id: row.id, tenantId: row.tenantId, version: row.version, name: row.name, description: row.description ?? undefined,
    source: row.source === "core_recipe" || row.source === "industry_pack" ? row.source : "tenant",
    status: row.status === "active" ? "active" : "inactive", trigger: { event: trigger.event, filters: trigger.filters },
    conditions, actions,
  };
}

/** Outbox sweep makes post-commit enqueue best effort rather than a correctness dependency. */
export async function publishPendingDomainEvents(db: Database, boss: PgBoss, now = new Date(), limit = 100): Promise<number> {
  const pending = await db.select({ id: domainEvents.id, tenantId: domainEvents.tenantId }).from(domainEvents)
    .where(and(isNull(domainEvents.publishedAt), isNotNull(domainEvents.tenantId)))
    .orderBy(asc(domainEvents.occurredAt)).limit(limit);
  let published = 0;
  for (const event of pending) {
    if (!event.tenantId) continue;
    const queued = await enqueueDomainEvent(boss, { tenantId: event.tenantId, eventId: event.id });
    if (!queued) throw new Error(`Queue did not accept domain event ${event.id}`);
    await db.update(domainEvents).set({ publishedAt: now }).where(and(eq(domainEvents.id, event.id), isNull(domainEvents.publishedAt)));
    published++;
  }
  return published;
}

export async function processDomainEvent(db: Database, boss: PgBoss, input: { tenantId: string; eventId: string }): Promise<{ automationRuns: number; webhookDeliveries: number }> {
  const [row] = await db.select().from(domainEvents).where(and(eq(domainEvents.id, input.eventId), eq(domainEvents.tenantId, input.tenantId))).limit(1);
  if (!row) return { automationRuns: 0, webhookDeliveries: 0 };
  const event = toAutomationEvent(row)!;
  const capabilityState = await loadTenantCapabilities(db, input.tenantId);
  const rules = hasUsableFeature(capabilityState, "automation_workflows")
    ? await db.select().from(automationRules).where(and(eq(automationRules.tenantId, input.tenantId), eq(automationRules.status, "active"), isNull(automationRules.archivedAt)))
    : [];
  let automationCount = 0;
  for (const ruleRow of rules) {
    let rule: AutomationRule;
    let plan: ReturnType<typeof planAutomationRun>;
    try {
      rule = normalizeAutomationRule(ruleRow);
      if (ruleRow.activeFrom && ruleRow.activeFrom > row.occurredAt) continue;
      plan = planAutomationRun(rule, event);
    } catch (error) {
      const idempotencyKey = [input.tenantId, ruleRow.id, ruleRow.version, row.id].map(encodeURIComponent).join(":");
      await db.insert(automationRuns).values({ tenantId: input.tenantId, automationRuleId: ruleRow.id, ruleVersion: ruleRow.version, triggeringEventId: row.id, idempotencyKey, status: "failed", errorCode: "invalid_rule", errorMessage: error instanceof Error ? error.message.slice(0, 300) : "Invalid rule" }).onConflictDoNothing();
      continue;
    }
    if (!plan) continue;
    const key = automationRunKey(event, rule);
    const snapshot = JSON.parse(JSON.stringify({ rule, event, plan, completedActionKeys: [] })) as Record<string, unknown>;
    const [inserted] = await db.insert(automationRuns).values({ tenantId: input.tenantId, automationRuleId: rule.id, ruleVersion: rule.version, triggeringEventId: row.id, idempotencyKey: key, status: "queued", contextSnapshot: snapshot }).onConflictDoNothing().returning({ id: automationRuns.id });
    const existing = inserted ? undefined : (await db.select({ id: automationRuns.id, status: automationRuns.status }).from(automationRuns).where(and(eq(automationRuns.tenantId, input.tenantId), eq(automationRuns.idempotencyKey, key))).limit(1))[0];
    const runId = inserted?.id ?? existing?.id;
    if (runId && existing?.status !== "completed" && existing?.status !== "failed") { await enqueueAutomationRun(boss, { tenantId: input.tenantId, runId }); automationCount++; }
  }
  const subscriptions = await db.select().from(webhookSubscriptions).where(and(eq(webhookSubscriptions.tenantId, input.tenantId), eq(webhookSubscriptions.status, "active")));
  let deliveryCount = 0;
  for (const subscription of subscriptions) {
    if (!subscription.eventPatterns.some((pattern) => matchesEventPattern(event.eventType, pattern))) continue;
    const [inserted] = await db.insert(webhookDeliveries).values({ tenantId: input.tenantId, webhookSubscriptionId: subscription.id, domainEventId: row.id, status: "queued" }).onConflictDoNothing().returning({ id: webhookDeliveries.id });
    const delivery = inserted ?? (await db.select({ id: webhookDeliveries.id, status: webhookDeliveries.status }).from(webhookDeliveries).where(and(eq(webhookDeliveries.webhookSubscriptionId, subscription.id), eq(webhookDeliveries.domainEventId, row.id))).limit(1))[0];
    if (delivery && (!("status" in delivery) || delivery.status === "queued" || delivery.status === "retry")) { await enqueueWebhookDelivery(boss, { tenantId: input.tenantId, deliveryId: delivery.id }); deliveryCount++; }
  }
  return { automationRuns: automationCount, webhookDeliveries: deliveryCount };
}
