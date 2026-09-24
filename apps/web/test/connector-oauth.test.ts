import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { ConnectorRegistry, type ConnectorDefinition } from "@modular-crm/connectors";
import { permissionsForRole } from "@modular-crm/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionActor } from "../lib/api/actor";

const harness = vi.hoisted(() => ({
  db: undefined as unknown,
  registry: undefined as unknown,
  usableCapabilities: ["calendar"] as string[],
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock("../lib/db", () => ({ getDb: () => harness.db }));
vi.mock("../lib/connectors", async (importOriginal) => {
  const original = await importOriginal() as typeof import("../lib/connectors");
  return { ...original, getRegistry: () => harness.registry };
});
vi.mock("../lib/api/capability-settings", () => ({
  assertConnectorEntitlement: async () => harness.usableCapabilities,
  usableConnectorCapabilities: async () => harness.usableCapabilities,
}));
vi.mock("../lib/api/events", () => ({ recordEvent: async (_actor: unknown, event: Record<string, unknown>) => { harness.events.push(event); } }));

const { handleConnectorOAuth, hydrateOAuthInstallation, disconnectOAuthConnector } = await import("../lib/api/connector-oauth.ts");
const { apiError } = await import("../lib/api/http.ts");
const { openConnectorOAuthTokens, sealConnectorOAuthTokens } = await import("../lib/api/connector-secrets.ts");

const tenantId = "11111111-1111-4111-8111-111111111111";
const installationId = "22222222-2222-4222-8222-222222222222";
const encryptionKey = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const owner: SessionActor = {
  kind: "staff", userId: "owner-user", tenantId, role: "owner", permissions: permissionsForRole("owner"),
  locationIds: new Set(), allLocations: true, membershipId: "membership-a", organizationId: "33333333-3333-4333-8333-333333333333",
  email: "owner@example.test", name: "Owner", tenantName: "Tenant A", packKey: null,
};
let pglite: PGlite;
let exchangedVerifiers: Array<string | undefined>;
let refreshed: Array<string>;
let revoked: Array<string>;
let registry: ConnectorRegistry;
let definition: ConnectorDefinition;

async function invoke(request: Request, path: string[], actor: SessionActor): Promise<Response> {
  try { return (await handleConnectorOAuth(request, path, actor)) ?? Response.json({ ignored: true }); }
  catch (error) { return apiError(error); }
}

function makeDefinition(configured = true): ConnectorDefinition {
  return {
    manifest: {
      key: "test-calendar-oauth", name: "Test Calendar", description: "Calendar connection for tests.", provider: "Test Provider", icon: "plug",
      categories: ["calendar"], capabilities: ["calendar"], authType: "oauth2", requiredScopes: ["calendar.read"],
      environments: ["test"], setupComplexity: "easy", discoverableResources: [], webhookSupport: false, syncModes: [], version: "0.1.0",
      availability: "credentials_ready",
    },
    oauth: {
      authorizationEndpoint: "https://provider.example/authorize", clientId: "public-client-id", authorizationParams: { access_type: "offline" },
      scopesForCapabilities: (capabilities) => capabilities.includes("calendar") ? ["calendar.read", "calendar.write"] : [],
      isConfigured: () => configured,
      exchangeCode: async ({ codeVerifier }) => {
        exchangedVerifiers.push(codeVerifier);
        return { accessToken: "initial-access-secret", refreshToken: "initial-refresh-secret", expiresInSeconds: 3_600,
          grantedScopes: ["calendar.read", "calendar.write"], providerAccountId: "calendar-account-1" };
      },
      refreshTokens: async ({ refreshToken }) => {
        refreshed.push(refreshToken);
        return { accessToken: "rotated-access-secret", refreshToken: "rotated-refresh-secret", expiresInSeconds: 3_600 };
      },
      revoke: async ({ accessToken }) => { revoked.push(accessToken); },
      createScope: ({ tokens, enabledCapabilities }) => {
        expect(enabledCapabilities).toContain("calendar");
        expect(tokens.accessToken).toMatch(/access-secret/);
        return {};
      },
    },
  };
}

beforeEach(async () => {
  process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
  process.env.APP_BASE_URL = "https://app.example.test";
  harness.usableCapabilities = ["calendar"];
  harness.events = [];
  exchangedVerifiers = [];
  refreshed = [];
  revoked = [];
  registry = new ConnectorRegistry();
  definition = makeDefinition();
  registry.register(definition);
  harness.registry = registry;
  pglite = new PGlite();
  harness.db = drizzle(pglite);
  await pglite.exec(`
    CREATE TABLE connector_installations (
      id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      tenant_id uuid NOT NULL, organization_id uuid, connector_key text NOT NULL, status text NOT NULL, display_name text,
      credential_reference text, granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb, provider_account_id text,
      health_checked_at timestamptz, last_success_at timestamptz, last_error_code text, last_error_message text,
      settings jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE connector_oauth_transactions (
      state_hash text PRIMARY KEY, tenant_id uuid NOT NULL, actor_user_id text NOT NULL, connector_key text NOT NULL,
      connector_installation_id uuid NOT NULL, verifier_envelope text, expires_at timestamptz NOT NULL,
      consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
});

afterEach(async () => {
  await pglite.close();
  delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.APP_BASE_URL;
});

describe("credentials-ready OAuth lifecycle", () => {
  it("starts with trusted callback URL, random state and S256 PKCE, then consumes state once and stores only encrypted tokens", async () => {
    expect(registry.getOAuthAdapter("test-calendar-oauth")).toBeDefined();
    const started = await invoke(new Request("https://attacker.example/api/v1/connections/test-calendar-oauth/connect", { method: "POST" }),
      ["connections", "test-calendar-oauth", "connect"], owner);
    expect(started.status, await started.clone().text()).toBe(200);
    const startPayload = await started.json();
    const authorizationUrl = new URL(startPayload.item.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://provider.example");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("https://app.example.test/api/v1/connections/test-calendar-oauth/oauth/callback");
    const state = authorizationUrl.searchParams.get("state")!;
    expect(state).toHaveLength(43);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("scope")).toBe("calendar.read calendar.write");
    const transaction = await pglite.query<{ state_hash: string; verifier_envelope: string }>("SELECT state_hash, verifier_envelope FROM connector_oauth_transactions");
    expect(transaction.rows[0]!.state_hash).not.toBe(state);
    expect(transaction.rows[0]!.verifier_envelope).not.toContain(authorizationUrl.searchParams.get("code_challenge"));

    const completed = await invoke(new Request(`https://app.example.test/api/v1/connections/test-calendar-oauth/oauth/callback?state=${encodeURIComponent(state)}&code=one-time-code`),
      ["connections", "test-calendar-oauth", "oauth", "callback"], owner);
    expect(completed.status).toBe(303);
    expect(completed.headers.get("location")).toBe("https://app.example.test/app/connections?connection=test-calendar-oauth&status=connected");
    expect(exchangedVerifiers[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await pglite.query<{ id: string; status: string; credential_reference: string; granted_scopes: string[]; provider_account_id: string }>("SELECT * FROM connector_installations");
    const installation = rows.rows[0]!;
    expect(installation.status).toBe("connected");
    expect(installation.granted_scopes).toEqual(["calendar.read", "calendar.write"]);
    expect(installation.provider_account_id).toBe("calendar-account-1");
    expect(installation.credential_reference).not.toContain("initial-access-secret");
    expect(installation.credential_reference).not.toContain("initial-refresh-secret");
    expect(JSON.stringify(startPayload)).not.toContain("initial-access-secret");
    expect(JSON.stringify(harness.events)).not.toContain(state);
    expect(JSON.stringify(harness.events)).not.toContain("initial-access-secret");
    expect(registry.getInstallation(tenantId, "test-calendar-oauth").state).toBe("connected");

    const replay = await invoke(new Request(`https://app.example.test/api/v1/connections/test-calendar-oauth/oauth/callback?state=${encodeURIComponent(state)}&code=second-code`),
      ["connections", "test-calendar-oauth", "oauth", "callback"], owner);
    expect(replay.headers.get("location")).toContain("status=failed");
    expect(exchangedVerifiers).toHaveLength(1);
  });

  it("preserves the prior refresh token and scopes when reauthorization omits unchanged values", async () => {
    const startFirst = await invoke(new Request("https://app.example.test/start", { method: "POST" }), ["connections", "test-calendar-oauth", "connect"], owner);
    const firstState = new URL((await startFirst.json()).item.authorizationUrl).searchParams.get("state")!;
    await invoke(new Request(`https://app.example.test/callback?state=${firstState}&code=first-code`), ["connections", "test-calendar-oauth", "oauth", "callback"], owner);
    const [priorInstallation] = (await pglite.query<{ id: string; credential_reference: string }>("SELECT id, credential_reference FROM connector_installations")).rows;
    const priorTokens = openConnectorOAuthTokens(priorInstallation!.credential_reference, {
      tenantId, installationId: priorInstallation!.id, connectorKey: "test-calendar-oauth",
    }).tokens;
    expect(priorTokens.refreshToken).toBe("initial-refresh-secret");

    definition = { ...definition, oauth: { ...definition.oauth!, exchangeCode: async ({ codeVerifier }) => {
      exchangedVerifiers.push(codeVerifier);
      return { accessToken: "reauthorization-access-secret", expiresInSeconds: 3_600 };
    } } };
    registry = new ConnectorRegistry(); registry.register(definition); harness.registry = registry;
    const startAgain = await invoke(new Request("https://app.example.test/start-again", { method: "POST" }), ["connections", "test-calendar-oauth", "connect"], owner);
    const secondState = new URL((await startAgain.json()).item.authorizationUrl).searchParams.get("state")!;
    const reauthorized = await invoke(new Request(`https://app.example.test/callback?state=${secondState}&code=second-code`),
      ["connections", "test-calendar-oauth", "oauth", "callback"], owner);
    expect(reauthorized.headers.get("location")).toContain("status=connected");

    const [updated] = (await pglite.query<{ credential_reference: string }>("SELECT credential_reference FROM connector_installations WHERE id=$1", [priorInstallation!.id])).rows;
    const tokens = openConnectorOAuthTokens(updated!.credential_reference, {
      tenantId, installationId: priorInstallation!.id, connectorKey: "test-calendar-oauth",
    }).tokens;
    expect(tokens).toMatchObject({
      accessToken: "reauthorization-access-secret", refreshToken: priorTokens.refreshToken,
      grantedScopes: priorTokens.grantedScopes, providerAccountId: priorTokens.providerAccountId,
    });

    await pglite.query("UPDATE connector_installations SET credential_reference='tampered-envelope' WHERE id=$1", [priorInstallation!.id]);
    const tamperedStart = await invoke(new Request("https://app.example.test/start-again", { method: "POST" }), ["connections", "test-calendar-oauth", "connect"], owner);
    const tamperedState = new URL((await tamperedStart.json()).item.authorizationUrl).searchParams.get("state")!;
    const beforeExchangeCount = exchangedVerifiers.length;
    const failedClosed = await invoke(new Request(`https://app.example.test/callback?state=${tamperedState}&code=third-code`),
      ["connections", "test-calendar-oauth", "oauth", "callback"], owner);
    expect(failedClosed.headers.get("location")).toContain("status=failed");
    expect(exchangedVerifiers).toHaveLength(beforeExchangeCount);
  });

  it("rejects a different actor, oversized codes and missing application registration without a mock fallback", async () => {
    const started = await invoke(new Request("https://attacker.example/start", { method: "POST" }), ["connections", "test-calendar-oauth", "connect"], owner);
    const url = new URL((await started.json()).item.authorizationUrl);
    const state = url.searchParams.get("state")!;
    const otherOwner = { ...owner, userId: "different-owner" };
    const wrongActor = await invoke(new Request(`https://app.example.test/callback?state=${state}&code=one-time-code`),
      ["connections", "test-calendar-oauth", "oauth", "callback"], otherOwner);
    expect(wrongActor.headers.get("location")).toContain("status=failed");
    const oversized = await invoke(new Request(`https://app.example.test/callback?state=${state}&code=${"x".repeat(4097)}`),
      ["connections", "test-calendar-oauth", "oauth", "callback"], owner);
    expect(oversized.headers.get("location")).toContain("status=failed");
    await pglite.exec("UPDATE connector_oauth_transactions SET expires_at = now() - interval '1 second'");
    const expired = await invoke(new Request(`https://app.example.test/callback?state=${state}&code=one-time-code`),
      ["connections", "test-calendar-oauth", "oauth", "callback"], owner);
    expect(expired.headers.get("location")).toContain("status=failed");
    expect(exchangedVerifiers).toHaveLength(0);

    registry = new ConnectorRegistry();
    registry.register(makeDefinition(false));
    harness.registry = registry;
    const notConfigured = await invoke(new Request("https://app.example.test/start", { method: "POST" }), ["connections", "test-calendar-oauth", "connect"], owner);
    expect(notConfigured.status).toBe(503);
    const installations = await pglite.query<{ status: string }>("SELECT status FROM connector_installations");
    expect(installations.rows).toEqual([{ status: "authorizing" }]);
  });

  it("refreshes near-expiry tokens, persists rotation, and clears local data even when revocation fails", async () => {
    const started = await invoke(new Request("https://app.example.test/start", { method: "POST" }), ["connections", "test-calendar-oauth", "connect"], owner);
    const url = new URL((await started.json()).item.authorizationUrl);
    const state = url.searchParams.get("state")!;
    await invoke(new Request(`https://app.example.test/callback?state=${state}&code=code`), ["connections", "test-calendar-oauth", "oauth", "callback"], owner);
    const installation = await pglite.query<{ id: string; credential_reference: string }>("SELECT id, credential_reference FROM connector_installations");
    const persisted = sealConnectorOAuthTokens({
      accessToken: "initial-access-secret", refreshToken: "initial-refresh-secret", expiresAt: new Date(Date.now() + 30_000).toISOString(),
      grantedScopes: ["calendar.read", "calendar.write"], providerAccountId: "calendar-account-1",
    }, { tenantId, installationId: installation.rows[0]!.id, connectorKey: "test-calendar-oauth", actorUserId: owner.userId });
    await pglite.query("UPDATE connector_installations SET credential_reference=$1 WHERE id=$2", [persisted, installation.rows[0]!.id]);
    await hydrateOAuthInstallation(tenantId, installation.rows[0]!.id);
    expect(refreshed).toEqual(["initial-refresh-secret"]);
    const rotatedRow = await pglite.query<{ credential_reference: string }>("SELECT credential_reference FROM connector_installations WHERE id=$1", [installation.rows[0]!.id]);
    const rotated = openConnectorOAuthTokens(rotatedRow.rows[0]!.credential_reference, { tenantId, installationId: installation.rows[0]!.id, connectorKey: "test-calendar-oauth" });
    expect(rotated.tokens).toMatchObject({ accessToken: "rotated-access-secret", refreshToken: "rotated-refresh-secret", providerAccountId: "calendar-account-1" });

    const revoke = definition.oauth!.revoke!;
    const connectedEnvelope = rotatedRow.rows[0]!.credential_reference;
    const successfullyDisconnected = await disconnectOAuthConnector(tenantId, "test-calendar-oauth");
    expect(successfullyDisconnected.revocationStatus).toBe("revoked");
    expect(revoked).toEqual(["rotated-access-secret"]);
    await pglite.query("UPDATE connector_installations SET status='connected',credential_reference=$1 WHERE id=$2", [connectedEnvelope, installation.rows[0]!.id]);
    definition = { ...definition, oauth: { ...definition.oauth!, revoke: async () => { throw new Error("provider secret must not leak"); } } };
    registry = new ConnectorRegistry(); registry.register(definition); harness.registry = registry;
    const disconnected = await disconnectOAuthConnector(tenantId, "test-calendar-oauth");
    expect(disconnected.revocationStatus).toBe("failed");
    expect(revoke).toBeDefined();
    expect(registry.getInstallation(tenantId, "test-calendar-oauth").state).toBe("not_connected");
    const cleared = await pglite.query<{ credential_reference: string | null; status: string; granted_scopes: string[]; provider_account_id: string | null }>("SELECT credential_reference,status,granted_scopes,provider_account_id FROM connector_installations");
    expect(cleared.rows[0]).toEqual({ credential_reference: null, status: "not_connected", granted_scopes: [], provider_account_id: null });
  });

  it("rejects non-owners on start", async () => {
    const office = { ...owner, role: "office" as const, permissions: permissionsForRole("office") };
    const response = await invoke(new Request("https://app.example.test/start", { method: "POST" }), ["connections", "test-calendar-oauth", "connect"], office);
    expect(response.status).toBe(403);
  });
});
