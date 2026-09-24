import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import {
  capabilityFeatureDependencies,
  capabilityFeatures,
  capabilityModuleDependencies,
  capabilityModuleFeatures,
  capabilityModules,
  commercialAccountEntries,
  commercialAccountPromotions,
  commercialAccounts,
  commercialPromotions,
  commercialUsageEvents,
  tenantCapabilityGrants,
  tenantCapabilitySettings,
  tenants,
  usageAllowances,
  usageMeters,
} from "../src/schema/index.ts";

let pglite: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pglite = new PGlite();
  db = drizzle(pglite);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
}, 120_000);

afterAll(async () => { await pglite?.close(); });

describe("capability and commercial persistence", () => {
  it("stores definitions, feature composition, temporal grants, tenant settings, and commercial quantities", async () => {
    const [{ id: tenantId }] = await db.insert(tenants).values({ name: "First business", slug: "first-business", status: "active" }).returning({ id: tenants.id });
    const [{ id: moduleId }] = await db.insert(capabilityModules).values({
      key: "module-example", name: "Example module", availability: { rollout: "public" }, compatibility: { platform: ["v1"] },
    }).returning({ id: capabilityModules.id });
    const [{ id: featureId }] = await db.insert(capabilityFeatures).values({ key: "feature-example", name: "Example feature" }).returning({ id: capabilityFeatures.id });
    const [{ id: dependentFeatureId }] = await db.insert(capabilityFeatures).values({ key: "feature-dependent", name: "Dependent feature" }).returning({ id: capabilityFeatures.id });

    await db.insert(capabilityModuleFeatures).values({ moduleId, featureId, required: true, sortOrder: 10 });
    await db.insert(capabilityFeatureDependencies).values({ featureId: dependentFeatureId, dependsOnFeatureId: featureId, conditions: { answer: "yes" } });

    const [grant] = await db.insert(tenantCapabilityGrants).values({
      tenantId, moduleId, source: "administrator", sourceReference: "case-1",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveUntil: new Date("2027-01-01T00:00:00Z"),
    }).returning();
    const [settings] = await db.insert(tenantCapabilitySettings).values({
      tenantId, moduleId, enabled: false, uiProminence: "hidden", configuration: { setupComplete: false },
    }).returning();

    const [{ id: accountId }] = await db.insert(commercialAccounts).values({ tenantId, accountReference: "local-account" }).returning({ id: commercialAccounts.id });
    const [credit] = await db.insert(commercialAccountEntries).values({
      tenantId, commercialAccountId: accountId, entryType: "credit", source: "promotion", sourceReference: "welcome",
      quantity: "50", unitKey: "service-units", details: { note: "non-currency test credit" },
    }).returning();
    const [{ id: meterId }] = await db.insert(usageMeters).values({
      key: "meter-example", name: "Example usage", unitKey: "service-units", aggregation: "sum",
    }).returning({ id: usageMeters.id });
    await db.insert(commercialUsageEvents).values({
      tenantId, commercialAccountId: accountId, meterId, idempotencyKey: "event-1", quantity: "2.5", source: "application",
    });
    await db.insert(usageAllowances).values({
      tenantId, commercialAccountId: accountId, meterId, quantity: "100", periodDefinition: { kind: "calendar-month" },
      source: "contract", effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const [{ id: promotionId }] = await db.insert(commercialPromotions).values({
      key: "promotion-example", name: "Example promotion", eligibility: { region: "any" }, benefit: { entryType: "credit" },
    }).returning({ id: commercialPromotions.id });
    const [appliedPromotion] = await db.insert(commercialAccountPromotions).values({
      tenantId, commercialAccountId: accountId, promotionId, source: "onboarding",
    }).returning();

    expect(grant.source).toBe("administrator");
    expect(settings).toMatchObject({ enabled: false, uiProminence: "hidden", configuration: { setupComplete: false } });
    expect(credit).toMatchObject({ quantity: "50.000000", unitKey: "service-units", entryType: "credit" });
    expect(appliedPromotion.status).toBe("active");
    expect((await db.select().from(capabilityModuleFeatures))).toHaveLength(1);
    expect((await db.select().from(commercialUsageEvents))).toHaveLength(1);
    expect((await db.select().from(usageAllowances))).toHaveLength(1);
  });

  it("rejects invalid dependencies, overlapping account ownership, cross-tenant account references, and invalid intervals", async () => {
    const [{ id: tenantA }] = await db.insert(tenants).values({ name: "Tenant A", slug: "tenant-a", status: "active" }).returning({ id: tenants.id });
    const [{ id: tenantB }] = await db.insert(tenants).values({ name: "Tenant B", slug: "tenant-b", status: "active" }).returning({ id: tenants.id });
    const [{ id: moduleId }] = await db.insert(capabilityModules).values({ key: "safe-module", name: "Safe module" }).returning({ id: capabilityModules.id });
    const [{ id: featureId }] = await db.insert(capabilityFeatures).values({ key: "safe-feature", name: "Safe feature" }).returning({ id: capabilityFeatures.id });
    const [{ id: accountA }] = await db.insert(commercialAccounts).values({ tenantId: tenantA }).returning({ id: commercialAccounts.id });
    const [{ id: accountB }] = await db.insert(commercialAccounts).values({ tenantId: tenantB }).returning({ id: commercialAccounts.id });
    const [{ id: meterId }] = await db.insert(usageMeters).values({ key: "safe-meter", name: "Safe meter", unitKey: "items", aggregation: "sum" }).returning({ id: usageMeters.id });

    await expect(db.insert(commercialAccounts).values({ tenantId: tenantA })).rejects.toThrow();
    await expect(db.insert(capabilityModuleDependencies).values({ moduleId, dependsOnModuleId: moduleId })).rejects.toThrow();
    await expect(db.insert(capabilityFeatureDependencies).values({ featureId, dependsOnFeatureId: featureId })).rejects.toThrow();
    await expect(db.insert(tenantCapabilityGrants).values({
      tenantId: tenantA, moduleId, source: "test", effectiveFrom: new Date("2026-01-02T00:00:00Z"), effectiveUntil: new Date("2026-01-01T00:00:00Z"),
    })).rejects.toThrow();
    await expect(db.insert(tenantCapabilityGrants).values({
      tenantId: tenantA, moduleId, source: "scheduled", effectiveFrom: new Date("2027-01-01T00:00:00Z"), revokedAt: new Date("2026-12-01T00:00:00Z"),
    }).returning()).resolves.toHaveLength(1);
    await expect(db.insert(commercialUsageEvents).values({
      tenantId: tenantA, commercialAccountId: accountB, meterId, idempotencyKey: "cross-tenant", quantity: "1", source: "test",
    })).rejects.toThrow();
    await expect(db.insert(commercialAccountEntries).values({
      tenantId: tenantA, commercialAccountId: accountB, entryType: "adjustment", source: "test",
    })).rejects.toThrow();
  });
});
