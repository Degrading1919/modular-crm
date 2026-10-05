import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, sql } from "drizzle-orm";
import { connectorInstallations, customerContacts, customers, invoices, jobs, paymentAllocations, payments, schema, seedDevelopment, seedIds, serviceLocations, servicePlans, type Database } from "@modular-crm/db";
import { manualPaymentMethods, paymentMethodLabel, permissionsForRole, type Permission } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";

const { getDbMock, getCapabilityMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), getCapabilityMock: vi.fn() }));
vi.mock("../lib/db", () => ({ getDb: getDbMock }));
vi.mock("../lib/connectors", () => ({ getCapability: getCapabilityMock }));
process.env.DATABASE_URL ??= "postgres://localhost/test";
const { handleRecords } = await import("../lib/api/records");
const { handleWorkflow } = await import("../lib/api/workflows");
const { handlePaymentReads } = await import("../lib/api/payment-reads");
const { getDocument } = await import("../lib/api/documents");
let pglite: PGlite;
let db: Database;
const owner: SessionActor = { kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia", role: "owner", permissions: permissionsForRole("owner"), allLocations: true, locationIds: new Set([seedIds.augusta]), membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta };
const morgan: SessionActor = { ...owner, userId: "demo-happy-manager", role: "office", permissions: permissionsForRole("office"), allLocations: false, membershipId: seedIds.morganMembership };
const portal: SessionActor = { kind: "customer", userId: "demo-happy-customer", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "customer@happyyards.test", name: "Alex", customerIds: new Set([seedIds.carter]), locationIds: new Set([seedIds.carterLocation]), customerLocationIds: new Map([[seedIds.carter, new Set([seedIds.carterLocation])]]) };
const fixtureCustomer = crypto.randomUUID();
const firstAddress = crypto.randomUUID(), secondAddress = crypto.randomUUID(), hiddenAddress = crypto.randomUUID();
beforeAll(async () => {
  pglite = new PGlite(); const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database; getDbMock.mockReturnValue(db); getCapabilityMock.mockResolvedValue(null);
  await seedDevelopment(db);
  await db.insert(customers).values({ id: fixtureCustomer, tenantId: owner.tenantId, organizationId: seedIds.happyOrganization, owningLocationId: seedIds.augusta, displayName: "Picker Lookup Household", customerType: "residential", billingEmail: "lookup-billing@example.test", billingPhone: "555-0199" });
  await db.insert(customerContacts).values({ tenantId: owner.tenantId, customerId: fixtureCustomer, firstName: "Primary", lastName: "Contact", email: "lookup-contact@example.test", phone: "555-0188" });
  await db.insert(serviceLocations).values([
    { id: firstAddress, tenantId: owner.tenantId, customerId: fixtureCustomer, organizationLocationId: seedIds.augusta, name: "Home", addressLine1: "121 Lookup Lane", city: "Augusta", region: "GA", postalCode: "30909" },
    { id: secondAddress, tenantId: owner.tenantId, customerId: fixtureCustomer, organizationLocationId: seedIds.augusta, name: "Workshop", addressLine1: "122 Lookup Lane", city: "Augusta", region: "GA", postalCode: "30909" },
    { id: hiddenAddress, tenantId: owner.tenantId, customerId: fixtureCustomer, organizationLocationId: seedIds.northAugusta, name: "Private remote site", addressLine1: "RestrictedAddressOnly", city: "North Augusta", region: "SC", postalCode: "29841" },
  ]);
}, 120_000);
afterAll(async () => { await pglite?.close(); });
async function read(resource: string, actor = morgan, query = "") {
  const response = await handleRecords(new Request(`http://localhost/api/v1/${resource}${query}`), resource.split("/"), actor);
  return await response!.json();
}
async function create(resource: string, payload: unknown, actor = morgan) {
  return await handleRecords(new Request(`http://localhost/api/v1/${resource}`, { method: "POST", body: JSON.stringify(payload) }), [resource], actor);
}
async function invoiceFixture(branch = seedIds.augusta, status = "issued", issuedAt: Date | null = new Date()) {
  const [invoice] = await db.insert(invoices).values({ tenantId: owner.tenantId, organizationId: seedIds.happyOrganization, organizationLocationId: branch, customerId: seedIds.carter, status, issuedAt, invoiceNumber: `PICKER-${crypto.randomUUID()}`, totalMinor: 4200n, balanceMinor: 4200n }).returning();
  return invoice!;
}
async function pay(invoiceId: string, method: string | undefined, reference = "", key = crypto.randomUUID(), actor = owner, amountCents = 1200) {
  return handleWorkflow(new Request(`http://localhost/api/v1/invoices/${invoiceId}/pay`, { method: "POST", body: JSON.stringify({ amountCents, method, reference, idempotencyKey: key }) }), ["invoices", invoiceId, "pay"], actor);
}
describe("scoped searchable staff records", () => {
  it.each(["Lookup Household", "555-0199", "lookup-billing@", "lookup-contact@", "555-0188", "121 Lookup Lane"])("finds actual customers by %s on the server", async (term) => {
    const { items } = await read("customers", morgan, `?search=${encodeURIComponent(term)}`);
    expect(items.map((item: { id: string }) => item.id)).toEqual([fixtureCustomer]);
  });
  it("does not disclose other branches, tenants, or hidden service addresses", async () => {
    expect((await read("customers", morgan, "?search=Riverfront")).items).toEqual([]);
    const matches = (await read("customers", owner, "?search=Carter")).items;
    expect(matches.some((item: { id: string }) => item.id === seedIds.cleanCarter)).toBe(false);
    expect((await read("customers", morgan, "?search=RestrictedAddressOnly")).items).toEqual([]);
    expect((await read("customers", owner, "?search=RestrictedAddressOnly")).items.map((item: { id: string }) => item.id)).toEqual([fixtureCustomer]);
    const detail = (await read(`customers/${fixtureCustomer}`)).item;
    expect(detail.locations.map((item: { id: string }) => item.id).sort()).toEqual([firstAddress, secondAddress].sort());
    await expect(read(`customers/${seedIds.riverfront}`)).rejects.toMatchObject({ status: 404 });
  });
  it("treats SQL/wildcard input as text, enforces permissions and fails closed for empty scopes", async () => {
    for (const search of ["%", "_", "' OR true --"]) expect((await read("customers", morgan, `?search=${encodeURIComponent(search)}`)).items).toEqual([]);
    expect((await read("customers", { ...morgan, locationIds: new Set() }, "?search=Lookup")).items).toEqual([]);
    await expect(read("customers", { ...morgan, permissions: new Set() }, "?search=Lookup")).rejects.toMatchObject({ status: 403 });
    await expect(read("customers", portal, "?search=Lookup")).rejects.toMatchObject({ status: 403 });
  });
  it("filters before the result limit, not just the first downloaded page", async () => {
    await db.insert(customers).values(Array.from({ length: 201 }, (_, index) => ({ tenantId: owner.tenantId, organizationId: seedIds.happyOrganization, owningLocationId: seedIds.augusta, displayName: `Recent padding ${index}`, customerType: "residential" })));
    expect((await read("customers", morgan, "?search=Lookup Household")).items.map((item: { id: string }) => item.id)).toEqual([fixtureCustomer]);
  });
  it("offers only collectible open invoices in the viewer's scope", async () => {
    const local = await invoiceFixture(), outside = await invoiceFixture(seedIds.northAugusta);
    const draft = await invoiceFixture(seedIds.augusta, "draft"), unissued = await invoiceFixture(seedIds.augusta, "issued", null);
    const items = (await read("invoices", morgan, "?open=1&search=PICKER-")).items;
    expect(items.map((item: { id: string }) => item.id)).toEqual([local.id]);
    expect(items[0]).toMatchObject({ customerName: "Carter Household", openBalanceCents: 4200, locationName: "Augusta Branch", number: local.invoiceNumber });
    const ownerItems = (await read("invoices", owner, "?open=1&search=PICKER-")).items;
    expect(ownerItems.some((item: { id: string }) => item.id === outside.id)).toBe(true);
    for (const id of [draft.id, unissued.id, seedIds.cleanInvoice]) expect(ownerItems.some((item: { id: string }) => item.id === id)).toBe(false);
    await expect(read("invoices", { ...morgan, permissions: new Set() }, "?open=1")).rejects.toMatchObject({ status: 403 });
  });
});
describe("saved address selection", () => {
  it.each(["jobs", "service-plans"])("persists the chosen saved address for %s and rejects unrelated/hidden choices", async (resource) => {
    const payload = { customerId: fixtureCustomer, serviceId: seedIds.weeklyService, serviceLocationId: secondAddress, frequency: "weekly", scheduledDate: "2026-10-06" };
    const response = await create(resource, payload);
    expect(response!.status).toBe(201);
    const { item } = await response!.json(); expect(item.serviceLocationId).toBe(secondAddress);
    const table = resource === "jobs" ? jobs : servicePlans;
    const [stored] = await db.select().from(table).where(eq(table.id, item.id));
    expect(stored!.serviceLocationId).toBe(secondAddress);
    for (const address of [seedIds.carterLocation, seedIds.cleanCarterLocation, hiddenAddress]) await expect(create(resource, { ...payload, serviceLocationId: address })).rejects.toMatchObject({ status: 404 });
    await expect(create(resource, { ...payload, serviceLocationId: undefined })).rejects.toMatchObject({ status: 422 });
  });
  it("retains the single-address default, but never uses an inactive address", async () => {
    const response = await create("jobs", { customerId: seedIds.carter, serviceId: seedIds.weeklyService });
    expect((await response!.json()).item.serviceLocationId).toBe(seedIds.carterLocation);
    await db.update(serviceLocations).set({ active: false }).where(eq(serviceLocations.id, secondAddress));
    try { await expect(create("jobs", { customerId: fixtureCustomer, serviceId: seedIds.weeklyService, serviceLocationId: secondAddress })).rejects.toMatchObject({ status: 404 }); }
    finally { await db.update(serviceLocations).set({ active: true }).where(eq(serviceLocations.id, secondAddress)); }
  });
});
describe("honest manual payment contract", () => {
  it.each(manualPaymentMethods)("records %s without a connector and shows the same method on payments and the receipt", async (method) => {
    const invoice = await invoiceFixture(); const response = await pay(invoice.id, method, " check-123 ");
    const payment = (await response!.json()).item;
    expect(payment).toMatchObject({ sourceType: "manual", recordedMethod: method, reference: "check-123", status: "succeeded" });
    const list = await handlePaymentReads(new Request("http://localhost/api/v1/payments"), ["payments"], owner);
    expect((await list!.json()).items.find((item: { id: string }) => item.id === payment.id)).toMatchObject({ method, reference: "check-123" });
    const receipt = await getDocument(owner, "receipt", payment.id);
    expect(receipt!.lines[0]!.description).toContain(paymentMethodLabel(method));
    expect(receipt!.lines[0]!.description).toContain("Reference: check-123");
    expect(getCapabilityMock).not.toHaveBeenCalled();
  });
  it("replays exactly once and conflicts on changed method/reference/amount", async () => {
    const invoice = await invoiceFixture(); const key = crypto.randomUUID();
    const first = await pay(invoice.id, "check", "123", key); const item = (await first!.json()).item;
    const retry = await pay(invoice.id, "check", "123", key); expect(await retry!.json()).toMatchObject({ duplicate: true, item: { id: item.id } });
    for (const [method, ref, amount] of [["cash", "123", 1200], ["check", "124", 1200], ["check", "123", 1300]] as const) await expect(pay(invoice.id, method, ref, key, owner, amount)).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    expect(await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, item.id))).toHaveLength(1);
    expect(await db.select().from(payments).where(eq(payments.idempotencyKey, `invoice:${invoice.id}:${key}`))).toHaveLength(1);
    const [stored] = await db.select().from(invoices).where(eq(invoices.id, invoice.id)); expect(stored!.paidMinor).toBe(1200n); expect(stored!.balanceMinor).toBe(3000n);
  });
  it("rejects unspecified/invalid methods, oversized references and excess amounts", async () => {
    const invoice = await invoiceFixture();
    for (const method of [undefined, "banana", "manual"]) await expect(pay(invoice.id, method)).rejects.toBeDefined();
    await expect(pay(invoice.id, "check", "x".repeat(201))).rejects.toBeDefined();
    await expect(pay(invoice.id, "cash", "", crypto.randomUUID(), owner, 5000)).rejects.toMatchObject({ status: 422 });
    expect(await db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoice.id))).toEqual([]);
  });
  it("replays pre-migration payments without relabeling them or requiring a disconnected demo provider", async () => {
    await db.update(connectorInstallations).set({ status: "disconnected" }).where(and(eq(connectorInstallations.tenantId, owner.tenantId), eq(connectorInstallations.connectorKey, "mock-payments")));
    try {
      for (const [method, sourceType] of [["manual", "manual"], ["test", "mock"]] as const) {
        const invoice = await invoiceFixture(), key = crypto.randomUUID(), paymentId = crypto.randomUUID();
        await db.insert(payments).values({ id: paymentId, tenantId: owner.tenantId, customerId: seedIds.carter, status: "succeeded", sourceType, amountMinor: 1200n, idempotencyKey: `invoice:${invoice.id}:${key}`, recordedByActorType: "staff" });
        await db.insert(paymentAllocations).values({ tenantId: owner.tenantId, paymentId, invoiceId: invoice.id, amountMinor: 1200n });
        await db.update(invoices).set({ paidMinor: 1200n, balanceMinor: 3000n, status: "partially_paid" }).where(eq(invoices.id, invoice.id));
        const response = await pay(invoice.id, method, "", key);
        expect(await response!.json()).toMatchObject({ duplicate: true, item: { id: paymentId, recordedMethod: null, reference: null }, invoice: { balanceCents: 3000 } });
        expect(await db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoice.id))).toHaveLength(1);
        await expect(pay(invoice.id, method, "", crypto.randomUUID())).rejects.toMatchObject({ status: 422 });
      }
      expect(getCapabilityMock).not.toHaveBeenCalled();
    } finally { await db.update(connectorInstallations).set({ status: "connected" }).where(and(eq(connectorInstallations.tenantId, owner.tenantId), eq(connectorInstallations.connectorKey, "mock-payments"))); }
  });
  it("enforces staff manual authority, invoice location and tenant scope, and rejects portal recording", async () => {
    const invoice = await invoiceFixture();
    const allowed = await pay(invoice.id, "cash", "", crypto.randomUUID(), morgan); expect(allowed!.status).toBe(200);
    for (const permission of ["payments.collect", "payments.record_manual"] as const) {
      const limited = { ...morgan, permissions: new Set([...morgan.permissions].filter((key) => key !== permission)) as Set<Permission> };
      await expect(pay(invoice.id, "cash", "", crypto.randomUUID(), limited)).rejects.toMatchObject({ status: 403 });
    }
    const outside = await invoiceFixture(seedIds.northAugusta);
    await expect(pay(outside.id, "cash", "", crypto.randomUUID(), morgan)).rejects.toMatchObject({ status: 404 });
    await expect(pay(seedIds.cleanInvoice, "cash")).rejects.toMatchObject({ status: 404 });
    await expect(pay(invoice.id, "check", "", crypto.randomUUID(), portal)).rejects.toMatchObject({ status: 403 });
  });
  it("keeps unknown historical methods unknown and refuses tests outside connected mock mode", async () => {
    expect(paymentMethodLabel(null, "manual")).toBe("Method not recorded"); expect(paymentMethodLabel(null, "mock")).toBe("Test payment");
    const invoice = await invoiceFixture();
    await db.update(connectorInstallations).set({ status: "disconnected" }).where(and(eq(connectorInstallations.tenantId, owner.tenantId), eq(connectorInstallations.connectorKey, "mock-payments")));
    try { await expect(pay(invoice.id, "test")).rejects.toMatchObject({ status: 422 }); expect(getCapabilityMock).not.toHaveBeenCalled(); }
    finally { await db.update(connectorInstallations).set({ status: "connected" }).where(and(eq(connectorInstallations.tenantId, owner.tenantId), eq(connectorInstallations.connectorKey, "mock-payments"))); }
    await expect(db.execute(sql`insert into payments (tenant_id,customer_id,status,source_type,recorded_method,idempotency_key,recorded_by_actor_type) values (${owner.tenantId},${seedIds.carter},'succeeded','manual','fabricated',${crypto.randomUUID()},'staff')`)).rejects.toBeDefined();
  });
});
