import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";
import { businessDate } from "../lib/dates";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db", () => ({ getDb: getDbMock }));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records");
const { handleWorkflow, transitionJob } = await import("../lib/api/workflows");
const { handleRoutesField } = await import("../lib/api/routes-field");
const { handleTimeReview } = await import("../lib/api/time-review");
const { handleOperationsSettings } = await import("../lib/api/operations-settings");
const { assignableTechnician } = await import("../lib/api/job-planning");
const { generateRecurringJobs } = await import("../../worker/src/recurring-db");
let pg: PGlite, db: Database;
const owner: SessionActor = { kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia", role: "owner", permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta]), allLocations: true, membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta };
const office: SessionActor = { ...owner, membershipId: seedIds.morganMembership, role: "office", permissions: permissionsForRole("office"), allLocations: false };
const today = businessDate(new Date(), "America/New_York");
const request = (data?: unknown) => new Request("http://localhost", data ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) } : {});
beforeAll(async () => { pg = new PGlite(); const d = drizzle(pg, { schema }); await migrate(d, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) }); db = d as unknown as Database; getDbMock.mockReturnValue(db); await seedDevelopment(db); }, 120_000);
afterAll(async () => { await pg?.close(); });
it("prioritizes older pending time and pages through more than 200 approved entries", async () => {
  const start = new Date("2025-01-01T10:00:00Z"), end = new Date("2025-01-01T11:00:00Z");
  const [pending] = await db.insert(schema.timeEntries).values({ tenantId: owner.tenantId, membershipId: owner.membershipId!, source: "office_correction", startsAt: start, endsAt: end, durationSeconds: 3600, approvalStatus: "pending" }).returning();
  await db.insert(schema.timeEntries).values(Array.from({ length: 205 }, (_, index) => ({ tenantId: owner.tenantId, membershipId: owner.membershipId!, source: "office_correction", startsAt: new Date(start.getTime() + (index + 1) * 86_400_000), endsAt: new Date(end.getTime() + (index + 1) * 86_400_000), durationSeconds: 3600, approvalStatus: "approved" })));
  const first = await (await handleTimeReview(request(), ["time"], office))!.json();
  expect(first.entries[0].id).toBe(pending!.id); expect(first.entries).toHaveLength(50); expect(first.hasMore).toBe(true);
  const seen = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const data = await (await handleTimeReview(new Request(`http://localhost/time?page=${page}`), ["time"], office))!.json();
    for (const entry of data.entries) { expect(seen.has(entry.id)).toBe(false); seen.add(entry.id); }
    if (page === 4) expect(data.hasMore).toBe(false);
  }
  expect(seen.size).toBeGreaterThanOrEqual(206);
});
it("rejects office clock-out before the end of any recorded break without changing the shift", async () => {
  const start = new Date(Date.now() - 7_200_000);
  const [shift] = await db.insert(schema.shifts).values({ tenantId: owner.tenantId, membershipId: owner.membershipId!, organizationLocationId: seedIds.augusta, status: "clocked_in", clockInAt: start }).returning();
  await db.insert(schema.breaks).values({ tenantId: owner.tenantId, shiftId: shift!.id, startedAt: new Date(start.getTime() + 60_000), endedAt: new Date(start.getTime() + 1_800_000), breakType: "meal", paid: false });
  await expect(handleTimeReview(request({ endsAt: new Date(start.getTime() + 900_000).toISOString(), reason: "Correction", expectedUpdatedAt: shift!.updatedAt.toISOString() }), ["time", "shifts", shift!.id, "clock-out"], office)).rejects.toMatchObject({ status: 422 });
  expect((await db.select().from(schema.shifts).where(eq(schema.shifts.id, shift!.id)))[0]?.status).toBe("clocked_in");
  expect(await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.shiftId, shift!.id))).toHaveLength(0);
});
async function job(extra: Partial<typeof schema.jobs.$inferInsert> = {}) {
  const [created] = await db.insert(schema.jobs).values({ tenantId: owner.tenantId, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, serviceId: seedIds.weeklyService, status: "scheduled", scheduledDate: today, ...extra }).returning(); return created!;
}

