import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  type Database, communicationEvents, consentRecords, hasUsableFeature, loadTenantCapabilities,
  notificationPreferences, outboundMessages, loadEmailBusiness, emailUnsubscribeToken, reservePlatformEmail, openAccountEmail,
  reserveAccountEmail, REMINDER_KEYS, reminderDeadline, domainEvents, auditEvents, invoices,
} from "@modular-crm/db";
import { ConnectorError, type ConnectorRegistry, createPlatformEmailSender, customerEmailParts, type EmailInput } from "@modular-crm/connectors";
import { readServerConfig, DEVELOPMENT_AUTH_SECRET, messagePurpose, type ServerConfig } from "@modular-crm/config";
import type { PgBoss } from "pg-boss";
import { enqueueOutboundMessage } from "./queues.js";
import { hydrateMessagingConnector } from "./messaging-connectors.js";
import { invoiceReminderBody } from "./invoice-reminders-db.js";

type Message = typeof outboundMessages.$inferSelect;
type Preference = typeof notificationPreferences.$inferSelect;
type Consent = typeof consentRecords.$inferSelect;
class MessageSetupError extends Error { readonly code = "business_details_missing"; readonly retryable = false; }

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
  return [...new Set([templateKey, canonical, "general"])];
}

/** A tenant-scoped connector is selected for every send; expired connections stay expired. */
export async function sendThroughMessagingCapability(registry: ConnectorRegistry, input: { tenantId: string; channel: "email" | "sms"; recipient: string; subject?: string; body: string; idempotencyKey: string } & Partial<Pick<EmailInput, "html" | "replyTo" | "unsubscribeUrl">>, allowImplicitMock = true): Promise<{ reference?: string; status: "sent" }> {
  let capability = registry.getCapability(input.tenantId, input.channel);
  if (!capability && allowImplicitMock) {
    const installation = registry.getInstallation(input.tenantId, "mock-communication");
    if (installation.state === "not_connected") {
      registry.connectMock(input.tenantId, "mock-communication");
      capability = registry.getCapability(input.tenantId, input.channel);
    } else if (installation.state === "expired") throw new ConnectorError("authorization_expired", "Reconnect messaging", false);
  }
  if (!capability) throw new ConnectorError("connector_unavailable", "Messaging service is unavailable", true);
  return input.channel === "email"
    ? registry.getCapability(input.tenantId, "email")!.sendEmail({ to: input.recipient, subject: input.subject ?? "Service update", body: input.body, idempotencyKey: input.idempotencyKey, html: input.html, replyTo: input.replyTo, unsubscribeUrl: input.unsubscribeUrl })
    : registry.getCapability(input.tenantId, "sms")!.sendSms({ to: input.recipient, body: input.body, idempotencyKey: input.idempotencyKey });
}

