import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  type Database, automationRuns, customerContacts, customers, hasUsableFeature, internalNotifications, invoices,
  jobs, loadTenantCapabilities, memberships, messageTemplates, notes, outboundMessages, roleTemplates,
  ticketStatusDefinitions, ticketTypeDefinitions, tickets,
} from "@modular-crm/db";
import { evaluateAutomationRule, renderActionConfiguration, type AutomationAction, type AutomationPlan, type AutomationRule, type DomainEvent } from "@modular-crm/automations";
import type { PgBoss } from "pg-boss";
import { enqueueAutomationRun, enqueueOutboundMessage } from "./queues.js";

type RunSnapshot = { rule: AutomationRule; event: DomainEvent; plan: AutomationPlan; completedActionKeys: string[] };
class ActionError extends Error { constructor(readonly code: string, message: string, readonly retryable = false) { super(message); } }

export function deterministicUuid(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function renderMessageFallback(eventType: string, channel: "email" | "sms"): { subject: string; body: string } {
  const label = eventType === "job.completed" ? "Service complete" : eventType === "payment.failed" ? "Payment needs attention" : "Service update";
  return { subject: label, body: channel === "sms" ? `${label}. Please check your account for details.` : `${label}. Please sign in to your customer portal for details.` };
}

async function messageRecipient(db: Database, tenantId: string, customerId: string | undefined, channel: "email" | "sms"): Promise<string | undefined> {
  if (!customerId) return undefined;
  const [customer] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
  const direct = channel === "email" ? customer?.billingEmail : customer?.billingPhone;
  if (direct) return direct;
  const [contact] = await db.select().from(customerContacts).where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, customerId), eq(customerContacts.isPrimary, true))).limit(1);
  return channel === "email" ? contact?.email ?? undefined : contact?.phone ?? undefined;
}

