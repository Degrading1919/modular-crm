import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { invoices, invoiceItems, jobs, schema, seedDevelopment, seedIds, servicePlans, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleWorkflow, transitionJob } = await import("../lib/api/workflows.ts");

let pglite: PGlite;
let db: Database;

const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta, seedIds.northAugusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

async function addJob(input: { customerId: string; serviceId: string; locationId: string; planId: string | null; priceSnapshot?: Record<string, unknown> }) {
  const [job] = await db.insert(jobs).values({
    tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: input.locationId,
    customerId: input.customerId, serviceLocationId: input.locationId === seedIds.northAugusta ? seedIds.riverfrontLocation : seedIds.carterLocation,
    servicePlanId: input.planId, serviceId: input.serviceId, status: "in_progress", priceSnapshot: input.priceSnapshot ?? null,
  }).returning();
  if (!job) throw new Error("Could not create a test job.");
  return job;
}

describe("job completion billing", () => {
  it("rejects completion through the generic status route and uses state-specific permissions", async () => {
    const job = await addJob({ customerId: seedIds.carter, serviceId: seedIds.weeklyService, locationId: seedIds.augusta, planId: null });
    const request = new Request(`http://localhost/api/v1/jobs/${job.id}/transition`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "completed", completedChecklist: true, proofProvided: true }),
    });
    await expect(handleWorkflow(request, ["jobs", job.id, "transition"], owner)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const startOnly = { ...owner, permissions: new Set(["jobs.read", "jobs.start"]) } as SessionActor;
    await expect(transitionJob(startOnly, job.id, "canceled", { reason: "customer_requested" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0]?.status).toBe("in_progress");
  });

  it("issues one immutable invoice for a billable on-completion plan and returns it on retry", async () => {
    const job = await addJob({ customerId: seedIds.carter, serviceId: seedIds.weeklyService, locationId: seedIds.augusta, planId: seedIds.carterPlan, priceSnapshot: { amountMinor: 2_750, currency: "USD" } });

    const response = await transitionJob(owner, job.id, "completed", { completedChecklist: true });
    expect(response.status).toBe(200);
    const first = await response.json() as { invoice: { id: string; invoiceNumber: string; status: string }; item: { status: string } };
    expect(first.item.status).toBe("completed");
    expect(first.invoice).toMatchObject({ status: "issued" });

    const [invoice] = await db.select().from(invoices).where(and(eq(invoices.tenantId, seedIds.happyTenant), eq(invoices.id, first.invoice.id))).limit(1);
    expect(invoice).toMatchObject({ status: "issued", customerId: seedIds.carter, organizationLocationId: seedIds.augusta, currency: "USD", subtotalMinor: 2_750n, totalMinor: 2_750n, balanceMinor: 2_750n });
    expect(invoice?.billingSnapshot).toMatchObject({ jobId: job.id, servicePlanId: seedIds.carterPlan, customerName: "Carter Household", subtotalMinor: 2_750, priceSnapshot: { amountMinor: 2_750, currency: "USD" } });
    const [line] = await db.select().from(invoiceItems).where(and(eq(invoiceItems.tenantId, seedIds.happyTenant), eq(invoiceItems.invoiceId, first.invoice.id))).limit(1);
    expect(line).toMatchObject({ jobId: job.id, serviceId: seedIds.weeklyService, unitAmountMinor: 2_750n, totalMinor: 2_750n });

    await db.update(servicePlans).set({ pricingSnapshot: { amountMinor: 9_999, currency: "USD" } }).where(and(eq(servicePlans.tenantId, seedIds.happyTenant), eq(servicePlans.id, seedIds.carterPlan)));
    const retry = await transitionJob(owner, job.id, "completed", { completedChecklist: true });
    expect(retry.status).toBe(200);
    const repeated = await retry.json() as { invoice: { id: string }; duplicate: boolean };
    expect(repeated).toMatchObject({ invoice: { id: first.invoice.id }, duplicate: true });
    expect(await db.select().from(invoiceItems).where(and(eq(invoiceItems.tenantId, seedIds.happyTenant), eq(invoiceItems.jobId, job.id)))).toHaveLength(1);

    await db.update(servicePlans).set({ pricingSnapshot: { amountMinor: 2_500, currency: "USD" } }).where(and(eq(servicePlans.tenantId, seedIds.happyTenant), eq(servicePlans.id, seedIds.carterPlan)));
  });

  it("completes safely without a configured service-plan billing policy", async () => {
    const job = await addJob({ customerId: seedIds.carter, serviceId: seedIds.weeklyService, locationId: seedIds.augusta, planId: null, priceSnapshot: { amountMinor: 2_500, currency: "USD" } });
    const response = await transitionJob(owner, job.id, "completed", { completedChecklist: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ item: { status: "completed" } });
    expect(await db.select().from(invoiceItems).where(and(eq(invoiceItems.tenantId, seedIds.happyTenant), eq(invoiceItems.jobId, job.id)))).toHaveLength(0);
  });

  it("bills a public-signup price snapshot with its frozen tax breakdown", async () => {
    const snapshot = { pricedAt: "2026-01-01T00:00:00.000Z", result: {
      currency: "USD", subtotalMinor: 2_500, taxMinor: 175, totalMinor: 2_675, discountMinor: 250,
    } };
    const job = await addJob({ customerId: seedIds.carter, serviceId: seedIds.weeklyService, locationId: seedIds.augusta, planId: seedIds.carterPlan, priceSnapshot: snapshot });
    const response = await transitionJob(owner, job.id, "completed", { completedChecklist: true });
    const body = await response.json() as { invoice: { id: string } };
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, body.invoice.id));
    const [line] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, body.invoice.id));
    expect(invoice).toMatchObject({ subtotalMinor: 2_500n, taxMinor: 175n, totalMinor: 2_675n, balanceMinor: 2_675n });
    expect(line).toMatchObject({ unitAmountMinor: 2_500n, taxMinor: 175n, totalMinor: 2_675n });
  });

  it("does not issue per-job invoices for a recurring-period billing plan", async () => {
    const job = await addJob({ customerId: seedIds.riverfront, serviceId: seedIds.commercialService, locationId: seedIds.northAugusta, planId: seedIds.riverfrontPlan, priceSnapshot: { amountMinor: 8_500, currency: "USD" } });
    const response = await transitionJob(owner, job.id, "completed", { completedChecklist: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ item: { status: "completed" } });
    expect(await db.select().from(invoiceItems).where(and(eq(invoiceItems.tenantId, seedIds.happyTenant), eq(invoiceItems.jobId, job.id)))).toHaveLength(0);
  });
});
