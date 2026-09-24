import { DomainError } from "./errors.ts";

export interface MoneyLine { description: string; quantity: number; unitAmountCents: number; taxAmountCents?: number; discountAmountCents?: number }
export interface InvoiceSnapshot { currency: string; lines: ReadonlyArray<MoneyLine>; subtotalCents: number; taxCents: number; discountCents: number; totalCents: number; issuedAt: string; customerName: string; businessName: string }

/** Payment states whose original collected amount remains part of financial reporting. */
export const settledPaymentStatuses = ["succeeded", "partially_refunded", "refunded"] as const;

export function makeInvoiceSnapshot(input: { lines: MoneyLine[]; issuedAt: string; customerName: string; businessName: string; currency?: string }): InvoiceSnapshot {
  if (input.lines.length === 0) throw new DomainError("VALIDATION_ERROR", "An invoice needs at least one line.", 422);
  const lines = input.lines.map((line) => ({ ...line }));
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0 || !Number.isInteger(line.unitAmountCents) || line.unitAmountCents < 0) {
      throw new DomainError("VALIDATION_ERROR", "Invoice quantities and amounts must be valid minor units.", 422);
    }
  }
  const subtotalCents = lines.reduce((sum, line) => sum + line.quantity * line.unitAmountCents, 0);
  const taxCents = lines.reduce((sum, line) => sum + (line.taxAmountCents ?? 0), 0);
  const discountCents = lines.reduce((sum, line) => sum + (line.discountAmountCents ?? 0), 0);
  return Object.freeze({
    currency: input.currency ?? "USD", lines: Object.freeze(lines.map((line) => Object.freeze(line))),
    subtotalCents, taxCents, discountCents, totalCents: subtotalCents + taxCents - discountCents,
    issuedAt: input.issuedAt, customerName: input.customerName, businessName: input.businessName,
  });
}

export function invoiceFinancialPosition(totalCents: number, paidCents: number, refundedCents = 0, creditedCents = 0): {
  grossPaidCents: number;
  refundedCents: number;
  creditedCents: number;
  netCollectedCents: number;
  balanceCents: number;
  status: "paid" | "partially_paid" | "issued";
} {
  for (const value of [totalCents, paidCents, refundedCents, creditedCents]) {
    if (!Number.isInteger(value) || value < 0) throw new DomainError("VALIDATION_ERROR", "Money must use nonnegative integer minor units.", 422);
  }
  if (refundedCents > paidCents) throw new DomainError("VALIDATION_ERROR", "Refund exceeds payments.", 422);
  const netCollectedCents = paidCents - refundedCents;
  const balanceCents = Math.max(0, totalCents - paidCents + refundedCents - creditedCents);
  return {
    grossPaidCents: paidCents,
    refundedCents,
    creditedCents,
    netCollectedCents,
    balanceCents,
    status: invoiceStatus(balanceCents, totalCents),
  };
}

export function invoiceBalance(totalCents: number, paidCents: number, refundedCents = 0, creditedCents = 0): number {
  return invoiceFinancialPosition(totalCents, paidCents, refundedCents, creditedCents).balanceCents;
}

export function invoiceStatus(balanceCents: number, totalCents: number): "paid" | "partially_paid" | "issued" {
  return balanceCents === 0 ? "paid" : balanceCents < totalCents ? "partially_paid" : "issued";
}
