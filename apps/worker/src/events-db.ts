import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { type Database, automationRules, automationRuns, domainEvents, webhookDeliveries, webhookSubscriptions } from "@modular-crm/db";
import { automationRunKey, planAutomationRun, type AutomationAction, type AutomationRule, type DomainEvent } from "@modular-crm/automations";
import type { PgBoss } from "pg-boss";
import { enqueueAutomationRun, enqueueDomainEvent, enqueueWebhookDelivery } from "./queues.js";
import { matchesEventPattern } from "./webhook.js";

type EventRow = typeof domainEvents.$inferSelect;
type RuleRow = typeof automationRules.$inferSelect;

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
    if (!raw || typeof raw !== "object") throw new Error("Automation action must be an object");
    const item = raw as Record<string, unknown>;
    if (item.type === "message.send" && (item.channel === "email" || item.channel === "sms")) return { actionType: item.channel === "email" ? "send_email" : "send_sms", configuration: { templateKey: String(item.template ?? "") } } satisfies AutomationAction;
    if (typeof item.actionType !== "string" || !item.configuration || typeof item.configuration !== "object") throw new Error("Automation action configuration is invalid");
    return item as unknown as AutomationAction;
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
  const rules = await db.select().from(automationRules).where(and(eq(automationRules.tenantId, input.tenantId), eq(automationRules.status, "active"), isNull(automationRules.archivedAt)));
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
