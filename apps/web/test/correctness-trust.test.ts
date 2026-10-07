import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";
import { businessDate } from "../lib/dates";
import { upcomingJob } from "../lib/api/read-facts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db", () => ({ getDb: getDbMock }));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records");
const { handlePortal } = await import("../lib/api/portal");
const { handleReporting } = await import("../lib/api/reporting");
const { handlePaymentReads } = await import("../lib/api/payment-reads");

let pglite: PGlite;
let db: Database;
const base = { tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", name: "Morgan", email: "manager@happyyards.test" };
const office: SessionActor = { ...base, kind: "staff", userId: "demo-happy-manager", membershipId: seedIds.morganMembership,
  organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta, role: "office",
  permissions: new Set(permissionsForRole("office")), allLocations: false, locationIds: new Set([seedIds.augusta]) };
const owner: SessionActor = { ...office, role: "owner", allLocations: true, permissions: new Set(permissionsForRole("owner")) };
const customer: SessionActor = { ...base, kind: "customer", userId: "demo-happy-customer", customerIds: new Set([seedIds.carter]),
  locationIds: new Set([seedIds.carterLocation]), customerLocationIds: new Map([[seedIds.carter, new Set([seedIds.carterLocation])]]) };
const dateAt = (offset: number) => businessDate(Date.now() + offset * 86_400_000, "America/New_York");
const request = (path: string) => new Request(`http://localhost/api/v1/${path}`);
async function call(handler: typeof handleRecords, path: string, actor: SessionActor = office) {
  const response = await handler(request(path), path.split("?")[0]!.split("/"), actor);
  expect(response?.status).toBe(200);
  return response!.json();
}

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
  await db.execute(sql`update jobs set status='canceled' where tenant_id=${seedIds.happyTenant}`);
}, 120_000);
afterAll(async () => { await pglite?.close(); });

async function addJob(status: string, offset: number, options: { plan?: boolean; branch?: string; address?: string } = {}) {
  const [job] = await db.insert(schema.jobs).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization,
    organizationLocationId: options.branch ?? seedIds.augusta, customerId: seedIds.carter,
    serviceLocationId: options.address ?? seedIds.carterLocation, serviceId: seedIds.weeklyService,
    servicePlanId: options.plan ? seedIds.carterPlan : null, status, scheduledDate: dateAt(offset) }).returning();
  return job!;
}

async function addInvoice(locationId: string, amount: bigint, options: { status?: string; currency?: string; issued?: boolean; customerId?: string } = {}) {
  const [invoice] = await db.insert(schema.invoices).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization,
    organizationLocationId: locationId, customerId: options.customerId ?? seedIds.carter, invoiceNumber: `P1-${crypto.randomUUID()}`,
    status: options.status ?? "issued", currency: options.currency ?? "USD", totalMinor: amount, balanceMinor: amount,
    issuedAt: options.issued === false ? null : new Date(), dueAt: new Date(Date.now() - 2 * 86_400_000) }).returning();
  return invoice!;
}

