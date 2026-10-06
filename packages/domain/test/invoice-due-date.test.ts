import { expect, it } from "vitest";
import { businessPaymentDueDays, invoiceDueDate, paymentDueOptions } from "../src/invoice-due-date.ts";
const issuedAt = new Date("2026-10-06T12:34:56.789Z");
it.each(paymentDueOptions)("uses the configured %i-day business deadline", days => {
  expect(businessPaymentDueDays(days)).toBe(days);
  expect(invoiceDueDate({ issuedAt, businessTermsDays: days }).getTime()).toBe(issuedAt.getTime() + days * 86400000);
});
it("defaults to on receipt and rejects malformed stored defaults", () => {
  for (const value of [undefined, null, -1, 1, "7", NaN]) expect(businessPaymentDueDays(value)).toBe(0);
  expect(invoiceDueDate({ issuedAt })).toEqual(issuedAt);
});
it("preserves explicit dates, plan terms and customer terms including on receipt", () => {
  const dueAt = new Date("2026-11-01T00:00:00Z");
  expect(invoiceDueDate({ issuedAt, dueAt, planTermsDays: 7, customerTermsDays: 15, businessTermsDays: 30 })).toBe(dueAt);
  expect(invoiceDueDate({ issuedAt, planTermsDays: 7, customerTermsDays: 15, businessTermsDays: 30 }).getTime()).toBe(issuedAt.getTime() + 7 * 86400000);
  expect(invoiceDueDate({ issuedAt, customerTermsDays: 15, businessTermsDays: 30 }).getTime()).toBe(issuedAt.getTime() + 15 * 86400000);
  expect(invoiceDueDate({ issuedAt, customerTermsDays: 0, businessTermsDays: 30 })).toEqual(issuedAt);
  expect(invoiceDueDate({ issuedAt, planTermsDays: 0, customerTermsDays: 15, businessTermsDays: 30 })).toEqual(issuedAt);
});
