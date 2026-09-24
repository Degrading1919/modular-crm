import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleWebsiteDomains, mockDomainVerificationAllowed, normalizeCustomHostname } = await import("../lib/api/website-domains.ts");
const { apiError } = await import("../lib/api/http.ts");
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
    expect(normalizeCustomHostname("  WWW.Example-Business.com. ")).toBe("www.example-business.com");
    expect(normalizeCustomHostname("café.com")).toBe("xn--caf-dma.com");
    for (const input of ["localhost", "demo.localhost", "service.local", "127.0.0.1", "https://site.example.com", "site.example.com/path"]) {
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

    const added = await call("POST", ["website", "domains"], owner, { hostname: "WWW.HappyYards.example.com" });
    expect(added?.status).toBe(201);
    const { item: created } = await added!.json() as { item: { id: string; hostname: string; isPrimary: boolean; dnsChallenge: { recordType: string; recordName: string; recordValue: string } } };
    expect(created).toMatchObject({ hostname: "www.happyyards.example.com", isPrimary: false, dnsChallenge: { recordType: "TXT", recordName: "_modular-crm-verification.www.happyyards.example.com" } });
    expect(created.dnsChallenge.recordValue).toMatch(/^modular-crm-verification=/);

    const cannotSelectBeforeVerification = await call("POST", ["website", "domains", created.id, "primary"], owner, {});
    expect(cannotSelectBeforeVerification?.status).toBe(422);

    await db.update(schema.tenants).set({ settings: { demoMode: true } }).where(eq(schema.tenants.id, seedIds.happyTenant));
    const verified = await call("POST", ["website", "domains", created.id, "verify"], owner, {});
    expect(verified?.status).toBe(200);
    expect(await verified!.json()).toMatchObject({ item: { verificationStatus: "verified", isPrimary: false } });

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
    const added = await call("POST", ["website", "domains"], otherTenantOwner, { hostname: "connect.cleanpaws.example.com" });
    const { item } = await added!.json() as { item: { id: string } };
    const verify = await call("POST", ["website", "domains", item.id, "verify"], otherTenantOwner, {});
    expect(verify?.status).toBe(409);
    expect(await verify!.json()).toMatchObject({ error: { message: expect.stringMatching(/hosting provider/i) } });
  });
});
