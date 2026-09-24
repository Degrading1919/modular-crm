import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
  type Database, communicationEvents, consentRecords, hasUsableFeature, loadTenantCapabilities,
  notificationPreferences, outboundMessages,
} from "@modular-crm/db";
import { ConnectorError, type ConnectorRegistry } from "@modular-crm/connectors";
import type { PgBoss } from "pg-boss";
import { enqueueOutboundMessage } from "./queues.js";

type Message = typeof outboundMessages.$inferSelect;
type Preference = typeof notificationPreferences.$inferSelect;
type Consent = typeof consentRecords.$inferSelect;

export function suppressReason(message: Pick<Message, "channel">, preference?: Pick<Preference, "emailEnabled" | "smsEnabled">, consent?: Pick<Consent, "state">): string | undefined {
  if (message.channel !== "email" && message.channel !== "sms") return "unsupported_channel";
  if (message.channel === "email" && preference?.emailEnabled === false) return "preference_disabled";
  if (message.channel === "sms" && preference?.smsEnabled === false) return "preference_disabled";
  if (consent?.state === "opted_out" || consent?.state === "suppressed") return "customer_suppressed";
  if (message.channel === "sms" && consent?.state !== "opted_in") return "sms_consent_missing";
  return undefined;
}

export function preferenceKeysForTemplate(templateKey?: string | null): string[] {
  if (!templateKey) return ["general"];
  const canonical = templateKey === "completion" || templateKey === "cleanup-completed" ? "job_completed"
    : templateKey === "payment-failed" ? "payment_failed" : templateKey.replace(/[.\-]/g, "_");
  return [...new Set([templateKey, canonical])];
}

/** A tenant-scoped connector is selected for every send; expired connections stay expired. */
export async function sendThroughMessagingCapability(registry: ConnectorRegistry, input: { tenantId: string; channel: "email" | "sms"; recipient: string; subject?: string; body: string; idempotencyKey: string }): Promise<{ reference: string; status: "sent" }> {
  let capability = registry.getCapability(input.tenantId, input.channel);
  if (!capability) {
    const installation = registry.getInstallation(input.tenantId, "mock-communication");
    if (installation.state === "not_connected") {
      registry.connectMock(input.tenantId, "mock-communication");
      capability = registry.getCapability(input.tenantId, input.channel);
    } else if (installation.state === "expired") throw new ConnectorError("authorization_expired", "Reconnect messaging", false);
  }
  if (!capability) throw new ConnectorError("connector_unavailable", "Messaging service is unavailable", true);
  return input.channel === "email"
    ? registry.getCapability(input.tenantId, "email")!.sendEmail({ to: input.recipient, subject: input.subject ?? "Service update", body: input.body, idempotencyKey: input.idempotencyKey })
    : registry.getCapability(input.tenantId, "sms")!.sendSms({ to: input.recipient, body: input.body, idempotencyKey: input.idempotencyKey });
}

export async function processOutboundMessage(db: Database, registry: ConnectorRegistry, input: { tenantId: string; messageId: string }, now = new Date()): Promise<"sent" | "suppressed" | "failed" | "skipped"> {
  const [message] = await db.update(outboundMessages).set({ status: "sending", updatedAt: now })
    .where(and(eq(outboundMessages.id, input.messageId), eq(outboundMessages.tenantId, input.tenantId), inArray(outboundMessages.status, ["queued", "retry"])))
    .returning();
  if (!message) return "skipped";
  const capabilityState = await loadTenantCapabilities(db, input.tenantId, now);
  if (!hasUsableFeature(capabilityState, "customer_notifications")) {
    await db.transaction(async (tx) => {
      await tx.update(outboundMessages).set({ status: "suppressed", failureCode: "capability_unavailable", failureMessage: "Customer notifications are not enabled for this business.", updatedAt: now })
        .where(and(eq(outboundMessages.id, message.id), eq(outboundMessages.tenantId, input.tenantId)));
      await tx.insert(communicationEvents).values({
        tenantId: input.tenantId, outboundMessageId: message.id, eventType: "suppressed", occurredAt: now,
        payload: { reason: "capability_unavailable" },
      });
    });
    return "suppressed";
  }
  const preferenceKeys = preferenceKeysForTemplate(message.templateKey);
  const preferences = message.customerId ? await db.select().from(notificationPreferences).where(and(eq(notificationPreferences.tenantId, input.tenantId), eq(notificationPreferences.customerId, message.customerId), inArray(notificationPreferences.eventKey, preferenceKeys))) : [];
  const preference = preferences.find((item) => item.eventKey === message.templateKey) ?? preferences[0];
  const [consent] = message.customerId ? await db.select().from(consentRecords).where(and(eq(consentRecords.tenantId, input.tenantId), eq(consentRecords.customerId, message.customerId), eq(consentRecords.channel, message.channel), eq(consentRecords.category, "transactional"))).orderBy(desc(consentRecords.capturedAt)).limit(1) : [];
  const reason = suppressReason(message, preference, consent);
  if (reason) {
    await db.transaction(async (tx) => {
      await tx.update(outboundMessages).set({ status: "suppressed", failureCode: reason, updatedAt: now }).where(and(eq(outboundMessages.id, message.id), eq(outboundMessages.tenantId, input.tenantId)));
      await tx.insert(communicationEvents).values({ tenantId: input.tenantId, outboundMessageId: message.id, eventType: "suppressed", occurredAt: now, payload: { reason } });
    });
    return "suppressed";
  }
  try {
    const sent = await sendThroughMessagingCapability(registry, { tenantId: input.tenantId, channel: message.channel === "email" ? "email" : "sms", recipient: message.recipient, subject: message.renderedSubject ?? undefined, body: message.renderedBody, idempotencyKey: message.idempotencyKey });
    await db.transaction(async (tx) => {
      await tx.update(outboundMessages).set({ status: "sent", providerReference: sent.reference, sentAt: now, failureCode: null, failureMessage: null, updatedAt: now }).where(and(eq(outboundMessages.id, message.id), eq(outboundMessages.tenantId, input.tenantId)));
      await tx.insert(communicationEvents).values({ tenantId: input.tenantId, outboundMessageId: message.id, eventType: "sent", occurredAt: now, payload: { reference: sent.reference } });
    });
    return "sent";
  } catch (error) {
    const code = error instanceof ConnectorError ? error.code : "provider_error";
    const retryable = error instanceof ConnectorError ? error.retryable : true;
    await db.update(outboundMessages).set({ status: retryable ? "retry" : "failed", failureCode: code, failureMessage: error instanceof Error ? error.message.slice(0, 250) : "Delivery failed", updatedAt: now }).where(and(eq(outboundMessages.id, message.id), eq(outboundMessages.tenantId, input.tenantId)));
    if (retryable) throw error;
    return "failed";
  }
}

/** Recover a worker crash after a message was claimed, and requeue durable retry records. */
export async function enqueuePendingMessages(db: Database, boss: PgBoss, now = new Date()): Promise<number> {
  await db.update(outboundMessages).set({ status: "retry", updatedAt: now }).where(and(eq(outboundMessages.status, "sending"), lt(outboundMessages.updatedAt, new Date(now.getTime() - 15 * 60000))));
  const pending = await db.select({ id: outboundMessages.id, tenantId: outboundMessages.tenantId }).from(outboundMessages).where(inArray(outboundMessages.status, ["queued", "retry"])).limit(100);
  for (const item of pending) await enqueueOutboundMessage(boss, { tenantId: item.tenantId, messageId: item.id });
  return pending.length;
}
