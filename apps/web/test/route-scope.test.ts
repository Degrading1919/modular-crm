import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRoutesField } = await import("../lib/api/routes-field.ts");
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

    const response = await handleRoutesField(new Request(`http://localhost/api/v1/routes/${routeId}/publish`, { method: "POST" }), ["routes", routeId, "publish"], owner);
    expect(response?.status).toBe(200);
    const events = await db.select().from(schema.domainEvents).where(eq(schema.domainEvents.entityId, jobId));
    expect(events.filter((event) => event.eventType === "job.dispatched")).toHaveLength(1);
    expect(events.find((event) => event.eventType === "job.dispatched")?.payload).toMatchObject({ customerId: seedIds.carter, jobId, routeId });
    const routeEvents = await db.select().from(schema.domainEvents).where(eq(schema.domainEvents.entityId, routeId));
    expect(routeEvents.some((event) => event.eventType === "route.published")).toBe(true);
  });
});
