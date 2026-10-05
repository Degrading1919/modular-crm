import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { automationRules, automationRuns, connectorInstallations, domainEvents, invoices, onlinePaymentAccounts, outboundMessages, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { processDomainEvent } from "./events-db.js";
import { processAutomationRun } from "./automations-db.js";
import { invoicePaymentEmailLink } from "./invoice-payment-email.js";

let client: PGlite; let db: Database; let accountId: string;
const boss = { send: vi.fn(async () => "queued") } as unknown as PgBoss;
beforeAll(async () => {
  vi.stubEnv("MOCK_CONNECTORS", "true"); vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  client = new PGlite(); const database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = database as unknown as Database; await seedDevelopment(db);
  const [installation] = await db.insert(connectorInstallations).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, connectorKey: "mock-payments", status: "connected" }).returning();
  const [account] = await db.insert(onlinePaymentAccounts).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, provider: "mock-payments", installationId: installation!.id, chargesEnabled: true }).returning(); accountId = account!.id;
}, 120_000);
afterAll(async () => { await client?.close(); vi.unstubAllEnvs(); });
async function invoice() { return (await db.insert(invoices).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, invoiceNumber: crypto.randomUUID(), status: "issued", totalMinor: 1000n, balanceMinor: 1000n, currency: "USD" }).returning())[0]!; }
it("only returns a real issued-balance link for the bound tenant, business and customer contact", async () => {
  const row = await invoice();
  const link = await invoicePaymentEmailLink(db, row.tenantId, row.id, row.customerId, "carter@example.test");
  expect(link).toBe(`http://localhost:3000/portal/billing/${row.id}`);
  expect(await invoicePaymentEmailLink(db, seedIds.cleanTenant, row.id, row.customerId, "carter@example.test")).toBeUndefined();
  expect(await invoicePaymentEmailLink(db, row.tenantId, row.id, seedIds.riverfront, "carter@example.test")).toBeUndefined();
  expect(await invoicePaymentEmailLink(db, row.tenantId, row.id, row.customerId, "someoneelse@example.test")).toBeUndefined();
  await db.update(invoices).set({ balanceMinor: 0n, status: "paid" }).where(eq(invoices.id, row.id));
  expect(await invoicePaymentEmailLink(db, row.tenantId, row.id, row.customerId, "carter@example.test")).toBeUndefined();
});
it("disconnected or unconfigured services do not promise a payment page", async () => {
  const row = await invoice();
  await db.update(onlinePaymentAccounts).set({ chargesEnabled: false }).where(eq(onlinePaymentAccounts.id, accountId));
  expect(await invoicePaymentEmailLink(db, row.tenantId, row.id, row.customerId, "carter@example.test")).toBeUndefined();
  await db.update(onlinePaymentAccounts).set({ chargesEnabled: true }).where(eq(onlinePaymentAccounts.id, accountId));
  vi.stubEnv("MOCK_CONNECTORS", "false");
  expect(await invoicePaymentEmailLink(db, row.tenantId, row.id, row.customerId, "carter@example.test")).toBeUndefined();
  vi.stubEnv("MOCK_CONNECTORS", "true");
});
it("real automation execution appends Pay now to service invoices, not promotions, and replays once", async () => {
  const row = await invoice();
  const ids: string[] = [];
  for (const purpose of ["service", "marketing"]) {
    const [rule] = await db.insert(automationRules).values({ tenantId: row.tenantId, source: "custom", name: `Invoice ${purpose}`, status: "active", triggerConfig: { event: "invoice.issued" }, conditions: { field: "event.entityId", operator: "equals", value: row.id }, actions: [{ actionType: "send_email", purpose, configuration: { subject: "Your invoice", body: "Please review your invoice." } }] }).returning(); ids.push(rule!.id);
  }
  const [event] = await db.insert(domainEvents).values({ tenantId: row.tenantId, organizationId: row.organizationId, locationId: row.organizationLocationId, eventType: "invoice.issued", entityType: "invoice", entityId: row.id, actorType: "system", payload: {} }).returning();
  await processDomainEvent(db, boss, { tenantId: row.tenantId, eventId: event!.id });
  const runs = await db.select().from(automationRuns).where(and(eq(automationRuns.tenantId, row.tenantId), eq(automationRuns.triggeringEventId, event!.id)));
  expect(runs.filter((run) => ids.includes(run.automationRuleId))).toHaveLength(2);
  for (const run of runs) { expect(await processAutomationRun(db, boss, { tenantId: row.tenantId, runId: run.id })).toBe("completed"); expect(await processAutomationRun(db, boss, { tenantId: row.tenantId, runId: run.id })).toBe("skipped"); }
  const mail = await db.select().from(outboundMessages).where(eq(outboundMessages.invoiceId, row.id));
  expect(mail).toHaveLength(2);
  expect(mail.find((message) => message.category === "service")).toMatchObject({ customerId: row.customerId, recipient: "carter@example.test", renderedBody: `Please review your invoice.\n\nPay now: http://localhost:3000/portal/billing/${row.id}` });
  expect(mail.find((message) => message.category === "marketing")!.renderedBody).not.toContain("Pay now:");
});
