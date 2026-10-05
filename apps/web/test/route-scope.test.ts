import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { assertTransition, permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRoutesField } = await import("../lib/api/routes-field.ts");
const { transitionJob } = await import("../lib/api/workflows.ts");
let pglite: PGlite;
let db: Database;

const terry: SessionActor = {
  kind: "staff", userId: "demo-happy-tech", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "tech@happyyards.test", name: "Terry Tech", role: "technician",
  permissions: permissionsForRole("technician"), locationIds: new Set([seedIds.augusta]), allLocations: false,
  membershipId: seedIds.terryMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};
const unassignedTech: SessionActor = { ...terry, userId: "casey-tech", membershipId: seedIds.caseyMembership };
const owner: SessionActor = {
  ...terry, userId: "demo-happy-owner", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), allLocations: true, membershipId: seedIds.oliviaMembership,
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

async function listRoutes(actor: SessionActor, path = ["routes"]) {
  const response = await handleRoutesField(new Request("http://localhost/api/v1/routes"), path, actor);
  if (!response) throw new Error("Route endpoint did not handle the request.");
  return response;
}

describe("route read scope", () => {
  it("shows a technician only their own published route and assigned stops", async () => {
    const response = await listRoutes(terry);
    expect(response.status).toBe(200);
    const payload = await response.json() as { items: Array<{ id: string; stops: Array<{ jobId: string }> }> };
    expect(payload.items.map((route) => route.id)).toEqual([seedIds.happyRoute]);
    expect(payload.items[0]?.stops.map((stop) => stop.jobId)).toEqual([seedIds.upcomingJob, seedIds.recleanJob]);
  });

  it("hides a route from an unassigned technician even when its branch is otherwise in scope", async () => {
    const list = await listRoutes(unassignedTech);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ items: [] });

    await expect(listRoutes(unassignedTech, ["routes", seedIds.happyRoute])).rejects.toMatchObject({ status: 404 });
  });

  it("publishes job dispatch events with the route update transaction", async () => {
    const jobId = crypto.randomUUID();
    const routeId = crypto.randomUUID();
    const routeDate = "2026-09-27";
    await db.insert(schema.jobs).values({
      id: jobId, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
      customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, serviceId: seedIds.weeklyService,
      status: "scheduled", scheduledDate: routeDate,
    });
    await db.insert(schema.routePlans).values({
      id: routeId, tenantId: seedIds.happyTenant, organizationLocationId: seedIds.augusta,
      membershipId: seedIds.terryMembership, routeDate, status: "draft",
    });
    await db.insert(schema.routeStops).values({ tenantId: seedIds.happyTenant, routePlanId: routeId, jobId, sequence: 1, status: "planned" });
    await db.insert(schema.jobAssignments).values({ tenantId: seedIds.happyTenant, jobId, membershipId: seedIds.terryMembership, assignmentRole: "primary" });

    const response = await handleRoutesField(new Request(`http://localhost/api/v1/routes/${routeId}/publish`, { method: "POST" }), ["routes", routeId, "publish"], owner);
    expect(response?.status).toBe(200);
    const events = await db.select().from(schema.domainEvents).where(eq(schema.domainEvents.entityId, jobId));
    expect(events.filter((event) => event.eventType === "job.dispatched")).toHaveLength(1);
    expect(events.find((event) => event.eventType === "job.dispatched")?.payload).toMatchObject({ customerId: seedIds.carter, jobId, routeId });
    const routeEvents = await db.select().from(schema.domainEvents).where(eq(schema.domainEvents.entityId, routeId));
    expect(routeEvents.some((event) => event.eventType === "route.published")).toBe(true);
    expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]).toMatchObject({ status: "dispatched", assignedRouteId: routeId });
    expect((await db.select().from(schema.jobStatusEvents).where(eq(schema.jobStatusEvents.jobId, jobId)))[0]).toMatchObject({ fromStatus: "scheduled", toStatus: "dispatched" });
    for (const [from, next] of [["dispatched", "en_route"], ["en_route", "in_progress"], ["in_progress", "paused"], ["paused", "in_progress"], ["in_progress", "completed"]]) {
      expect((await transitionJob(terry, jobId, next!, { expectedPriorState: from, completedChecklist: next === "completed" })).status).toBe(200);
    }
    await expect(transitionJob(terry, jobId, "in_progress")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("seeded published stops and recorded history match states the real workflow produces", async () => {
    for (const jobId of [seedIds.upcomingJob, seedIds.recleanJob, seedIds.cleanJob]) {
      const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      expect(job).toMatchObject({ status: "dispatched" });
      expect(job?.assignedRouteId).toBeTruthy();
    }
    const events = await db.select().from(schema.jobStatusEvents);
    for (const event of events) expect(() => assertTransition("job", event.fromStatus!, event.toStatus, { reason: event.reasonCode ?? undefined, completedChecklist: true })).not.toThrow();
  });

  it.each(["canceled", "unscheduled", "missed", "needs_return", "wrong_date", "removed_assignment", "wrong_location"])("rejects a changed %s stop atomically instead of publishing a partially ready route", async (change) => {
    const routeId = crypto.randomUUID();
    const jobIds = [crypto.randomUUID(), crypto.randomUUID()];
    const routeDate = "2026-10-08";
    await db.insert(schema.routePlans).values({ id: routeId, tenantId: seedIds.happyTenant, organizationLocationId: seedIds.augusta, membershipId: seedIds.terryMembership, routeDate, status: "draft" });
    await db.insert(schema.jobs).values(jobIds.map((id, index) => ({
      id, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: index && change === "wrong_location" ? seedIds.northAugusta : seedIds.augusta,
      customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, serviceId: seedIds.weeklyService,
      status: index && ["canceled", "unscheduled", "missed", "needs_return"].includes(change) ? change : "scheduled",
      scheduledDate: index && change === "wrong_date" ? "2026-10-09" : routeDate,
    })));
    await db.insert(schema.routeStops).values(jobIds.map((jobId, index) => ({ tenantId: seedIds.happyTenant, routePlanId: routeId, jobId, sequence: index + 1, status: "planned" })));
    await db.insert(schema.jobAssignments).values(jobIds.filter((_, index) => !index || change !== "removed_assignment").map((jobId) => ({ tenantId: seedIds.happyTenant, jobId, membershipId: seedIds.terryMembership, assignmentRole: "primary" })));
    await expect(handleRoutesField(new Request(`http://localhost/api/v1/routes/${routeId}/publish`, { method: "POST" }), ["routes", routeId, "publish"], owner)).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect((await db.select().from(schema.routePlans).where(eq(schema.routePlans.id, routeId)))[0]?.status).toBe("draft");
    expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobIds[0]!)))[0]?.status).toBe("scheduled");
    expect(await db.select().from(schema.domainEvents).where(eq(schema.domainEvents.entityId, routeId))).toHaveLength(0);
  });

  it("continues to reject scheduled start and travel server-side", async () => {
    const jobId = crypto.randomUUID();
    await db.insert(schema.jobs).values({ id: jobId, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, serviceId: seedIds.weeklyService, status: "scheduled", scheduledDate: "2026-10-08" });
    await db.insert(schema.jobAssignments).values({ tenantId: seedIds.happyTenant, jobId, membershipId: seedIds.terryMembership, assignmentRole: "primary" });
    for (const next of ["en_route", "in_progress", "completed"]) await expect(transitionJob(terry, jobId, next, { completedChecklist: true })).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
  });
});
