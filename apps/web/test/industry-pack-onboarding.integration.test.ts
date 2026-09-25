import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, isNull } from "drizzle-orm";
import {
  INITIAL_CAPABILITY_FEATURE_KEYS, auditEvents, capabilityModules, domainEvents, loadTenantCapabilities, priceRules, schema, seedDevelopment, seedIds,
  services, siteContents, sites, tenantCapabilityGrants, tenants, type Database,
} from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import { getIndustryPack, listIndustryPacks } from "@modular-crm/industry-packs";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock, requireTenantFeatureMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(), requireTenantFeatureMock: vi.fn(async () => undefined),
}));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
vi.mock("../lib/api/capability-enforcement.ts", () => ({ requireTenantFeature: requireTenantFeatureMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleOnboardingSite } = await import("../lib/api/onboarding-site.ts");
const { handleTenantCapabilities } = await import("../lib/api/tenant-capabilities.ts");
let pglite: PGlite;
let db: Database;
const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};

function request(method: "GET" | "PATCH", data?: unknown): Request {
  return new Request("http://localhost/api/onboarding", {
    method,
    ...(data === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(data) }),
  });
}

async function patchStep(step: number, data: Record<string, unknown>) {
  return handleOnboardingSite(request("PATCH", { step, data }), ["onboarding"], owner);
}

beforeAll(async () => {
  pglite = new PGlite();
  const pgliteDb = drizzle(pglite, { schema });
  await migrate(pgliteDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = pgliteDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, seedIds.happyTenant)).limit(1);
  await db.update(tenants).set({
    settings: { ...tenant!.settings, onboarding: { step: 0, completed: false, data: { 3: { services: { "recurring-cleanup": { enabled: true } } } } } },
  }).where(eq(tenants.id, seedIds.happyTenant));
}, 120_000);

afterAll(async () => { await pglite?.close(); });

it("keeps pack feature recommendations aligned with the stable capability catalog", () => {
  const known = new Set(INITIAL_CAPABILITY_FEATURE_KEYS);
  expect(listIndustryPacks().length).toBeGreaterThan(40);
  for (const pack of listIndustryPacks()) {
    for (const recommendation of pack.productCapabilityRecommendations) expect(known.has(recommendation.featureKey), `${pack.key}:${recommendation.featureKey}`).toBe(true);
  }
});

it("enumerates packs and applies a selected pack to the owner's real setup records", async () => {
  const initial = await handleOnboardingSite(request("GET"), ["onboarding"], owner);
  expect(initial?.status).toBe(200);
  const initialItem = (await initial!.json() as { item: Record<string, any> }).item;
  expect(initialItem.availableIndustries.length).toBe(listIndustryPacks().length);
  expect(initialItem.availableIndustries).toContainEqual(expect.objectContaining({ key: "cleaning", displayName: "Commercial Cleaning" }));

  const pack = getIndustryPack("cleaning")!;
  const recommendedFeatures = new Set(pack.productCapabilityRecommendations
    .filter((item) => item.recommendation === "normally_recommended").map((item) => item.featureKey));
  const beforeCapabilities = await loadTenantCapabilities(db, owner.tenantId);
  const recommendedCapabilityModule = Object.entries(beforeCapabilities.modules).find(([, module]) =>
    module.featureKeys.some((featureKey) => recommendedFeatures.has(featureKey)),
  )?.[0];
  expect(recommendedCapabilityModule).toBeDefined();
  const [legacyModule] = await db.select().from(capabilityModules).where(eq(capabilityModules.key, recommendedCapabilityModule!)).limit(1);
  const revokedAt = new Date();
  await db.update(tenantCapabilityGrants).set({ revokedAt, updatedAt: revokedAt }).where(and(
    eq(tenantCapabilityGrants.tenantId, owner.tenantId), isNull(tenantCapabilityGrants.revokedAt),
  ));
  await db.insert(tenantCapabilityGrants).values({
    tenantId: owner.tenantId, moduleId: legacyModule!.id, source: "signup_recommendation", sourceReference: "legacy-pack-selection", effectiveFrom: new Date(),
  });

  const selected = await patchStep(0, { packKey: "cleaning" });
  expect(selected?.status).toBe(200);
  const selectedItem = (await selected!.json() as { item: Record<string, any> }).item;
  expect(selectedItem.pack).toMatchObject({ key: pack.key, displayName: pack.displayName, services: pack.services });
  expect(selectedItem.data["3"]).toEqual({ services: {} });

  const capabilitySetup = await handleTenantCapabilities(new Request("http://localhost/api/capabilities"), ["capabilities"], owner);
  expect(capabilitySetup?.status).toBe(200);
  const capabilityItem = (await capabilitySetup!.json() as { item: Record<string, any> }).item;
  const recommendedModule = capabilityItem.modules.find((module: Record<string, any>) =>
    module.recommendations.some((recommendation: Record<string, any>) => recommendation.recommendation === "normally_recommended"),
  );
  expect(recommendedModule).toMatchObject({ recommended: true, entitled: false });
  expect(await db.select().from(tenantCapabilityGrants).where(and(
    eq(tenantCapabilityGrants.tenantId, owner.tenantId), eq(tenantCapabilityGrants.source, "signup_recommendation"),
    isNull(tenantCapabilityGrants.revokedAt),
  ))).toEqual([]);

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, owner.tenantId)).limit(1);
  expect(tenant).toMatchObject({ industryPackKey: pack.key, industryPackVersion: pack.version });
  const catalog = await db.select().from(services).where(and(eq(services.tenantId, owner.tenantId), eq(services.organizationId, owner.organizationId!)));
  for (const packService of pack.services) {
    expect(catalog.find((service) => service.key === packService.key)).toMatchObject({
      name: packService.name, serviceType: packService.kind, active: packService.defaultEnabled ?? false,
    });
  }
  const [site] = await db.select().from(sites).where(and(eq(sites.tenantId, owner.tenantId), eq(sites.organizationId, owner.organizationId!))).limit(1);
  expect(site?.templateKey).toBe("classic");
  const [home] = await db.select().from(siteContents).where(and(eq(siteContents.tenantId, owner.tenantId), eq(siteContents.siteId, site!.id), eq(siteContents.contentKey, "home"))).limit(1);
  expect(home?.content).toMatchObject({ headline: pack.website.heroHeadline, description: pack.website.heroDescription });
  expect(await db.select().from(domainEvents).where(and(eq(domainEvents.tenantId, owner.tenantId), eq(domainEvents.eventType, "tenant.industry_pack_changed")))).toHaveLength(1);
  expect(await db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, owner.tenantId), eq(auditEvents.action, "tenant.industry_pack_changed")))).toHaveLength(1);

  const firstService = pack.services.find((service) => service.defaultEnabled) ?? pack.services[0]!;
  const serviceSetup = await patchStep(3, { services: { [firstService.key]: { enabled: true, price: "48.25" } } });
  expect(serviceSetup?.status).toBe(200);
  const [configuredService] = await db.select().from(services).where(and(
    eq(services.tenantId, owner.tenantId), eq(services.organizationId, owner.organizationId!), eq(services.key, firstService.key),
  )).limit(1);
  expect(configuredService?.active).toBe(true);
  expect(await db.select().from(priceRules).where(and(
    eq(priceRules.tenantId, owner.tenantId), eq(priceRules.organizationId, owner.organizationId!), eq(priceRules.effects, { type: "set_base_amount", amountMinor: 4_825 }),
  ))).toHaveLength(1);
  expect(await db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, owner.tenantId), eq(auditEvents.action, "tenant.industry_services_configured")))).toHaveLength(1);
});

