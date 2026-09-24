import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiKey, hashApiKey, DomainError } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";

const dbHarness = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; tenantId: string; scopes: string[] }>,
  updateValues: undefined as Record<string, unknown> | undefined,
  whereCondition: undefined as unknown,
  updateCalls: 0,
  insertCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
}));

vi.mock("../lib/db", () => ({
  getDb: () => ({
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          dbHarness.insertCalls.push({ table, values });
          return {
            returning: async () => dbHarness.insertCalls.length === 1
              ? [{ ...values, id: "credential-created", createdAt: new Date("2026-09-23T12:00:00.000Z") }]
              : [],
          };
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: unknown) => ({
          returning: async () => {
            dbHarness.updateCalls += 1;
            dbHarness.updateValues = values;
            dbHarness.whereCondition = condition;
            return dbHarness.rows;
          },
        }),
      }),
    }),
  }),
}));

const {
  API_CREDENTIAL_SCOPES,
  apiKeyFromAuthorization,
  createApiCredentialBodySchema,
  handleDeveloperCredentials,
  presentApiCredential,
  resolveApiCredential,
  resolveApiCredentialFromRequest,
} = await import("../lib/api/developer-credentials.ts");

const owner: SessionActor = {
  kind: "staff", userId: "user-owner", tenantId: "tenant-a", role: "owner", permissions: new Set(),
  locationIds: new Set(), allLocations: true, membershipId: "membership-owner", email: "owner@example.test",
  name: "Owner", tenantName: "Tenant A", packKey: null,
};

const officeActor: SessionActor = { ...owner, role: "office", userId: "user-office", membershipId: "membership-office" };

beforeEach(() => {
  dbHarness.rows = [];
  dbHarness.updateValues = undefined;
  dbHarness.whereCondition = undefined;
  dbHarness.updateCalls = 0;
  dbHarness.insertCalls = [];
});

describe("developer API credentials", () => {
  it("accepts only documented scopes and normalizes duplicates", () => {
    expect(createApiCredentialBodySchema.parse({
      name: "  Reporting dashboard  ",
      scopes: ["customers:read", "leads:read", "customers:read"],
    })).toEqual({ name: "Reporting dashboard", scopes: ["customers:read", "leads:read"] });
    expect(API_CREDENTIAL_SCOPES).toContain("webhooks:manage");
    expect(() => createApiCredentialBodySchema.parse({ name: "Report", scopes: ["tenant:delete"] })).toThrow();
    expect(() => createApiCredentialBodySchema.parse({ name: "\n", scopes: ["customers:read"] })).toThrow();
    expect(() => createApiCredentialBodySchema.parse({ name: "Report", scopes: ["customers:read"], tenantId: "tenant-b" })).toThrow();
  });

  it("generates an opaque key and presents only non-secret credential fields", () => {
    const key = createApiKey();
    expect(key.plain).toMatch(/^mcrm_[A-Za-z0-9_-]{43}$/);
    expect(key.hash).toBe(hashApiKey(key.plain));
    expect(key.hash).not.toContain(key.plain);

    const safe = presentApiCredential({
      id: "credential-1", name: "Dashboard", tokenPrefix: key.prefix, scopes: ["customers:read"], status: "active",
      expiresAt: null, lastUsedAt: null, createdAt: new Date("2026-01-01T00:00:00.000Z"), revokedAt: null,
    });
    expect(safe).toMatchObject({ name: "Dashboard", tokenPrefix: key.prefix, scopes: ["customers:read"] });
    expect(safe).not.toHaveProperty("tokenHash");
    expect(safe).not.toHaveProperty("key");
    expect(safe).not.toHaveProperty("createdByMembershipId");
  });

  it("stores only a hash, returns the new key once, and audits without secret material", async () => {
    const response = await handleDeveloperCredentials(new Request("https://crm.example/api/v1/developer/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dashboard", scopes: ["customers:read", "leads:read"] }),
    }), ["developer", "credentials"], owner);
    expect(response?.status).toBe(201);
    const payload = await response!.json();
    const returnedKey = payload.item.key as string;
    const credentialInsert = dbHarness.insertCalls[0]!.values;
    const auditInsert = dbHarness.insertCalls[1]!.values;

    expect(returnedKey).toMatch(/^mcrm_[A-Za-z0-9_-]{43}$/);
    expect(credentialInsert.tokenHash).toBe(hashApiKey(returnedKey));
    expect(credentialInsert.tokenHash).not.toBe(returnedKey);
    expect(credentialInsert.tenantId).toBe(owner.tenantId);
    expect(payload.item).not.toHaveProperty("tokenHash");
    expect(auditInsert.action).toBe("developer.api_credential_created");
    expect(JSON.stringify(auditInsert)).not.toContain(returnedKey);
    expect(JSON.stringify(auditInsert)).not.toContain(String(credentialInsert.tokenHash));
  });

  it("resolves a bearer key from its stored tenant and scopes while applying active and expiry filters", async () => {
    const key = createApiKey().plain;
    const now = new Date("2026-09-23T12:00:00.000Z");
    dbHarness.rows = [{ id: "credential-1", tenantId: "tenant-a", scopes: ["customers:read"] }];

    expect(apiKeyFromAuthorization(new Request("https://crm.example", { headers: { authorization: `Bearer ${key}` } }))).toBe(key);
    const resolved = await resolveApiCredentialFromRequest(new Request("https://crm.example", {
      headers: { authorization: `Bearer ${key}` },
    }), now);
    expect(resolved).toEqual({ credentialId: "credential-1", tenantId: "tenant-a", scopes: ["customers:read"] });
    expect(dbHarness.updateValues).toEqual({ lastUsedAt: now });

    const query = new PgDialect().sqlToQuery(dbHarness.whereCondition as SQL);
    expect(query.sql).toContain("token_hash");
    expect(query.sql).toContain("status");
    expect(query.sql).toContain("revoked_at");
    expect(query.sql).toContain("expires_at");
    expect(query.params).toContain(hashApiKey(key));
    expect(query.params).toContain("active");
    expect(query.params).toContain(now.toISOString());
  });

  it("rejects missing, malformed, revoked, or expired keys without resolving tenant authority", async () => {
    const malformed = new Request("https://crm.example", { headers: { authorization: "Bearer mcrm_not-a-key" } });
    expect(apiKeyFromAuthorization(malformed)).toBeNull();
    expect(await resolveApiCredentialFromRequest(malformed)).toBeNull();
    expect(dbHarness.updateCalls).toBe(0);

    dbHarness.rows = [];
    expect(await resolveApiCredential(createApiKey().plain)).toBeNull();
    const query = new PgDialect().sqlToQuery(dbHarness.whereCondition as SQL);
    expect(query.sql).toContain("revoked_at");
    expect(query.sql).toContain("expires_at");
  });

  it("allows credential management only for owners and leaves other developer handlers unclaimed", async () => {
    await expect(handleDeveloperCredentials(new Request("https://crm.example/api/v1/developer"), ["developer"], officeActor))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(handleDeveloperCredentials(new Request("https://crm.example/api/v1/developer/credentials", { method: "POST" }), ["developer", "credentials"], officeActor))
      .rejects.toBeInstanceOf(DomainError);
    expect(await handleDeveloperCredentials(new Request("https://crm.example/api/v1/developer/webhooks"), ["developer", "webhooks"], officeActor)).toBeNull();
  });
});
