import { and, eq, gt, inArray } from "drizzle-orm";
import { creditAllocations, invoices, onlinePaymentSessions, paymentAllocations, refunds } from "@modular-crm/db";
import { invoiceFinancialPosition } from "@modular-crm/domain";
import type { getDb } from "../db";

export type PaymentTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
/** Called under the invoice lock by manual/mock/hosted payments and refunds alike. */
export async function updateInvoiceFinancialPosition(tx: PaymentTransaction, invoice: typeof invoices.$inferSelect, paidMinor = invoice.paidMinor): Promise<number> {
  const allocations = await tx.select({ paymentId: paymentAllocations.paymentId }).from(paymentAllocations)
    .where(and(eq(paymentAllocations.tenantId, invoice.tenantId), eq(paymentAllocations.invoiceId, invoice.id)));
  const paymentIds = allocations.map((row) => row.paymentId);
  const refundRows = paymentIds.length ? await tx.select({ amountMinor: refunds.amountMinor, reviewResolution: refunds.reviewResolution }).from(refunds)
    .where(and(eq(refunds.tenantId, invoice.tenantId), eq(refunds.status, "succeeded"), inArray(refunds.paymentId, paymentIds))) : [];
  const credits = await tx.select({ amountMinor: creditAllocations.amountMinor }).from(creditAllocations)
    .where(and(eq(creditAllocations.tenantId, invoice.tenantId), eq(creditAllocations.invoiceId, invoice.id)));
  const position = invoiceFinancialPosition(Number(invoice.totalMinor), Number(paidMinor), Number(refundRows.reduce((sum, row) => sum + row.amountMinor, 0n)), Number(credits.reduce((sum, row) => sum + row.amountMinor, 0n)), { confirmedExcessRefund: refundRows.some((row) => row.reviewResolution === "refunded") });
  // A delayed processor confirmation cannot silently resurrect a void/written-off invoice.
  await tx.update(invoices).set({ paidMinor, balanceMinor: BigInt(position.balanceCents),
    status: ["void", "written_off"].includes(invoice.status) ? invoice.status : position.status, updatedAt: new Date() })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.tenantId, invoice.tenantId)));
  // This local invalidation shares the financial transaction. Network expiry is
  // performed only after commit; a lost processor response stays visibly pending.
  const collectible = ["void", "written_off"].includes(invoice.status) || invoice.voidedAt || invoice.writtenOffAt ? 0n : BigInt(position.balanceCents);
  await tx.update(onlinePaymentSessions).set({ status: "expire_pending" }).where(and(
    eq(onlinePaymentSessions.tenantId, invoice.tenantId), eq(onlinePaymentSessions.invoiceId, invoice.id),
    inArray(onlinePaymentSessions.status, ["creating", "open", "failed"]), gt(onlinePaymentSessions.amountMinor, collectible),
  ));
  return position.balanceCents;
}
