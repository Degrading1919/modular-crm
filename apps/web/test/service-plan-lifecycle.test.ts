import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import {
  auditEvents, jobStatusEvents, jobs, recurringGenerationLedger, recurrenceRules, schema, seedDevelopment, seedIds,
  priceRules, servicePlans, type Database,
} from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records.ts");

let pglite: PGlite;
let db: Database;
const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta, seedIds.northAugusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};

function localDate(timezone = "America/New_York"): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

it("creates an office service plan with an engine-calculated immutable price and canonical recurrence", async () => {
  await db.insert(priceRules).values({
    tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, name: "Every other week cleanup", priority: 20,
    conditions: { serviceKey: "yard-cleanup", frequency: "every_two_weeks" }, effects: { type: "set_base_amount", amountMinor: 3200 }, source: "tenant",
  });
  const response = await handleRecords(new Request("http://localhost/api/v1/service-plans", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ customerId: seedIds.carter, serviceId: seedIds.weeklyService, frequency: "every-two-weeks", startDate: localDate() }),
  }), ["service-plans"], owner);
  expect(response?.status).toBe(201);
  const { item } = await response!.json() as { item: Record<string, unknown> };
  expect(item).toMatchObject({ status: "active", frequency: "every_two_weeks" });
  const price = item.pricingSnapshot as Record<string, unknown>;
  expect(price).toMatchObject({ amountMinor: 3200, totalMinor: 3200, currency: "USD" });
  expect(price.priceVersions).toMatchObject([{ effectiveFrom: localDate(), snapshot: { amountMinor: 3200, totalMinor: 3200 } }]);
  const [plan] = await db.select().from(servicePlans).where(eq(servicePlans.id, String(item.id))).limit(1);
  const [rule] = await db.select().from(recurrenceRules).where(eq(recurrenceRules.id, plan!.recurrenceRuleId)).limit(1);
  expect(rule).toMatchObject({ frequencyType: "weekly", interval: 2 });
});

it("applies a future price version, preserves existing history, and honors the explicit future-job policy", async () => {
  const effectiveDate = addDays(localDate(), 5);
  const [scheduled] = await db.insert(jobs).values({
    tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
    customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, servicePlanId: seedIds.carterPlan,
    serviceId: seedIds.weeklyService, status: "scheduled", scheduledDate: effectiveDate, priceSnapshot: { amountMinor: 2500, currency: "USD" },
  }).returning();
  const [dispatched] = await db.insert(jobs).values({
    tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
    customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, servicePlanId: seedIds.carterPlan,
    serviceId: seedIds.weeklyService, status: "dispatched", scheduledDate: addDays(effectiveDate, 1), priceSnapshot: { amountMinor: 2500, currency: "USD" },
  }).returning();
  await db.insert(recurringGenerationLedger).values([
    { tenantId: seedIds.happyTenant, servicePlanId: seedIds.carterPlan, occurrenceKey: `${seedIds.carterPlan}:${effectiveDate}`, intendedDate: effectiveDate, jobId: scheduled!.id, status: "generated", generatedAt: new Date() },
    { tenantId: seedIds.happyTenant, servicePlanId: seedIds.carterPlan, occurrenceKey: `${seedIds.carterPlan}:${addDays(effectiveDate, 1)}`, intendedDate: addDays(effectiveDate, 1), jobId: dispatched!.id, status: "generated", generatedAt: new Date() },
  ]);

  const response = await handleRecords(new Request("http://localhost/api/v1/service-plans", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ effectiveDate, priceOverride: { amountMinor: 3000, reason: "Updated service price" }, futureJobPolicy: "cancel_unstarted" }),
  }), ["service-plans", seedIds.carterPlan], owner);

  expect(response).not.toBeNull();
  expect(response!.status).toBe(200);
  expect(await response!.json()).toMatchObject({ item: { frequency: "weekly", effectiveDate, futureJobPolicy: "cancel_unstarted", canceledFutureJobs: 1 } });
  const [plan] = await db.select().from(servicePlans).where(eq(servicePlans.id, seedIds.carterPlan)).limit(1);
  expect(plan?.pricingSnapshot).toMatchObject({
    amountMinor: 3000, totalMinor: 3000,
    priceVersions: [
      { effectiveFrom: expect.any(String), snapshot: { amountMinor: 2500 } },
      { effectiveFrom: effectiveDate, snapshot: { amountMinor: 3000, totalMinor: 3000 } },
    ],
  });
  const [savedScheduled] = await db.select().from(jobs).where(eq(jobs.id, scheduled!.id)).limit(1);
  const [savedDispatched] = await db.select().from(jobs).where(eq(jobs.id, dispatched!.id)).limit(1);
  expect(savedScheduled).toMatchObject({ status: "canceled", cancelReasonCode: "service_plan_changed", priceSnapshot: { amountMinor: 2500, currency: "USD" } });
  expect(savedDispatched).toMatchObject({ status: "dispatched", priceSnapshot: { amountMinor: 2500, currency: "USD" } });
  expect(await db.select().from(jobStatusEvents).where(and(eq(jobStatusEvents.jobId, scheduled!.id), eq(jobStatusEvents.toStatus, "canceled")))).toHaveLength(1);
  expect(await db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, seedIds.happyTenant), eq(auditEvents.entityId, seedIds.carterPlan), eq(auditEvents.action, "service_plan.change")))).toHaveLength(1);
});
