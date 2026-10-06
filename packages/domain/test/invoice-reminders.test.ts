import { expect, it } from "vitest";
import { defaultInvoiceReminders, invoiceReminderSchedule, nextInvoiceReminder } from "../src/invoice-reminders.ts";
it("defaults reminders off and rejects malformed schedules", () => {
  expect(invoiceReminderSchedule(undefined)).toEqual(defaultInvoiceReminders);
  expect(invoiceReminderSchedule({ enabled: true, intervalDays: 0 }).enabled).toBe(false);
  expect(invoiceReminderSchedule({ enabled: "true" }).enabled).toBe(false);
});
it("starts after due, spaces actual sends and stops at the maximum", () => {
  const schedule = { ...defaultInvoiceReminders, enabled: true }, due = new Date("2026-10-01T00:00:00Z");
  expect(nextInvoiceReminder(schedule, due, [])).toEqual(new Date("2026-10-04T00:00:00Z"));
  const sent = [new Date("2026-10-10T00:00:00Z")];
  expect(nextInvoiceReminder(schedule, due, sent)).toEqual(new Date("2026-10-17T00:00:00Z"));
  expect(nextInvoiceReminder(schedule, due, [...sent, ...sent, ...sent])).toBeNull();
});
