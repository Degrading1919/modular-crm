import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { customers, schema, seedDevelopment, seedIds, services, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records.ts");
const { apiError } = await import("../lib/api/http.ts");

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

async function call(method: string, path: string[], body?: unknown): Promise<Response> {
  // Resolve thrown errors the way the API route does, so tests assert the HTTP outcome.
  return (await handleRecords(new Request(`http://localhost/api/v1/${path.join("/")}`, {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }), path, owner).catch(apiError))!;
}

describe("record identifiers", () => {
  it.each(["customers", "jobs", "invoices", "tickets"])("treats a malformed %s id as not found", async (resource) => {
    expect((await call("GET", [resource, "not-a-real-id"])).status).toBe(404);
    expect((await call("PATCH", [resource, "not-a-real-id"], { description: "x" })).status).toBe(404);
  });
});

describe("record edits", () => {
  it.each([
    ["customers", seedIds.carter, { name: "" }],
    ["customers", seedIds.carter, { name: null }],
    ["customers", seedIds.carter, { email: "not-an-email" }],
    ["jobs", seedIds.upcomingJob, { scheduledDate: "garbage" }],
    ["services", seedIds.weeklyService, { durationMinutes: "abc" }],
    ["services", seedIds.weeklyService, { durationMinutes: -5 }],
  ] as const)("rejects invalid %s values %j", async (resource, id, body) => {
    expect((await call("PATCH", [resource, id], body)).status).toBe(422);
  });

  it("rejects a non-object body", async () => {
    expect((await call("PATCH", ["customers", seedIds.carter], null)).status).toBe(422);
  });

  it("keeps the stored values after rejected edits and still applies valid ones", async () => {
    const [customer] = await db.select().from(customers).where(eq(customers.id, seedIds.carter));
    expect(customer?.displayName).toBe("Carter Household");
    const [service] = await db.select().from(services).where(eq(services.id, seedIds.weeklyService));
    expect(service?.defaultDurationMinutes).toBeGreaterThan(0);
    const response = await call("PATCH", ["customers", seedIds.carter], { phone: "555-0100", email: "" });
    expect(response.status).toBe(200);
    const [updated] = await db.select().from(customers).where(eq(customers.id, seedIds.carter));
    expect(updated).toMatchObject({ billingPhone: "555-0100", billingEmail: null });
  });
});
