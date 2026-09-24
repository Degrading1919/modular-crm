import type { PgBoss } from "pg-boss";

export const QUEUES = {
  publishOutbox: "mcrm.publish-outbox",
  recurringGeneration: "mcrm.recurring-generation",
  domainEvent: "mcrm.domain-event",
  automationRun: "mcrm.automation-run",
  outboundMessage: "mcrm.outbound-message",
  webhookDelivery: "mcrm.webhook-delivery",
} as const;

export type TenantJob = { tenantId: string };
export type DomainEventJob = TenantJob & { eventId: string };
export type RecurringGenerationJob = { tenantId?: string; planId?: string; through?: string };
export type AutomationRunJob = TenantJob & { runId: string };
export type OutboundMessageJob = TenantJob & { messageId: string };
export type WebhookDeliveryJob = TenantJob & { deliveryId: string };

export async function registerWorkerQueues(boss: PgBoss): Promise<void> {
  await Promise.all([
    boss.createQueue(QUEUES.publishOutbox, { retryLimit: 3, retryDelay: 5, retryBackoff: true }),
    boss.createQueue(QUEUES.recurringGeneration, { retryLimit: 3, retryDelay: 10, retryBackoff: true }),
    boss.createQueue(QUEUES.domainEvent, { retryLimit: 5, retryDelay: 5, retryBackoff: true }),
    boss.createQueue(QUEUES.automationRun, { retryLimit: 3, retryDelay: 10, retryBackoff: true }),
    boss.createQueue(QUEUES.outboundMessage, { retryLimit: 3, retryDelay: 10, retryBackoff: true }),
    boss.createQueue(QUEUES.webhookDelivery, { retryLimit: 3, retryDelay: 10, retryBackoff: true }),
  ]);
}

function required(value: string, label: string): void { if (!value?.trim()) throw new Error(`${label} is required`); }

/** Call these only after the business transaction commits. The database outbox recovers missed sends. */
export function enqueueDomainEvent(boss: PgBoss, job: DomainEventJob): Promise<string | null> {
  required(job.tenantId, "tenantId"); required(job.eventId, "eventId");
  // The database outbox is authoritative; downstream handlers are idempotent.
  return boss.send(QUEUES.domainEvent, job);
}
export function enqueueRecurringGeneration(boss: PgBoss, job: RecurringGenerationJob & TenantJob): Promise<string | null> {
  required(job.tenantId, "tenantId");
  return boss.send(QUEUES.recurringGeneration, job, { singletonKey: `${job.tenantId}:${job.planId ?? "all"}:${job.through ?? "default"}`, singletonSeconds: 300 });
}
export function enqueueAutomationRun(boss: PgBoss, job: AutomationRunJob, startAfter?: string): Promise<string | null> {
  required(job.tenantId, "tenantId"); required(job.runId, "runId");
  return boss.send(QUEUES.automationRun, job, { ...(startAfter ? { startAfter } : {}), singletonKey: `${job.tenantId}:${job.runId}`, singletonSeconds: 60 });
}
export function enqueueOutboundMessage(boss: PgBoss, job: OutboundMessageJob): Promise<string | null> {
  required(job.tenantId, "tenantId"); required(job.messageId, "messageId");
  return boss.send(QUEUES.outboundMessage, job, { singletonKey: `${job.tenantId}:${job.messageId}`, singletonSeconds: 60 });
}
export function enqueueWebhookDelivery(boss: PgBoss, job: WebhookDeliveryJob, startAfter?: string): Promise<string | null> {
  required(job.tenantId, "tenantId"); required(job.deliveryId, "deliveryId");
  return boss.send(QUEUES.webhookDelivery, job, { ...(startAfter ? { startAfter } : {}), singletonKey: `${job.tenantId}:${job.deliveryId}`, singletonSeconds: 60 });
}
