import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, or, sql } from "drizzle-orm";
import type { ConnectorDefinition } from "@modular-crm/connectors";
import { auditEvents, connectorInstallations, domainEvents, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";
import { sealConnectorCredentials, sealConnectorOAuthTokens } from "../lib/api/connector-secrets";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleCapabilitySettings } = await import("../lib/api/capability-settings.ts");
const { getRegistry } = await import("../lib/connectors.ts");

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY; });

const actor: SessionActor = {
  kind: "staff", userId: "connection-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards",
  organizationId: seedIds.happyOrganization, membershipId: seedIds.oliviaMembership,
  role: "owner", permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta]), allLocations: true,
  email: "owner@example.test", name: "Owner", packKey: null,
};

describe("connector connection atomicity", () => {
  it("keeps the persisted installation and runtime cache unchanged when audit persistence fails", async () => {
    const connectorKey = "mock-payments";
    const [installation] = await db.select().from(connectorInstallations).where(and(
      eq(connectorInstallations.tenantId, seedIds.happyTenant), eq(connectorInstallations.connectorKey, connectorKey),
    ));
    expect(installation).toBeDefined();

    // The partial unique index makes recordEvent's audit insert fail after its domain event insert.
    await db.execute(sql`create unique index test_connector_disconnect_audit_failure
      on audit_events (tenant_id, entity_id) where action = 'connector.disconnect'`);
    await db.insert(auditEvents).values({
      tenantId: seedIds.happyTenant, actorType: "staff", actorId: actor.userId,
      action: "connector.disconnect", entityType: "connector_installation", entityId: installation!.id,
    });

    const registry = getRegistry();
    registry.disconnect(seedIds.happyTenant, connectorKey);
    const runtimeBefore = registry.healthCheck(seedIds.happyTenant, connectorKey);

    await expect(handleCapabilitySettings(
      new Request(`https://crm.example/api/v1/connections/${connectorKey}/disconnect`, { method: "POST" }),
      ["connections", connectorKey, "disconnect"], actor,
    )).rejects.toThrow();

    const [afterFailure] = await db.select().from(connectorInstallations).where(eq(connectorInstallations.id, installation!.id));
    expect(afterFailure?.status).toBe(installation!.status);
    expect(afterFailure?.credentialReference).toBe(installation!.credentialReference);
    expect(registry.healthCheck(seedIds.happyTenant, connectorKey)).toMatchObject({
      state: runtimeBefore.state, health: runtimeBefore.health,
    });
    expect(await db.select().from(domainEvents).where(and(
      eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.entityId, installation!.id), eq(domainEvents.eventType, "connector.disconnected"),
    ))).toHaveLength(0);
    expect(await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, seedIds.happyTenant), eq(auditEvents.entityId, installation!.id), eq(auditEvents.action, "connector.disconnect"),
    ))).toHaveLength(1);
  });

  it("commits a credentials-ready connection before applying it to the runtime registry", async () => {
    const connectorKey = "twilio";
    const installationId = "a7148103-899a-4f16-8246-90034427a91e";
    const credentialReference = sealConnectorCredentials({
      accountSid: `AC${"a".repeat(32)}`, authToken: "test-only-auth-token", sender: "+15551234567",
    }, { tenantId: seedIds.happyTenant, installationId, connectorKey });
    await db.insert(connectorInstallations).values({
      id: installationId, tenantId: seedIds.happyTenant, connectorKey, status: "not_connected",
      displayName: "Twilio", credentialReference, settings: {},
    });

    await db.execute(sql`create unique index test_connector_connect_audit_failure
      on audit_events (tenant_id, entity_id) where action = 'connector.connect'`);
    await db.insert(auditEvents).values({
      tenantId: seedIds.happyTenant, actorType: "staff", actorId: actor.userId,
      action: "connector.connect", entityType: "connector_installation", entityId: installationId,
    });
    const registry = getRegistry();
    const runtimeBefore = registry.healthCheck(seedIds.happyTenant, connectorKey);
    await expect(handleCapabilitySettings(
      new Request(`https://crm.example/api/v1/connections/${connectorKey}/connect`, { method: "POST" }),
      ["connections", connectorKey, "connect"], actor,
    )).rejects.toThrow();
    const [afterFailure] = await db.select().from(connectorInstallations).where(eq(connectorInstallations.id, installationId));
    expect(afterFailure?.status).toBe("not_connected");
    expect(registry.healthCheck(seedIds.happyTenant, connectorKey)).toMatchObject({
      state: runtimeBefore.state, health: runtimeBefore.health,
    });
    expect(await db.select().from(domainEvents).where(and(
      eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.entityId, installationId), eq(domainEvents.eventType, "connector.connected"),
    ))).toHaveLength(0);
    await db.delete(auditEvents).where(and(eq(auditEvents.entityId, installationId), eq(auditEvents.action, "connector.connect")));
    await db.execute(sql`drop index test_connector_connect_audit_failure`);

    const response = await handleCapabilitySettings(
      new Request(`https://crm.example/api/v1/connections/${connectorKey}/connect`, { method: "POST" }),
      ["connections", connectorKey, "connect"], actor,
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ item: { key: connectorKey, status: "connected", mode: "live" } });
    const [installation] = await db.select().from(connectorInstallations).where(eq(connectorInstallations.id, installationId));
    expect(installation?.status).toBe("connected");
    expect(registry.healthCheck(seedIds.happyTenant, connectorKey)).toMatchObject({ state: "connected", health: "healthy" });
    expect(await db.select().from(domainEvents).where(and(
      eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.entityId, installationId), eq(domainEvents.eventType, "connector.connected"),
    ))).toHaveLength(1);
  });

  it("preserves OAuth installation and runtime state when post-revocation audit persistence fails", async () => {
    const connectorKey = "atomic-oauth-disconnect";
    const revoked: string[] = [];
    const definition: ConnectorDefinition = {
      manifest: {
        key: connectorKey, name: "Atomic OAuth", description: "OAuth disconnect atomicity test", provider: "Test Provider",
        icon: "plug", categories: ["calendar"], capabilities: ["calendar"], authType: "oauth2", requiredScopes: ["calendar.read"],
        environments: ["production"], setupComplexity: "easy", discoverableResources: [], webhookSupport: false,
        syncModes: [], version: "1.0.0", availability: "credentials_ready",
      },
      oauth: {
        authorizationEndpoint: "https://provider.example/authorize", clientId: "test-client",
        exchangeCode: async () => ({ accessToken: "unused" }), createScope: () => ({}),
        revoke: async ({ accessToken }) => { revoked.push(accessToken); },
      },
    };
    const registry = getRegistry();
    registry.register(definition);
    const installationId = "bcb7345b-8d0f-4e1f-95a9-8d9e7d59a7d2";
    const credentialReference = sealConnectorOAuthTokens({ accessToken: "access-token", refreshToken: "refresh-token", grantedScopes: ["calendar.read"] }, {
      tenantId: seedIds.happyTenant, installationId, connectorKey, actorUserId: actor.userId,
    });
    await db.insert(connectorInstallations).values({
      id: installationId, tenantId: seedIds.happyTenant, connectorKey, status: "connected",
      displayName: "Atomic OAuth", credentialReference, grantedScopes: ["calendar.read"], settings: {},
    });
    registry.installOAuthScope(seedIds.happyTenant, connectorKey, {});

    await db.execute(sql`create unique index test_oauth_disconnect_audit_failure
      on audit_events (tenant_id, entity_id) where action = 'connector.disconnect'`);
    await db.insert(auditEvents).values({
      tenantId: seedIds.happyTenant, actorType: "staff", actorId: actor.userId,
      action: "connector.disconnect", entityType: "connector_installation", entityId: installationId,
    });
    const runtimeBefore = registry.healthCheck(seedIds.happyTenant, connectorKey);

    const disconnectRequest = () => handleCapabilitySettings(
      new Request(`https://crm.example/api/v1/connections/${connectorKey}/disconnect`, { method: "POST" }),
      ["connections", connectorKey, "disconnect"], actor,
    );
    await expect(disconnectRequest()).rejects.toThrow();
    expect(revoked).toEqual(["access-token"]);
    const [afterFailure] = await db.select().from(connectorInstallations).where(eq(connectorInstallations.id, installationId));
    expect(afterFailure?.status).toBe("connected");
    expect(afterFailure?.credentialReference).toBe(credentialReference);
    expect(registry.healthCheck(seedIds.happyTenant, connectorKey)).toMatchObject({
      state: runtimeBefore.state, health: runtimeBefore.health,
    });
    expect(await db.select().from(domainEvents).where(and(
      eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.entityId, installationId), eq(domainEvents.eventType, "connector.disconnected"),
    ))).toHaveLength(0);

    await db.delete(auditEvents).where(and(eq(auditEvents.entityId, installationId), eq(auditEvents.action, "connector.disconnect")));
    await db.execute(sql`drop index test_oauth_disconnect_audit_failure`);
    const success = await disconnectRequest();
    expect(success?.status).toBe(200);
    expect(await success?.json()).toMatchObject({ item: { key: connectorKey, status: "not_connected", mode: "live" } });
    const [afterSuccess] = await db.select().from(connectorInstallations).where(eq(connectorInstallations.id, installationId));
    expect(afterSuccess?.status).toBe("not_connected");
    expect(afterSuccess?.credentialReference).toBeNull();
    expect(registry.healthCheck(seedIds.happyTenant, connectorKey)).toMatchObject({ state: "not_connected", health: "unavailable" });
    expect(await db.select().from(domainEvents).where(and(
      eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.entityId, installationId), eq(domainEvents.eventType, "connector.disconnected"),
    ))).toHaveLength(1);
  });

  it("rolls back every OAuth installation when any of multiple snapshots is stale", async () => {
    const connectorKey = "multi-oauth-disconnect-race";
    const firstId = "3f8e6e35-bbe6-4445-87b8-f003ac919e55";
    const secondId = "8a34aadc-3b19-41a7-958a-ea10a89fdc2c";
    const firstReference = sealConnectorOAuthTokens({ accessToken: "first-access", grantedScopes: [] }, {
      tenantId: seedIds.happyTenant, installationId: firstId, connectorKey, actorUserId: actor.userId,
    });
    const secondReference = sealConnectorOAuthTokens({ accessToken: "second-access", grantedScopes: [] }, {
      tenantId: seedIds.happyTenant, installationId: secondId, connectorKey, actorUserId: actor.userId,
    });
    const rotatedReference = sealConnectorOAuthTokens({ accessToken: "rotated-access", grantedScopes: [] }, {
      tenantId: seedIds.happyTenant, installationId: secondId, connectorKey, actorUserId: actor.userId,
    });
    const registry = getRegistry();
    registry.register({
      manifest: {
        key: connectorKey, name: "Multi OAuth", description: "OAuth snapshot conflict test", provider: "Test Provider",
        icon: "plug", categories: ["calendar"], capabilities: ["calendar"], authType: "oauth2", requiredScopes: [],
        environments: ["production"], setupComplexity: "easy", discoverableResources: [], webhookSupport: false,
        syncModes: [], version: "1.0.0", availability: "credentials_ready",
      },
      oauth: {
        authorizationEndpoint: "https://provider.example/authorize", clientId: "test-client",
        exchangeCode: async () => ({ accessToken: "unused" }), createScope: () => ({}),
        revoke: async () => { await db.update(connectorInstallations).set({ credentialReference: rotatedReference }).where(eq(connectorInstallations.id, secondId)); },
      },
    });
    await db.insert(connectorInstallations).values([
      { id: firstId, tenantId: seedIds.happyTenant, connectorKey, status: "connected", displayName: "Multi OAuth A", credentialReference: firstReference, settings: {} },
      { id: secondId, tenantId: seedIds.happyTenant, connectorKey, status: "connected", displayName: "Multi OAuth B", credentialReference: secondReference, settings: {} },
    ]);
    registry.installOAuthScope(seedIds.happyTenant, connectorKey, {});
    const runtimeBefore = registry.healthCheck(seedIds.happyTenant, connectorKey);

    await expect(handleCapabilitySettings(
      new Request(`https://crm.example/api/v1/connections/${connectorKey}/disconnect`, { method: "POST" }),
      ["connections", connectorKey, "disconnect"], actor,
    )).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    const rows = await db.select().from(connectorInstallations).where(and(
      eq(connectorInstallations.tenantId, seedIds.happyTenant), eq(connectorInstallations.connectorKey, connectorKey),
    ));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === firstId)).toMatchObject({ status: "connected", credentialReference: firstReference });
    expect(rows.find((row) => row.id === secondId)).toMatchObject({ status: "connected", credentialReference: rotatedReference });
    expect(registry.healthCheck(seedIds.happyTenant, connectorKey)).toMatchObject({
      state: runtimeBefore.state, health: runtimeBefore.health,
    });
    expect(await db.select().from(domainEvents).where(and(
      eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.entityType, "connector_installation"),
      eq(domainEvents.eventType, "connector.disconnected"), or(eq(domainEvents.entityId, firstId), eq(domainEvents.entityId, secondId)),
    ))).toHaveLength(0);
  });
});
