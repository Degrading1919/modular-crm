import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  capabilityFeatures, capabilityModuleFeatures, capabilityModules, leads, schema, seedDevelopment, seedIds,
  services, siteContents, siteSubmissions, tenantCapabilityGrants, tenants, type Database,
} from "@modular-crm/db";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { apiError } = await import("../lib/api/http.ts");
const { handlePublicSite } = await import("../lib/api/public-site.ts");

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

async function send(path: string[], method = "GET", body?: unknown) {
  const request = new Request(`http://localhost/api/v1/${path.join("/")}`, {
    method,
    headers: { "x-forwarded-for": "198.51.100.241", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try { return await handlePublicSite(request, path) ?? new Response(null, { status: 404 }); }
  catch (error) { return apiError(error); }
}

function signupBody(idempotencyKey: string, overrides: Record<string, unknown> = {}) {
  return {
    slug: "happy-yards", address: "55 Event Lane", zip: "30909",
    contact: { name: "Riley Host", email: `host-${idempotencyKey}@example.test`, phone: "555-0109" },
    service: { id: seedIds.weeklyService, key: "item-rental", frequency: "one_time" },
    requestDetails: "Party Rentals request: 40 chairs, 6 tables, delivery Saturday morning.\nService-location details: Rear garden, level access, delivery after 9am.",
    termsAccepted: true, termsVersion: "v1", idempotencyKey,
    ...overrides,
  };
}

it("keeps Pet Waste public intake and rejects Pet signups without pet details", async () => {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, seedIds.happyTenant)).limit(1);
  await db.update(tenants).set({ industryPackKey: "pet-waste-removal", industryPackVersion: "1.0.0" }).where(eq(tenants.id, seedIds.happyTenant));
  const withoutPets = await send(["public", "signup"], "POST", signupBody("pet-missing-details"));
  expect(withoutPets.status).toBe(422);
  await expect(withoutPets.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });

  const withPet = await send(["public", "signup"], "POST", signupBody("pet-valid-details", {
    service: { id: seedIds.weeklyService, key: "yard-cleanup", frequency: "one_time" },
    pets: [{ name: "Scout", size: "medium" }], yard: { size: "medium", accessNotes: "Use the side gate." },
  }));
  expect([201, 200]).toContain(withPet.status);
  expect(tenant?.industryPackKey).toBe("pet-waste-removal");
  const [submission] = await db.select().from(siteSubmissions).where(and(
    eq(siteSubmissions.tenantId, seedIds.happyTenant), eq(siteSubmissions.idempotencyKey, "signup:pet-valid-details"),
  )).limit(1);
  expect(submission?.payload).toMatchObject({ pets: [{ name: "Scout", size: "medium" }], yard: { size: "medium", accessProvided: true } });
  const [lead] = await db.select().from(leads).where(and(eq(leads.tenantId, seedIds.happyTenant), eq(leads.email, "host-pet-valid-details@example.test"))).limit(1);
  expect(lead?.customFields).toMatchObject({ websiteSignup: { pets: [{ name: "Scout", size: "medium" }], yardSize: "medium" } });
});

it("accepts a non-Pet pack request without Pet fields and persists the tenant-scoped details", async () => {
  await db.update(tenants).set({ industryPackKey: "party-rentals", industryPackVersion: "1.0.0" }).where(eq(tenants.id, seedIds.happyTenant));
  await db.update(services).set({ key: "item-rental", name: "Item Rental", serviceType: "one_time" }).where(and(
    eq(services.id, seedIds.weeklyService), eq(services.tenantId, seedIds.happyTenant),
  ));
  await db.update(siteContents).set({ content: { headline: "A cleaner yard, every week", description: "Fresh, dependable service from Happy Yards." } })
    .where(and(eq(siteContents.tenantId, seedIds.happyTenant), eq(siteContents.siteId, seedIds.happySite), eq(siteContents.contentKey, "home")));

  // The public site route reads its slug from the query string.
  const site = await handlePublicSite(new Request("http://localhost/api/v1/public/site?slug=happy-yards", { headers: { "x-forwarded-for": "198.51.100.242" } }), ["public", "site"]);
  if (!site) throw new Error("Public site route did not handle the request.");
  expect(site.status).toBe(200);
  await expect(site.json()).resolves.toMatchObject({ item: {
    industryPackKey: "party-rentals", industryName: "Party Rentals",
    serviceLocationTerm: "Event Site",
    services: expect.arrayContaining([expect.objectContaining({ key: "item-rental", name: "Item Rental" })]),
    tagline: "Rent event equipment for the day you need it",
    petIntake: false,
  } });

  const body = signupBody("party-rental-request");
  const response = await send(["public", "signup"], "POST", body);
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toMatchObject({ item: { kind: "lead", status: "review" } });

  const [submission] = await db.select().from(siteSubmissions).where(and(
    eq(siteSubmissions.tenantId, seedIds.happyTenant), eq(siteSubmissions.idempotencyKey, "signup:party-rental-request"),
  )).limit(1);
  expect(submission?.payload).toMatchObject({
    service: { key: "item-rental", frequency: "one_time" },
    requestDetails: "Party Rentals request: 40 chairs, 6 tables, delivery Saturday morning.\nService-location details: Rear garden, level access, delivery after 9am.",
  });
  expect(submission?.payload).not.toHaveProperty("pets");
  expect(submission?.payload).not.toHaveProperty("yard");
  const [lead] = await db.select().from(leads).where(and(eq(leads.tenantId, seedIds.happyTenant), eq(leads.email, "host-party-rental-request@example.test"))).limit(1);
  expect(lead?.customFields).toMatchObject({ websiteSignup: {
    serviceKey: "item-rental", requestDetails: "Party Rentals request: 40 chairs, 6 tables, delivery Saturday morning.\nService-location details: Rear garden, level access, delivery after 9am.",
  } });
  expect(lead?.customFields).not.toHaveProperty("websiteSignup.yardSize");
});

it("keeps online-booking entitlement authoritative for non-Pet signup", async () => {
  const [bookingFeature] = await db.select({ id: capabilityFeatures.id }).from(capabilityFeatures).where(eq(capabilityFeatures.key, "online_booking")).limit(1);
  if (!bookingFeature) throw new Error("online_booking feature missing from the capability catalog");
  const moduleRows = await db.select({ id: capabilityModules.id }).from(capabilityModuleFeatures)
    .innerJoin(capabilityModules, eq(capabilityModuleFeatures.moduleId, capabilityModules.id))
    .where(eq(capabilityModuleFeatures.featureId, bookingFeature.id));
  const moduleIds = moduleRows.map((row) => row.id);
  const priorGrants = await db.select().from(tenantCapabilityGrants).where(and(
    eq(tenantCapabilityGrants.tenantId, seedIds.happyTenant), inArray(tenantCapabilityGrants.moduleId, moduleIds), isNull(tenantCapabilityGrants.revokedAt),
  ));
  try {
    await db.update(tenantCapabilityGrants).set({ revokedAt: new Date() }).where(and(
      eq(tenantCapabilityGrants.tenantId, seedIds.happyTenant), inArray(tenantCapabilityGrants.moduleId, moduleIds), isNull(tenantCapabilityGrants.revokedAt),
    ));
    const response = await send(["public", "signup"], "POST", signupBody("party-booking-disabled"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CAPABILITY_UNAVAILABLE" } });
  } finally {
    for (const grant of priorGrants) await db.update(tenantCapabilityGrants).set({ revokedAt: null }).where(eq(tenantCapabilityGrants.id, grant.id));
  }
});
