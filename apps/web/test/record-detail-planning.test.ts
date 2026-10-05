import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db", () => ({ getDb: getDbMock }));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleJobPlanning } = await import("../lib/api/job-planning");
const { handleRecordDetails } = await import("../lib/api/record-details");
const { handleRecords } = await import("../lib/api/records");
const { handleRoutesField } = await import("../lib/api/routes-field");
const { handleWorkflow } = await import("../lib/api/workflows");
const owner: SessionActor = { kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia", role: "owner", permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta]), allLocations: true, membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta };
const office: SessionActor = { ...owner, role: "office", permissions: permissionsForRole("office"), allLocations: false };
let pg: PGlite, db: Database;
beforeAll(async () => { pg = new PGlite(); const d = drizzle(pg, { schema }); await migrate(d, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) }); db = d as unknown as Database; getDbMock.mockReturnValue(db); await seedDevelopment(db); }, 120_000);
afterAll(async () => { await pg?.close(); });
const request = (data: unknown, method = "POST") => new Request("http://localhost", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
async function createJob(status = "scheduled", date = "2026-11-07") {
  const [job] = await db.insert(schema.jobs).values({ tenantId: owner.tenantId, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, serviceId: seedIds.weeklyService, scheduledDate: date, status }).returning();
  await db.insert(schema.jobAssignments).values({ tenantId: owner.tenantId, jobId: job!.id, membershipId: seedIds.terryMembership }); return job!;
}
async function action(job: typeof schema.jobs.$inferSelect, name: string, extra: Record<string, unknown>, actor = office, key = crypto.randomUUID()) {
  return handleJobPlanning(request({ idempotencyKey: key, expectedUpdatedAt: job.updatedAt.toISOString(), ...extra }), ["jobs", job.id, name], actor);
}

it("reschedules dispatched work atomically, preserves old route history, and publishes a valid new route", async () => {
  const job = await createJob();
  const [route] = await db.insert(schema.routePlans).values({ tenantId: owner.tenantId, organizationLocationId: seedIds.augusta, membershipId: seedIds.terryMembership, routeDate: job.scheduledDate!, status: "draft" }).returning();
  await db.insert(schema.routeStops).values({ tenantId: owner.tenantId, routePlanId: route!.id, jobId: job.id, sequence: 1, status: "planned" });
  await handleRoutesField(request({}), ["routes", route!.id, "publish"], office);
  const [dispatched] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
  await expect(handleWorkflow(request({ status: "scheduled" }), ["jobs", job.id, "transition"], office)).rejects.toMatchObject({ status: 409, message: "Use Reschedule or Reassign to return this job to scheduling." });
  expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)))[0]).toMatchObject({ status: "dispatched", assignedRouteId: route!.id });
  const key = crypto.randomUUID(); const change = { scheduledDate: "2026-11-08" };
  expect((await action(dispatched!, "reschedule", change, office, key))!.status).toBe(200);
  expect(await (await action(dispatched!, "reschedule", change, office, key))!.json()).toMatchObject({ duplicate: true, item: { status: "scheduled", assignedRouteId: null } });
  await expect(action(dispatched!, "reschedule", { scheduledDate: "2026-11-09" }, office, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect((await db.select().from(schema.routeStops).where(eq(schema.routeStops.routePlanId, route!.id)))[0]!.status).toBe("removed");
  const newRoute = (await (await handleRoutesField(request({ date: change.scheduledDate, technicianId: seedIds.terryMembership }), ["routes"], office))!.json()).item;
  expect((await handleRoutesField(request({}), ["routes", newRoute.id, "publish"], office))!.status).toBe(200);
  expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)))[0]).toMatchObject({ status: "dispatched", assignedRouteId: newRoute.id });
  expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityId, job.id), eq(schema.auditEvents.action, "job.reschedule")))).toHaveLength(1);
  const legacy = await handleWorkflow(request({ technicianId: seedIds.terryMembership, scheduledDate: "2026-11-09" }), ["jobs",job.id,"assign"],office);
  expect(await legacy!.json()).toMatchObject({ item: { assignedRouteId: null, scheduledDate: "2026-11-09", status: "scheduled" } });
  expect((await db.select().from(schema.routeStops).where(eq(schema.routeStops.routePlanId,newRoute.id)))[0]!.status).toBe("removed");
});
it("rejects started work, stale updates, missing permission, wrong tenant and wrong location without changes", async () => {
  const job = await createJob("in_progress");
  await expect(action(job, "reschedule", { scheduledDate: "2026-11-10" })).rejects.toMatchObject({ status: 409 });
  await expect(action(job, "reassign", { technicianId: seedIds.terryMembership })).rejects.toMatchObject({ status: 409 });
  await expect(action(job, "cancel", { reason: "Requested" }, { ...office, permissions: new Set() })).rejects.toMatchObject({ status: 403 });
  await expect(action(job, "cancel", { reason: "Requested" }, { ...office, locationIds: new Set([seedIds.northAugusta]) })).rejects.toMatchObject({ status: 404 });
  await expect(action(job, "cancel", { reason: "Requested" }, { ...owner, tenantId: seedIds.cleanTenant })).rejects.toMatchObject({ status: 404 });
  const fresh = await createJob(); await db.update(schema.jobs).set({ updatedAt: new Date(fresh.updatedAt.getTime() + 1000) }).where(eq(schema.jobs.id, fresh.id));
  await expect(action(fresh, "reschedule", { scheduledDate: "2026-11-10" })).rejects.toMatchObject({ status: 409 });
});
it("reassigns within the job's business only, retaining assignment history", async () => {
  const job = await createJob();
  await expect(handleWorkflow(request({ technicianId: seedIds.oliviaMembership }), ["jobs",job.id,"assign"], owner)).rejects.toMatchObject({ status: 404 });
  await expect(action(job, "reassign", { technicianId: seedIds.caseyMembership })).rejects.toMatchObject({ status: 404 });
  await db.insert(schema.outboundMessages).values({ tenantId: owner.tenantId, customerId: job.customerId, jobId: job.id, channel: "sms", category: "service", templateKey: "service-day-reminder", recipient: "+17065550101", renderedBody: "Old dispatch", status: "queued", idempotencyKey: crypto.randomUUID() });
  await expect(action(job, "reassign", { technicianId: seedIds.oliviaMembership })).rejects.toMatchObject({ status: 404 });
  await db.insert(schema.membershipLocationScopes).values({ tenantId: owner.tenantId, membershipId: seedIds.caseyMembership, locationId: seedIds.augusta });
  expect((await action(job, "reassign", { technicianId: seedIds.caseyMembership }))!.status).toBe(200);
  expect((await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.jobId,job.id)))[0]).toMatchObject({ status: "suppressed", failureCode: "visit_rescheduled" });
  const assignments = await db.select().from(schema.jobAssignments).where(eq(schema.jobAssignments.jobId, job.id));
  expect(assignments).toHaveLength(2); expect(assignments.filter((row) => !row.removedAt)).toHaveLength(1);
  expect(assignments.find((row) => !row.removedAt)!.membershipId).toBe(seedIds.caseyMembership);
});
it("requires a cancellation reason and emits one audited notification event on replay", async () => {
  const job = await createJob();
  await expect(action(job, "cancel", {})).rejects.toMatchObject({ status: 422 });
  const key = crypto.randomUUID(); expect((await action(job, "cancel", { reason: "Customer traveling" }, office, key))!.status).toBe(200);
  expect(await (await action(job, "cancel", { reason: "Customer traveling" }, office, key))!.json()).toMatchObject({ duplicate: true });
  const events = await db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.entityId, job.id), eq(schema.domainEvents.eventType, "job.canceled")));
  expect(events).toHaveLength(1); expect(events[0]!.payload).toMatchObject({ reason: "Customer traveling", customerId: seedIds.carter });
});
it("all four detail endpoints enforce record scope and omit related sections without their permissions", async () => {
  const leads = await db.select().from(schema.leads).where(eq(schema.leads.tenantId, owner.tenantId));
  const lead = leads.find((row) => row.owningLocationId === seedIds.augusta)!;
  for (const [resource, id] of [["customers", seedIds.carter], ["jobs", seedIds.upcomingJob], ["invoices", seedIds.happyInvoice], ["leads", lead.id]]) {
    expect((await handleRecordDetails(new Request("http://localhost"), [resource!, id!, "detail"], office))!.status).toBe(200);
    await expect(handleRecordDetails(new Request("http://localhost"), [resource!, id!, "detail"], { ...office, locationIds: new Set() })).rejects.toMatchObject({ status: 404 });
    await expect(handleRecordDetails(new Request("http://localhost"), [resource!, id!, "detail"], { ...office, tenantId: seedIds.cleanTenant })).rejects.toMatchObject({ status: 404 });
  }
  const restricted = { ...office, permissions: new Set(["customers.read"] as const) };
  const view = await (await handleRecordDetails(new Request("http://localhost"), ["customers", seedIds.carter, "detail"], restricted))!.json();
  expect(view.related).not.toHaveProperty("jobs"); expect(view.related).not.toHaveProperty("invoices"); expect(view.related).not.toHaveProperty("payments");
  const [outside] = await db.insert(schema.invoices).values({ tenantId: owner.tenantId, organizationId: owner.organizationId!, organizationLocationId: seedIds.northAugusta, customerId: seedIds.carter, invoiceNumber: "OTHER BRANCH", status: "draft" }).returning();
  const [property] = await db.insert(schema.serviceLocations).values({ tenantId: owner.tenantId, customerId: seedIds.carter, organizationLocationId: seedIds.northAugusta, name: "Other branch property", addressLine1: "1 Other Street", city: "North Augusta", region: "SC", postalCode: "29841" }).returning();
  const [pet] = await db.insert(schema.customerAssets).values({ tenantId: owner.tenantId, customerId: seedIds.carter, serviceLocationId: property!.id, assetTypeKey: "pet", name: "Outside branch pet" }).returning();
  const ownerView = await (await handleRecordDetails(new Request("http://localhost"), ["customers",seedIds.carter,"detail"],owner))!.json();
  const officeView = await (await handleRecordDetails(new Request("http://localhost"), ["customers",seedIds.carter,"detail"],office))!.json();
  expect(ownerView.related.invoices.some((row: { id: string }) => row.id === outside!.id)).toBe(true);
  expect(officeView.related.invoices.some((row: { id: string }) => row.id === outside!.id)).toBe(false);
  expect(officeView.item.pets.some((row: { id: string }) => row.id === pet!.id)).toBe(false);
});
it("draft invoice editing updates its real line and balance but cannot mutate issued invoices", async () => {
  const created = await handleRecords(request({ customerId: seedIds.carter, description: "One service", totalCents: 1000 }), ["invoices"], owner); const invoice = (await created!.json()).item;
  const edit = { description: "Updated service", totalCents: 1250, dueDate: "2026-11-12", expectedUpdatedAt: invoice.updatedAt };
  expect((await handleRecords(request(edit, "PATCH"), ["invoices", invoice.id], office))!.status).toBe(200);
  const line = (await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, invoice.id)))[0]!;
  expect(line.totalMinor).toBe(1250n); expect(line.description).toBe("Updated service");
  await db.update(schema.invoices).set({ status: "issued" }).where(eq(schema.invoices.id, invoice.id));
  await expect(handleRecords(request(edit, "PATCH"), ["invoices", invoice.id], office)).rejects.toMatchObject({ status: 409 });
});
