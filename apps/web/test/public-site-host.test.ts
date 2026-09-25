import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { isLocalApplicationHostname, normalizeRequestHostname, resolvePublishedSiteForHost } = await import("../lib/public-site-host.ts");

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 30_000);

afterAll(async () => { await pglite?.close(); });

describe("public site host routing", () => {
  it("normalizes ordinary Host values strictly and identifies the local app root", () => {
    expect(normalizeRequestHostname(" WWW.Example.com.:443 ")).toBeNull();
    expect(normalizeRequestHostname("WWW.Example.com.:443")).toBe("www.example.com");
    expect(normalizeRequestHostname("café.example")).toBe("xn--caf-dma.example");
    for (const invalid of ["https://example.com", "user@example.com", "example.com/path", "example.com,evil.com", "example.com:bad", "bad..example"]) {
      expect(normalizeRequestHostname(invalid)).toBeNull();
    }
    expect(isLocalApplicationHostname(normalizeRequestHostname("localhost:3000"))).toBe(true);
    expect(isLocalApplicationHostname(normalizeRequestHostname("happy-yards.localhost"))).toBe(false);
  });

  it("resolves each seeded platform hostname to its own tenant site", async () => {
    await expect(resolvePublishedSiteForHost("HAPPY-YARDS.LOCALHOST:3000")).resolves.toEqual({
      siteId: seedIds.happySite, tenantId: seedIds.happyTenant, slug: "happy-yards",
    });
    await expect(resolvePublishedSiteForHost("cleanpaws.localhost")).resolves.toEqual({
      siteId: seedIds.cleanSite, tenantId: seedIds.cleanTenant, slug: "cleanpaws",
    });
  });

  it("routes only verified primary domains attached to the matching tenant's published site", async () => {
    const { domains, sites } = await import("@modular-crm/db");
    const [secondSite] = await db.insert(sites).values({
      tenantId: seedIds.happyTenant,
      organizationId: seedIds.happyOrganization,
      status: "published",
      templateKey: "service-home",
      templateVersion: "1",
      slug: "happy-yards-east",
      publishedAt: new Date(),
    }).returning();

    await db.insert(domains).values([
      { tenantId: seedIds.happyTenant, siteId: secondSite!.id, hostname: "east.example.com", domainType: "custom", verificationStatus: "verified", isPrimary: true, verifiedAt: new Date() },
      { tenantId: seedIds.happyTenant, siteId: secondSite!.id, hostname: "pending.example.com", domainType: "custom", verificationStatus: "pending", isPrimary: true },
      { tenantId: seedIds.happyTenant, siteId: secondSite!.id, hostname: "alternate.example.com", domainType: "custom", verificationStatus: "verified", isPrimary: false, verifiedAt: new Date() },
    ]);
    await expect(db.insert(domains).values({
      tenantId: seedIds.cleanTenant, siteId: secondSite!.id, hostname: "mismatched.example.com",
      domainType: "custom", verificationStatus: "verified", isPrimary: true, verifiedAt: new Date(),
    })).rejects.toThrow();

    await expect(resolvePublishedSiteForHost("EAST.EXAMPLE.COM.:443")).resolves.toEqual({
      siteId: secondSite!.id, tenantId: seedIds.happyTenant, slug: "happy-yards-east",
    });
    await expect(resolvePublishedSiteForHost("pending.example.com")).resolves.toBeNull();
    await expect(resolvePublishedSiteForHost("alternate.example.com")).resolves.toBeNull();
    await expect(resolvePublishedSiteForHost("unknown.example.com")).resolves.toBeNull();
    await expect(resolvePublishedSiteForHost("localhost:3000")).resolves.toBeNull();
  });
});
