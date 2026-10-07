import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, sweepWebsiteDomains, checkWebsiteDomain, type Database } from "@modular-crm/db";
import { createWebsiteHosting } from "@modular-crm/connectors";
import { NextRequest } from "next/server";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleWebsiteDomains, mockDomainVerificationAllowed, normalizeCustomHostname } = await import("../lib/api/website-domains.ts");
const { apiError } = await import("../lib/api/http.ts");
const { findWebsiteHost, assertWebsiteHostSlug, websiteRequestHost } = await import("../lib/website-host.ts");
const { proxy } = await import("../proxy.ts");
let pglite: PGlite;
let db: Database;

const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta, seedIds.northAugusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};
const office: SessionActor = { ...owner, role: "office", permissions: permissionsForRole("office") };
const otherTenantOwner: SessionActor = {
  ...owner, userId: "demo-clean-owner", tenantId: seedIds.cleanTenant, tenantName: "CleanPaws Route Service",
  organizationId: seedIds.cleanOrganization, membershipId: "00000000-0000-4000-8000-00000000002c",
};

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 30_000);
afterAll(async () => { await pglite?.close(); });

async function call(method: string, path: string[], actor = owner, value?: unknown) {
  const request = new Request("http://localhost/api/v1/website/domains", {
    method, headers: value === undefined ? {} : { "content-type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  try { return await handleWebsiteDomains(request, path, actor); }
  catch (error) { return apiError(error); }
}

describe("website custom domains", () => {
  it("normalizes public hostnames and rejects local names, URLs, and IP addresses", () => {
    expect(normalizeCustomHostname("  WWW.Example.test. ", true)).toBe("www.example.test");
    expect(normalizeCustomHostname("café.test", true)).toBe("xn--caf-dma.test");
    for (const input of ["localhost", "demo.localhost", "service.local", "127.0.0.1", "https://site.example.test", "site.example.test/path", "co.uk", "example.test"]) {
      expect(() => normalizeCustomHostname(input)).toThrow();
    }
  });

  it("only enables simulated verification in non-production with an explicit mock/demo setting", () => {
    expect(mockDomainVerificationAllowed({ demoMode: true }, "production")).toBe(false);
    expect(mockDomainVerificationAllowed({ demoMode: true }, "development")).toBe(true);
    expect(mockDomainVerificationAllowed({}, "development")).toBe(false);
    const previous = process.env.DOMAIN_VERIFICATION_MODE;
    process.env.DOMAIN_VERIFICATION_MODE = "mock";
    try {
      expect(mockDomainVerificationAllowed({}, "development")).toBe(true);
      expect(mockDomainVerificationAllowed({}, "production")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.DOMAIN_VERIFICATION_MODE;
      else process.env.DOMAIN_VERIFICATION_MODE = previous;
    }
  });

  it("enforces manager permission, tenant scope, DNS challenge, primary selection, and platform reversion", async () => {
    const denied = await call("GET", ["website", "domains"], office);
    expect(denied?.status).toBe(403);
    await db.update(schema.tenants).set({ settings: { demoMode: true } }).where(eq(schema.tenants.id, seedIds.happyTenant));
    const added = await call("POST", ["website", "domains"], owner, { hostname: "WWW.HappyYards.example.test" });
    expect(added?.status).toBe(201);
    const { item: created } = await added!.json() as { item: { id: string; hostname: string; isPrimary: boolean; dnsChallenge: { recordType: string; recordName: string; recordValue: string } } };
    expect(created).toMatchObject({ hostname: "www.happyyards.example.test", isPrimary: false, dnsChallenge: { recordType: "TXT", recordName: "_modular-crm-verification.www.happyyards.example.test" }, state: "waiting_dns", routingRecord: { recordType: "CNAME", recordValue: "sites.example.test" } });
    expect(created.dnsChallenge.recordValue).toMatch(/^modular-crm-verification=/);

    const cannotSelectBeforeVerification = await call("POST", ["website", "domains", created.id, "primary"], owner, {});
    expect(cannotSelectBeforeVerification?.status).toBe(422);

    expect(await (await call("POST", ["website", "domains", created.id, "verify"], owner, {}))!.json()).toMatchObject({ item: { state: "waiting_dns", verificationStatus: "pending" } });
    await call("POST", ["website", "domains", created.id, "mock-dns"], owner, { ownership: "valid", routing: "valid", certificate: "ready" });
    const verified = await call("POST", ["website", "domains", created.id, "verify"], owner, {});
    expect(verified?.status).toBe(200);
    expect(await verified!.json()).toMatchObject({ item: { verificationStatus: "verified", isPrimary: false, state: "live" } });

    const foreignDomain = await db.select().from(schema.domains).where(eq(schema.domains.tenantId, seedIds.cleanTenant)).limit(1);
    const foreignAccess = await call("DELETE", ["website", "domains", foreignDomain[0]!.id], owner);
    expect(foreignAccess?.status).toBe(404);

    const selected = await call("POST", ["website", "domains", created.id, "primary"], owner, {});
    expect(await selected!.json()).toMatchObject({ item: { isPrimary: true } });
    const listed = await call("GET", ["website", "domains"]);
    const { platformDomain } = await listed!.json() as { platformDomain: { id: string } };
    const reverted = await call("POST", ["website", "domains", platformDomain.id, "primary"], owner, {});
    expect(reverted?.status).toBe(200);
    expect(await reverted!.json()).toMatchObject({ item: { domainType: "platform", isPrimary: true } });

    await call("POST", ["website", "domains", created.id, "primary"], owner, {});
    const removedPrimary = await call("DELETE", ["website", "domains", created.id]);
    expect(removedPrimary?.status).toBe(200);
    const finalList = await call("GET", ["website", "domains"]);
    expect(await finalList!.json()).toMatchObject({ items: [], platformDomain: { isPrimary: true } });
  });

  it("never simulates verification for a tenant without explicit demo mode", async () => {
    await db.update(schema.tenants).set({ settings: { demoMode: false } }).where(eq(schema.tenants.id, seedIds.cleanTenant));
    const added = await call("POST", ["website", "domains"], otherTenantOwner, { hostname: "connect.cleanpaws.example.test" });
    expect(added?.status).toBe(503);
    expect(await added!.json()).toMatchObject({ error: { message: "Custom website addresses are not configured yet. Your included address still works." } });
    expect((await call("POST", ["website", "domains", seedIds.cleanTenant, "mock-dns"], otherTenantOwner, {}))?.status).toBe(403);
  });

  it("progresses through verified, securing, live and attention; rechecks while billing is read-only and isolates Host", async () => {
    const hostname = "state.example.test";
    const added = await call("POST", ["website", "domains"], owner, { hostname });
    expect(added!.status).toBe(201);
    const { item } = await added!.json();
    const hosting = createWebsiteHosting({ NODE_ENV: "test", DOMAIN_VERIFICATION_MODE: "mock" });
    await call("POST", ["website", "domains", item.id, "mock-dns"], owner, { ownership: "valid", routing: "valid", certificate: "pending" });
    expect((await checkWebsiteDomain(db, owner.tenantId, item.id, hosting)).state).toBe("verified");
    expect((await checkWebsiteDomain(db, owner.tenantId, item.id, hosting, true)).state).toBe("securing");
    expect(await findWebsiteHost(hostname)).toBeNull();
    await call("POST", ["website", "domains", item.id, "mock-dns"], owner, { ownership: "valid", routing: "valid", certificate: "ready" });
    await sweepWebsiteDomains(db, hosting);
    const route = await findWebsiteHost(hostname);
    expect(route?.tenantId).toBe(owner.tenantId);
    expect(await findWebsiteHost(hostname, new Date(Date.now() + 23 * 60 * 60_000))).not.toBeNull();
    expect(await findWebsiteHost(hostname, new Date(Date.now() + 25 * 60 * 60_000))).toBeNull();
    const [evidence] = await db.select().from(schema.websiteDomainChecks).where(eq(schema.websiteDomainChecks.domainId, item.id));
    await checkWebsiteDomain(db, owner.tenantId, item.id, { ...hosting, dns: { check: vi.fn().mockResolvedValue({ ownership: "missing", routing: "missing", unavailable: true }) } }, true);
    const [afterOutage] = await db.select().from(schema.websiteDomainChecks).where(eq(schema.websiteDomainChecks.domainId, item.id));
    expect(afterOutage).toMatchObject({ state: "live", ownershipVerified: true, routingVerified: true, checkedAt: evidence!.checkedAt });
    expect(await findWebsiteHost(hostname)).not.toBeNull();
    expect(await findWebsiteHost(hostname, new Date(Date.now() + 25 * 60 * 60_000))).toBeNull();
    await expect(assertWebsiteHostSlug(new Request("http://localhost", { headers: { host: hostname } }), "cleanpaws")).rejects.toMatchObject({ status: 404 });
    await expect(assertWebsiteHostSlug(new Request("http://localhost", { headers: { host: hostname } }), route!.slug)).resolves.toBeUndefined();
    const request = (path: string, headers = {}) => new NextRequest(`http://localhost:3000${path}`, { headers: { host: hostname, ...headers } });
    expect((await proxy(request("/"))).headers.get("x-middleware-rewrite")).toContain(`/site/${route!.slug}`);
    expect((await proxy(request("/app/dashboard"))).status).toBe(404);
    expect((await proxy(request("/login"))).status).toBe(404);
    expect((await proxy(request("/site/cleanpaws"))).status).toBe(404);
    expect((await proxy(request("/", { "next-action": "forged" }))).status).toBe(404);
    expect((await proxy(new NextRequest("http://localhost:3000/", { headers: { host: "unknown.example.test" } }))).status).toBe(404);
    expect((await proxy(request("/api/v1/public/site", { cookie: "staff-secret", authorization: "Bearer staff-secret" }))).headers.get("x-middleware-request-cookie")).toBeNull();
    await db.update(schema.tenants).set({ settings: { demoMode: true } }).where(eq(schema.tenants.id, seedIds.cleanTenant));
    expect((await call("POST", ["website", "domains"], otherTenantOwner, { hostname }))!.status).toBe(409);
    expect((await call("POST", ["website", "domains", item.id, "verify"], otherTenantOwner, {}))!.status).toBe(404);
    await db.update(schema.websiteDomainChecks).set({ mockRecords: { ownership: "valid", routing: "wrong" }, nextCheckAt: new Date(0) }).where(eq(schema.websiteDomainChecks.domainId, item.id));
    await db.insert(schema.platformSubscriptions).values({ tenantId: owner.tenantId, provider: "mock", status: "read_only", planKey: "starter", capabilities: [], includedSeats: 10, trialEnd: new Date() }).onConflictDoUpdate({ target: schema.platformSubscriptions.tenantId, set: { status: "read_only" } });
    await sweepWebsiteDomains(db, hosting);
    expect((await db.select().from(schema.websiteDomainChecks).where(eq(schema.websiteDomainChecks.domainId, item.id)))[0]).toMatchObject({ state: "needs_attention", ownershipVerified: true, routingVerified: false, problem: expect.stringMatching(/points somewhere else/) });
    expect(await findWebsiteHost(hostname)).toBeNull();
    expect((await proxy(request("/"))).status).toBe(404);
    expect((await call("POST", ["website", "domains"], owner, { hostname: "blocked.example.test" }))!.status).toBe(402);
    await checkWebsiteDomain(db, owner.tenantId, item.id, hosting, true);
    expect((await db.select().from(schema.websiteDomainChecks).where(eq(schema.websiteDomainChecks.domainId, item.id)))[0]?.state).toBe("needs_attention");
    await db.update(schema.platformSubscriptions).set({ status: "active" }).where(eq(schema.platformSubscriptions.tenantId, owner.tenantId));
    await call("DELETE", ["website", "domains", item.id]);
  });

  it("requires the origin key for forwarded hosts, including malformed Unicode keys", () => {
    const env = { WEBSITE_ORIGIN_SECRET: "x".repeat(48) };
    expect(websiteRequestHost(new Request("http://localhost", { headers: { "x-website-host": "www.example.test" } }), env)).toBeNull();
    expect(websiteRequestHost(new Request("http://localhost", { headers: { "x-website-host": "www.example.test", "x-website-origin-key": "é".repeat(48) } }), env)).toBeNull();
    expect(websiteRequestHost(new Request("http://localhost", { headers: { "x-website-host": "WWW.EXAMPLE.TEST.", "x-website-origin-key": "x".repeat(48) } }), env)).toBe("www.example.test");
  });

  it("does not strand other checks on a legacy missing token and retains real claims through cleanup errors", async () => {
    const added = await call("POST", ["website", "domains"], owner, { hostname: "cleanup.example.test" });
    expect(added!.status).toBe(201);
    const { item } = await added!.json();
    await db.update(schema.domains).set({ verificationData: {} }).where(eq(schema.domains.id, item.id));
    const hosting = createWebsiteHosting({ NODE_ENV: "test", DOMAIN_VERIFICATION_MODE: "mock" });
    const edge = { ensure: vi.fn(hosting.edge.ensure), remove: vi.fn(hosting.edge.remove) };
    await sweepWebsiteDomains(db, { ...hosting, edge });
    expect(edge.ensure).not.toHaveBeenCalled();
    expect((await db.select().from(schema.websiteDomainChecks).where(eq(schema.websiteDomainChecks.domainId, item.id)))[0]).toMatchObject({ state: "needs_attention", problem: expect.stringMatching(/reconnect/) });
    await db.update(schema.tenants).set({ settings: { demoMode: false } }).where(eq(schema.tenants.id, owner.tenantId));
    expect((await call("DELETE", ["website", "domains", item.id]))!.status).toBe(200);
    expect((await db.select().from(schema.websiteDomainChecks).where(eq(schema.websiteDomainChecks.domainId, item.id)))[0]?.state).toBe("removing");
    expect((await call("POST", ["website", "domains"], otherTenantOwner, { hostname: "cleanup.example.test" }))!.status).toBe(409);
    edge.remove.mockRejectedValueOnce(new Error("edge unavailable"));
    await sweepWebsiteDomains(db, { ...hosting, edge });
    expect(edge.remove).toHaveBeenCalledWith(`crm-domain-${item.id}`);
    expect((await db.select().from(schema.domains).where(eq(schema.domains.id, item.id)))).toHaveLength(1);
    await sweepWebsiteDomains(db, { ...hosting, edge }, new Date(Date.now() + 61_000));
    expect((await db.select().from(schema.domains).where(eq(schema.domains.id, item.id)))).toHaveLength(0);
    await db.update(schema.tenants).set({ settings: { demoMode: true } }).where(eq(schema.tenants.id, owner.tenantId));
  });
});
