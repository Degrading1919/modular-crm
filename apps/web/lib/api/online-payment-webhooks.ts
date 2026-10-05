import { createHash } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { auditEvents, connectorInstallations, domainEvents, invoices, onlinePaymentAccounts, onlinePaymentEvents, onlinePaymentSessions, paymentAllocations, payments, refunds } from "@modular-crm/db";
import { ConnectorError, createMockOnlinePayments, type OnlinePaymentEvent } from "@modular-crm/connectors";
import { DomainError } from "@modular-crm/domain";
import { getRegistry } from "../connectors";
import { getDb } from "../db";
import { onlineProviderConfigured, paymentAccountHash } from "./online-payment-accounts";
import { updateInvoiceFinancialPosition, type PaymentTransaction } from "./invoice-payment-ledger";
import { json } from "./http";
import { expireExcessHostedPages } from "./hosted-page-expiry";

async function eventHistory(tx: PaymentTransaction, invoice: typeof invoices.$inferSelect, installationId: string, event: Extract<OnlinePaymentEvent, { paymentReference: string }>, entityId: string) {
  await tx.insert(domainEvents).values({ tenantId: invoice.tenantId, organizationId: invoice.organizationId, locationId: invoice.organizationLocationId,
    actorType: "connector", actorId: installationId, eventType: event.type, entityType: ["payment.refunded", "refund.failed"].includes(event.type) ? "refund" : "payment", entityId,
    payload: { invoiceId: invoice.id, customerId: invoice.customerId, amountCents: event.amountMinor, currency: invoice.currency, method: "card" } });
  await tx.insert(auditEvents).values({ tenantId: invoice.tenantId, actorType: "connector", actorId: installationId, action: event.type, entityType: "invoice", entityId: invoice.id, afterData: { amountCents: event.amountMinor } });
}

