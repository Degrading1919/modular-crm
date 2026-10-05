import { and, eq, sql } from "drizzle-orm";
import { invoices, paymentAllocations, payments, refunds } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { requireTenantFeature } from "./capability-enforcement";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { updateInvoiceFinancialPosition } from "./invoice-payment-ledger";
import { normalized } from "./sql";

/** Resolve an observed processor outcome, never request another refund. */
export async function handleRefundReview(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (request.method !== "POST" || path.length !== 5 || path[0] !== "invoices" || path[2] !== "refunds" || path[4] !== "resolve") return null;
  requireStaff(actor);
  if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Only the owner can resolve a refund review.", 403);
  requirePermission(actor, "payments.refund");
  await requireTenantFeature(actor.tenantId, "invoicing");
  await requireTenantFeature(actor.tenantId, "payment_collection");
  const invoiceId = z.uuid().parse(path[1]), refundId = z.uuid().parse(path[3]);
  const { outcome } = await readBody(request, z.object({ outcome: z.enum(["refunded", "not_refunded"]) }));
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where tenant_id=${actor.tenantId} and id=${invoiceId} for update`);
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoiceId))).limit(1);
    if (!invoice || (!actor.allLocations && (!invoice.organizationLocationId || !actor.locationIds.has(invoice.organizationLocationId)))) throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
    const [review] = await tx.select().from(refunds).where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.id, refundId))).limit(1);
    if (!review) throw new DomainError("NOT_FOUND", "Refund review not found.", 404);
    const allocations = await tx.select().from(paymentAllocations).where(and(eq(paymentAllocations.tenantId, actor.tenantId), eq(paymentAllocations.paymentId, review.paymentId)));
    const [payment] = await tx.select().from(payments).where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, review.paymentId))).limit(1);
    if (allocations.length !== 1 || allocations[0]!.invoiceId !== invoiceId || !payment || payment.customerId !== invoice.customerId || payment.currency !== invoice.currency) throw new DomainError("NOT_FOUND", "Refund review not found for this invoice.", 404);
    if (review.reviewResolution) {
      if (review.reviewResolution !== outcome) throw new DomainError("CONFLICT", "This refund review has already been resolved differently. Review the recorded outcome with your office.", 409);
      return { item: review, duplicate: true, balanceCents: Number(invoice.balanceMinor) };
    }
    if (!review.reviewReason) throw new DomainError("CONFLICT", "This refund does not need review.", 409);
    const [saved] = await tx.update(refunds).set({ status: outcome === "refunded" ? "succeeded" : "failed", reviewReason: null, reviewResolution: outcome, completedAt: new Date() }).where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.id, refundId))).returning();
    const ledger = await tx.select().from(refunds).where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.paymentId, payment.id), eq(refunds.status, "succeeded")));
    const refunded = ledger.reduce((sum, row) => sum + row.amountMinor, 0n);
    await tx.update(payments).set({ status: refunded >= payment.amountMinor ? "refunded" : refunded > 0n ? "partially_refunded" : "succeeded", updatedAt: new Date() }).where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, payment.id)));
    const balanceCents = await updateInvoiceFinancialPosition(tx, invoice);
    await recordEvent(actor, { type: "payment.refund_review_resolved", entityType: "refund", entityId: refundId, auditAction: "payment.refund_review_resolve",
      payload: { invoiceId, paymentId: payment.id, outcome, amountCents: Number(review.amountMinor) }, locationId: invoice.organizationLocationId,
      before: { status: review.status, reviewReason: review.reviewReason, balanceCents: Number(invoice.balanceMinor) }, after: { outcome, status: saved!.status, balanceCents } }, tx);
    if (outcome === "refunded" && review.status !== "succeeded") await recordEvent(actor, { type: "payment.refunded", entityType: "refund", entityId: refundId,
      payload: { invoiceId, paymentId: payment.id, customerId: invoice.customerId, amountCents: Number(review.amountMinor), currency: invoice.currency }, locationId: invoice.organizationLocationId }, tx);
    return { item: saved!, duplicate: false, balanceCents };
  });
  // Financial references stay server-side, just as in the regular refund form.
  return json({ item: normalized({ id: result.item.id, paymentId: result.item.paymentId, amountMinor: result.item.amountMinor, currency: result.item.currency, status: result.item.status }), duplicate: result.duplicate, invoice: { id: invoiceId, balanceCents: result.balanceCents } });
}
