import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { type Database, domainEvents, webhookDeliveries, webhookSubscriptions } from "@modular-crm/db";
import type { PgBoss } from "pg-boss";
import { enqueueWebhookDelivery } from "./queues.js";
import { deliverWebhookAttempt, nextWebhookRetryAt, type WebhookEvent } from "./webhook.js";

export type WebhookSecretResolver = (reference: string) => Promise<string | undefined>;
export type WebhookFetcher = typeof fetch;
const MAX_DELIVERY_ATTEMPTS = 8;

export async function processWebhookDelivery(db: Database, boss: PgBoss, input: { tenantId: string; deliveryId: string }, resolveSecret: WebhookSecretResolver, fetcher: WebhookFetcher = fetch, now = new Date()): Promise<"delivered" | "retry" | "failed" | "skipped"> {
  const [claimed] = await db.update(webhookDeliveries).set({ status: "sending", lastAttemptAt: now, updatedAt: now })
    .where(and(eq(webhookDeliveries.id, input.deliveryId), eq(webhookDeliveries.tenantId, input.tenantId), inArray(webhookDeliveries.status, ["queued", "retry"]), or(isNull(webhookDeliveries.nextRetryAt), lte(webhookDeliveries.nextRetryAt, now))))
    .returning();
  if (!claimed) return "skipped";
  const [subscription] = await db.select().from(webhookSubscriptions).where(and(eq(webhookSubscriptions.id, claimed.webhookSubscriptionId), eq(webhookSubscriptions.tenantId, input.tenantId))).limit(1);
  const [event] = await db.select().from(domainEvents).where(and(eq(domainEvents.id, claimed.domainEventId), eq(domainEvents.tenantId, input.tenantId))).limit(1);
  const secret = subscription?.status === "active" ? await resolveSecret(subscription.secretReference) : undefined;
  if (!subscription || !event || !secret) {
    await db.update(webhookDeliveries).set({ status: "failed", attemptCount: claimed.attemptCount + 1, responseExcerpt: "Webhook subscription, event or signing secret unavailable", updatedAt: now }).where(eq(webhookDeliveries.id, claimed.id));
    if (subscription) await db.update(webhookSubscriptions).set({ status: "needs_attention", lastFailureAt: now, updatedAt: now }).where(and(eq(webhookSubscriptions.id, subscription.id), eq(webhookSubscriptions.tenantId, input.tenantId)));
    return "failed";
  }
  const webhookEvent: WebhookEvent = { id: event.id, tenantId: input.tenantId, eventType: event.eventType, eventVersion: event.eventVersion, occurredAt: event.occurredAt, entityType: event.entityType, entityId: event.entityId, organizationId: event.organizationId, locationId: event.locationId, payload: event.payload };
  let outcome: Awaited<ReturnType<typeof deliverWebhookAttempt>>;
  try { outcome = await deliverWebhookAttempt({ url: subscription.url, secret, event: webhookEvent, now, fetcher }); }
  catch (error) { outcome = { success: false, responseExcerpt: error instanceof Error ? error.message.slice(0, 250) : "Delivery configuration error", retryable: false }; }
  const attemptCount = claimed.attemptCount + 1;
  if (outcome.success) {
    await db.update(webhookDeliveries).set({ status: "delivered", attemptCount, responseStatus: outcome.responseStatus, responseExcerpt: outcome.responseExcerpt, deliveredAt: now, nextRetryAt: null, updatedAt: now }).where(eq(webhookDeliveries.id, claimed.id));
    await db.update(webhookSubscriptions).set({ lastSuccessAt: now, updatedAt: now }).where(and(eq(webhookSubscriptions.id, subscription.id), eq(webhookSubscriptions.tenantId, input.tenantId)));
    return "delivered";
  }
  const retry = outcome.retryable && attemptCount < MAX_DELIVERY_ATTEMPTS;
  const nextRetryAt = retry ? nextWebhookRetryAt(attemptCount, now) : null;
  await db.update(webhookDeliveries).set({ status: retry ? "retry" : "failed", attemptCount, responseStatus: outcome.responseStatus, responseExcerpt: outcome.responseExcerpt, nextRetryAt, updatedAt: now }).where(eq(webhookDeliveries.id, claimed.id));
  await db.update(webhookSubscriptions).set({ ...(outcome.retryable && attemptCount >= MAX_DELIVERY_ATTEMPTS ? { status: "needs_attention" } : {}), lastFailureAt: now, updatedAt: now }).where(and(eq(webhookSubscriptions.id, subscription.id), eq(webhookSubscriptions.tenantId, input.tenantId)));
  if (retry && nextRetryAt) await enqueueWebhookDelivery(boss, { tenantId: input.tenantId, deliveryId: claimed.id }, nextRetryAt.toISOString());
  return retry ? "retry" : "failed";
}

/** Poll durable delivery rows so a failed pg-boss enqueue or worker crash is recovered. */
export async function enqueuePendingWebhookDeliveries(db: Database, boss: PgBoss, now = new Date()): Promise<number> {
  await db.update(webhookDeliveries).set({ status: "retry", nextRetryAt: now, updatedAt: now }).where(and(eq(webhookDeliveries.status, "sending"), lt(webhookDeliveries.lastAttemptAt, new Date(now.getTime() - 15 * 60000))));
  const pending = await db.select({ id: webhookDeliveries.id, tenantId: webhookDeliveries.tenantId }).from(webhookDeliveries)
    .where(and(inArray(webhookDeliveries.status, ["queued", "retry"]), or(isNull(webhookDeliveries.nextRetryAt), lte(webhookDeliveries.nextRetryAt, now)))).limit(100);
  for (const item of pending) await enqueueWebhookDelivery(boss, { tenantId: item.tenantId, deliveryId: item.id });
  return pending.length;
}