describe("truthful scheduling read models", () => {
  it("uses real jobs consistently, excludes non-upcoming states, and preserves exact location scope", async () => {
    for (const status of ["draft", "unscheduled", "missed", "needs_return", "completed", "skipped", "canceled"]) await addJob(status, 0, { plan: true });
    const planJob = await addJob("dispatched", 3, { plan: true });
    const oneTime = await addJob("scheduled", 2);
    const [address] = await db.insert(schema.serviceLocations).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter,
      organizationLocationId: seedIds.northAugusta, name: "Private", addressLine1: "Private address", city: "North Augusta", region: "SC", postalCode: "29841" }).returning();
    const hidden = await addJob("scheduled", 1, { plan: true, branch: seedIds.northAugusta, address: address!.id });
    const staffCustomer = await call(handleRecords, `customers/${seedIds.carter}`);
    const staffPlan = await call(handleRecords, `service-plans/${seedIds.carterPlan}`);
    const portalPlan = await call(handlePortal, "portal/services", customer);
    const portalOverview = await call(handlePortal, "portal/overview", customer);
    expect(staffCustomer.item.nextService).toBe(oneTime.scheduledDate);
    expect(staffPlan.item.nextService).toBe(planJob.scheduledDate);
    expect(portalPlan.items.find((plan: { id: string }) => plan.id === seedIds.carterPlan).nextService).toBe(planJob.scheduledDate);
    expect(portalOverview.item.nextService).toMatchObject({ id: oneTime.id, scheduledDate: oneTime.scheduledDate });
    const dashboard = await call(handleReporting, "dashboard");
    expect(dashboard.item.upcomingJobs.map((job: { id: string }) => job.id)).toEqual([oneTime.id, planJob.id]);
    expect(dashboard.item.upcomingJobs[0]).toMatchObject({ scheduledDate: oneTime.scheduledDate, scheduledTime: null });
    expect(dashboard.item.scope.label).toBe("Augusta Branch");
    const ownerCustomer = await call(handleRecords, `customers/${seedIds.carter}`, owner);
    expect(ownerCustomer.item.nextService).toBe(hidden.scheduledDate);
  });

  it("does not infer a date from recurrence when no eligible job exists", async () => {
    const staffPlan = await call(handleRecords, `service-plans/${seedIds.nguyenPlan}`);
    expect(staffPlan.item.nextService).toBeNull();
  });

  it("uses the job's business location date at a UTC date boundary", async () => {
    const job = await addJob("scheduled", 0);
    await db.execute(sql`update organization_locations set timezone='America/Los_Angeles' where id=${seedIds.augusta}`);
    await db.execute(sql`update jobs set scheduled_date='2026-10-05' where id=${job.id}`);
    const eligible = await db.execute(sql`select j.id from jobs j where j.id=${job.id}
      and ${upcomingJob("j", sql`'2026-10-06T01:30:00Z'::timestamptz`)}`);
    expect(eligible.rows.map((row) => row.id)).toEqual([job.id]);
    await db.execute(sql`update organization_locations set timezone='America/New_York' where id=${seedIds.augusta}`);
    await db.execute(sql`update jobs set status='canceled' where id=${job.id}`);
  });

  it("includes one-time completed visits in the recent-service overview", async () => {
    const job = await addJob("completed", -1);
    await db.execute(sql`update jobs set actual_completed_at=current_timestamp,customer_summary='One-time cleanup' where id=${job.id}`);
    const overview = await call(handlePortal, "portal/overview", customer);
    expect(overview.item.recentService).toMatchObject({ id: job.id, summary: "One-time cleanup" });
  });

  it("orders completed calendar-day fallbacks in the job's timezone, not the database timezone", async () => {
    const older = await addJob("completed", 2);
    const later = await addJob("completed", 2);
    const originalZone = (await db.execute(sql`select current_setting('TimeZone') as zone`)).rows[0]!.zone as string;
    const [originalLocation] = await db.select().from(schema.organizationLocations).where(sql`id=${seedIds.augusta}`);
    try {
      // Fixed differing zones keep this regression meaningful in every season.
      await db.execute(sql`select set_config('TimeZone','Etc/GMT+5',false)`);
      await db.execute(sql`update organization_locations set timezone='UTC' where id=${seedIds.augusta}`);
      await db.execute(sql`update jobs set actual_completed_at=(scheduled_date::timestamp+interval '30 minutes') at time zone 'UTC',
        customer_summary='Later actual completion' where id=${later.id}`);
      const overview = await call(handlePortal, "portal/overview", customer);
      expect(overview.item.recentService).toMatchObject({ id: later.id, summary: "Later actual completion" });
      const visits = await call(handlePortal, "portal/visits", customer);
      expect(visits.items.slice(0,2).map((visit: { id: string }) => visit.id)).toEqual([later.id,older.id]);
    } finally {
      await db.execute(sql`select set_config('TimeZone',${originalZone},false)`);
      await db.execute(sql`update organization_locations set timezone=${originalLocation!.timezone} where id=${seedIds.augusta}`);
      await db.execute(sql`update jobs set status='canceled' where id in (${older.id},${later.id})`);
    }
  });
});