it("assigns owner and office by effective field permission, rejects denied, inactive and wrong-location members", async () => {
  const work = await job();
  expect(await assignableTechnician(db, owner, work, seedIds.oliviaMembership)).toMatchObject({ id: seedIds.oliviaMembership });
  expect(await assignableTechnician(db, owner, work, seedIds.morganMembership)).toMatchObject({ id: seedIds.morganMembership });
  await expect(assignableTechnician(db, owner, work, seedIds.caseyMembership)).rejects.toMatchObject({ status: 404 });
  const [member] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, seedIds.oliviaMembership));
  await db.insert(schema.rolePermissions).values({ roleTemplateId: member!.roleTemplateId, permissionKey: "jobs.start", allowed: false }).onConflictDoUpdate({ target: [schema.rolePermissions.roleTemplateId, schema.rolePermissions.permissionKey], set: { allowed: false } });
  await expect(assignableTechnician(db, owner, work, seedIds.oliviaMembership)).rejects.toMatchObject({ status: 404 });
  await db.update(schema.rolePermissions).set({ allowed: true }).where(and(eq(schema.rolePermissions.roleTemplateId, member!.roleTemplateId), eq(schema.rolePermissions.permissionKey, "jobs.start")));
  await db.update(schema.memberships).set({ status: "inactive" }).where(eq(schema.memberships.id, seedIds.morganMembership));
  await expect(assignableTechnician(db, owner, work, seedIds.morganMembership)).rejects.toMatchObject({ status: 404 });
  await db.update(schema.memberships).set({ status: "active" }).where(eq(schema.memberships.id, seedIds.morganMembership));
});

it("stores office-set job pricing, bills that exact price, and rejects repricing after invoicing", async () => {
  const response = await handleRecords(request({ customerId: seedIds.carter, serviceId: seedIds.weeklyService, priceCents: 4567, scheduledDate: today }), ["jobs"], owner);
  const { item } = await response!.json(); expect(item.priceSnapshot).toMatchObject({ amountMinor: 4567, currency: "USD", source: "office" });
  await db.update(schema.jobs).set({ status: "completed", actualCompletedAt: new Date() }).where(eq(schema.jobs.id, item.id));
  const invoice = await handleWorkflow(request({}), ["jobs", item.id, "invoice"], owner);
  expect(await invoice!.json()).toMatchObject({ item: { totalMinor: 4567 } });
  const [current] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, item.id));
  await expect(handleOperationsSettings(request({ priceCents: 100, expectedUpdatedAt: current!.updatedAt.toISOString() }), ["jobs", item.id, "price"], owner)).rejects.toMatchObject({ status: 409 });
});

it("repairs an unpriced historical visit without rewriting an agreed started price", async () => {
  const work = await job({ status: "completed", actualStartedAt: new Date(), actualCompletedAt: new Date() });
  await expect(handleOperationsSettings(request({ priceCents: 0, expectedUpdatedAt: work.updatedAt.toISOString() }), ["jobs", work.id, "price"], { ...owner, organizationId: seedIds.cleanOrganization })).rejects.toMatchObject({ status: 404 });
  expect((await handleOperationsSettings(request({ priceCents: 0, expectedUpdatedAt: work.updatedAt.toISOString() }), ["jobs", work.id, "price"], owner))!.status).toBe(200);
  const [saved] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, work.id));
  await expect(handleOperationsSettings(request({ priceCents: 100, expectedUpdatedAt: saved!.updatedAt.toISOString() }), ["jobs", work.id, "price"], owner)).rejects.toMatchObject({ status: 409 });
});

it("shows every same-day published route for an assigned owner", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const work = await job({ status: "dispatched", serviceWindowStart: new Date(`${today}T14:00:00Z`), serviceWindowEnd: new Date(`${today}T16:00:00Z`) }); ids.push(work.id);
    await db.insert(schema.jobAssignments).values({ tenantId: owner.tenantId, jobId: work.id, membershipId: owner.membershipId! });
    const [route] = await db.insert(schema.routePlans).values({ tenantId: owner.tenantId, organizationLocationId: seedIds.augusta, membershipId: owner.membershipId!, routeDate: today, status: "published", publishedAt: new Date() }).returning();
    await db.insert(schema.routeStops).values({ tenantId: owner.tenantId, routePlanId: route!.id, jobId: work.id, sequence: 1, status: "planned" });
  }
  const payload = await (await handleRoutesField(request(), ["field", "today"], owner))!.json();
  expect(payload.item.jobs.map((j: { id: string }) => j.id).sort()).toEqual(ids.sort());
  expect(payload.item.jobs[0].serviceWindowStart).toBeTruthy();
  await expect(handleRoutesField(request(), ["field", "today"], { ...owner, permissions: new Set() })).rejects.toMatchObject({ status: 403 });
});

