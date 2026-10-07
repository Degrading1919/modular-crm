import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { createConnectorRegistry } from "@modular-crm/connectors";
import { readServerConfig } from "@modular-crm/config";
import { defaultInvoiceReminders } from "@modular-crm/domain";
import { enqueueInvoiceReminders, invoiceReminderBody } from "./invoice-reminders-db.js";
import { processOutboundMessage } from "./messages-db.js";
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
const config = readServerConfig({ NODE_ENV: "test", MOCK_CONNECTORS: "false", SMTP_HOST: "localhost", SMTP_FROM: "Platform <mail@platform.test>", APP_BASE_URL: "http://localhost:3000" });
let pg: PGlite, db: Database;
const now = new Date("2026-10-10T12:00:00Z");
beforeAll(async () => { pg = new PGlite(); const raw = drizzle(pg, { schema }); await migrate(raw, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) }); db = raw as unknown as Database; await seedDevelopment(db); }, 120_000);
afterAll(async () => { vi.unstubAllEnvs(); await pg?.close(); });
beforeEach(async () => { sendMail.mockReset(); sendMail.mockResolvedValue({ accepted: ["carter@example.test"], rejected: [], messageId: "accepted" }); await schedule(false); });
async function schedule(enabled = true, maxReminders = 3) {
  const [organization] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, seedIds.happyOrganization));
  await db.update(schema.organizations).set({ settings: { ...organization!.settings, overdueReminders: { ...defaultInvoiceReminders, enabled, maxReminders } } }).where(eq(schema.organizations.id, seedIds.happyOrganization));
}
async function invoice(extra: Partial<typeof schema.invoices.$inferInsert> = {}) {
  const [row] = await db.insert(schema.invoices).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, status: "issued", invoiceNumber: `TEST-${crypto.randomUUID()}`, totalMinor: 3000n, subtotalMinor: 3000n, balanceMinor: 3000n, dueAt: new Date("2026-10-07T12:00:00Z"), ...extra }).returning(); return row!;
}
const messages = (id: string) => db.select().from(schema.outboundMessages).where(and(eq(schema.outboundMessages.invoiceId, id), eq(schema.outboundMessages.templateKey, "invoice_overdue"))).orderBy(schema.outboundMessages.queuedAt);
const deliver = (message: typeof schema.outboundMessages.$inferSelect, at = now) => processOutboundMessage(db, createConnectorRegistry({ includePlannedProviders: true }), { tenantId: message.tenantId, messageId: message.id }, at, config);
it("defaults off, waits until due plus the configured days, and queues exactly once on sweep replay", async () => {
  const row = await invoice(); await enqueueInvoiceReminders(db, now); expect(await messages(row.id)).toHaveLength(0);
  await schedule(); await enqueueInvoiceReminders(db, new Date(now.getTime() - 1)); expect(await messages(row.id)).toHaveLength(0);
  await enqueueInvoiceReminders(db, now); await enqueueInvoiceReminders(db, now);
  expect(await messages(row.id)).toHaveLength(1);
  expect((await messages(row.id))[0]).toMatchObject({ category: "service", invoiceId: row.id, status: "queued" });
});
it("delivers one plain-language email with an invoice link and one timeline fact, never a second on replay", async () => {
  await schedule(); const row = await invoice(); await enqueueInvoiceReminders(db, now); const message = (await messages(row.id))[0]!;
  expect(await deliver(message)).toBe("sent"); expect(await deliver(message)).toBe("skipped"); expect(sendMail).toHaveBeenCalledTimes(1);
  const saved = (await messages(row.id))[0]!; expect(saved.renderedBody).toContain("$30.00"); expect(saved.renderedBody).toContain(`/portal/billing/${row.id}`);
  expect(await db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.entityId, row.id), eq(schema.domainEvents.eventType, "invoice.reminder_sent")))).toHaveLength(1);
});
it("suppresses an already queued reminder after payment, void, dispute or turning reminders off", async () => {
  for (const stop of ["paid", "void", "disputed", "disabled"] as const) {
    await schedule(); const row = await invoice(); await enqueueInvoiceReminders(db, now); const message = (await messages(row.id))[0]!;
    if (stop === "disabled") await schedule(false);
    else await db.update(schema.invoices).set(stop === "disputed" ? { billingSnapshot: { disputed: true } } : { status: stop, balanceMinor: stop === "paid" ? 0n : row.balanceMinor }).where(eq(schema.invoices.id, row.id));
    expect(await deliver(message)).toBe("suppressed"); expect(sendMail).not.toHaveBeenCalled();
  }
});
it("respects sending intervals and maximum reminders without a catch-up burst or starvation", async () => {
  await schedule(true, 2); const row = await invoice(); await enqueueInvoiceReminders(db, now); await deliver((await messages(row.id))[0]!);
  await enqueueInvoiceReminders(db, new Date("2026-10-16T12:00:00Z")); expect(await messages(row.id)).toHaveLength(1);
  const later = new Date("2026-10-30T12:00:00Z"); await enqueueInvoiceReminders(db, later); expect(await messages(row.id)).toHaveLength(2); await deliver((await messages(row.id))[1]!, later);
  await enqueueInvoiceReminders(db, new Date("2026-12-01T12:00:00Z")); expect(await messages(row.id)).toHaveLength(2);
  const other = await invoice(); await enqueueInvoiceReminders(db, now); expect(await messages(other.id)).toHaveLength(1);
});
it("uses the current partial balance and rejects changed due dates or cross-tenant invoice references", async () => {
  await schedule(); const row = await invoice(); await enqueueInvoiceReminders(db, now); const message = (await messages(row.id))[0]!;
  await db.update(schema.invoices).set({ status: "partially_paid", balanceMinor: 1000n, paidMinor: 2000n }).where(eq(schema.invoices.id, row.id));
  expect(await invoiceReminderBody(db, message, now)).toContain("$10.00");
  expect(await invoiceReminderBody(db, { ...message, tenantId: seedIds.cleanTenant }, now)).toBeNull();
  await db.update(schema.invoices).set({ dueAt: new Date("2026-10-20T12:00:00Z") }).where(eq(schema.invoices.id, row.id));
  expect(await deliver(message)).toBe("suppressed"); expect(sendMail).not.toHaveBeenCalled();
});
it("offers Pay now only for an available payment service on the invoice's business", async () => {
  vi.stubEnv("MOCK_CONNECTORS", "true"); vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  const [installation] = await db.insert(schema.connectorInstallations).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, connectorKey: "mock-payments", status: "connected" }).returning();
  const [account] = await db.insert(schema.onlinePaymentAccounts).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, provider: "mock-payments", installationId: installation!.id, chargesEnabled: true }).returning();
  try {
    await schedule(); const row = await invoice(); await enqueueInvoiceReminders(db, now); const message = (await messages(row.id))[0]!;
    expect(await invoiceReminderBody(db, message, now)).toContain(`Pay now: http://localhost:3000/portal/billing/${row.id}`);
    await db.update(schema.onlinePaymentAccounts).set({ chargesEnabled: false }).where(eq(schema.onlinePaymentAccounts.id, account!.id));
    expect(await invoiceReminderBody(db, message, now)).toContain(`View your invoice: http://localhost:3000/portal/billing/${row.id}`);
  } finally {
    await db.delete(schema.onlinePaymentAccounts).where(eq(schema.onlinePaymentAccounts.id, account!.id));
    await db.delete(schema.connectorInstallations).where(eq(schema.connectorInstallations.id, installation!.id)); vi.unstubAllEnvs();
  }
});
it("keeps exhausted platform caps queued without duplicating the invoice reminder", async () => {
  await schedule(); const row = await invoice(); await enqueueInvoiceReminders(db, now); const message = (await messages(row.id))[0]!;
  await db.delete(schema.platformEmailUsage).where(eq(schema.platformEmailUsage.tenantId, seedIds.happyTenant));
  const limited = { ...config, platformEmailLimits: { hourly: 1, daily: 1, firstWeekHourly: 1, firstWeekDaily: 1 } };
  const { reservePlatformEmail } = await import("@modular-crm/db");
  expect(await reservePlatformEmail(db, seedIds.happyTenant, limited.platformEmailLimits, now, "service")).toEqual({ allowed: true });
  expect(await processOutboundMessage(db, createConnectorRegistry(), { tenantId: message.tenantId, messageId: message.id }, now, limited)).toBe("queued");
  expect((await messages(row.id))[0]).toMatchObject({ status: "queued", failureCode: "email_daily_limit" });
  await enqueueInvoiceReminders(db, now); expect(await messages(row.id)).toHaveLength(1); expect(sendMail).not.toHaveBeenCalled();
});
it("keeps customer email preferences in force", async () => {
  await schedule(); const row = await invoice(); await enqueueInvoiceReminders(db, now); const message = (await messages(row.id))[0]!;
  await db.insert(schema.notificationPreferences).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter, eventKey: "invoice_overdue", emailEnabled: false, smsEnabled: false });
  expect(await deliver(message)).toBe("suppressed"); expect(sendMail).not.toHaveBeenCalled();
});
