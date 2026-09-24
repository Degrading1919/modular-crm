import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, isNull } from "drizzle-orm";
import {
  capabilityModules, customers, grantRecommendedCapabilitySetup, installInitialCapabilityCatalog, invoices,
  loadTenantCapabilities, organizations, schema, tenantCapabilityGrants, tenantCapabilitySettings, tenants, type Database,
} from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleTenantCapabilities } = await import("../lib/api/tenant-capabilities.ts");

let pglite: PGlite;
let db: Database;
const tenantId = "10000000-0000-4000-8000-000000000001";
const otherTenantId = "10000000-0000-4000-8000-000000000002";
const organizationId = "10000000-0000-4000-8000-000000000020";

function owner(forTenant = tenantId): SessionActor {
  return {
    kind: "staff", userId: `owner-${forTenant}`, tenantId: forTenant, tenantName: "Capability Test",
    packKey: "pet-waste-removal", email: "owner@example.test", name: "Owner", role: "owner",
    permissions: permissionsForRole("owner"), locationIds: new Set(), allLocations: true,
    membershipId: "10000000-0000-4000-8000-000000000010", organizationId,
  };
}

function setupRequest(moduleKeys: string[]) {
  return new Request("http://localhost/api/v1/capabilities/setup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection: "custom", answers: {}, moduleKeys }),
  });
}

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await db.transaction(async (tx) => {
    await installInitialCapabilityCatalog(tx);
    await tx.insert(tenants).values([
      { id: tenantId, name: "Capability Test", slug: "capability-test", status: "active", industryPackKey: "pet-waste-removal", settings: {} },
      { id: otherTenantId, name: "Other Tenant", slug: "other-tenant", status: "active", industryPackKey: "pet-waste-removal", settings: {} },
    ]);
    await tx.insert(organizations).values({
      id: organizationId, tenantId, legalName: "Capability Test", displayName: "Capability Test", organizationType: "business",
    });
    await grantRecommendedCapabilitySetup(tx, tenantId,
      ["service_scheduling", "invoicing", "payment_collection", "customer_notifications"],
      { source: "signup_recommendation", sourceReference: "pet-waste-removal" });
    await grantRecommendedCapabilitySetup(tx, otherTenantId, ["route_planning"], { source: "development_seed" });
  });
}, 120_000);

afterAll(async () => { await pglite?.close(); });

describe("tenant capability setup", () => {
  it("replaces signup recommendations, preserves records, and closes module dependencies", async () => {
    const beforeState = await loadTenantCapabilities(db, tenantId);
    expect(beforeState.modules).toMatchObject({
      "core-platform": { usable: true },
      "scheduling-and-recurring": { usable: true },
      "billing-and-payments": { usable: true },
      "customer-experience": { usable: true },
    });
    const customerCount = (await db.select().from(customers).where(eq(customers.tenantId, tenantId))).length;
    const invoiceCount = (await db.select().from(invoices).where(eq(invoices.tenantId, tenantId))).length;

    const coreOnly = await handleTenantCapabilities(setupRequest([]), ["capabilities", "setup"], owner());
    expect(coreOnly?.status).toBe(200);
    const coreBody = await coreOnly!.json() as { item: { selectedModuleKeys: string[]; modules: Array<Record<string, unknown>> } };
    expect(coreBody.item.selectedModuleKeys).toEqual(["core-platform"]);
    expect(coreBody.item.modules.find((module) => module.key === "billing-and-payments"))
      .toMatchObject({ entitled: false, usable: false });
    expect(await db.select().from(customers).where(eq(customers.tenantId, tenantId))).toHaveLength(customerCount);
    expect(await db.select().from(invoices).where(eq(invoices.tenantId, tenantId))).toHaveLength(invoiceCount);

    const routeSetup = await handleTenantCapabilities(
      setupRequest(["route-planning"]), ["capabilities", "setup"], owner(),
    );
    const routeBody = await routeSetup!.json() as { item: { selectedModuleKeys: string[] } };
    expect(routeBody.item.selectedModuleKeys).toEqual(expect.arrayContaining([
      "core-platform", "scheduling-and-recurring", "field-operations", "route-planning",
    ]));
    const state = await loadTenantCapabilities(db, tenantId);
    expect(state.features.route_planning).toMatchObject({ entitled: true, enabled: true, usable: true });

    const otherState = await loadTenantCapabilities(db, otherTenantId);
    expect(otherState.features.route_planning?.usable).toBe(true);
  });

  it("keeps entitlement, enablement, and prominence independent", async () => {
    const response = await handleTenantCapabilities(new Request(
      "http://localhost/api/v1/capabilities/route-planning",
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false, uiProminence: "hidden" }) },
    ), ["capabilities", "route-planning"], owner());
    expect(await response!.json()).toMatchObject({ item: {
      entitled: true, enabled: false, usable: false, uiProminence: "hidden",
    } });
    const [setting] = await db.select().from(tenantCapabilitySettings).where(and(
      eq(tenantCapabilitySettings.tenantId, tenantId),
      eq(tenantCapabilitySettings.moduleId, (await db.select().from(capabilityModules).where(eq(capabilityModules.key, "route-planning")))[0]!.id),
    ));
    expect(setting).toMatchObject({ enabled: false, uiProminence: "hidden" });
  });

  it("prevents self-service removal of a currently managed grant", async () => {
    const [billing] = await db.select().from(capabilityModules).where(eq(capabilityModules.key, "billing-and-payments"));
    await db.insert(tenantCapabilityGrants).values({
      tenantId, moduleId: billing.id, source: "promotion", sourceReference: "owner-credit", effectiveFrom: new Date(),
    });
    await expect(handleTenantCapabilities(setupRequest([]), ["capabilities", "setup"], owner()))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    const activeManaged = await db.select().from(tenantCapabilityGrants).where(and(
      eq(tenantCapabilityGrants.tenantId, tenantId), eq(tenantCapabilityGrants.moduleId, billing.id),
      eq(tenantCapabilityGrants.source, "promotion"), isNull(tenantCapabilityGrants.revokedAt),
    ));
    expect(activeManaged).toHaveLength(1);
  });
});
