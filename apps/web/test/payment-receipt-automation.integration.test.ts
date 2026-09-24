import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import {
  automationRules, automationRuns, domainEvents, invoices, outboundMessages, schema,
  seedDevelopment, seedIds, grantRecommendedCapabilitySetup, type Database,
} from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import { PET_WASTE_REMOVAL_PACK } from "@modular-crm/industry-packs";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock, getCapabilityMock, requireTenantFeatureMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(), getCapabilityMock: vi.fn(), requireTenantFeatureMock: vi.fn(async () => undefined),
}));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
vi.mock("../lib/connectors.ts", () => ({ getCapability: getCapabilityMock }));
vi.mock("../lib/api/capability-enforcement.ts", () => ({ requireTenantFeature: requireTenantFeatureMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleWorkflow } = await import("../lib/api/workflows.ts");
const { processDomainEvent } = await import("../../worker/src/events-db.js");
const { processAutomationRun } = await import("../../worker/src/automations-db.js");
const { QUEUES } = await import("../../worker/src/queues.js");

let pglite: PGlite;
let db: Database;
const queueSend = vi.fn(async (..._args: unknown[]): Promise<string | null> => "queued-worker-job");
const boss = { send: queueSend } as unknown as Parameters<typeof processDomainEvent>[1];
const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};

beforeAll(async () => {
  pglite = new PGlite();
  const pgliteDb = drizzle(pglite, { schema });
  await migrate(pgliteDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = pgliteDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  getCapabilityMock.mockResolvedValue(null);
  await seedDevelopment(db);
  await db.transaction((tx) => grantRecommendedCapabilitySetup(tx, seedIds.happyTenant, ["automation_workflows", "customer_notifications"], {
    source: "payment-receipt-integration-test", sourceReference: "default-automations",
    effectiveFrom: new Date("2020-01-01T00:00:00Z"),
  }));
}, 120_000);

afterAll(async () => { await pglite?.close(); });

it("routes the successful payment producer event through the default receipt recipe and worker", async () => {
  const recipe = PET_WASTE_REMOVAL_PACK.defaultAutomations.find(({ sourceKey }) => sourceKey === "payment-receipt");
  expect(recipe).toBeDefined();
  const [rule] = await db.insert(automationRules).values({
    tenantId: seedIds.happyTenant,
    name: recipe!.name,
    description: recipe!.description,
    source: "industry_pack",
    sourceKey: recipe!.sourceKey,
    status: "active",
    version: 1,
    triggerConfig: { event: recipe!.event, ...(recipe!.filters ? { filters: recipe!.filters } : {}) },
    conditions: {},
    actions: recipe!.actions.map((action) => ({ actionType: action.actionType, configuration: action.configuration })),
    createdByMembershipId: seedIds.oliviaMembership,
  }).returning({ id: automationRules.id });

  const [invoice] = await db.insert(invoices).values({
    tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
    customerId: seedIds.carter, status: "issued", invoiceNumber: `RECEIPT-${crypto.randomUUID().slice(0, 8)}`,
    currency: "USD", issuedAt: new Date(), totalMinor: 2_500n, paidMinor: 0n, balanceMinor: 2_500n,
  }).returning({ id: invoices.id });

  const paymentResponse = await handleWorkflow(new Request(`http://localhost/api/v1/invoices/${invoice!.id}/pay`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ amountCents: 2_500, method: "manual", idempotencyKey: "receipt-producer-worker" }),
  }), ["invoices", invoice!.id, "pay"], owner);
  expect(paymentResponse?.status).toBe(200);
  const payment = (await paymentResponse!.json() as { item: { id: string; status: string } }).item;
  expect(payment.status).toBe("succeeded");

  const [event] = await db.select().from(domainEvents).where(and(
    eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.eventType, "payment.succeeded"), eq(domainEvents.entityId, payment.id),
  )).limit(1);
  expect(event).toMatchObject({
    entityType: "payment",
    payload: { invoiceId: invoice!.id, customerId: seedIds.carter, amountCents: 2_500 },
  });

  await expect(processDomainEvent(db, boss, { tenantId: seedIds.happyTenant, eventId: event!.id }))
    .resolves.toMatchObject({ automationRuns: 1, webhookDeliveries: 0 });
  expect(queueSend.mock.calls.at(-1)?.[0]).toBe(QUEUES.automationRun);
  const [run] = await db.select().from(automationRuns).where(and(
    eq(automationRuns.tenantId, seedIds.happyTenant), eq(automationRuns.automationRuleId, rule!.id),
  )).limit(1);
  expect(run).toBeDefined();
  await expect(processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: run!.id }, new Date(Date.now() + 1_000)))
    .resolves.toBe("completed");

  const [message] = await db.select().from(outboundMessages).where(and(
    eq(outboundMessages.tenantId, seedIds.happyTenant), eq(outboundMessages.customerId, seedIds.carter),
    eq(outboundMessages.templateKey, "payment-receipt"),
  )).limit(1);
  expect(message).toMatchObject({
    customerId: seedIds.carter, invoiceId: null, recipient: "carter@example.test", channel: "email",
    renderedSubject: "Payment received", renderedBody: "We received your payment. You can view your receipt in your account.", status: "queued",
  });
  expect(queueSend.mock.calls.some(([name]) => name === QUEUES.outboundMessage)).toBe(true);
});