/** Both real and mock signed delivery use this locked, durable, account-bound ledger path. */
export async function processOnlinePaymentEvent(provider: string, event: OnlinePaymentEvent, payloadHash: string): Promise<{ duplicate: boolean; ignored?: boolean }> {
  const db = getDb();
  const [account] = await db.select().from(onlinePaymentAccounts).where(and(eq(onlinePaymentAccounts.provider, provider), eq(onlinePaymentAccounts.accountHash, paymentAccountHash(event.accountReference)))).limit(1);
  if (!account) return { duplicate: false, ignored: true }; // Another platform's connected account is not ours.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from online_payment_accounts where tenant_id=${account.tenantId} and id=${account.id} for update`);
    const [priorEvent] = await tx.select().from(onlinePaymentEvents).where(and(eq(onlinePaymentEvents.accountId, account.id), eq(onlinePaymentEvents.providerEventId, event.id))).limit(1);
    if (priorEvent) {
      if (priorEvent.payloadHash !== payloadHash) throw new DomainError("CONFLICT", "Payment notification changed after processing.", 409);
      return { duplicate: true };
    }
    if (event.type === "account.updated") {
      const [installation] = await tx.select().from(connectorInstallations).where(and(eq(connectorInstallations.tenantId, account.tenantId), eq(connectorInstallations.id, account.installationId))).limit(1);
      // Health notifications must not reconnect an owner-disconnected account.
      await tx.update(onlinePaymentAccounts).set({ chargesEnabled: installation?.status !== "not_connected" && event.chargesEnabled, detailsNeeded: event.detailsNeeded }).where(eq(onlinePaymentAccounts.id, account.id));
      if (installation?.status !== "not_connected") await tx.update(connectorInstallations).set({ status: event.chargesEnabled ? "connected" : "needs_attention", healthCheckedAt: new Date() }).where(and(eq(connectorInstallations.tenantId, account.tenantId), eq(connectorInstallations.id, account.installationId)));
    } else if (event.type === "payment.refunded" || event.type === "refund.failed") {
      const [payment] = await tx.select().from(payments).where(and(eq(payments.tenantId, account.tenantId), eq(payments.connectorInstallationId, account.installationId), eq(payments.providerReference, event.paymentReference))).limit(1);
      if (!payment || !event.refundReference) throw new DomainError("CONFLICT", "Payment confirmation has not arrived yet. Deliver this notification again.", 409);
      const [allocation] = await tx.select().from(paymentAllocations).where(and(eq(paymentAllocations.tenantId, account.tenantId), eq(paymentAllocations.paymentId, payment.id))).limit(1);
      if (!allocation) throw new DomainError("CONFLICT", "Payment confirmation is still being recorded.", 409);
      await tx.execute(sql`select id from invoices where tenant_id=${account.tenantId} and id=${allocation.invoiceId} for update`);
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, account.tenantId), eq(invoices.id, allocation.invoiceId), eq(invoices.organizationId, account.organizationId))).limit(1);
      if (!invoice || payment.currency !== event.currency || invoice.currency !== event.currency) throw new DomainError("CONFLICT", "Payment notification does not match this invoice.", 409);
      const refundRows = await tx.select().from(refunds).where(and(eq(refunds.tenantId, account.tenantId), eq(refunds.paymentId, payment.id)));
      const prior = refundRows.find((row) => row.providerReference === event.refundReference || (row.id === event.refundRequestReference && row.status === "pending"));
      if (prior && prior.amountMinor !== BigInt(event.amountMinor)) throw new DomainError("CONFLICT", "Refund notification does not match the requested amount.", 409);
      if (prior?.reviewReason) {
        // Reconciliation has a durable end state; repeated notifications cannot change money.
      } else if (event.type === "refund.failed") {
        if (prior?.status === "succeeded") {
          await tx.update(refunds).set({ reviewReason: "A previously confirmed refund later failed. Check the payment service before changing or refunding this payment again." }).where(eq(refunds.id, prior.id));
          await eventHistory(tx, invoice, account.installationId, event, prior.id);
        }
        // Release only an unconfirmed reservation. A late failure never undoes refunded money.
        if (prior && prior.status !== "succeeded" && prior.status !== "failed") {
          await tx.update(refunds).set({ status: "failed", providerReference: event.refundReference, completedAt: new Date() }).where(and(eq(refunds.id, prior.id), eq(refunds.tenantId, account.tenantId)));
          await eventHistory(tx, invoice, account.installationId, event, prior.id);
        }
      } else if (prior?.status !== "succeeded") {
        const total = refundRows.filter((row) => row.status === "succeeded").reduce((sum, row) => sum + row.amountMinor, 0n) + BigInt(event.amountMinor);
        if (total > payment.amountMinor) {
          const reviewReason = "The confirmed refund exceeds the recorded payment after other refunds. Check the payment service before refunding again.";
          let reviewId = prior?.id;
          if (prior) await tx.update(refunds).set({ providerReference: event.refundReference, reviewReason, completedAt: new Date() }).where(eq(refunds.id, prior.id));
          else {
            const [review] = await tx.insert(refunds).values({ tenantId: account.tenantId, paymentId: payment.id, connectorInstallationId: account.installationId, providerReference: event.refundReference,
              amountMinor: BigInt(event.amountMinor), currency: event.currency, status: "pending", reviewReason, completedAt: new Date() }).returning();
            reviewId = review!.id;
          }
          // Review is not a successful refund and must not trigger refund receipt automations.
          await tx.insert(domainEvents).values({ tenantId: invoice.tenantId, organizationId: invoice.organizationId, locationId: invoice.organizationLocationId,
            actorType: "connector", actorId: account.installationId, eventType: "payment.refund_needs_review", entityType: "refund", entityId: reviewId!, payload: { invoiceId: invoice.id, amountCents: event.amountMinor, currency: invoice.currency } });
          await tx.insert(auditEvents).values({ tenantId: invoice.tenantId, actorType: "connector", actorId: account.installationId, action: "payment.refund_needs_review", entityType: "invoice", entityId: invoice.id, afterData: { amountCents: event.amountMinor, reviewReason } });
          await tx.insert(onlinePaymentEvents).values({ tenantId: account.tenantId, accountId: account.id, providerEventId: event.id, payloadHash });
          return { duplicate: false };
        }
        let refundId = prior?.id;
        if (prior) await tx.update(refunds).set({ status: "succeeded", providerReference: event.refundReference, completedAt: new Date() }).where(and(eq(refunds.id, prior.id), eq(refunds.tenantId, account.tenantId)));
        else {
          const [created] = await tx.insert(refunds).values({ tenantId: account.tenantId, paymentId: payment.id, connectorInstallationId: account.installationId,
            providerReference: event.refundReference, amountMinor: BigInt(event.amountMinor), currency: event.currency, status: "succeeded", completedAt: new Date() }).returning();
          refundId = created!.id;
        }
        await tx.update(payments).set({ status: total === payment.amountMinor ? "refunded" : "partially_refunded", updatedAt: new Date() }).where(and(eq(payments.id, payment.id), eq(payments.tenantId, account.tenantId)));
        await updateInvoiceFinancialPosition(tx, invoice);
        await eventHistory(tx, invoice, account.installationId, event, refundId!);
      }
    } else {
      const [session] = await tx.select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.tenantId, account.tenantId), eq(onlinePaymentSessions.accountId, account.id), or(eq(onlinePaymentSessions.providerReference, event.sessionReference ?? ""),
        ...(event.sessionRequestReference && /^[0-9a-f-]{36}$/i.test(event.sessionRequestReference) ? [and(eq(onlinePaymentSessions.id, event.sessionRequestReference), event.sessionReference ? isNull(onlinePaymentSessions.providerReference) : undefined)] : [])))).limit(1);
      if (!session) throw new DomainError("CONFLICT", "The payment page is still being recorded. Deliver this notification again.", 409);
      if (session.amountMinor !== BigInt(event.amountMinor) || session.currency !== event.currency) throw new DomainError("CONFLICT", "Payment notification does not match the payment page.", 409);
      if (!session.providerReference && event.sessionReference) await tx.update(onlinePaymentSessions).set({ providerReference: event.sessionReference }).where(eq(onlinePaymentSessions.id, session.id));
      await tx.execute(sql`select id from invoices where tenant_id=${account.tenantId} and id=${session.invoiceId} for update`);
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, account.tenantId), eq(invoices.id, session.invoiceId), eq(invoices.organizationId, account.organizationId))).limit(1);
      if (!invoice || invoice.currency !== event.currency) throw new DomainError("CONFLICT", "Payment notification does not match this invoice.", 409);
      if (session.paymentReference && session.paymentReference !== event.paymentReference) throw new DomainError("CONFLICT", "Payment notification does not match the recorded payment.", 409);
      if (event.type === "payment.failed") {
        // A late failure cannot undo a confirmed payment or refund.
        if (session.status !== "succeeded") {
          await tx.update(onlinePaymentSessions).set({ status: "failed", paymentReference: event.paymentReference, failureMessage: "The card payment did not go through. Try another card or contact your service team." }).where(eq(onlinePaymentSessions.id, session.id));
          if (session.status !== "failed") await eventHistory(tx, invoice, account.installationId, event, session.id);
        }
      } else if (session.status !== "succeeded") {
        const key = `hosted:${account.id}:${event.paymentReference}`;
        const [existing] = await tx.select().from(payments).where(and(eq(payments.tenantId, account.tenantId), eq(payments.idempotencyKey, key))).limit(1);
        if (existing) throw new DomainError("CONFLICT", "This payment has already been applied to another payment page.", 409);
        const [payment] = await tx.insert(payments).values({ id: session.id, tenantId: account.tenantId, customerId: invoice.customerId, status: "succeeded",
          sourceType: provider === "mock-payments" ? "mock" : "connector", recordedMethod: "card", connectorInstallationId: account.installationId, providerReference: event.paymentReference,
          amountMinor: BigInt(event.amountMinor), currency: event.currency, feeMinor: event.feeMinor === undefined ? null : BigInt(event.feeMinor), receivedAt: new Date(), idempotencyKey: key,
          recordedByActorType: "connector", recordedByActorId: account.installationId }).returning();
        await tx.insert(paymentAllocations).values({ tenantId: account.tenantId, paymentId: payment!.id, invoiceId: invoice.id, amountMinor: BigInt(event.amountMinor) });
        await updateInvoiceFinancialPosition(tx, invoice, invoice.paidMinor + BigInt(event.amountMinor));
        await tx.update(onlinePaymentSessions).set({ status: "succeeded", paymentReference: event.paymentReference, failureMessage: null }).where(eq(onlinePaymentSessions.id, session.id));
        await eventHistory(tx, invoice, account.installationId, event, payment!.id);
      }
    }
    await tx.insert(onlinePaymentEvents).values({ tenantId: account.tenantId, accountId: account.id, providerEventId: event.id, payloadHash });
    return { duplicate: false };
  });
  if (event.type === "payment.succeeded") {
    const [session] = await db.select({ invoiceId: onlinePaymentSessions.invoiceId }).from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.tenantId, account.tenantId), eq(onlinePaymentSessions.accountId, account.id), eq(onlinePaymentSessions.paymentReference, event.paymentReference))).limit(1);
    if (session) await expireExcessHostedPages(account.tenantId, session.invoiceId);
  }
  return result;
}

