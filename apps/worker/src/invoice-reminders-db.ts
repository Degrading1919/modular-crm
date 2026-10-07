import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { customers, customerContacts, invoices, organizations, outboundMessages, type Database } from "@modular-crm/db";
import { invoiceReminderSchedule, nextInvoiceReminder, moneyValue } from "@modular-crm/domain";
import { readServerConfig } from "@modular-crm/config";
import { invoicePaymentEmailLink } from "./invoice-payment-email.js";

const keyFor = (invoice: typeof invoices.$inferSelect) => `invoice-overdue:${invoice.id}:${invoice.dueAt!.getTime()}:`;
const open = (invoice: typeof invoices.$inferSelect) => ["issued", "partially_paid", "overdue"].includes(invoice.status) && invoice.balanceMinor > 0n && invoice.billingSnapshot.disputed !== true;
const boundedSetting = (key: string, fallback: number, max: number) => sql`case when (${organizations.settings}->'overdueReminders'->>${key}) ~ ${max === 10 ? "^([1-9]|10)$" : "^([1-9]|[1-8][0-9]|90)$"} then (${organizations.settings}->'overdueReminders'->>${key})::int else ${fallback} end`;

/** Lock each invoice, then insert one durable service message. No catch-up burst. */
export async function enqueueInvoiceReminders(db: Database, now = new Date()): Promise<number> {
  const candidates = await db.select({ id: invoices.id, tenantId: invoices.tenantId }).from(invoices).innerJoin(organizations, and(eq(organizations.tenantId, invoices.tenantId), eq(organizations.id, invoices.organizationId))).where(and(inArray(invoices.status, ["issued", "partially_paid", "overdue"]), lt(invoices.dueAt, now), sql`${invoices.balanceMinor} > 0`, sql`coalesce(${invoices.billingSnapshot}->>'disputed', 'false') <> 'true'`, sql`${organizations.settings}->'overdueReminders'->>'enabled' = 'true'`,
    sql`not exists (select 1 from outbound_messages m where m.tenant_id=${invoices.tenantId} and m.invoice_id=${invoices.id} and m.template_key='invoice_overdue' and m.status not in ('sent','suppressed'))`,
    sql`(select count(*) from outbound_messages m where m.tenant_id=${invoices.tenantId} and m.invoice_id=${invoices.id} and m.template_key='invoice_overdue') < ${boundedSetting("maxReminders", 3, 10)}`,
    sql`coalesce((select max(coalesce(m.sent_at,m.updated_at)) + (${boundedSetting("intervalDays", 7, 90)} * interval '1 day') from outbound_messages m where m.tenant_id=${invoices.tenantId} and m.invoice_id=${invoices.id} and m.template_key='invoice_overdue' and m.status in ('sent','suppressed')), ${invoices.dueAt} + (${boundedSetting("firstAfterDays", 3, 90)} * interval '1 day')) <= ${now}`,
  )).orderBy(invoices.dueAt, invoices.id).limit(100);
  let queued = 0;
  for (const candidate of candidates) queued += await db.transaction(async tx => {
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, candidate.tenantId), eq(invoices.id, candidate.id))).for("update");
    if (!invoice || !open(invoice) || !invoice.dueAt) return 0;
    const [organization] = await tx.select().from(organizations).where(and(eq(organizations.tenantId, invoice.tenantId), eq(organizations.id, invoice.organizationId))).limit(1);
    const schedule = invoiceReminderSchedule(organization?.settings.overdueReminders);
    const previous = await tx.select().from(outboundMessages).where(and(eq(outboundMessages.tenantId, invoice.tenantId), eq(outboundMessages.invoiceId, invoice.id), eq(outboundMessages.templateKey, "invoice_overdue")));
    // A failed delivery remains reviewable/retryable; never bypass it with a duplicate send.
    if (previous.some(message => message.status !== "sent" && message.status !== "suppressed")) return 0;
    const attempts = previous.map(message => message.sentAt ?? message.updatedAt);
    const next = nextInvoiceReminder(schedule, invoice.dueAt, attempts);
    if (!next || next > now || previous.length >= schedule.maxReminders) return 0;
    const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, invoice.tenantId), eq(customers.id, invoice.customerId))).limit(1);
    const [contact] = await tx.select().from(customerContacts).where(and(eq(customerContacts.tenantId, invoice.tenantId), eq(customerContacts.customerId, invoice.customerId), eq(customerContacts.isPrimary, true))).limit(1);
    const recipient = customer?.billingEmail ?? contact?.email ?? "";
    await tx.insert(outboundMessages).values({ tenantId: invoice.tenantId, invoiceId: invoice.id, customerId: invoice.customerId, channel: "email", category: "service", templateKey: "invoice_overdue", templateVersion: 1, recipient, renderedSubject: `Reminder: invoice ${invoice.invoiceNumber}`, renderedBody: `A reminder about your unpaid invoice ${invoice.invoiceNumber}.`, status: "queued", queuedAt: now, idempotencyKey: `${keyFor(invoice)}${previous.length + 1}` }).onConflictDoNothing();
    return 1;
  });
  return queued;
}

/** Recheck payment, dispute, due-date and settings changes immediately before delivery. */
export async function invoiceReminderBody(db: Database, message: typeof outboundMessages.$inferSelect, now: Date): Promise<string | null> {
  if (!message.invoiceId || !message.customerId) return null;
  const [invoice] = await db.select().from(invoices).where(and(eq(invoices.tenantId, message.tenantId), eq(invoices.id, message.invoiceId), eq(invoices.customerId, message.customerId))).limit(1);
  if (!invoice || !open(invoice) || !invoice.dueAt || !message.idempotencyKey.startsWith(keyFor(invoice))) return null;
  const [organization] = await db.select().from(organizations).where(and(eq(organizations.tenantId, invoice.tenantId), eq(organizations.id, invoice.organizationId))).limit(1);
  const schedule = invoiceReminderSchedule(organization?.settings.overdueReminders);
  const sequence = Number(message.idempotencyKey.slice(keyFor(invoice).length));
  if (!schedule.enabled || !Number.isInteger(sequence) || sequence < 1 || sequence > schedule.maxReminders || invoice.dueAt.getTime() + schedule.firstAfterDays * 86400000 > now.getTime()) return null;
  const previous = await db.select({ sentAt: outboundMessages.sentAt, updatedAt: outboundMessages.updatedAt }).from(outboundMessages).where(and(eq(outboundMessages.tenantId, invoice.tenantId), eq(outboundMessages.invoiceId, invoice.id), eq(outboundMessages.templateKey, "invoice_overdue"), inArray(outboundMessages.status, ["sent", "suppressed"])));
  const next = nextInvoiceReminder(schedule, invoice.dueAt, previous.map(item => item.sentAt ?? item.updatedAt));
  if (!next || next > now) return null;
  const pay = await invoicePaymentEmailLink(db, invoice.tenantId, invoice.id, invoice.customerId, message.recipient);
  const amount = moneyValue(Number(invoice.balanceMinor), invoice.currency);
  const link = pay ?? new URL(`/portal/billing/${invoice.id}`, readServerConfig(process.env).appBaseUrl).toString();
  return `A friendly reminder that invoice ${invoice.invoiceNumber} has an unpaid balance of ${amount}.\n\n${pay ? "Pay now" : "View your invoice"}: ${link}\n\nIf you have a question about this invoice, please contact us. Thank you.`;
}
