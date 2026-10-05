import { and, eq, inArray, sql } from "drizzle-orm";
import { invoices, onlinePaymentAccounts, paymentAllocations, payments, refunds } from "@modular-crm/db";
import { ConnectorError, signMockPaymentEvent } from "@modular-crm/connectors";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { requireTenantFeature } from "./capability-enforcement";
import { json, readBody } from "./http";
import { onlineForAccount } from "./online-payment-accounts";
import { readableOnlineInvoice } from "./online-payment-sessions";
import { handleOnlinePaymentWebhook } from "./online-payment-webhooks";
import { refundId } from "./refunds";
import { normalized } from "./sql";

export async function handleOnlinePaymentRefund(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length !== 3 || path[0] !== "invoices" || path[2] !== "refunds" || request.method !== "POST") return null;
  // Inspect a cloned body to leave the existing manual/test refund path unchanged.
  const raw = await request.clone().json() as { paymentId?: string };
  if (typeof raw.paymentId !== "string" || !z.uuid().safeParse(raw.paymentId).success) return null;
  const [payment] = await getDb().select().from(payments).where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, raw.paymentId))).limit(1);
  if (!payment || payment.recordedMethod !== "card") return null;
  requireStaff(actor);
  if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Only the owner can refund an online payment.", 403);
  requirePermission(actor, "payments.refund");
  await requireTenantFeature(actor.tenantId, "invoicing");
  await requireTenantFeature(actor.tenantId, "payment_collection");
  const invoice = await readableOnlineInvoice(actor, path[1]!, false);
  const body = await readBody(request, z.object({ paymentId: z.uuid(), amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), reason: z.string().trim().max(500).optional(), idempotencyKey: z.string().trim().min(1).max(200).optional() }).strict());
  const key = (request.headers.get("idempotency-key") ?? body.idempotencyKey)?.trim();
  if (!key || key.length > 200) throw new DomainError("VALIDATION_ERROR", "Provide a refund retry key.", 422);
  const id = refundId(actor.tenantId, invoice.id, key);
  const [account] = await getDb().select().from(onlinePaymentAccounts).where(and(eq(onlinePaymentAccounts.tenantId, actor.tenantId), eq(onlinePaymentAccounts.installationId, payment.connectorInstallationId ?? ""), eq(onlinePaymentAccounts.organizationId, invoice.organizationId))).limit(1);
  if (!account || !payment.providerReference) throw new DomainError("NOT_FOUND", "Payment not found for this invoice.", 404);
  const online = await onlineForAccount(account, true); // Disconnect stops new collection, not refunds of historical money.
  const pending = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where tenant_id=${actor.tenantId} and id=${invoice.id} for update`);
    const [allocation] = await tx.select().from(paymentAllocations).where(and(eq(paymentAllocations.tenantId, actor.tenantId), eq(paymentAllocations.invoiceId, invoice.id), eq(paymentAllocations.paymentId, payment.id))).limit(1);
    if (!allocation) throw new DomainError("NOT_FOUND", "Payment not found for this invoice.", 404);
    const [prior] = await tx.select().from(refunds).where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.id, id))).limit(1);
    if (prior) {
      if (prior.paymentId !== payment.id || prior.amountMinor !== BigInt(body.amountCents) || (prior.reason ?? "") !== (body.reason ?? "")) throw new DomainError("IDEMPOTENCY_CONFLICT", "This refund retry key was used for a different request.", 409);
      return prior;
    }
    const reserved = await tx.select().from(refunds).where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.paymentId, payment.id), inArray(refunds.status, ["pending", "succeeded"])));
    if (BigInt(body.amountCents) > payment.amountMinor - reserved.reduce((sum, row) => sum + row.amountMinor, 0n)) throw new DomainError("VALIDATION_ERROR", "Refund exceeds the amount available after completed and pending refunds.", 422);
    const [created] = await tx.insert(refunds).values({ id, tenantId: actor.tenantId, paymentId: payment.id, connectorInstallationId: account.installationId, amountMinor: BigInt(body.amountCents), currency: payment.currency, status: "pending", reason: body.reason || null }).returning();
    return created!;
  });
  if (pending.status === "pending" && !pending.providerReference) {
    if (pending.createdAt.getTime() < Date.now() - 23 * 60 * 60 * 1000) throw new DomainError("CONFLICT", "This refund needs a payment-service review before it can be retried. Do not start another refund for the same amount.", 409);
    let reference: string;
    try { reference = (await online.requestRefund({ paymentReference: payment.providerReference, amountMinor: body.amountCents, idempotencyKey: `refund:${id}`, requestReference: id })).reference; }
    catch (error) {
      if (error instanceof ConnectorError) throw new DomainError("EXTERNAL_SERVICE_ERROR", "The refund has not been confirmed. Keep this request and try again; do not submit a different refund.", 503);
      throw error;
    }
    await getDb().update(refunds).set({ providerReference: reference }).where(and(eq(refunds.id, id), eq(refunds.tenantId, actor.tenantId), eq(refunds.status, "pending")));
  }
  if (pending.status === "pending" && account.provider === "mock-payments") {
      const [saved] = await getDb().select().from(refunds).where(and(eq(refunds.id, id), eq(refunds.tenantId, actor.tenantId))).limit(1);
      const reference = saved!.providerReference!;
      const status = await online.accountStatus();
      const signed = signMockPaymentEvent({ id: `event_${reference}`, accountReference: status.accountReference, type: "payment.refunded", paymentReference: payment.providerReference,
        refundReference: reference, refundRequestReference: id, amountMinor: body.amountCents, currency: payment.currency });
      await handleOnlinePaymentWebhook(new Request("http://localhost/api/v1/payments/webhooks/mock-payments", { method: "POST", headers: { "payment-signature": signed.signature }, body: signed.rawBody }), ["payments", "webhooks", "mock-payments"]);
  }
  const [current] = await getDb().select().from(invoices).where(and(eq(invoices.id, invoice.id), eq(invoices.tenantId, actor.tenantId))).limit(1);
  const [result] = await getDb().select().from(refunds).where(and(eq(refunds.id, id), eq(refunds.tenantId, actor.tenantId))).limit(1);
  return json({ item: normalized({ id, paymentId: payment.id, amountMinor: result!.amountMinor, currency: result!.currency, status: result!.status }), invoice: { id: invoice.id, balanceCents: Number(current!.balanceMinor) } }, 202);
}