export async function handleOnlinePaymentWebhook(request: Request, path: string[]): Promise<Response | null> {
  if (path.length !== 3 || path[0] !== "payments" || path[1] !== "webhooks") return null;
  if (request.method !== "POST") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  const provider = path[2]!;
  if (!onlineProviderConfigured(provider)) throw new DomainError("NOT_FOUND", "Payment service is unavailable.", 404);
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000) { await reader.cancel(); throw new DomainError("VALIDATION_ERROR", "Payment notification is too large.", 413); }
      chunks.push(chunk.value);
    }
  }
  let rawBody: string;
  // Preserve a leading BOM too: no byte may be silently removed before HMAC verification.
  try { rawBody = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); }
  catch { throw new DomainError("VALIDATION_ERROR", "Payment notification could not be verified.", 400); }
  const capability = provider === "mock-payments" ? createMockOnlinePayments("", () => {}) : getRegistry().getDefinition(provider)?.createConfiguredScope?.({ tenantId: "webhook", credentials: {}, now: () => new Date(), ensureAvailable: () => {} }).payments?.online;
  try {
    const event = capability?.verifyWebhook({ rawBody, signature: request.headers.get("stripe-signature") ?? request.headers.get("payment-signature") ?? "" });
    if (!event) return json({ accepted: true, ignored: true });
    const result = await processOnlinePaymentEvent(provider, event, createHash("sha256").update(rawBody).digest("hex"));
    return json({ accepted: true, ...result });
  } catch (error) {
    if (error instanceof ConnectorError) throw new DomainError("VALIDATION_ERROR", "Payment notification could not be verified.", 400);
    throw error;
  }
}
