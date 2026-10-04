import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleAdminOperations } = await import("../lib/api/admin-operations");
let pglite: PGlite;
const office: SessionActor = {
  kind: "staff", userId: "demo-happy-manager", tenantId: seedIds.happyTenant, tenantName: "Happy Yards",
  packKey: "pet-waste-removal", email: "manager@happyyards.test", name: "Morgan", role: "office",
  permissions: permissionsForRole("office"), locationIds: new Set([seedIds.augusta]), allLocations: false,
  membershipId: seedIds.morganMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};
const owner: SessionActor = { ...office, userId: "demo-happy-owner", role: "owner", permissions: permissionsForRole("owner"), allLocations: true, membershipId: seedIds.oliviaMembership };

beforeAll(async () => {
  pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  getDbMock.mockReturnValue(db as unknown as Database);
  await seedDevelopment(db as unknown as Database);
}, 120_000);
afterAll(async () => { await pglite?.close(); });
const create = (path: string[], actor: SessionActor) => handleAdminOperations(new Request(`http://localhost/api/v1/${path.join("/")}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Permission regression location", address: "12 Test Road" }) }), path, actor);

describe("organization permission defaults", () => {
  it("lets Morgan read only scoped locations", async () => {
    const response = await handleAdminOperations(new Request("http://localhost/api/v1/organization"), ["organization"], office);
    expect(response?.status).toBe(200);
    expect((await response!.json()).items.map((item: { id: string }) => item.id)).toEqual([seedIds.augusta]);
  });
  it.each(["organization", "organization/locations"])("denies Morgan location creation through %s", async (endpoint) => {
    await expect(create(endpoint.split("/"), office)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
  it("preserves Owner location creation", async () => {
    const response = await create(["organization"], owner);
    expect(response?.status).toBe(201);
    const { item } = await response!.json();
    expect(item).toMatchObject({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization });
    const read = await handleAdminOperations(new Request(`http://localhost/api/v1/organization/${item.id}`), ["organization", item.id], owner);
    expect(read?.status).toBe(200);
  });
  it("allows an explicitly granted custom Office permission without a role-name check", async () => {
    const response = await create(["organization"], { ...office, permissions: new Set([...office.permissions, "organization.locations_manage"]) });
    expect(response?.status).toBe(201);
  });
});
