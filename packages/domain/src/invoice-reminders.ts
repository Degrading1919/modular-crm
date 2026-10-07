export type InvoiceReminderSchedule = { enabled: boolean; firstAfterDays: number; intervalDays: number; maxReminders: number };
export const defaultInvoiceReminders: InvoiceReminderSchedule = { enabled: false, firstAfterDays: 3, intervalDays: 7, maxReminders: 3 };
export function invoiceReminderSchedule(value: unknown): InvoiceReminderSchedule {
  if (!value || typeof value !== "object") return { ...defaultInvoiceReminders };
  const candidate = { ...defaultInvoiceReminders, ...value };
  if (![candidate.firstAfterDays, candidate.intervalDays, candidate.maxReminders].every(Number.isSafeInteger) || candidate.firstAfterDays < 1 || candidate.firstAfterDays > 90 || candidate.intervalDays < 1 || candidate.intervalDays > 90 || candidate.maxReminders < 1 || candidate.maxReminders > 10) return { ...defaultInvoiceReminders };
  return { ...candidate, enabled: candidate.enabled === true };
}
export function nextInvoiceReminder(schedule: InvoiceReminderSchedule, dueAt: Date, sent: Date[]): Date | null {
  if (!schedule.enabled || sent.length >= schedule.maxReminders) return null;
  const last = sent.length ? Math.max(...sent.map(date => date.getTime())) : undefined;
  return new Date(last === undefined ? dueAt.getTime() + schedule.firstAfterDays * 86400000 : last + schedule.intervalDays * 86400000);
}
