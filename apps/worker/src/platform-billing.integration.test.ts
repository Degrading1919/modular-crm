import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { schema, seedDevelopment, seedIds, startPlatformTrial, platformSubscriptions, invoices, outboundMessages, communicationEvents, domainEvents, automationRules, automationRuns, type Database, sealAccountEmail } from "@modular-crm/db";
import { readServerConfig, DEVELOPMENT_AUTH_SECRET } from "@modular-crm/config";
import { createMockConnectorRegistry } from "@modular-crm/connectors";
import { processOutboundMessage } from "./messages-db.js";
import { processAutomationRun } from "./automations-db.js";
import { generateRecurringJobs } from "./recurring-db.js";
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({ accepted: ["owner@happyyards.test"], rejected: [], messageId: "platform-billing-mail" })) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
const config = readServerConfig({ NODE_ENV: "test", MOCK_CONNECTORS: "true" });
let pglite: PGlite; let db: Database;
beforeAll(async () => {
  pglite = new PGlite(); const database = drizzle(pglite, { schema });
  await migrate(database, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = database as unknown as Database; await seedDevelopment(db);
  await startPlatformTrial(db, seedIds.happyTenant, config.platformBilling);
  await db.update(platformSubscriptions).set({ status: "read_only" }).where(eq(platformSubscriptions.tenantId, seedIds.happyTenant));
}, 120000);
afterAll(async () => { vi.unstubAllEnvs(); await pglite?.close(); });
it("suppresses already queued customer reminders with a visible invoice fact, but delivers billing recovery mail", async () => {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, seedIds.overdueInvoice));
  const [reminder] = await db.insert(outboundMessages).values({ tenantId: seedIds.happyTenant, customerId: invoice!.customerId, invoiceId: seedIds.overdueInvoice,
    channel: "email", category: "service", status: "queued", templateKey: "invoice_overdue", recipient: "carter@example.test", renderedSubject: "Your invoice", renderedBody: "Reminder", idempotencyKey: crypto.randomUUID() }).returning();
  expect(await processOutboundMessage(db, createMockConnectorRegistry(), { tenantId: seedIds.happyTenant, messageId: reminder!.id }, new Date(), config)).toBe("suppressed");
  expect(sendMail).not.toHaveBeenCalled();
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, reminder!.id)))[0]).toMatchObject({ status: "suppressed", failureCode: "workspace_read_only" });
  expect(await db.select().from(communicationEvents).where(eq(communicationEvents.outboundMessageId, reminder!.id))).toMatchObject([{ eventType: "suppressed", payload: { reason: "workspace_read_only" } }]);
  expect(await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, seedIds.overdueInvoice), eq(domainEvents.eventType, "invoice.reminder_not_sent")))).toEqual(expect.arrayContaining([expect.objectContaining({ payload: expect.objectContaining({ code: "workspace_read_only" }) })]));
  const [account] = await db.insert(outboundMessages).values({ tenantId: seedIds.happyTenant, channel: "email", category: "account", status: "queued", recipient: "owner@happyyards.test", renderedSubject: "Update billing",
    renderedBody: sealAccountEmail("Update billing. Your data is safe.", process.env.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET), idempotencyKey: crypto.randomUUID() }).returning();
  expect(await processOutboundMessage(db, createMockConnectorRegistry(), { tenantId: seedIds.happyTenant, messageId: account!.id }, new Date(), config)).toBe("sent");
  expect(sendMail).toHaveBeenCalledOnce();
  expect(await processOutboundMessage(db, createMockConnectorRegistry(), { tenantId: seedIds.happyTenant, messageId: reminder!.id }, new Date(), config)).toBe("skipped");
});
it("stops automated business effects with an explicit history reason rather than repeated retries", async () => {
  const [rule] = await db.select().from(automationRules).where(eq(automationRules.tenantId, seedIds.happyTenant)).limit(1);
  const [event] = await db.select().from(domainEvents).where(eq(domainEvents.tenantId, seedIds.happyTenant)).limit(1);
  const [run] = await db.insert(automationRuns).values({ tenantId: seedIds.happyTenant, automationRuleId: rule!.id, ruleVersion: rule!.version, triggeringEventId: event!.id, idempotencyKey: crypto.randomUUID(), status: "queued", contextSnapshot: {} }).returning();
  const boss = { send: vi.fn() } as unknown as PgBoss;
  expect(await processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: run!.id })).toBe("failed");
  expect((await db.select().from(automationRuns).where(eq(automationRuns.id, run!.id)))[0]).toMatchObject({ errorCode: "workspace_read_only", nextRetryAt: null, status: "failed" });
  expect(boss.send).not.toHaveBeenCalled();
});
it("skips recurring writes for the suspended business without stopping other businesses", async () => {
  const frozen = await generateRecurringJobs(db, { tenantId: seedIds.happyTenant, horizonDays: 7 });
  expect(frozen).toEqual({ created: 0, existing: 0, invalid: [] });
  const writable = await generateRecurringJobs(db, { tenantId: seedIds.cleanTenant, horizonDays: 7 });
  expect(writable.created + writable.existing).toBeGreaterThan(0);
});
