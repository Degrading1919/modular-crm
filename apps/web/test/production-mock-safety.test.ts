import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
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
// Registry boundary test: configuration validity is covered by config's production tests.
vi.mock("@modular-crm/config", async importOriginal => ({ ...await importOriginal<typeof import("@modular-crm/config")>(), readServerConfig: () => ({ stripePayments: undefined }), readObjectStorageConfig: () => undefined }));
process.env.DATABASE_URL ??= "postgres://localhost/test";
const { getRegistry, hydrateTenantConnectors, getCapability, setConnectorState } = await import("../lib/connectors");
const { handleWorkflow } = await import("../lib/api/workflows");
const { handleOnboardingSite } = await import("../lib/api/onboarding-site");
const { handleCapabilitySettings } = await import("../lib/api/capability-settings");
let pglite: PGlite, db: Database;
const owner: SessionActor = { kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia", role: "owner", permissions: permissionsForRole("owner"), allLocations: true, locationIds: new Set([seedIds.augusta]), membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta };
const portal: SessionActor = { kind: "customer", userId: "demo-happy-customer", tenantId: owner.tenantId, tenantName: owner.tenantName, packKey: owner.packKey, email: "customer@happyyards.test", name: "Alex", customerIds: new Set([seedIds.carter]), locationIds: new Set([seedIds.carterLocation]), customerLocationIds: new Map([[seedIds.carter, new Set([seedIds.carterLocation])]]) };
beforeAll(async () => {
  pglite = new PGlite(); const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database; getDbMock.mockReturnValue(db); await seedDevelopment(db);
}, 120_000);
afterAll(async () => { await pglite?.close(); });
afterEach(() => vi.unstubAllEnvs());
function production() { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_SECRET", "production-test-fixture-not-a-real-secret-12345"); }

it("keeps mocks available locally, but never lists, hydrates, connects or uses them in production", async () => {
  const mockKeys = getRegistry().listCatalog().filter(provider => provider.authType === "local_mock").map(provider => provider.key);
  expect(mockKeys.length).toBeGreaterThan(0);
  await db.insert(schema.connectorInstallations).values(mockKeys.map(connectorKey => ({ tenantId: owner.tenantId, connectorKey, status: "connected" }))).onConflictDoNothing();
  production(); vi.stubEnv("MOCK_CONNECTORS", "true"); // Defense in depth even with a mis-set flag.
  const registry = await hydrateTenantConnectors(owner.tenantId);
  expect(registry.listCatalog().some(provider => provider.authType === "local_mock" || provider.availability === "mock_complete")).toBe(false);
  for (const key of mockKeys) {
    expect(registry.getDefinition(key)).toBeUndefined();
    await expect(setConnectorState(owner.tenantId, key, true)).rejects.toMatchObject({ status: 404 });
  }
  expect(await getCapability(owner.tenantId, "payments")).toBeUndefined();
  expect(await getCapability(owner.tenantId, "geocoding")).toBeUndefined();
  const catalog = await handleCapabilitySettings(new Request("http://localhost"), ["connections"], owner);
  expect(JSON.stringify(await catalog!.json())).not.toMatch(/mock-payments|mock-geocoding|mock-communication|local-storage/);
});

it.each([owner, portal])("refuses forged test payment requests for $kind without writing money", async actor => {
  const [invoice] = await db.insert(schema.invoices).values({ tenantId: owner.tenantId, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, status: "issued", issuedAt: new Date(), invoiceNumber: `PROD-${crypto.randomUUID()}`, totalMinor: 1000n, balanceMinor: 1000n }).returning();
  production();
  await expect(handleWorkflow(new Request("http://localhost", { method: "POST", body: JSON.stringify({ method: "test", amountCents: 1000, idempotencyKey: crypto.randomUUID() }) }), ["invoices", invoice!.id, "pay"], actor)).rejects.toMatchObject({ status: 403 });
  expect((await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoice!.id)))[0]!.balanceMinor).toBe(1000n);
  expect(await db.select().from(schema.paymentAllocations).where(and(eq(schema.paymentAllocations.tenantId, owner.tenantId), eq(schema.paymentAllocations.invoiceId, invoice!.id)))).toEqual([]);
});

it("uses real-safe onboarding defaults and rejects crafted demo selections server-side", async () => {
  production();
  const patch = (step: number, data: unknown) => handleOnboardingSite(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ step, data }) }), ["onboarding"], owner);
  for (const [step, data] of [[4, { paymentMode: "demo" }], [5, { email: "demo" }], [5, { sms: "demo" }]] as const) await expect(patch(step, data)).rejects.toMatchObject({ status: 403 });
  expect((await patch(4, {}))!.status).toBe(200);
  expect((await patch(5, {}))!.status).toBe(200);
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, owner.tenantId));
  expect(tenant!.settings).toMatchObject({ paymentMode: "manual", demoMode: false });
  const response = await handleOnboardingSite(new Request("http://localhost"), ["onboarding"], owner);
  expect(await response!.json()).toMatchObject({ item: { mocksAllowed: false, data: { 4: { paymentMode: "manual" }, 5: { email: "connect", sms: "off" } } } });
});