export async function processOutboundMessage(db: Database, registry: ConnectorRegistry, input: { tenantId: string; messageId: string }, now = new Date(), config: ServerConfig = readServerConfig(process.env)): Promise<"sent" | "suppressed" | "failed" | "skipped" | "queued"> {
  const [message] = await db.update(outboundMessages).set({ status: "sending", updatedAt: now })
    .where(and(eq(outboundMessages.id, input.messageId), eq(outboundMessages.tenantId, input.tenantId), inArray(outboundMessages.status, ["queued", "retry"]), or(isNull(outboundMessages.nextSendAt), lte(outboundMessages.nextSendAt, now), lte(outboundMessages.expiresAt, now))))
    .returning();
  if (!message) return "skipped";
  const purpose = messagePurpose(message.category);
  const deadline = purpose === "service" && REMINDER_KEYS.includes(message.templateKey ?? "") && message.jobId ? await reminderDeadline(db, input.tenantId, message.jobId) : undefined;
  if ((message.expiresAt && message.expiresAt <= now) || (deadline && (!deadline.active || !deadline.expiresAt || deadline.expiresAt <= now || (message.expiresAt && message.expiresAt.getTime() !== deadline.expiresAt.getTime())))) {
    await db.transaction(async (tx) => {
      await tx.update(outboundMessages).set({ status: "suppressed", failureCode: "reminder_expired", failureMessage: "This reminder was not sent because the visit has started, ended, or changed.", nextSendAt: null, updatedAt: now }).where(and(eq(outboundMessages.tenantId, input.tenantId), eq(outboundMessages.id, message.id)));
      await tx.insert(communicationEvents).values({ tenantId: input.tenantId, outboundMessageId: message.id, eventType: "suppressed", occurredAt: now, payload: { reason: "reminder_expired" } });
    });
    return "suppressed";
  }
  const capabilityState = await loadTenantCapabilities(db, input.tenantId, now);
  if (purpose !== "account" && !hasUsableFeature(capabilityState, "customer_notifications")) {
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
  const preference = preferenceKeys.map((key) => preferences.find((item) => item.eventKey === key)).find(Boolean);
  const [consent] = message.customerId ? await db.select().from(consentRecords).where(and(eq(consentRecords.tenantId, input.tenantId), eq(consentRecords.customerId, message.customerId), eq(consentRecords.channel, message.channel), eq(consentRecords.category, "transactional"))).orderBy(desc(consentRecords.capturedAt)).limit(1) : [];
  const [marketingConsent] = message.customerId && purpose === "marketing" ? await db.select().from(consentRecords).where(and(eq(consentRecords.tenantId, input.tenantId), eq(consentRecords.customerId, message.customerId), eq(consentRecords.channel, message.channel), eq(consentRecords.category, "marketing"))).orderBy(desc(consentRecords.capturedAt)).limit(1) : [];
  const reason = purpose === "account" ? undefined : suppressReason(message, preference, consent) ?? (marketingConsent?.state === "opted_out" || marketingConsent?.state === "suppressed" ? "customer_unsubscribed" : undefined);
  if (reason) {
    await db.transaction(async (tx) => {
      await tx.update(outboundMessages).set({ status: "suppressed", failureCode: reason, updatedAt: now }).where(and(eq(outboundMessages.id, message.id), eq(outboundMessages.tenantId, input.tenantId)));
      await tx.insert(communicationEvents).values({ tenantId: input.tenantId, outboundMessageId: message.id, eventType: "suppressed", occurredAt: now, payload: { reason } });
    });
    return "suppressed";
  }
  try {
    const channel: "email" | "sms" = message.channel === "email" ? "email" : "sms";
    const selected = purpose === "account" ? { mode: "platform" as const, installationId: undefined } : await hydrateMessagingConnector(db, registry, input.tenantId, channel, config.mockConnectors);
    const business = channel === "email" ? await loadEmailBusiness(db, input.tenantId, message) : undefined;
    if (channel === "email" && purpose === "marketing" && (!message.customerId || !business?.address)) {
      throw new MessageSetupError("Choose a customer and add the business address before sending promotional emails.");
    }
    const unsubscribeUrl = channel === "email" && purpose === "marketing" && message.customerId
      ? new URL(`/email/unsubscribe?token=${emailUnsubscribeToken({ tenantId: input.tenantId, customerId: message.customerId, messageId: message.id }, process.env.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET)}`, config.appBaseUrl).toString() : undefined;
    const reminderBody = message.templateKey === "invoice_overdue" ? await invoiceReminderBody(db, message, now) : undefined;
    if (reminderBody === null) {
      await db.transaction(async tx => {
        await tx.update(outboundMessages).set({ status: "suppressed", failureCode: "invoice_reminder_canceled", failureMessage: "This invoice no longer needs this reminder.", nextSendAt: null, updatedAt: now }).where(and(eq(outboundMessages.tenantId, message.tenantId), eq(outboundMessages.id, message.id)));
        await tx.insert(communicationEvents).values({ tenantId: message.tenantId, outboundMessageId: message.id, eventType: "suppressed", occurredAt: now, payload: { reason: "invoice_reminder_canceled" } });
      });
      return "suppressed";
    }
    const renderedBody = reminderBody ?? (purpose === "account" ? openAccountEmail(message.renderedBody, process.env.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET) : message.renderedBody);
    const parts = business ? customerEmailParts(renderedBody, business, unsubscribeUrl) : { body: renderedBody };
    const request = { tenantId: input.tenantId, channel, recipient: message.recipient, subject: message.renderedSubject ?? "Service update", idempotencyKey: message.idempotencyKey, ...parts };
    if (selected.mode === "platform") {
      const reservation = purpose === "account" ? await reserveAccountEmail(db, message.recipient, now) : await reservePlatformEmail(db, input.tenantId, config.platformEmailLimits, now, purpose);
      if (!reservation.allowed) {
        await db.update(outboundMessages).set({ status: "queued", nextSendAt: reservation.nextSendAt, failureCode: reservation.code, failureMessage: reservation.note, updatedAt: now })
          .where(and(eq(outboundMessages.id, message.id), eq(outboundMessages.tenantId, input.tenantId)));
        return "queued";
      }
    }
    const sent = selected.mode === "platform"
      ? await createPlatformEmailSender(config.smtp, config.environment === "production", business, config.platformName).sendEmail({ ...parts, to: message.recipient, subject: request.subject, idempotencyKey: `${input.tenantId}:${message.idempotencyKey}` })
      : await sendThroughMessagingCapability(registry, request, false);
    await db.transaction(async (tx) => {
      await tx.update(outboundMessages).set({ status: "sent", renderedBody, connectorInstallationId: selected.installationId, providerReference: sent.reference ?? null, sentAt: now, nextSendAt: null, failureCode: null, failureMessage: null, updatedAt: now }).where(and(eq(outboundMessages.id, message.id), eq(outboundMessages.tenantId, input.tenantId)));
      await tx.insert(communicationEvents).values({ tenantId: input.tenantId, outboundMessageId: message.id, eventType: "sent", occurredAt: now, payload: { ...(sent.reference ? { reference: sent.reference } : {}), acceptedByProvider: true, mode: selected.mode, environment: selected.mode === "platform" ? config.environment : selected.mode === "mock" ? "test" : "production" } });
      if (message.templateKey === "invoice_overdue" && message.invoiceId) {
        const [invoice] = await tx.select({ organizationId: invoices.organizationId, locationId: invoices.organizationLocationId }).from(invoices).where(and(eq(invoices.tenantId, message.tenantId), eq(invoices.id, message.invoiceId))).limit(1);
        const payload = { messageId: message.id, recipient: message.recipient };
        await tx.insert(domainEvents).values({ tenantId: message.tenantId, ...invoice, eventType: "invoice.reminder_sent", actorType: "system", entityType: "invoice", entityId: message.invoiceId, occurredAt: now, payload });
        await tx.insert(auditEvents).values({ tenantId: message.tenantId, actorType: "system", action: "invoice.reminder_sent", entityType: "invoice", entityId: message.invoiceId, afterData: payload });
      }
    });
    return "sent";
  } catch (error) {
    const code = error instanceof ConnectorError || error instanceof MessageSetupError ? error.code : "provider_error";
    const retryable = error instanceof ConnectorError || error instanceof MessageSetupError ? error.retryable : true;
    const failureMessage = error instanceof MessageSetupError ? error.message : retryable ? "We couldn’t send this message. We’ll try again." : code === "not_connected" || code === "authorization_expired"
      ? (message.channel === "sms" ? "Connect or reconnect a texting service to send this message." : "Reconnect your email service to send this message.") : "This message wasn’t sent. Check the recipient and email service before retrying.";
    await db.transaction(async (tx) => {
      await tx.update(outboundMessages).set({ status: retryable ? "retry" : "failed", failureCode: code, failureMessage, updatedAt: now }).where(and(eq(outboundMessages.id, message.id), eq(outboundMessages.tenantId, input.tenantId)));
      await tx.insert(communicationEvents).values({ tenantId: input.tenantId, outboundMessageId: message.id, eventType: "failed", occurredAt: now, payload: { code, retryable } });
    });
    if (retryable) throw error;
    return "failed";
  }
}

/** Recover a worker crash after a message was claimed, and requeue durable retry records. */
export async function enqueuePendingMessages(db: Database, boss: PgBoss, now = new Date()): Promise<number> {
  await db.update(outboundMessages).set({ status: "retry", updatedAt: now }).where(and(eq(outboundMessages.status, "sending"), lt(outboundMessages.updatedAt, new Date(now.getTime() - 15 * 60000))));
  const pending = await db.select({ id: outboundMessages.id, tenantId: outboundMessages.tenantId, category: outboundMessages.category }).from(outboundMessages).where(and(inArray(outboundMessages.status, ["queued", "retry"]), or(isNull(outboundMessages.nextSendAt), lte(outboundMessages.nextSendAt, now), lte(outboundMessages.expiresAt, now))))
    .orderBy(sql`case when ${outboundMessages.category}='account' then 0 when ${outboundMessages.category} in ('service','transactional') then 1 else 2 end`, outboundMessages.queuedAt, outboundMessages.id).limit(100);
  for (const item of pending) await enqueueOutboundMessage(boss, { tenantId: item.tenantId, messageId: item.id }, item.category);
  return pending.length;
}
