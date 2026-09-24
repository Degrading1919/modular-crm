import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { creditAllocations, invoices, paymentAllocations, payments, refunds } from "@modular-crm/db";
import { DomainError, invoiceFinancialPosition, requirePermission } from "@modular-crm/domain";
import { ConnectorError } from "@modular-crm/connectors";
import { getCapability } from "../connectors";
import { getDb } from "../db";
import { requireTenantFeature } from "./capability-enforcement";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized } from "./sql";
import { z } from "zod";

const refundRequest = z.object({
  paymentId: z.uuid(),
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

function refundId(tenantId: string, invoiceId: string, key: string): string {
  const bytes = createHash("sha256").update(`${tenantId}:${invoiceId}:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function visibleRefund(row: typeof refunds.$inferSelect) {
  // Processor references are intentionally kept server-side.
  return normalized({ id: row.id, paymentId: row.paymentId, amountMinor: row.amountMinor, currency: row.currency, status: row.status, reason: row.reason, createdAt: row.createdAt });
}

/** Handles POST /api/v1/invoices/:invoiceId/refunds. */
export async function handleInvoiceRefund(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length !== 3 || path[0] !== "invoices" || !["refunds", "payments"].includes(path[2] ?? "")) return null;
  const invoiceId = path[1];
  if (!invoiceId) return null;

  if (request.method === "GET" && path[2] === "payments") {
    requireStaff(actor);
    requirePermission(actor, "invoices.read");
    const db = getDb();
    const [invoice] = await db.select({ id: invoices.id, organizationLocationId: invoices.organizationLocationId })
      .from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, actor.tenantId))).limit(1);
    if (!invoice || (!actor.allLocations && (!invoice.organizationLocationId || !actor.locationIds.has(invoice.organizationLocationId)))) {
      throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
    }
    const allocated = await db.select({ payment: payments, allocation: paymentAllocations })
      .from(paymentAllocations)
      .innerJoin(payments, and(eq(payments.id, paymentAllocations.paymentId), eq(payments.tenantId, paymentAllocations.tenantId)))
      .where(and(eq(paymentAllocations.tenantId, actor.tenantId), eq(paymentAllocations.invoiceId, invoiceId)));
    const ids = allocated.map(({ payment }) => payment.id);
    const refundRows = ids.length
      ? await db.select({ paymentId: refunds.paymentId, amountMinor: refunds.amountMinor }).from(refunds)
        .where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.status, "succeeded"), inArray(refunds.paymentId, ids)))
      : [];
    const refundedByPayment = new Map<string, bigint>();
    for (const refund of refundRows) refundedByPayment.set(refund.paymentId, (refundedByPayment.get(refund.paymentId) ?? 0n) + refund.amountMinor);
    return json({ items: allocated.map(({ payment, allocation }) => normalized({
      id: payment.id,
      amountCents: allocation.amountMinor,
      refundedCents: refundedByPayment.get(payment.id) ?? 0n,
      status: payment.status,
      sourceType: payment.sourceType,
      createdAt: payment.createdAt,
    })) });
  }

  if (request.method !== "POST" || path[2] !== "refunds") return null;

  requireStaff(actor);
  requirePermission(actor, "payments.refund");
  await requireTenantFeature(actor.tenantId, "invoicing");
  await requireTenantFeature(actor.tenantId, "payment_collection");

  const body = await readBody(request, refundRequest);
  const clientKey = (request.headers.get("idempotency-key") ?? body.idempotencyKey)?.trim();
  if (!clientKey || clientKey.length > 200) throw new DomainError("VALIDATION_ERROR", "Provide a refund retry key.", 422);
  const id = refundId(actor.tenantId, invoiceId, clientKey);
  const idempotencyKey = `refund:${id}`;
  const db = getDb();
  // Hydrate before opening the transaction because connector setup may read from the database.
  const capability = await getCapability(actor.tenantId, "payments");

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM invoices WHERE tenant_id = ${actor.tenantId} AND id = ${invoiceId} FOR UPDATE`);
    const [invoice] = await tx.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, actor.tenantId))).limit(1);
    if (!invoice || (!actor.allLocations && (!invoice.organizationLocationId || !actor.locationIds.has(invoice.organizationLocationId)))) {
      throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
    }

    const [prior] = await tx.select().from(refunds).where(and(eq(refunds.id, id), eq(refunds.tenantId, actor.tenantId))).limit(1);
    if (prior) {
      if (prior.paymentId !== body.paymentId || prior.amountMinor !== BigInt(body.amountCents) || (prior.reason ?? "") !== (body.reason ?? "")) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This refund retry key was used for a different request.", 409);
      }
      return { refund: prior, duplicate: true, balanceCents: Number(invoice.balanceMinor) };
    }

    await tx.execute(sql`SELECT id FROM payments WHERE tenant_id = ${actor.tenantId} AND id = ${body.paymentId} FOR UPDATE`);
    const [payment] = await tx.select().from(payments)
      .where(and(eq(payments.id, body.paymentId), eq(payments.tenantId, actor.tenantId))).limit(1);
    if (!payment) throw new DomainError("NOT_FOUND", "Payment not found for this invoice.", 404);
    if (!invoice.customerId || payment.customerId !== invoice.customerId || payment.currency !== invoice.currency) {
      throw new DomainError("NOT_FOUND", "Payment not found for this invoice.", 404);
    }
    if (!["paid", "partially_paid", "overdue"].includes(invoice.status)) {
      throw new DomainError("INVALID_TRANSITION", "Only an issued invoice with collected payments can be refunded.", 409);
    }

    const allocations = await tx.select().from(paymentAllocations)
      .where(and(eq(paymentAllocations.tenantId, actor.tenantId), eq(paymentAllocations.paymentId, payment.id)));
    const allocation = allocations.find((item) => item.invoiceId === invoiceId);
    if (!allocation) throw new DomainError("NOT_FOUND", "Payment not found for this invoice.", 404);
    if (allocations.length !== 1) {
      throw new DomainError("CONFLICT", "This payment is not exclusively allocated to the invoice and cannot be refunded here.", 409);
    }
    if (!["succeeded", "partially_refunded"].includes(payment.status)) {
      throw new DomainError("INVALID_TRANSITION", "Only a successful payment can be refunded.", 409);
    }

    const existingRefunds = await tx.select().from(refunds)
      .where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.paymentId, payment.id), eq(refunds.status, "succeeded")));
    const refundedMinor = existingRefunds.reduce((sum, item) => sum + item.amountMinor, 0n);
    const refundableMinor = (allocation.amountMinor < payment.amountMinor ? allocation.amountMinor : payment.amountMinor) - refundedMinor;
    const amountMinor = BigInt(body.amountCents);
    if (amountMinor > refundableMinor) throw new DomainError("VALIDATION_ERROR", "Refund exceeds the amount collected for this invoice.", 422);
    let providerReference: string | null = null;
    if (payment.sourceType === "mock") {
      if (!capability || !payment.providerReference) throw new DomainError("EXTERNAL_SERVICE_ERROR", "The connected test payment service cannot refund this payment.", 503);
      try {
        const outcome = await capability.refund({ paymentReference: payment.providerReference, amountMinor: body.amountCents, idempotencyKey });
        if (outcome.status !== "succeeded" || outcome.amountMinor !== body.amountCents) {
          throw new DomainError("EXTERNAL_SERVICE_ERROR", "The payment service did not confirm the refund.", 503);
        }
        providerReference = outcome.reference;
      } catch (error) {
        if (error instanceof DomainError) throw error;
        if (error instanceof ConnectorError && error.code === "invalid_request") {
          throw new DomainError("VALIDATION_ERROR", "The payment service rejected this refund.", 422);
        }
        throw new DomainError("EXTERNAL_SERVICE_ERROR", "The payment service could not complete this refund.", 503);
      }
    } else if (payment.sourceType !== "manual") {
      throw new DomainError("EXTERNAL_SERVICE_ERROR", "Refunds for this payment source are not available here.", 503);
    }

    const now = new Date();
    const [refund] = await tx.insert(refunds).values({
      id, tenantId: actor.tenantId, paymentId: payment.id, providerReference,
      amountMinor, currency: invoice.currency, status: "succeeded", reason: body.reason || null, createdAt: now, completedAt: now,
    }).returning();
    if (!refund) throw new Error("Could not record the refund.");

    const nextRefundedMinor = refundedMinor + amountMinor;
    const nextPaymentStatus = nextRefundedMinor >= payment.amountMinor ? "refunded" : "partially_refunded";
    await tx.update(payments).set({ status: nextPaymentStatus, updatedAt: now })
      .where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, payment.id)));

    const invoiceAllocations = await tx.select({ paymentId: paymentAllocations.paymentId })
      .from(paymentAllocations).where(and(eq(paymentAllocations.tenantId, actor.tenantId), eq(paymentAllocations.invoiceId, invoiceId)));
    const invoicePaymentIds = invoiceAllocations.map((item) => item.paymentId);
    const invoiceRefundRows = invoicePaymentIds.length
      ? await tx.select({ amountMinor: refunds.amountMinor }).from(refunds)
        .where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.status, "succeeded"), inArray(refunds.paymentId, invoicePaymentIds)))
      : [];
    const totalRefundedMinor = invoiceRefundRows.reduce((sum, item) => sum + item.amountMinor, 0n);
    const creditRows = await tx.select({ amountMinor: creditAllocations.amountMinor }).from(creditAllocations)
      .where(and(eq(creditAllocations.tenantId, actor.tenantId), eq(creditAllocations.invoiceId, invoiceId)));
    const creditedMinor = creditRows.reduce((sum, item) => sum + item.amountMinor, 0n);
    let position: ReturnType<typeof invoiceFinancialPosition>;
    try {
      position = invoiceFinancialPosition(Number(invoice.totalMinor), Number(invoice.paidMinor), Number(totalRefundedMinor), Number(creditedMinor));
    } catch (error) {
      if (error instanceof DomainError && error.code === "VALIDATION_ERROR") {
        throw new DomainError("CONFLICT", "Refund would exceed the amount collected for this invoice.", 409);
      }
      throw error;
    }
    const balanceMinor = BigInt(position.balanceCents);
    const balanceCents = position.balanceCents;
    await tx.update(invoices).set({ balanceMinor, status: position.status, updatedAt: now })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, actor.tenantId)));
    await recordEvent(actor, {
      type: "payment.refunded", entityType: "refund", entityId: refund.id,
      payload: { invoiceId, paymentId: payment.id, amountCents: body.amountCents, currency: invoice.currency },
      auditAction: "payment.refund", before: { balanceCents: Number(invoice.balanceMinor) }, after: { balanceCents },
      locationId: invoice.organizationLocationId,
    }, tx);
    return { refund, duplicate: false, balanceCents };
  });

  return json({ item: visibleRefund(result.refund), duplicate: result.duplicate, invoice: { id: invoiceId, balanceCents: result.balanceCents } }, result.duplicate ? 200 : 201);
}
