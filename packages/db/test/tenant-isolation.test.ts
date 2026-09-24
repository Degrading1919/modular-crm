import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import type { Database } from "../src/client.ts";
import { createTenantRepository } from "../src/tenant-repository.ts";
import { INITIAL_CAPABILITY_MODULE_KEYS } from "../src/initial-capability-catalog.ts";
import { seedDevelopment, seedIds, seedUserIds } from "../src/seed.ts";
import { capabilityModules, customerAssets, customerContacts, customers, connectorInstallations, domainEvents, invoices, jobs, paymentAllocations, schema, tenantCapabilityGrants, tenants } from "../src/schema/index.ts";

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

describe("tenant-scoped persistence", () => {
  it("seeds two independent tenants and is repeatable", async () => {
    const before = {
      connectors: (await db.select().from(connectorInstallations)).length,
      events: (await db.select().from(domainEvents)).length,
    };
    await seedDevelopment(db);
    const allTenants = await db.select().from(tenants);
    expect(allTenants).toHaveLength(2);
    const happy = createTenantRepository(db, seedIds.happyTenant);
    const clean = createTenantRepository(db, seedIds.cleanTenant);
    expect((await happy.listCustomers()).map((row) => row.displayName)).toEqual(["Carter Household", "Nguyen Household", "Riverfront Apartments"]);
    expect((await clean.listCustomers()).map((row) => row.displayName)).toEqual(["Carter Household", "Rivera Household"]);
    const localStorage = await db.select().from(connectorInstallations).where(eq(connectorInstallations.connectorKey, "local-storage"));
    expect(localStorage.map((row) => row.id).sort()).toEqual([seedIds.cleanLocalStorage, seedIds.happyLocalStorage].sort());
    expect((await db.select().from(connectorInstallations)).length).toBe(before.connectors);
    expect((await db.select().from(domainEvents)).length).toBe(before.events);
    const [completionEvent] = await db.select().from(domainEvents).where(eq(domainEvents.id, "00000000-0000-4000-8000-000000000321"));
    expect(completionEvent.publishedAt).not.toBeNull();

    const catalogModules = await db.select().from(capabilityModules);
    const grants = await db.select().from(tenantCapabilityGrants);
    for (const tenantId of [seedIds.happyTenant, seedIds.cleanTenant]) {
      const tenantGrants = grants.filter((grant) => grant.tenantId === tenantId && grant.revokedAt === null && grant.effectiveUntil === null);
      expect(new Set(tenantGrants.map(({ moduleId }) => moduleId)).size).toBe(INITIAL_CAPABILITY_MODULE_KEYS.length);
      expect(tenantGrants.map(({ moduleId }) => moduleId).sort()).toEqual(catalogModules.map(({ id }) => id).sort());
    }
  });

  it("repairs the customer-assets archive column on a legacy schema", async () => {
    const assetsBeforeRepair = await db.select().from(customerAssets);
    await pglite.exec('ALTER TABLE "customer_assets" DROP COLUMN "archived_at"');
    const migration = await readFile(fileURLToPath(new URL("../drizzle/0001_repair_customer_assets_archived_at.sql", import.meta.url)), "utf8");
    await pglite.exec(migration);
    await pglite.exec(migration);
    const { rows } = await pglite.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customer_assets'`);
    expect(rows.map((row) => row.column_name)).toContain("archived_at");
    const assetsAfterRepair = await db.select().from(customerAssets);
    expect(assetsAfterRepair.map((asset) => asset.id)).toEqual(assetsBeforeRepair.map((asset) => asset.id));
    expect(assetsAfterRepair.every((asset) => asset.archivedAt === null)).toBe(true);
  });

  it("does not reveal or mutate another tenant's record by direct ID", async () => {
    const happy = createTenantRepository(db, seedIds.happyTenant);
    expect(await happy.getCustomer(seedIds.cleanCarter)).toBeNull();
    expect(await happy.getJob(seedIds.cleanJob)).toBeNull();
    expect(await happy.getInvoice(seedIds.cleanInvoice)).toBeNull();
    expect(await happy.updateCustomer(seedIds.cleanCarter, { displayName: "Leaked" })).toBeNull();
    const [cleanCustomer] = await db.select().from(customers).where(eq(customers.id, seedIds.cleanCarter));
    expect(cleanCustomer.displayName).toBe("Carter Household");
  });

  it("requires a portal relationship within the tenant", async () => {
    const happy = createTenantRepository(db, seedIds.happyTenant);
    const clean = createTenantRepository(db, seedIds.cleanTenant);
    expect((await happy.getPortalCustomer(seedUserIds.happyCustomer, seedIds.carter))?.id).toBe(seedIds.carter);
    expect(await happy.getPortalCustomer(seedUserIds.happyCustomer, seedIds.cleanCarter)).toBeNull();
    expect(await clean.getPortalCustomer(seedUserIds.happyCustomer, seedIds.cleanCarter)).toBeNull();
    expect((await clean.getPortalCustomer(seedUserIds.cleanCustomer, seedIds.cleanCarter))?.id).toBe(seedIds.cleanCarter);
    expect((await happy.getPortalServiceLocations(seedUserIds.happyCustomer, seedIds.carter)).map((r) => r.id)).toEqual([seedIds.carterLocation]);
    expect(await happy.getPortalServiceLocations(seedUserIds.cleanCustomer, seedIds.carter)).toEqual([]);
    expect((await happy.getPortalInvoice(seedUserIds.happyCustomer, seedIds.happyInvoice))?.id).toBe(seedIds.happyInvoice);
    expect(await happy.getPortalInvoice(seedUserIds.cleanCustomer, seedIds.happyInvoice)).toBeNull();
  });

  it("enforces branch and assignment scope in repository reads", async () => {
    const northOnly = createTenantRepository(db, seedIds.happyTenant, { locationIds: [seedIds.northAugusta] });
    expect((await northOnly.listCustomers()).map((row) => row.id)).toEqual([seedIds.riverfront]);
    expect(await northOnly.getJob(seedIds.upcomingJob)).toBeNull();
    const happy = createTenantRepository(db, seedIds.happyTenant);
    expect((await happy.getAssignedJob(seedIds.upcomingJob, seedIds.terryMembership))?.id).toBe(seedIds.upcomingJob);
    expect(await happy.getAssignedJob(seedIds.upcomingJob, seedIds.caseyMembership)).toBeNull();
  });

  it("rejects cross-tenant child references at the database layer", async () => {
    await expect(db.insert(customerContacts).values({ tenantId: seedIds.happyTenant, customerId: seedIds.cleanCarter,
      firstName: "Cross", lastName: "Tenant" })).rejects.toThrow();
    await expect(db.insert(customerAssets).values({ tenantId: seedIds.happyTenant, customerId: seedIds.cleanCarter,
      assetTypeKey: "pet", name: "Cross-tenant pet" })).rejects.toThrow();
    await expect(db.insert(paymentAllocations).values({ tenantId: seedIds.happyTenant, paymentId: seedIds.happyPayment,
      invoiceId: seedIds.cleanInvoice, amountMinor: 1n })).rejects.toThrow();
    await expect(db.insert(customers).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.cleanOrganization,
      displayName: "Cross-tenant customer" })).rejects.toThrow();
    await expect(db.insert(jobs).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization,
      customerId: seedIds.carter, serviceLocationId: seedIds.nguyenLocation, serviceId: seedIds.weeklyService,
      status: "scheduled" })).rejects.toThrow();
  });

  it("keeps overlapping names and financial records separate", async () => {
    const happy = createTenantRepository(db, seedIds.happyTenant);
    const clean = createTenantRepository(db, seedIds.cleanTenant);
    expect((await happy.listCustomers({ search: "Carter" })).map((r) => r.id)).toEqual([seedIds.carter]);
    expect((await clean.listCustomers({ search: "Carter" })).map((r) => r.id)).toEqual([seedIds.cleanCarter]);
    expect((await happy.listInvoices()).map((r) => r.invoiceNumber)).toEqual(["HY-1001", "HY-1002"]);
    expect((await clean.listInvoices()).map((r) => r.invoiceNumber)).toEqual(["CP-1001"]);
  });
});
