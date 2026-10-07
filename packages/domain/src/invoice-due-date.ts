export const paymentDueOptions = [0, 7, 15, 30] as const;

/** Unconfigured businesses require payment on receipt, never an invented historical date. */
export function businessPaymentDueDays(value: unknown): number {
  return paymentDueOptions.some(days => days === value) ? Number(value) : 0;
}

/** Issuance only: preserve explicit dates and agreed plan/customer terms before business defaults. */
export function invoiceDueDate(input: {
  issuedAt: Date; dueAt?: Date | null; planTermsDays?: unknown;
  customerTermsDays?: number | null; businessTermsDays?: unknown;
}): Date {
  if (input.dueAt) return input.dueAt;
  const validTerms = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const days = validTerms(input.planTermsDays) ? input.planTermsDays
    : validTerms(input.customerTermsDays) ? input.customerTermsDays : businessPaymentDueDays(input.businessTermsDays);
  return new Date(input.issuedAt.getTime() + days * 86400000);
}