async function executeAction(db: Database, boss: PgBoss, snapshot: RunSnapshot, action: AutomationAction, executionKey: string, now: Date): Promise<void> {
  const { event } = snapshot;
  const configuration = renderActionConfiguration(action.configuration, event);
  const tenantId = event.tenantId;
  if (event.entityType === "job") {
    const [linked] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, event.entityId), eq(jobs.tenantId, tenantId))).limit(1);
    if (!linked) throw new ActionError("invalid_event_scope", "Job is outside the event tenant");
  }
  if (event.entityType === "invoice") {
    const [linked] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id, event.entityId), eq(invoices.tenantId, tenantId))).limit(1);
    if (!linked) throw new ActionError("invalid_event_scope", "Invoice is outside the event tenant");
  }
  if (action.actionType === "send_email" || action.actionType === "send_sms") {
    const channel = action.actionType === "send_email" ? "email" : "sms";
    const customerId = typeof configuration.customerId === "string" ? configuration.customerId : typeof event.payload.customerId === "string" ? event.payload.customerId : undefined;
    if (customerId) {
      const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
      if (!customer) throw new ActionError("invalid_event_scope", "Customer is outside the event tenant");
    }
    const recipient = typeof configuration.to === "string" ? configuration.to : await messageRecipient(db, tenantId, customerId, channel);
    if (!recipient) throw new ActionError("recipient_missing", "No customer contact is available for the message");
    const templateKey = typeof configuration.templateKey === "string" ? configuration.templateKey : undefined;
    const templates = templateKey ? await db.select().from(messageTemplates).where(and(eq(messageTemplates.key, templateKey), eq(messageTemplates.channel, channel), eq(messageTemplates.active, true), or(eq(messageTemplates.tenantId, tenantId), isNull(messageTemplates.tenantId)))) : [];
    const template = templates.find((item) => item.tenantId === tenantId) ?? templates[0];
    const fallback = renderMessageFallback(event.eventType, channel);
    const rendered = template ? renderActionConfiguration({ subject: template.subjectTemplate ?? fallback.subject, body: template.bodyTemplate }, event) : configuration;
    const subject = String(rendered.subject ?? fallback.subject);
    const body = String(rendered.body ?? fallback.body);
    const [inserted] = await db.insert(outboundMessages).values({ tenantId, customerId, jobId: event.entityType === "job" ? event.entityId : undefined, invoiceId: event.entityType === "invoice" ? event.entityId : undefined, channel, templateKey, templateVersion: template?.version, recipient, renderedSubject: channel === "email" ? subject : null, renderedBody: body, status: "queued", idempotencyKey: executionKey, queuedAt: now }).onConflictDoNothing({ target: [outboundMessages.tenantId, outboundMessages.idempotencyKey] }).returning({ id: outboundMessages.id });
    const messageId = inserted?.id ?? (await db.select({ id: outboundMessages.id }).from(outboundMessages).where(and(eq(outboundMessages.tenantId, tenantId), eq(outboundMessages.idempotencyKey, executionKey))).limit(1))[0]?.id;
    if (messageId) await enqueueOutboundMessage(boss, { tenantId, messageId });
    return;
  }
  if (action.actionType === "notify_staff") {
    const staff = await db.select({ id: memberships.id }).from(memberships).innerJoin(roleTemplates, eq(memberships.roleTemplateId, roleTemplates.id))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), inArray(roleTemplates.key, ["owner", "office"]), ...(event.organizationId ? [eq(memberships.organizationId, event.organizationId)] : [])));
    for (const member of staff) await db.insert(internalNotifications).values({ id: deterministicUuid(`${executionKey}:${member.id}`), tenantId, membershipId: member.id, notificationType: event.eventType, title: String(configuration.title ?? "Action needed"), body: String(configuration.body ?? "A customer event needs review."), entityType: event.entityType, entityId: event.entityId }).onConflictDoNothing();
    return;
  }
  if (action.actionType === "add_note") {
    const body = String(configuration.body ?? "").trim();
    if (!body) throw new ActionError("invalid_configuration", "A note body is required");
    await db.insert(notes).values({ id: deterministicUuid(executionKey), tenantId, entityType: event.entityType, entityId: event.entityId, visibility: "internal", body, createdByActorType: "automation", createdByActorId: snapshot.rule.id }).onConflictDoNothing();
    return;
  }
  if (action.actionType === "create_ticket") {
    const typeKey = String(configuration.type ?? "general");
    const [type] = await db.select().from(ticketTypeDefinitions).where(and(eq(ticketTypeDefinitions.tenantId, tenantId), eq(ticketTypeDefinitions.key, typeKey), eq(ticketTypeDefinitions.active, true))).limit(1);
    const [status] = await db.select().from(ticketStatusDefinitions).where(and(eq(ticketStatusDefinitions.tenantId, tenantId), eq(ticketStatusDefinitions.normalizedCategory, "open"), eq(ticketStatusDefinitions.active, true))).limit(1);
    if (!type || !status) throw new ActionError("ticket_configuration_missing", "Configure a ticket type and open status before activating this action");
    const customerId = typeof event.payload.customerId === "string" ? event.payload.customerId : undefined;
    if (customerId) {
      const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
      if (!customer) throw new ActionError("invalid_event_scope", "Customer is outside the event tenant");
    }
    await db.insert(tickets).values({ id: deterministicUuid(executionKey), tenantId, customerId, jobId: event.entityType === "job" ? event.entityId : undefined, ticketTypeId: type.id, statusDefinitionId: status.id, title: String(configuration.title ?? "Follow up needed"), description: String(configuration.description ?? "Created by an automation."), createdByActorType: "automation", createdByActorId: snapshot.rule.id }).onConflictDoNothing();
    return;
  }
  throw new ActionError("unsupported_action", `Worker action ${action.actionType} is not available yet`);
}