it("runs diverse industries through onboarding, capability recommendations, and service configuration", async () => {
  const samples = [
    "lawn-care-landscaping", // recurring route work
    "mobile-car-mechanic", // repair and diagnosis
    "general-contractor", // project work
    "party-rentals", // event rentals
    "electrical", // regulated trade
    "septic-pumping", // persistent asset maintenance
    "mobile-massage", // appointment-based personal service
    "property-management", // property operations
    "pet-waste-removal", // established reference pack remains selectable
  ];

  for (const key of samples) {
    const pack = getIndustryPack(key);
    expect(pack, `missing stress-test pack ${key}`).toBeDefined();

    const selected = await patchStep(0, { packKey: key });
    expect(selected?.status, key).toBe(200);
    const selectedItem = (await selected!.json() as { item: Record<string, any> }).item;
    expect(selectedItem.pack).toMatchObject({ key, displayName: pack!.displayName });

    const setupResponse = await handleTenantCapabilities(new Request("http://localhost/api/capabilities"), ["capabilities"], owner);
    expect(setupResponse?.status, key).toBe(200);
    expect((await setupResponse!.json() as { item: Record<string, any> }).item.packName).toBe(pack!.displayName);

    const catalog = await db.select().from(services).where(and(eq(services.tenantId, owner.tenantId), eq(services.organizationId, owner.organizationId!)));
    for (const packService of pack!.services) {
      expect(catalog.find((service) => service.key === packService.key), `${key}:${packService.key}`).toMatchObject({
        name: packService.name, serviceType: packService.kind, active: packService.defaultEnabled ?? false,
      });
    }

    const chosen = pack!.services.find((service) => service.defaultEnabled) ?? pack!.services[0]!;
    const configured = await patchStep(3, { services: { [chosen.key]: { enabled: true, price: "73.50" } } });
    expect(configured?.status, key).toBe(200);
    const [activeService] = await db.select().from(services).where(and(
      eq(services.tenantId, owner.tenantId), eq(services.organizationId, owner.organizationId!), eq(services.key, chosen.key),
    )).limit(1);
    expect(activeService?.active, `${key}:${chosen.key}`).toBe(true);
    expect(await db.select().from(priceRules).where(and(
      eq(priceRules.tenantId, owner.tenantId), eq(priceRules.organizationId, owner.organizationId!),
      eq(priceRules.name, `Onboarding starting price: ${chosen.key}`), eq(priceRules.effects, { type: "set_base_amount", amountMinor: 7_350 }),
    ))).toHaveLength(1);
  }

  const pack = getIndustryPack("cleaning")!;
  const selected = await patchStep(0, { packKey: pack.key });
  expect(selected?.status).toBe(200);
  const setupResponse = await handleTenantCapabilities(new Request("http://localhost/api/capabilities"), ["capabilities"], owner);
  expect(setupResponse?.status).toBe(200);
  const setupItem = (await setupResponse!.json() as { item: Record<string, any> }).item;
  const recommendedModule = setupItem.modules.find((module: Record<string, any>) =>
    module.recommendations.some((recommendation: Record<string, any>) => recommendation.recommendation === "normally_recommended"),
  );
  expect(recommendedModule).toMatchObject({ recommended: true, entitled: false });
  const accepted = await handleTenantCapabilities(new Request("http://localhost/api/capabilities/setup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection: "recommended", answers: {} }),
  }), ["capabilities", "setup"], owner);
  expect(accepted?.status).toBe(200);
  const acceptedItem = (await accepted!.json() as { item: Record<string, any> }).item;
  expect(acceptedItem.selectedModuleKeys).toContain(recommendedModule.key);
  expect(acceptedItem.modules.find((module: Record<string, any>) => module.key === recommendedModule.key))
    .toMatchObject({ entitled: true, usable: true });
});