it("pausing withdraws published future visits but preserves started/completed/invoiced work and prevents auto-billing", async () => {
  const [source] = await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.id, seedIds.carterPlan));
  const [plan] = await db.insert(schema.servicePlans).values({ ...source!, id: crypto.randomUUID(), status: "active" }).returning();
  const future = await job({ servicePlanId: plan!.id, status: "dispatched" });
  const started = await job({ servicePlanId: plan!.id, status: "in_progress", actualStartedAt: new Date() });
  const completed = await job({ servicePlanId: plan!.id, status: "completed", actualCompletedAt: new Date() });
  const invoiceWork = await job({ servicePlanId: plan!.id });
  await db.insert(schema.invoiceItems).values({ tenantId: owner.tenantId, invoiceId: seedIds.happyInvoice, jobId: invoiceWork.id, description: "Recorded visit", quantity: "1", unitAmountMinor: 100n, totalMinor: 100n });
  const [route] = await db.insert(schema.routePlans).values({ tenantId: owner.tenantId, membershipId: owner.membershipId!, organizationLocationId: seedIds.augusta, routeDate: today, status: "published" }).returning();
  await db.insert(schema.routeStops).values({ tenantId: owner.tenantId, routePlanId: route!.id, jobId: future.id, sequence: 1, status: "planned" });
  await handleWorkflow(request({}), ["service-plans", plan!.id, "pause"], owner);
  const [withdrawn] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, future.id)); expect(withdrawn).toMatchObject({ status: "canceled", billable: false, assignedRouteId: null });
  expect((await db.select().from(schema.routeStops).where(eq(schema.routeStops.jobId, future.id)))[0]?.status).toBe("removed");
  for (const work of [started, completed, invoiceWork]) expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, work.id)))[0]?.status).toBe(work.status);
  await expect(transitionJob(owner, future.id, "completed", { completedChecklist: true })).rejects.toMatchObject({ status: 409 });
  expect(await (await transitionJob(owner, started.id, "completed", { completedChecklist: true })).json()).not.toHaveProperty("invoice");
  expect(await generateRecurringJobs(db, { tenantId: owner.tenantId, planId: plan!.id, horizonDays: 7 })).toMatchObject({ created: 0 });
});

it("saves the usual worker with business, permission and version checks", async () => {
  const [source] = await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.id, seedIds.carterPlan));
  const [plan] = await db.insert(schema.servicePlans).values({ ...source!, id: crypto.randomUUID(), status: "active" }).returning();
  const body = { technicianId: owner.membershipId, expectedUpdatedAt: plan!.updatedAt.toISOString() };
  const path = ["service-plans", plan!.id, "assignment"];
  await expect(handleOperationsSettings(request(body), path, { ...owner, organizationId: seedIds.cleanOrganization })).rejects.toMatchObject({ status: 404 });
  await expect(handleOperationsSettings(request(body), path, { ...owner, permissions: new Set(["service_plans.update"]) })).rejects.toMatchObject({ status: 403 });
  expect(await (await handleOperationsSettings(request(body), path, owner))!.json()).toMatchObject({ item: { preferredAssignment: { membershipId: owner.membershipId } } });
  await expect(handleOperationsSettings(request({ ...body, technicianId: null }), path, owner)).rejects.toMatchObject({ status: 409 });
});

it("new recurring visits inherit a valid plan worker", async () => {
  const [source] = await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.id, seedIds.carterPlan));
  const [rule] = await db.insert(schema.recurrenceRules).values({ tenantId: owner.tenantId, frequencyType: "daily", interval: 1, timezone: "America/New_York" }).returning();
  const [plan] = await db.insert(schema.servicePlans).values({ ...source!, id: crypto.randomUUID(), status: "active", effectiveFrom: today, recurrenceRuleId: rule!.id, preferredAssignment: { membershipId: owner.membershipId } }).returning();
  expect(await generateRecurringJobs(db, { planId: plan!.id, through: today })).toMatchObject({ created: 1 });
  const [work] = await db.select().from(schema.jobs).where(eq(schema.jobs.servicePlanId, plan!.id));
  expect((await db.select().from(schema.jobAssignments).where(eq(schema.jobAssignments.jobId, work!.id)))[0]?.membershipId).toBe(owner.membershipId);
});