/** Runs are claimed once; each supported effect has a stable database idempotency key. */
export async function processAutomationRun(db: Database, boss: PgBoss, input: { tenantId: string; runId: string }, now = new Date()): Promise<"completed" | "retry" | "failed" | "skipped"> {
  const [run] = await db.update(automationRuns).set({ status: "running", startedAt: now, updatedAt: now })
    .where(and(eq(automationRuns.id, input.runId), eq(automationRuns.tenantId, input.tenantId), inArray(automationRuns.status, ["queued", "retry"])))
    .returning();
  if (!run) return "skipped";
  const capabilityState = await loadTenantCapabilities(db, input.tenantId, now);
  if (!hasUsableFeature(capabilityState, "automation_workflows")) {
    await db.update(automationRuns).set({
      status: "failed", attempts: run.attempts + 1, completedAt: now,
      errorCode: "capability_unavailable", errorMessage: "Automation workflows are not enabled for this business.",
      nextRetryAt: null, updatedAt: now,
    }).where(and(eq(automationRuns.id, run.id), eq(automationRuns.tenantId, input.tenantId)));
    return "failed";
  }
  const snapshot = run.contextSnapshot as unknown as RunSnapshot | undefined;
  const attempts = run.attempts + 1;
  const completed = new Set(snapshot?.completedActionKeys ?? []);
  try {
    if (!snapshot?.event || !snapshot.plan || !snapshot.rule || snapshot.event.tenantId !== input.tenantId || snapshot.plan.ruleId !== run.automationRuleId) throw new ActionError("invalid_snapshot", "Automation run snapshot is incomplete");
    for (const planned of snapshot.plan.actions) {
      if (completed.has(planned.executionKey)) continue;
      if (new Date(planned.scheduledAt).getTime() > now.getTime()) {
        await db.update(automationRuns).set({ status: "retry", attempts, nextRetryAt: new Date(planned.scheduledAt), contextSnapshot: { ...snapshot, completedActionKeys: [...completed] }, updatedAt: now }).where(eq(automationRuns.id, run.id));
        await enqueueAutomationRun(boss, input, planned.scheduledAt);
        return "retry";
      }
      if (snapshot.rule.recheckConditions !== false && snapshot.event.entityType === "job") {
        const [currentJob] = await db.select({ status: jobs.status }).from(jobs).where(and(eq(jobs.id, snapshot.event.entityId), eq(jobs.tenantId, input.tenantId))).limit(1);
        if (currentJob && !evaluateAutomationRule(snapshot.rule, { ...snapshot.event, payload: { ...snapshot.event.payload, job: { ...(snapshot.event.payload.job as Record<string, unknown> | undefined), status: currentJob.status } } }).matched) {
          completed.add(planned.executionKey);
          continue;
        }
      }
      try { await executeAction(db, boss, snapshot, planned.action, planned.executionKey, now); }
      catch (error) { if (planned.action.continueOnError && error instanceof ActionError && !error.retryable) { completed.add(planned.executionKey); continue; } throw error; }
      completed.add(planned.executionKey);
      await db.update(automationRuns).set({ contextSnapshot: { ...snapshot, completedActionKeys: [...completed] }, updatedAt: now }).where(eq(automationRuns.id, run.id));
    }
    await db.update(automationRuns).set({ status: "completed", attempts, completedAt: now, nextRetryAt: null, contextSnapshot: { ...snapshot, completedActionKeys: [...completed] }, updatedAt: now }).where(eq(automationRuns.id, run.id));
    return "completed";
  } catch (error) {
    const code = error instanceof ActionError ? error.code : "action_error";
    const retryable = error instanceof ActionError ? error.retryable : true;
    const retry = retryable && attempts < 5;
    const nextRetryAt = retry ? new Date(now.getTime() + Math.min(3600000, 60000 * 2 ** (attempts - 1))) : null;
    await db.update(automationRuns).set({ status: retry ? "retry" : "failed", attempts, errorCode: code, errorMessage: error instanceof Error ? error.message.slice(0, 250) : "Action failed", nextRetryAt, contextSnapshot: { ...(snapshot ?? {}), completedActionKeys: [...completed] }, updatedAt: now }).where(eq(automationRuns.id, run.id));
    if (retry && nextRetryAt) await enqueueAutomationRun(boss, input, nextRetryAt.toISOString());
    return retry ? "retry" : "failed";
  }
}

export async function enqueuePendingAutomationRuns(db: Database, boss: PgBoss, now = new Date()): Promise<number> {
  await db.update(automationRuns).set({ status: "retry", nextRetryAt: now, updatedAt: now }).where(and(eq(automationRuns.status, "running"), lt(automationRuns.startedAt, new Date(now.getTime() - 15 * 60000))));
  const pending = await db.select({ id: automationRuns.id, tenantId: automationRuns.tenantId }).from(automationRuns).where(and(inArray(automationRuns.status, ["queued", "retry"]), or(isNull(automationRuns.nextRetryAt), lt(automationRuns.nextRetryAt, now)))).limit(100);
  for (const item of pending) await enqueueAutomationRun(boss, { tenantId: item.tenantId, runId: item.id });
  return pending.length;
}