describe("financial meaning, currency and scope", () => {
  it("names each invoice's actual business/location and exports money in readable units", async () => {
    const ownerInvoices = await call(handleRecords, "invoices", owner);
    const franchiseInvoice = ownerInvoices.items.find((item: { id: string }) => item.id === seedIds.franchiseEastInvoice);
    expect(franchiseInvoice.organizationName).toBeTruthy();
    expect(franchiseInvoice.locationName).toBeTruthy();
    const [organization] = await db.select().from(schema.organizations).where(sql`id=${franchiseInvoice.organizationId} and tenant_id=${owner.tenantId}`);
    const [location] = await db.select().from(schema.organizationLocations).where(sql`id=${franchiseInvoice.organizationLocationId} and tenant_id=${owner.tenantId}`);
    expect(franchiseInvoice.organizationName).toBe(organization!.displayName);
    expect(franchiseInvoice.locationName).toBe(location!.name);
    expect((await call(handleRecords, "invoices")).items.every((item: { locationName: string }) => item.locationName === "Augusta Branch")).toBe(true);
    const response = await handleReporting(request("reports/export?type=financial&range=month"), ["reports", "export"], owner);
    expect(response?.status).toBe(200);
    const csv = await response!.text();
    expect(csv.split("\r\n")[0]).toContain('"Location"');
    expect(csv.split("\r\n")[0]).toContain('"Invoiced"');
    expect(csv.split("\r\n")[0]).not.toMatch(/Id|Cents|cents/);
    expect(csv).toContain("$");
    expect(csv).not.toContain(seedIds.augusta);
  });
  it("reconciles current collectible balances across dashboard, report, records and portal", async () => {
    await db.execute(sql`update invoices set status='void' where tenant_id=${seedIds.happyTenant}`);
    const due = await addInvoice(seedIds.augusta, 9500n);
    await addInvoice(seedIds.augusta, 12000n, { status: "draft" });
    await addInvoice(seedIds.augusta, 11000n, { status: "void" });
    await addInvoice(seedIds.augusta, 13000n, { status: "written_off" });
    await addInvoice(seedIds.augusta, 14000n, { issued: false });
    await addInvoice(seedIds.northAugusta, 19000n);
    const dashboard = await call(handleReporting, "dashboard");
    const report = await call(handleReporting, "reports?type=financial&range=month");
    const portal = await call(handlePortal, "portal/overview", customer);
    const records = await call(handleRecords, `invoices/${due.id}`);
    expect(dashboard.item.metrics.openBalanceCents).toBe(9500);
    expect(portal.item.balanceCents).toBe(9500);
    expect(records.item.openBalanceCents).toBe(9500);
    expect(report.item.metrics.find((metric: { key: string }) => metric.key === "outstandingCents").value).toBe(9500);
    const reportRow = report.item.rows[0];
    const aging = ["currentCents", "days1To30Cents", "days31To60Cents", "days61To90Cents", "over90DaysCents"].reduce((sum, key) => sum + Number(reportRow[key]), 0);
    expect(aging).toBe(Number(reportRow.outstandingCents));
    expect(report.item.scope.label).toBe("Augusta Branch");
    const foreign = { ...office, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization, locationIds: new Set([seedIds.cleanBranch]) } as SessionActor;
    expect((await call(handleReporting, "dashboard", foreign)).item.metrics.openBalanceCents).not.toBe(9500);
  });

  it("keeps different currencies separate rather than presenting their sum as dollars", async () => {
    await addInvoice(seedIds.augusta, 2300n, { currency: "EUR" });
    const report = await call(handleReporting, "reports?type=financial&range=month");
    expect(report.item.metrics.filter((metric: { key: string }) => metric.key === "outstandingCents"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ currency: "USD", value: 9500 }), expect.objectContaining({ currency: "EUR", value: 2300 })]));
    const portal = await call(handlePortal, "portal/overview", customer);
    expect(portal.item.balanceCents).toBeNull();
    expect((await call(handleReporting, "dashboard")).item.metrics.openBalanceCents).toBeNull();
    expect(portal.item.balances).toEqual(expect.arrayContaining([{ currency: "USD", cents: 9500 }, { currency: "EUR", cents: 2300 }]));
  });

  it("attributes receipts to their invoices, excludes out-of-scope allocations, and never guesses refund attribution", async () => {
    await db.execute(sql`update payments set received_at='2000-01-01',created_at='2000-01-01' where tenant_id=${seedIds.happyTenant}`);
    await db.execute(sql`update refunds set completed_at='2000-01-01',created_at='2000-01-01' where tenant_id=${seedIds.happyTenant}`);
    const visible = await addInvoice(seedIds.augusta, 0n);
    const hidden = await addInvoice(seedIds.northAugusta, 0n);
    async function payment(invoices: string[], amount: bigint) {
      const [p] = await db.insert(schema.payments).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter,
        status: "succeeded", sourceType: "mock", amountMinor: amount, currency: "USD", receivedAt: new Date(),
        idempotencyKey: crypto.randomUUID(), recordedByActorType: "staff" }).returning();
      for (const invoiceId of invoices) await db.insert(schema.paymentAllocations).values({ tenantId: seedIds.happyTenant, paymentId: p!.id, invoiceId, amountMinor: amount / BigInt(invoices.length) });
      return p!;
    }
    const local = await payment([visible.id], 600n);
    const outside = await payment([hidden.id], 1400n);
    const mixed = await payment([visible.id, hidden.id], 1000n);
    await db.insert(schema.refunds).values({ tenantId: seedIds.happyTenant, paymentId: mixed.id, amountMinor: 200n, currency: "USD", status: "succeeded", completedAt: new Date() });
    const report = await call(handleReporting, "reports?type=financial&range=month");
    expect(report.item.metrics.find((metric: { key: string; currency?: string }) => metric.key === "collectedCents" && metric.currency === "USD").value).toBe(600);
    const payments = await call(handlePaymentReads, "payments");
    expect(payments.items.map((p: { id: string }) => p.id)).toContain(local.id);
    expect(payments.items.map((p: { id: string }) => p.id)).not.toContain(outside.id);
    expect(payments.items.map((p: { id: string }) => p.id)).not.toContain(mixed.id);
    const ownerReport = await call(handleReporting, "reports?type=financial&range=month", owner);
    expect(ownerReport.item.rows).toContainEqual(expect.objectContaining({ locationName: "Unassigned", collectedCents: 800, refundsCents: 200 }));
    const rollup = await call(handleReporting, "reports?type=locations&range=month", owner);
    expect(rollup.item.rows).toContainEqual(expect.objectContaining({ locationName: "Unassigned", collectedCents: 800 }));
    expect(rollup.item.rows.filter((row: { locationName: string }) => row.locationName === "Augusta Branch").filter((row: { jobs: number | null }) => row.jobs !== null)).toHaveLength(1);
    const singleLocation = await call(handleReporting, `reports?type=financial&range=month&locationId=${seedIds.augusta}`, owner);
    expect(singleLocation.item.rows.every((row: { locationName: string }) => row.locationName === "Augusta Branch")).toBe(true);
    expect(singleLocation.item.metrics.find((metric: { key: string; currency?: string }) => metric.key === "collectedCents" && metric.currency === "USD").value).toBe(600);
  });

  it("does not fabricate zero or combine currencies for missing plan/job pricing inputs", async () => {
    await db.execute(sql`update service_plans set pricing_snapshot='{}'::jsonb where id=${seedIds.carterPlan}`);
    const customerReport = await call(handleReporting, "reports?type=customers&range=month");
    expect(customerReport.item.metrics.find((metric: { key: string }) => metric.key === "activePlanPriceCents").value).toBeNull();
    const plans = await call(handlePortal, "portal/services", customer);
    expect(plans.items.find((plan: { id: string }) => plan.id === seedIds.carterPlan).priceCents).toBeNull();
    const job = await addJob("completed", 0);
    await db.insert(schema.jobAssignments).values({ tenantId: seedIds.happyTenant, jobId: job.id, membershipId: seedIds.terryMembership, assignmentRole: "primary" });
    const staff = await call(handleReporting, "reports?type=staff&range=month", owner);
    expect(staff.item.metrics.find((metric: { key: string }) => metric.key === "revenueCents").value).toBeNull();
    expect(staff.item.rows.find((row: { staffId: string }) => row.staffId === seedIds.terryMembership).revenueCents).toBeNull();
  });

  it("does not label mixed-currency payroll report inputs as a single dollar amount", async () => {
    const [period] = await db.insert(schema.payrollPeriods).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization,
      periodStart: dateAt(-4), periodEnd: dateAt(-1), status: "approved" }).returning();
    await db.insert(schema.payrollCalculations).values([
      { tenantId: seedIds.happyTenant, payrollPeriodId: period!.id, membershipId: seedIds.terryMembership, version: 1, grossAmountMinor: 10000n, currency: "USD" },
      { tenantId: seedIds.happyTenant, payrollPeriodId: period!.id, membershipId: seedIds.caseyMembership, version: 1, grossAmountMinor: 10000n, currency: "EUR" },
    ]);
    const report = await call(handleReporting, "reports?type=staff&range=month", owner);
    expect(report.item.metrics.find((metric: { key: string }) => metric.key === "grossPayCents").value).toBeNull();
  });
});