it("canceling withdraws visits, while resuming a paused plan creates replacements without reactivating history", async () => {
  const [source] = await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.id, seedIds.carterPlan));
  const [rule] = await db.insert(schema.recurrenceRules).values({ tenantId: owner.tenantId, frequencyType: "daily", interval: 1, timezone: "America/New_York" }).returning();
  const [plan] = await db.insert(schema.servicePlans).values({ ...source!, id: crypto.randomUUID(), effectiveFrom: today, recurrenceRuleId: rule!.id, status: "active" }).returning();
  expect((await generateRecurringJobs(db, { planId: plan!.id, through: today })).created).toBe(1);
  const [original] = await db.select().from(schema.jobs).where(eq(schema.jobs.servicePlanId, plan!.id));
  await handleWorkflow(request({}), ["service-plans", plan!.id, "pause"], owner);
  await handleWorkflow(request({}), ["service-plans", plan!.id, "resume"], owner);
  expect((await generateRecurringJobs(db, { planId: plan!.id, through: today })).created).toBe(1);
  expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, original!.id)))[0]?.status).toBe("canceled");
  await handleWorkflow(request({}), ["service-plans", plan!.id, "cancel"], owner);
  const work = await db.select().from(schema.jobs).where(eq(schema.jobs.servicePlanId, plan!.id));
  expect(work).toHaveLength(2); expect(work.every(j => j.status === "canceled" && !j.billable)).toBe(true);
  expect((await generateRecurringJobs(db, { planId: plan!.id, through: today })).created).toBe(0);
});

it("office closes a forgotten shift, separately approves its time, and enforces scoping, permissions and locked payroll", async () => {
  const start = new Date(Date.now()-3_600_000), end = new Date(Date.now()-60_000);
  const [shift] = await db.insert(schema.shifts).values({ tenantId: owner.tenantId, membershipId: owner.membershipId!, organizationLocationId: seedIds.augusta, status: "clocked_in", clockInAt: start }).returning();
  const payload = { endsAt: end.toISOString(), reason: "Forgot to clock out", expectedUpdatedAt: shift!.updatedAt.toISOString() };
  await expect(handleTimeReview(request(payload), ["time", "shifts", shift!.id, "clock-out"], { ...office, locationIds: new Set([seedIds.northAugusta]) })).rejects.toMatchObject({ status: 404 });
  await handleTimeReview(request(payload), ["time", "shifts", shift!.id, "clock-out"], office);
  await handleTimeReview(request(payload), ["time", "shifts", shift!.id, "clock-out"], office);
  const entries = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.shiftId, shift!.id)); expect(entries).toHaveLength(1); expect(entries[0]?.approvalStatus).toBe("pending");
  const review = await (await handleTimeReview(request(), ["time"], office))!.json();
  const reviewed = review.entries.find((entry: { id: string }) => entry.id === entries[0]!.id);
  expect(reviewed.approvalStatus).toBe("pending");
  expect(reviewed.updatedAt).toBe(new Date(reviewed.updatedAt).toISOString());
  const approve = request({ expectedUpdatedAt: entries[0]!.updatedAt.toISOString() });
  await expect(handleTimeReview(approve, ["time", "entries", entries[0]!.id, "approve"], { ...office, permissions: new Set(["time.all_read"]) })).rejects.toMatchObject({ status: 403 });
  await handleTimeReview(request({ expectedUpdatedAt: entries[0]!.updatedAt.toISOString() }), ["time", "entries", entries[0]!.id, "approve"], office);
  expect((await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, entries[0]!.id)))[0]?.approvalStatus).toBe("approved");
  const [locked] = await db.insert(schema.payrollPeriods).values({ tenantId: owner.tenantId, organizationId: owner.organizationId!, periodStart: today, periodEnd: today, status: "approved" }).returning();
  await expect(handleTimeReview(request({ expectedUpdatedAt: entries[0]!.updatedAt.toISOString() }), ["time", "entries", entries[0]!.id, "approve"], office)).rejects.toMatchObject({ status: 409 });
  await db.update(schema.payrollPeriods).set({ status: "reopened" }).where(eq(schema.payrollPeriods.id, locked!.id));
});
