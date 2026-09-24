import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { PET_WASTE_REMOVAL_PACK } from "../../industry-packs/src/pet-waste-removal.ts";
import type { Database } from "../src/client.ts";
import {
  grantRecommendedCapabilitySetup,
  INITIAL_CAPABILITY_FEATURE_KEYS,
  INITIAL_CAPABILITY_MODULE_KEYS,
  installInitialCapabilityCatalog,
  resolveInitialCapabilityModuleKeys,
} from "../src/initial-capability-catalog.ts";
import {
  capabilityFeatures,
  capabilityModuleDependencies,
  capabilityModuleFeatures,
  capabilityModules,
  schema,
  tenantCapabilityGrants,
  tenants,
} from "../src/schema/index.ts";

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
}, 120_000);

afterAll(async () => { await pglite?.close(); });

describe("initial capability catalog", () => {
  it("installs a revisioned catalog idempotently and covers every pet-waste recommendation", async () => {
    await db.transaction((tx) => installInitialCapabilityCatalog(tx));

    const modulesBefore = await db.select().from(capabilityModules);
    const featuresBefore = await db.select().from(capabilityFeatures);
    const membershipsBefore = await db.select().from(capabilityModuleFeatures);
    const moduleKeys = modulesBefore.map(({ key }) => key).sort();
    const featureKeys = featuresBefore.map(({ key }) => key).sort();
    const recommendationKeys = PET_WASTE_REMOVAL_PACK.productCapabilityRecommendations.map(({ featureKey }) => featureKey).sort();

    expect(moduleKeys).toEqual([...INITIAL_CAPABILITY_MODULE_KEYS].sort());
    expect(featureKeys).toEqual([...INITIAL_CAPABILITY_FEATURE_KEYS].sort());
    expect(recommendationKeys.every((key) => featureKeys.includes(key))).toBe(true);
    expect(new Set(membershipsBefore.map(({ featureId }) => featureId)).size).toBe(featureKeys.length);

    const [core] = await db.select().from(capabilityModules).where(eq(capabilityModules.key, "core-platform"));
    expect(core.metadata).toMatchObject({ catalog: { key: "initial", revision: 1 }, required: true });
    expect(JSON.stringify(modulesBefore)).not.toMatch(/price|seat|stripe|twilio|quickbooks/i);

    const [coreModule] = await db.select().from(capabilityModules).where(eq(capabilityModules.key, "core-platform"));
    const [customerRecords] = await db.select().from(capabilityFeatures).where(eq(capabilityFeatures.key, "customer_records"));
    const [routeModule] = await db.select().from(capabilityModules).where(eq(capabilityModules.key, "route-planning"));
    const [schedulingModule] = await db.select().from(capabilityModules).where(eq(capabilityModules.key, "scheduling-and-recurring"));
    await db.update(capabilityModules).set({
      name: "Administrator-edited core",
      availability: { rollout: "paused" },
      metadata: { catalog: { key: "initial", revision: 1 }, required: true, sortOrder: 0, adminNote: "keep" },
    }).where(eq(capabilityModules.id, coreModule.id));
    await db.update(capabilityFeatures).set({ name: "Administrator-edited customer feature" }).where(eq(capabilityFeatures.id, customerRecords.id));
    await db.update(capabilityModuleFeatures).set({ sortOrder: 77, required: false }).where(and(
      eq(capabilityModuleFeatures.moduleId, coreModule.id),
      eq(capabilityModuleFeatures.featureId, customerRecords.id),
    ));
    await db.update(capabilityModuleDependencies).set({ conditions: { adminRule: "keep" } }).where(and(
      eq(capabilityModuleDependencies.moduleId, routeModule.id),
      eq(capabilityModuleDependencies.dependsOnModuleId, schedulingModule.id),
    ));
    await db.transaction((tx) => installInitialCapabilityCatalog(tx));

    expect((await db.select().from(capabilityModules)).map(({ key }) => key).sort()).toEqual(moduleKeys);
    expect((await db.select().from(capabilityFeatures)).map(({ key }) => key).sort()).toEqual(featureKeys);
    expect(await db.select().from(capabilityModuleFeatures)).toHaveLength(membershipsBefore.length);
    expect((await db.select().from(capabilityModules).where(eq(capabilityModules.key, "core-platform")))[0]).toMatchObject({
      name: "Administrator-edited core",
      availability: { rollout: "paused" },
      metadata: { catalog: { key: "initial", revision: 1 }, required: true, adminNote: "keep" },
    });
    expect((await db.select().from(capabilityFeatures).where(eq(capabilityFeatures.key, "customer_records")))[0].name)
      .toBe("Administrator-edited customer feature");
    expect((await db.select().from(capabilityModuleFeatures).where(and(
      eq(capabilityModuleFeatures.moduleId, coreModule.id), eq(capabilityModuleFeatures.featureId, customerRecords.id),
    )))[0]).toMatchObject({ sortOrder: 77, required: false });
    expect((await db.select().from(capabilityModuleDependencies).where(and(
      eq(capabilityModuleDependencies.moduleId, routeModule.id), eq(capabilityModuleDependencies.dependsOnModuleId, schedulingModule.id),
    )))[0].conditions).toEqual({ adminRule: "keep" });
  });

  it("resolves required setup and module dependencies from catalog data", async () => {
    await db.transaction((tx) => installInitialCapabilityCatalog(tx));

    const routeStack = await db.transaction((tx) => resolveInitialCapabilityModuleKeys(tx, ["route_planning"]));
    expect(routeStack).toEqual(["core-platform", "scheduling-and-recurring", "field-operations", "route-planning"]);

    const allRecommended = await db.transaction((tx) => resolveInitialCapabilityModuleKeys(
      tx,
      PET_WASTE_REMOVAL_PACK.productCapabilityRecommendations.map(({ featureKey }) => featureKey),
    ));
    expect(allRecommended).toEqual(INITIAL_CAPABILITY_MODULE_KEYS);
    await expect(db.transaction((tx) => resolveInitialCapabilityModuleKeys(tx, ["missing-feature"])))
      .rejects.toThrow("Unknown or inactive recommended capability feature: missing-feature");

    expect(await db.select().from(capabilityModuleDependencies)).toHaveLength(INITIAL_CAPABILITY_MODULE_KEYS.length - 1 + 3);
  });

  it("grants core plus recommendations idempotently for signup", async () => {
    await db.transaction((tx) => installInitialCapabilityCatalog(tx));
    const [{ id: tenantId }] = await db.insert(tenants).values({ name: "Setup business", slug: "setup-business", status: "active" }).returning({ id: tenants.id });
    const options = { source: "signup_setup", sourceReference: "setup-business" };

    const grantedOnce = await db.transaction((tx) => grantRecommendedCapabilitySetup(tx, tenantId, ["route_planning"], options));
    const grantedTwice = await db.transaction((tx) => grantRecommendedCapabilitySetup(tx, tenantId, ["route_planning"], options));
    const grants = await db.select().from(tenantCapabilityGrants).where(eq(tenantCapabilityGrants.tenantId, tenantId));

    expect(grantedOnce).toEqual(grantedTwice);
    expect(grants).toHaveLength(grantedOnce.length);
    expect(new Set(grants.map(({ moduleId }) => moduleId)).size).toBe(grantedOnce.length);
    expect(grants.every(({ source, effectiveUntil, revokedAt }) => source === options.source && effectiveUntil === null && revokedAt === null)).toBe(true);
  });
});
