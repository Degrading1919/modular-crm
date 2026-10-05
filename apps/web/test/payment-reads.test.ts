import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { customers, invoices, paymentAllocations, payments, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
const { handlePaymentReads } = await import("../lib/api/payment-reads");
let pglite: PGlite;
let db: Database;
const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization,
};
const office: SessionActor = { ...owner, userId: "demo-happy-manager", role: "office", permissions: permissionsForRole("office"), allLocations: false, membershipId: seedIds.morganMembership };
const request = () => new Request("http://localhost/api/v1/payments");
async function list(actor: SessionActor) {
  const response = await handlePaymentReads(request(), ["payments"], actor);
  expect(response?.status).toBe(200);
  return (await response!.json()).items as Array<{ id: string; customerName: string; amountCents: number; method: string; status: string; createdAt: string }>;
}

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);
afterAll(async () => { await pglite?.close(); });

async function paymentFixture(branches: Array<string | null>, customerId = seedIds.carter) {
  const id = crypto.randomUUID();
  await db.insert(payments).values({ id, tenantId: seedIds.happyTenant, customerId, status: "succeeded", sourceType: "manual", amountMinor: 1200n, idempotencyKey: id, recordedByActorType: "staff", providerReference: "never-public" });
  for (const branch of branches) {
    const invoiceId = crypto.randomUUID();
    await db.insert(invoices).values({ id: invoiceId, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: branch, customerId, status: "paid", invoiceNumber: invoiceId, totalMinor: 1200n, paidMinor: 1200n });
    await db.insert(paymentAllocations).values({ tenantId: seedIds.happyTenant, paymentId: id, invoiceId, amountMinor: 1200n });
  }
  return id;
}

describe("read-only payment collection", () => {
  it("preserves owner access and returns the page's view model without private payment fields", async () => {
    const items = await list(owner);
    const payment = items.find((item) => item.id === seedIds.happyPayment);
    expect(payment).toMatchObject({ customerName: "Carter Household", amountCents: 2500, method: "mock", status: "succeeded" });
    expect(Object.keys(payment!).sort()).toEqual(["id", "customerName", "amountCents", "currency", "method", "reference", "status", "createdAt"].sort());
    expect(Number.isNaN(Date.parse(payment!.createdAt))).toBe(false);
  });
  it("allows permitted office staff without requiring invoice or owner permissions", async () => {
    const actor = { ...office, permissions: new Set(["payments.read"] as const) };
    expect((await list(actor)).some((item) => item.id === seedIds.happyPayment)).toBe(true);
  });
  it("rejects missing payments.read, including an owner with that permission removed", async () => {
    for (const actor of [office, owner]) await expect(handlePaymentReads(request(), ["payments"], { ...actor, permissions: new Set() })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
  it("rejects customer portal actors", async () => {
    const customer: SessionActor = { kind: "customer", userId: "demo-happy-customer", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "customer@happyyards.test", name: "Alex", customerIds: new Set([seedIds.carter]), locationIds: new Set([seedIds.carterLocation]), customerLocationIds: new Map([[seedIds.carter, new Set([seedIds.carterLocation])]]) };
    await expect(handlePaymentReads(request(), ["payments"], customer)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
  it("isolates tenants even for owners with unrestricted location access", async () => {
    expect((await list(owner)).some((item) => item.id === seedIds.cleanPayment)).toBe(false);
    const other = { ...owner, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization };
    const items = await list(other);
    expect(items.some((item) => item.id === seedIds.cleanPayment)).toBe(true);
    expect(items.some((item) => item.id === seedIds.happyPayment)).toBe(false);
  });
  it("requires visibility of every allocated invoice and returns each payment only once", async () => {
    const inScope = await paymentFixture([seedIds.augusta, seedIds.augusta]);
    const outside = await paymentFixture([seedIds.northAugusta]);
    const mixed = await paymentFixture([seedIds.augusta, seedIds.northAugusta]);
    const unscoped = await paymentFixture([null]);
    const items = await list(office);
    expect(items.filter((item) => item.id === inScope)).toHaveLength(1);
    for (const id of [outside, mixed, unscoped]) expect(items.some((item) => item.id === id)).toBe(false);
    const ownerItems = await list(owner);
    for (const id of [inScope, outside, mixed, unscoped]) expect(ownerItems.some((item) => item.id === id)).toBe(true);
  });
  it("uses owning customer location only for unallocated payments and fails closed with no locations", async () => {
    const local = await paymentFixture([]);
    const customerId = crypto.randomUUID();
    await db.insert(customers).values({ id: customerId, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, owningLocationId: seedIds.northAugusta, displayName: "Out-of-scope customer", customerType: "residential" });
    const outside = await paymentFixture([], customerId);
    const items = await list(office);
    expect(items.some((item) => item.id === local)).toBe(true);
    expect(items.some((item) => item.id === outside)).toBe(false);
    expect(await list({ ...office, locationIds: new Set() })).toEqual([]);
  });
  it("does not handle mutations or introduce other payment endpoints", async () => {
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) expect(await handlePaymentReads(new Request("http://localhost/api/v1/payments", { method }), ["payments"], owner)).toBeNull();
    expect(await handlePaymentReads(request(), ["payments", seedIds.happyPayment], owner)).toBeNull();
  });
});
