import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, isNull } from "drizzle-orm";
import { auditEvents, automationRules, customerAssets, customers, domainEvents, estimateItems, estimateRevisions, estimates, importRows, jobAssignments, jobs, leads, memberships, organizations, priceRules, roleTemplates, schema, seedDevelopment, seedIds, seedUserIds, serviceLocations, services, sites, siteSubmissions, tenants, type Database } from "@modular-crm/db";
import { HOUSE_CLEANING_PACK, PET_WASTE_REMOVAL_PACK } from "@modular-crm/industry-packs";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handlePublicSite } = await import("../lib/api/public-site.ts");
const { handleRecords } = await import("../lib/api/records.ts");
const { handlePortal } = await import("../lib/api/portal.ts");
const { handleRoutesField } = await import("../lib/api/routes-field.ts");
const { handleDataPortability } = await import("../lib/api/data-portability.ts");
const { handleOnboardingSite } = await import("../lib/api/onboarding-site.ts");
const { handleWorkflow, estimateAction } = await import("../lib/api/workflows.ts");
const { handleV1 } = await import("../lib/api/handler.ts");
const { apiError } = await import("../lib/api/http.ts");
const { decryptServiceAccessInstructions } = await import("../lib/api/service-access.ts");
let pglite: PGlite;
let db: Database;
const owner: SessionActor = { kind: "staff", userId: seedUserIds.houseOwner, tenantId: seedIds.houseTenant, tenantName: "Tidy Home", packKey: "house-cleaning", email: "owner@tidyhome.test", name: "Robin", role: "owner", permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.houseBranch]), allLocations: true, membershipId: seedIds.houseOwnerMembership, organizationId: seedIds.houseOrganization, defaultLocationId: seedIds.houseBranch };
const customer: SessionActor = { kind: "customer", userId: seedUserIds.houseCustomer, tenantId: seedIds.houseTenant, tenantName: "Tidy Home", packKey: "house-cleaning", email: "customer@tidyhome.test", name: "Avery", customerIds: new Set([seedIds.houseCustomer]), locationIds: new Set([seedIds.houseLocation]), customerLocationIds: new Map([[seedIds.houseCustomer, new Set([seedIds.houseLocation])]]) };
const tech: SessionActor = { ...owner, role: "technician", userId: seedUserIds.houseTech, membershipId: seedIds.houseTechMembership, permissions: permissionsForRole("technician"), allLocations: false };
beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  pglite = new PGlite(); const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database; getDbMock.mockReturnValue(db); await seedDevelopment(db);
}, 120_000);
afterAll(async () => { await pglite?.close(); vi.unstubAllEnvs(); });
function request(path: string, data?: unknown, method = data ? "POST" : "GET") { return new Request(`http://localhost/api/v1/${path}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.216" }, ...(data ? { body: JSON.stringify(data) } : {}) }); }
async function response(promise: Promise<Response | null>) { return (await promise.catch(apiError))!; }

it("quotes and activates the second pack, stores generic details and never persists private plaintext", async () => {
  const details = { assets: [{ assetTypeKey: "room", name: "Dining room", customFields: { floor_surface: "wood", care_notes: "Soft cloth" } }], locationFields: { room_count: 3, home_type: "house", supplies_provided: true, first_visit: "2026-10-08", entry_instructions: "private-second-pack-9128" } };
  const quoteResponse = await response(handlePublicSite(request("public/quote", { slug: "tidy-home", address: "90 Birch Street", zip: "30909", serviceId: seedIds.houseService, frequency: "weekly", ...details }), ["public", "quote"]));
  expect(quoteResponse.status).toBe(200); const quote = (await quoteResponse.json()).item;
  expect(quote).toMatchObject({ amountCents: 7500, quoteRequired: false });
  const createdResponse = await response(handlePublicSite(request("public/signup", { slug: "tidy-home", address: "90 Birch Street", zip: "30909", contact: { name: "Quinn New", email: "quinn.new@example.test", phone: "555-010191" }, service: { id: seedIds.houseService, frequency: "weekly" }, ...details, quoteId: quote.id, termsAccepted: true, idempotencyKey: "house-cleaning-lifecycle" }), ["public", "signup"]));
  expect(createdResponse.status).toBe(201); const created = (await createdResponse.json()).item; expect(created.kind).toBe("customer");
  const [location] = await db.select().from(serviceLocations).where(eq(serviceLocations.customerId, created.id));
  expect(location.customFields).toMatchObject({ room_count: 3, home_type: "house", supplies_provided: true });
  expect(location.customFields).not.toHaveProperty("entry_instructions");
  expect(decryptServiceAccessInstructions(location.accessInstructionsEncrypted)).toContain("private-second-pack-9128");
  const [asset] = await db.select().from(customerAssets).where(eq(customerAssets.customerId, created.id));
  expect(asset).toMatchObject({ assetTypeKey: "room", name: "Dining room", customFields: { floor_surface: "wood" } });
  for (const table of [siteSubmissions, auditEvents, domainEvents]) expect(JSON.stringify(await db.select().from(table))).not.toContain("private-second-pack-9128");
  const detailResponse = await response(handleRecords(request(`customers/${created.id}`), ["customers", created.id], owner));
  expect(detailResponse.status).toBe(200); const detail = (await detailResponse.json()).item;
  expect(detail.assets[0]).toMatchObject({ pluralLabel: "Rooms", customFields: { floor_surface: "wood" } });
  expect(detail.locations[0].fieldValues.room_count).toBe(3);
});

it("retains exact seeded legacy records without migration or read-time mutation", async () => {
  const before = await db.select().from(customerAssets).where(eq(customerAssets.customerId, seedIds.carter));
  const legacyOwner = { ...owner, tenantId: seedIds.happyTenant, membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization };
  const result = await response(handleRecords(request(`customers/${seedIds.carter}`), ["customers", seedIds.carter], legacyOwner));
  expect(result.status).toBe(200); const item = (await result.json()).item;
  expect(item.pets).toEqual(before.map(asset => ({ id: asset.id, name: asset.name, customFields: asset.customFields })));
  expect(item.name).toBe("Carter Household"); expect(item.assets.map((asset: { name: string }) => asset.name)).toEqual(before.map(asset => asset.name));
  expect(await db.select().from(customerAssets).where(eq(customerAssets.customerId, seedIds.carter))).toEqual(before);
  const changed = await response(handleOnboardingSite(request("onboarding", { step: 0, data: { packKey: "house-cleaning" } }, "PATCH"), ["onboarding"], legacyOwner));
  expect(changed.status).toBe(409);
  expect(await db.select().from(customerAssets).where(eq(customerAssets.customerId, seedIds.carter))).toEqual(before);
});

it("retains Max's legacy warning for staff and assigned work, hides it in the portal and never fills missing read values", async () => {
  const before = await db.select().from(customerAssets).where(eq(customerAssets.customerId, seedIds.nguyen));
  const legacyOwner = { ...owner, tenantId: seedIds.happyTenant, membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization };
  const record = await response(handleRecords(request(`customers/${seedIds.nguyen}`), ["customers", seedIds.nguyen], legacyOwner));
  expect(record.status).toBe(200);
  const asset = (await record.json()).item.assets.find((item: { name: string }) => item.name === "Max");
  expect(asset.customFields).toEqual({ name: "Max", species: "dog", safety_flag: "Reactive near gate" });
  expect(asset.fields.find((field: { key: string }) => field.key === "safety_flag").displayAs).toBe("warning");
  const jobId = randomUUID();
  await db.insert(jobs).values({ id: jobId, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, serviceId: seedIds.weeklyService, status: "dispatched", scheduledDate: "2026-10-07", billable: false });
  await db.insert(jobAssignments).values({ tenantId: seedIds.happyTenant, jobId, membershipId: seedIds.terryMembership, assignmentRole: "primary" });
  const legacyTech: SessionActor = { ...legacyOwner, role: "technician", userId: seedUserIds.happyTech, membershipId: seedIds.terryMembership, permissions: permissionsForRole("technician"), locationIds: new Set([seedIds.augusta]), allLocations: false };
  const field = await response(handleRoutesField(request(`field/jobs/${jobId}`), ["field", "jobs", jobId], legacyTech));
  expect(field.status).toBe(200);
  expect((await field.json()).item.assets[0].customFields).toEqual(asset.customFields);
  const legacyCustomer = { ...customer, tenantId: seedIds.happyTenant, customerIds: new Set([seedIds.nguyen]), locationIds: new Set([seedIds.nguyenLocation]), customerLocationIds: new Map([[seedIds.nguyen, new Set([seedIds.nguyenLocation])]]) };
  const portal = await response(handlePortal(request("portal/profile"), ["portal", "profile"], legacyCustomer));
  expect(portal.status).toBe(200);
  const profile = await portal.json();
  expect(profile.item.assets[0].customFields).toEqual({ name: "Max", species: "dog" });
  expect(JSON.stringify(profile)).not.toContain("Reactive near gate");
  expect(await db.select().from(customerAssets).where(eq(customerAssets.customerId, seedIds.nguyen))).toEqual(before);
});

it("shows only customer-visible fields and rejects private, read-only and cross-tenant edits", async () => {
  await db.update(customerAssets).set({ customFields: { floor_surface: "tile", care_notes: "Soft cloth", hidden_internal: "office only" } }).where(eq(customerAssets.id, seedIds.houseRoom));
  const read = await response(handlePortal(request("portal/profile"), ["portal", "profile"], customer)); expect(read.status).toBe(200);
  const profile = (await read.json()).item;
  expect(profile.assets[0].customFields).toMatchObject({ floor_surface: "tile" }); expect(profile.assets[0].customFields).not.toHaveProperty("hidden_internal");
  expect(profile.locations[0].customFields.room_count).toBe(3);
  for (const customFields of [{ room_count: 90 }, { entry_instructions: "private" }, { unknown: "value" }]) {
    const denied = await response(handlePortal(request("portal/profile", { locations: [{ id: seedIds.houseLocation, customFields }] }, "PATCH"), ["portal", "profile"], customer)); expect(denied.status).toBe(422);
  }
  const saved = await response(handlePortal(request("portal/profile", { assets: [{ id: seedIds.houseRoom, assetTypeKey: "room", customFields: { care_notes: "Changed safely" } }] }, "PATCH"), ["portal", "profile"], customer)); expect(saved.status).toBe(200);
  const denied = await response(handlePortal(request("portal/profile", { assets: [{ id: seedIds.houseRoom, assetTypeKey: "room", customFields: { care_notes: "foreign" } }] }, "PATCH"), ["portal", "profile"], { ...customer, tenantId: seedIds.happyTenant })); expect(denied.status).toBe(422);
  const [asset] = await db.select().from(customerAssets).where(eq(customerAssets.id, seedIds.houseRoom)); expect(asset.customFields).toMatchObject({ hidden_internal: "office only", care_notes: "Changed safely" });
});

it("uses the second pack checklist and skip reasons at the assigned-job boundary", async () => {
  const read = await response(handleRoutesField(request(`field/jobs/${seedIds.houseJob}`), ["field", "jobs", seedIds.houseJob], tech)); expect(read.status).toBe(200);
  const item = (await read.json()).item; expect(item.assets[0].pluralLabel).toBe("Rooms"); expect(item.fieldValues.room_count).toBe(3);
  expect(item.checklist.map((check: { key: string }) => check.key)).toEqual(["propertyConfirmed", "roomsCleaned", "propertySecured"]);
  const invalid = await response(handleRoutesField(request(`field/jobs/${seedIds.houseJob}/skip`, { reason: "unsafe_animal" }), ["field", "jobs", seedIds.houseJob, "skip"], tech)); expect(invalid.status).toBe(422);
  const wrongAlias = await response(handleRoutesField(request(`field/jobs/${seedIds.houseJob}/skip`, { reason: "address_issue" }), ["field", "jobs", seedIds.houseJob, "skip"], tech)); expect(wrongAlias.status).toBe(422);
  const missing = await response(handleRoutesField(request(`field/jobs/${seedIds.houseJob}/complete`, { checklist: { propertyConfirmed: true, propertySecured: true } }), ["field", "jobs", seedIds.houseJob, "complete"], tech)); expect(missing.status).toBe(422);
  const foreign = await response(handleRoutesField(request(`field/jobs/${seedIds.upcomingJob}`), ["field", "jobs", seedIds.upcomingJob], tech)); expect(foreign.status).toBe(404);
  expect((await db.select().from(jobs).where(eq(jobs.id, seedIds.houseJob)))[0].status).toBe("dispatched");
});

it("imports pack aliases and encrypts private fields including failed and duplicate row history", async () => {
  const csv = "Name,Email,Address,Room Name,Floor Surface,Room Count,Entry Instructions\nImported House,imported.house@example.test,110 Birch Street,Kitchen,tile,4,import-private-4921\nInvalid House,invalid.house@example.test,111 Birch Street,Kitchen,invalid,4,import-private-4921\nBrooks Household,brooks@example.test,15 Birch Street,Kitchen,tile,3,import-private-4921";
  const preview = await response(handleDataPortability(request("imports", { csv, preview: true }), ["imports"], owner)); expect(preview.status).toBe(200);
  const item = (await preview.json()).item; expect(item.mapping["Room Name"]).toBe("asset.room.name"); expect(item.mapping["Entry Instructions"]).toBe("location.entry_instructions"); expect(JSON.stringify(item)).not.toContain("import-private-4921");
  const committed = await response(handleDataPortability(request("imports", { csv, mapping: item.mapping, confirmed: true, idempotencyKey: "second-pack-import" }), ["imports"], owner)); expect(committed.status).toBe(200); expect((await committed.json()).item).toMatchObject({ imported: 1, skipped: 2 });
  const [imported] = await db.select().from(customers).where(and(eq(customers.tenantId, seedIds.houseTenant), eq(customers.billingEmail, "imported.house@example.test")));
  const [location] = await db.select().from(serviceLocations).where(eq(serviceLocations.customerId, imported.id)); expect(location.customFields.room_count).toBe(4); expect(decryptServiceAccessInstructions(location.accessInstructionsEncrypted)).toContain("import-private-4921");
  expect((await db.select().from(customerAssets).where(eq(customerAssets.customerId, imported.id)))[0]).toMatchObject({ assetTypeKey: "room", name: "Kitchen" });
  expect(JSON.stringify(await db.select().from(importRows))).not.toContain("import-private-4921");
});

it("selects a second pack for an empty business without retaining the previous catalog, pricing review or recipes", async () => {
  const tenantId = randomUUID(), organizationId = randomUUID();
  await db.insert(tenants).values({ id: tenantId, name: "New business", slug: `new-${tenantId}`, status: "active", industryPackKey: PET_WASTE_REMOVAL_PACK.key, industryPackVersion: PET_WASTE_REMOVAL_PACK.version, settings: { onboardingComplete: false } });
  await db.insert(organizations).values({ id: organizationId, tenantId, legalName: "New business", displayName: "New business", organizationType: "business" });
  const roleId = randomUUID(), membershipId = randomUUID();
  await db.insert(roleTemplates).values({ id: roleId, tenantId, key: "owner", name: "Owner", system: true });
  await db.insert(memberships).values({ id: membershipId, tenantId, organizationId, userId: owner.userId, roleTemplateId: roleId, status: "active" });
  await db.insert(sites).values({ tenantId, organizationId, slug: `new-${tenantId}`, status: "draft", templateKey: "fresh", templateVersion: "1" });
  await db.insert(services).values({ tenantId, organizationId, key: "recurring-cleanup", name: "Previous service", serviceType: "recurring", active: true });
  const reviewName = PET_WASTE_REMOVAL_PACK.intake!.quantityReview!.ruleName;
  await db.insert(priceRules).values({ tenantId, organizationId, name: reviewName, priority: 60, conditions: {}, effects: { type: "mark_quote_required" }, source: "tenant", active: true });
  const recipe = PET_WASTE_REMOVAL_PACK.defaultAutomations[0]!;
  await db.insert(automationRules).values({ tenantId, name: recipe.name, source: "industry_pack", sourceKey: recipe.sourceKey, status: "active", activeFrom: new Date(), version: 1, triggerConfig: { event: recipe.event }, conditions: {}, actions: [], createdByMembershipId: membershipId });
  const newOwner = { ...owner, tenantId, organizationId, membershipId, defaultLocationId: null };
  const selected = await response(handleOnboardingSite(request("onboarding", { step: 0, data: { packKey: "house-cleaning" } }, "PATCH"), ["onboarding"], newOwner));
  expect(selected.status, await selected.clone().text()).toBe(200);
  expect((await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0].industryPackKey).toBe("house-cleaning");
  const catalog = await db.select().from(services).where(eq(services.tenantId, tenantId)).orderBy(services.key);
  expect(catalog.filter(service => service.active).map(service => service.key)).toEqual(["deep-cleaning", "recurring-cleaning"]);
  expect(catalog.find(service => service.key === "recurring-cleanup")?.active).toBe(false);
  expect((await db.select().from(priceRules).where(eq(priceRules.tenantId, tenantId)))[0].active).toBe(false);
  expect((await db.select().from(automationRules).where(eq(automationRules.tenantId, tenantId)))[0]).toMatchObject({ status: "archived", activeFrom: null });
  const archived = (await db.select().from(automationRules).where(eq(automationRules.tenantId, tenantId)))[0]!;
  expect(archived.archivedAt).toBeInstanceOf(Date);
  expect(archived.version).toBe(2);
  expect(archived.updatedAt).toEqual(archived.archivedAt);
  for (const pack of [PET_WASTE_REMOVAL_PACK, HOUSE_CLEANING_PACK, PET_WASTE_REMOVAL_PACK]) {
    expect((await response(handleOnboardingSite(request("onboarding", { step: 0, data: { packKey: pack.key } }, "PATCH"), ["onboarding"], newOwner))).status).toBe(200);
    const visible = await db.select().from(automationRules).where(and(eq(automationRules.tenantId, tenantId), isNull(automationRules.archivedAt)));
    expect(visible.map(rule => rule.sourceKey).sort()).toEqual(pack.defaultAutomations.map(rule => rule.sourceKey).sort());
    expect(new Set(visible.map(rule => rule.sourceKey)).size).toBe(visible.length);
    expect(visible.every(rule => rule.status === "draft")).toBe(true);
  }
});

it("keeps portal media read-only without overwriting an existing photo", async () => {
  const [asset] = await db.select().from(customerAssets).where(eq(customerAssets.customerId, seedIds.nguyen));
  await db.update(customerAssets).set({ customFields: { ...asset!.customFields, photo: "existing-photo-reference" } }).where(eq(customerAssets.id, asset!.id));
  const portalActor = { ...customer, tenantId: seedIds.happyTenant, customerIds: new Set([seedIds.nguyen]), locationIds: new Set([seedIds.nguyenLocation]), customerLocationIds: new Map([[seedIds.nguyen, new Set([seedIds.nguyenLocation])]]) };
  const read = await response(handlePortal(request("portal/profile"), ["portal", "profile"], portalActor));
  const profile = (await read.json()).item;
  expect(profile.assets[0].customFields.photo).toBe("existing-photo-reference");
  expect(profile.assets[0].fields.find((field: { key: string }) => field.key === "photo").customerEditable).toBe(false);
  const edit = await response(handlePortal(request("portal/profile", { assets: [{ id: asset!.id, assetTypeKey: "pet", customFields: { photo: "arbitrary-text" } }] }, "PATCH"), ["portal", "profile"], portalActor));
  expect(edit.status).toBe(422);
  expect((await db.select().from(customerAssets).where(eq(customerAssets.id, asset!.id)))[0]!.customFields.photo).toBe("existing-photo-reference");
});

it.each([
  ["pet-waste-removal", "staff"], ["pet-waste-removal", "secure-link"],
  ["house-cleaning", "staff"], ["house-cleaning", "secure-link"],
  ["pet-waste-removal", "staff-legacy"],
])("preserves reviewed signup details and encrypted access for %s conversion via %s", async (packKey, path) => {
  const house = packKey === "house-cleaning";
  const staff: SessionActor = house ? owner : { ...owner, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, membershipId: seedIds.oliviaMembership, userId: seedUserIds.happyOwner, defaultLocationId: seedIds.augusta, locationIds: new Set([seedIds.augusta]) };
  const serviceId = house ? seedIds.houseService : seedIds.weeklyService;
  const marker = `private-convert-${packKey}-${path}`;
  const details = house ? { assets: [{ assetTypeKey: "room", name: "Review room", customFields: { floor_surface: "tile" } }], locationFields: { room_count: 4, entry_instructions: marker } } : { assets: [{ assetTypeKey: "pet", name: "Review item", customFields: { size: "large" } }], locationFields: { yard_size: "large", gate_code: marker } };
  const signup = await response(handlePublicSite(request("public/signup", { slug: house ? "tidy-home" : "happy-yards", address: "98 Review Street", zip: house ? "30909" : "30901", contact: { name: "Review Conversion", email: `conversion-${packKey}-${path}@example.test`, phone: "555-010231" }, service: { id: serviceId, frequency: "weekly" }, ...details, termsAccepted: true, idempotencyKey: `conversion-${packKey}-${path}` }), ["public", "signup"]));
  expect(signup.status).toBe(201);
  const result = (await signup.json()).item;
  expect(result.kind).toBe("lead");
  if (path === "staff-legacy") {
    const [saved] = await db.select().from(leads).where(eq(leads.id, result.id));
    await db.update(leads).set({ customFields: { ...saved!.customFields, websiteSignup: { pets: [{ name: "Review item", size: "large" }], yardSize: "large" } } }).where(eq(leads.id, result.id));
  }
  const [lead] = await db.select().from(leads).where(eq(leads.id, result.id));
  const envelope = lead!.customFields.accessInstructionsEncrypted;
  if (path.startsWith("staff")) {
    // Staff sees the same not-found response for foreign tenants and unassigned locations.
    const denied = await response(handleWorkflow(request(`leads/${lead!.id}/convert`, {}), ["leads", lead!.id, "convert"], { ...staff, tenantId: house ? seedIds.happyTenant : seedIds.houseTenant }));
    expect(denied.status).toBe(404);
    const limited = await response(handleWorkflow(request(`leads/${lead!.id}/convert`, {}), ["leads", lead!.id, "convert"], { ...staff, allLocations: false, locationIds: new Set() }));
    expect(limited.status).toBe(404);
    expect((await response(handleWorkflow(request(`leads/${lead!.id}/convert`, {}), ["leads", lead!.id, "convert"], staff))).status).toBe(200);
    expect((await response(handleWorkflow(request(`leads/${lead!.id}/convert`, {}), ["leads", lead!.id, "convert"], staff))).status).toBe(200);
  } else {
    const [estimate] = await db.insert(estimates).values({ tenantId: staff.tenantId, leadId: lead!.id, organizationLocationId: staff.defaultLocationId, status: "draft", currentRevision: 1, totalMinor: 7500n, createdByMembershipId: staff.membershipId }).returning();
    const [revision] = await db.insert(estimateRevisions).values({ tenantId: staff.tenantId, estimateId: estimate!.id, revisionNumber: 1, subtotalMinor: 7500n, totalMinor: 7500n, termsText: "Service terms", snapshot: { title: "Requested service" } }).returning();
    await db.insert(estimateItems).values({ tenantId: staff.tenantId, estimateRevisionId: revision!.id, serviceId, description: "Requested service", quantity: "1", unitAmountMinor: 7500n, totalMinor: 7500n });
    const sent = await estimateAction(request(`estimates/${estimate!.id}/send`, {}), staff, estimate!.id, "send");
    expect(sent.status).toBe(200);
    const token = (await sent.json()).actionUrl.split("/").at(-1);
    const approve = () => handleV1(request(`public/estimate-links/${token}/approve`, {}), ["public", "estimate-links", token, "approve"]);
    expect((await approve()).status).toBe(200);
    expect((await approve()).status).toBe(200);
  }
  const [converted] = await db.select().from(leads).where(eq(leads.id, lead!.id));
  const [location] = await db.select().from(serviceLocations).where(eq(serviceLocations.customerId, converted!.customerId!));
  expect(location!.accessInstructionsEncrypted).toBe(envelope);
  expect(decryptServiceAccessInstructions(location!.accessInstructionsEncrypted)).toContain(marker);
  expect(location!.customFields).toMatchObject(house ? { room_count: 4 } : { yardSize: "large" });
  const assets = await db.select().from(customerAssets).where(eq(customerAssets.customerId, converted!.customerId!));
  expect(assets).toHaveLength(1);
  expect(assets[0]!).toMatchObject({ tenantId: staff.tenantId, serviceLocationId: location!.id, assetTypeKey: house ? "room" : "pet", name: house ? "Review room" : "Review item" });
  const record = await response(handleRecords(request(`customers/${converted!.customerId}`), ["customers", converted!.customerId!], staff));
  expect(record.status).toBe(200);
  expect((await record.json()).item.assets[0].customFields).toMatchObject(house ? { floor_surface: "tile" } : { size: "large" });
  const jobId = randomUUID(), membershipId = house ? seedIds.houseTechMembership : seedIds.terryMembership;
  await db.insert(jobs).values({ id: jobId, tenantId: staff.tenantId, organizationId: staff.organizationId!, organizationLocationId: staff.defaultLocationId, customerId: converted!.customerId!, serviceLocationId: location!.id, serviceId, status: "dispatched", scheduledDate: "2026-10-07", billable: false });
  await db.insert(jobAssignments).values({ tenantId: staff.tenantId, jobId, membershipId, assignmentRole: "primary" });
  const assigned: SessionActor = { ...staff, role: "technician", membershipId, permissions: permissionsForRole("technician"), allLocations: false };
  const field = await response(handleRoutesField(request(`field/jobs/${jobId}`), ["field", "jobs", jobId], assigned));
  expect(field.status).toBe(200);
  const fieldItem = (await field.json()).item;
  expect(fieldItem.accessNotes).toContain(marker);
  expect(fieldItem.assets[0].name).toBe(assets[0]!.name);
  expect(fieldItem.fieldValues).toMatchObject(house ? { room_count: 4 } : { yard_size: "large" });
  for (const table of [siteSubmissions, auditEvents, domainEvents]) expect(JSON.stringify(await db.select().from(table))).not.toContain(marker);
});
