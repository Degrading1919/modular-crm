import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";

const { getDbMock, signUpMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), signUpMock: vi.fn() }));
vi.mock("../lib/db", () => ({ getDb: getDbMock }));
vi.mock("../lib/auth", () => ({ auth: { api: { signUpEmail: signUpMock } } }));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleCapabilitySettings } = await import("../lib/api/capability-settings");
const { handleAuthRoute } = await import("../lib/api/auth-routes");
const owner: SessionActor = { kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia", role: "owner", permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta]), allLocations: true, membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta };
let pg: PGlite, db: Database;
beforeAll(async () => {
  pg = new PGlite(); const raw = drizzle(pg, { schema });
  await migrate(raw, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = raw as unknown as Database; getDbMock.mockReturnValue(db); await seedDevelopment(db);
}, 120_000);
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => { await pg?.close(); });
const activation = new Date("2026-11-01T12:00:00Z"), later = new Date("2026-11-02T12:00:00Z");
function clock(now: Date) { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); }
const request = (data: unknown, method = "POST") => new Request("http://localhost", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
async function saved(id: string) { return (await db.select().from(schema.automationRules).where(and(eq(schema.automationRules.tenantId, owner.tenantId), eq(schema.automationRules.id, id))))[0]!; }
async function create(status: string) {
  const response = await handleCapabilitySettings(request({ name: "Invoice follow-up", status, trigger: "invoice.issued", actions: [{ actionType: "notify_staff", configuration: { body: "Review the invoice." } }] }), ["automations"], owner);
  expect(response!.status).toBe(201); return saved((await response!.json()).item.id);
}
async function change(id: string, data: unknown) {
  const response = await handleCapabilitySettings(request(data, "PATCH"), ["automations", id], owner);
  expect(response!.status).toBe(200); return saved((await response!.json()).item.id);
}

it("sets the cutoff on active creation but not draft creation", async () => {
  clock(activation);
  expect((await create("active")).activeFrom).toEqual(activation);
  expect((await create("draft")).activeFrom).toBeNull();
});

it("resets the cutoff on activation/reactivation and preserves it on pause/archive", async () => {
  clock(activation); const draft = await create("draft");
  expect((await change(draft.id, { status: "active" })).activeFrom).toEqual(activation);
  clock(later);
  expect((await change(draft.id, { status: "paused" })).activeFrom).toEqual(activation);
  expect((await change(draft.id, { status: "active" })).activeFrom).toEqual(later);
  expect((await change(draft.id, { status: "archived" })).activeFrom).toEqual(later);
});

it("applies an active definition edit only to events from the edit onward", async () => {
  clock(activation); const rule = await create("active"); clock(later);
  const edited = await change(rule.id, { name: "Updated follow-up" });
  expect(edited).toMatchObject({ id: rule.id, activeFrom: later, updatedAt: later, version: 2 });
  expect((await change(rule.id, { name: "Paused follow-up", status: "paused" })).activeFrom).toEqual(later);
});

it("gives active pack overrides a new cutoff without changing the archived source cutoff", async () => {
  const [source] = await db.insert(schema.automationRules).values({ tenantId: owner.tenantId, name: "Pack follow-up", source: "industry_pack", sourceKey: "test-follow-up", status: "active", activeFrom: activation, triggerConfig: { event: "invoice.issued" }, actions: [{ actionType: "notify_staff", configuration: { body: "Review invoice." } }] }).returning();
  clock(later); const copy = await change(source!.id, { name: "My follow-up" });
  expect(copy.id).not.toBe(source!.id); expect(copy).toMatchObject({ source: "tenant", sourceKey: "test-follow-up", activeFrom: later, updatedAt: later, status: "active" });
  expect(await saved(source!.id)).toMatchObject({ status: "archived", activeFrom: activation });
});

it("restoring active via an edit resets the cutoff for both tenant and pack rules", async () => {
  clock(activation); const tenant = await create("paused");
  const [pack] = await db.insert(schema.automationRules).values({ tenantId: owner.tenantId, name: "Paused pack", source: "industry_pack", status: "paused", activeFrom: activation, triggerConfig: { event: "invoice.issued" }, actions: [{ actionType: "notify_staff", configuration: { body: "Review invoice." } }] }).returning();
  clock(later);
  for (const rule of [tenant, pack!]) expect((await change(rule.id, { name: "Restored", status: "active" })).activeFrom).toEqual(later);
});

it("sets signup recipe cutoffs only for recipes that start enabled", async () => {
  clock(activation); signUpMock.mockResolvedValue(Response.json({ user: { id: owner.userId } }, { status: 201 }));
  const response = await handleAuthRoute(request({ name: "Owner", businessName: "Activation Signup", email: "activation@example.test", password: "Test-password-123" }), ["auth", "register"]);
  expect(response.status).toBe(201);
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.name, "Activation Signup"));
  const recipes = await db.select().from(schema.automationRules).where(eq(schema.automationRules.tenantId, tenant!.id));
  expect(recipes.some(rule => rule.status === "active")).toBe(true);
  expect(recipes.some(rule => rule.status === "draft")).toBe(true);
  for (const rule of recipes) expect(rule.activeFrom).toEqual(rule.status === "active" ? activation : null);
});
