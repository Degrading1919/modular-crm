import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";

const harness = vi.hoisted(() => ({
  db: undefined as unknown,
  realGetRegistry: undefined as (() => { listCatalog: () => Array<Record<string, unknown>>; register: (definition: unknown) => void }) | undefined,
  events: [] as Array<Record<string, unknown>>,
  manifests: [] as Array<Record<string, unknown>>,
}));

vi.mock("../lib/db", () => ({ getDb: () => harness.db }));
vi.mock("../lib/connectors", async (importOriginal) => {
  const original = await importOriginal() as typeof import("../lib/connectors");
  harness.realGetRegistry = original.getRegistry as unknown as typeof harness.realGetRegistry;
  return { ...original, getRegistry: () => ({
    listCatalog: (capability?: string) => harness.manifests.filter((manifest) => !capability || (manifest.capabilities as string[]).includes(capability)),
    healthCheck: () => ({ state: "not_connected", health: "unavailable" }),
    disconnect: () => ({ state: "not_connected", health: "unavailable" }),
    connectMock: () => ({ state: "connected", health: "healthy" }),
  }) };
});
vi.mock("../lib/api/events", () => ({ recordEvent: async (_actor: unknown, event: Record<string, unknown>) => { harness.events.push(event); } }));

const { handleConnectorCredentials } = await import("../lib/api/connector-credentials.ts");
const { handleCapabilitySettings } = await import("../lib/api/capability-settings.ts");
const { setConnectorState } = await import("../lib/connectors.ts");
const { apiError } = await import("../lib/api/http.ts");
const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const owner: SessionActor = {
  kind: "staff", userId: "owner-user", tenantId: "11111111-1111-4111-8111-111111111111", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set(), allLocations: true, membershipId: "membership-a",
  organizationId: "33333333-3333-4333-8333-333333333333", email: "owner@example.test", name: "Owner", tenantName: "Tenant A", packKey: null,
};
let pglite: PGlite;

async function invoke(request: Request, path: string[], actor: SessionActor): Promise<Response> {
  try { return (await handleConnectorCredentials(request, path, actor))!; }
  catch (error) { return apiError(error); }
}

beforeEach(async () => {
  process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = key;
  harness.events = [];
  harness.manifests = [
    { key: "test-real", name: "Test Real", authType: "api_key", availability: "credentials_ready", credentialSetup: true, capabilities: ["payments"],
      credentialFields: [{ key: "apiKey", label: "API key", inputType: "password", maxLength: 100 }] },
    { key: "test-planned", name: "Test Planned", authType: "api_key", availability: "planned", credentialSetup: true, capabilities: ["payments"] },
    { key: "test-mock", name: "Test Mock", authType: "local_mock", availability: "mock_complete", capabilities: ["payments"] },
  ];
  pglite = new PGlite();
  harness.db = drizzle(pglite);
  await pglite.exec(`CREATE TABLE connector_installations (
    id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    tenant_id uuid NOT NULL, organization_id uuid, connector_key text NOT NULL, status text NOT NULL, display_name text,
    credential_reference text, granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb, provider_account_id text,
    health_checked_at timestamptz, last_success_at timestamptz, last_error_code text, last_error_message text,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb
  );`);
});

afterEach(async () => { await pglite.close(); delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY; });

describe("owner connector credential endpoint", () => {
  it("stores only encrypted tenant-bound data and never returns or audits the secret", async () => {
    const secret = "a-provider-api-key-that-must-stay-server-side";
    const response = await invoke(new Request("https://crm.example/api/v1/connections/test-real/credentials", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credentials: { apiKey: secret } }),
    }), ["connections", "test-real", "credentials"], owner);
    expect(response?.status).toBe(201);
    const json = await response!.json();
    const storedResult = await pglite.query<{ id: string; tenant_id: string; credential_reference: string }>("SELECT id, tenant_id, credential_reference FROM connector_installations");
    const stored = storedResult.rows[0]!;
    expect(stored!.tenant_id).toBe(owner.tenantId);
    expect(stored!.credential_reference).not.toContain(secret);
    expect(JSON.stringify(json)).not.toContain(secret);
    expect(JSON.stringify(harness.events)).not.toContain(secret);
    expect(json.item).toMatchObject({ installationId: stored!.id, connectorKey: "test-real", credentialConfigured: true });
  });

  it("rejects cross-tenant installation IDs, mock/planned providers, and non-owner actors", async () => {
    const otherId = "22222222-2222-4222-8222-222222222222";
    await pglite.query(`INSERT INTO connector_installations (id, tenant_id, connector_key, status, credential_reference)
      VALUES ($1, $2, 'test-real', 'connected', 'prior')`, [otherId, "44444444-4444-4444-8444-444444444444"]);
    const request = (keyName: string) => new Request(`https://crm.example/api/v1/connections/${keyName}/credentials`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentials: { apiKey: "new-secret" }, installationId: otherId }),
    });
    const crossTenant = await invoke(request("test-real"), ["connections", "test-real", "credentials"], owner);
    expect(crossTenant?.status).toBe(404);
    for (const connectorKey of ["test-planned", "test-mock"]) {
      const rejected = await invoke(request(connectorKey), ["connections", connectorKey, "credentials"], owner);
      expect(rejected?.status).toBe(404);
    }
    const office = { ...owner, role: "office" as const, permissions: permissionsForRole("office") };
    const denied = await invoke(request("test-real"), ["connections", "test-real", "credentials"], office);
    expect(denied?.status).toBe(403);
  });

  it("accepts only manifest-declared credential keys and field limits", async () => {
    const makeRequest = (credentials: Record<string, string>) => new Request("https://crm.example/api/v1/connections/test-real/credentials", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credentials }),
    });
    expect((await invoke(makeRequest({ accessToken: "wrong-field" }), ["connections", "test-real", "credentials"], owner)).status).toBe(422);
    expect((await invoke(makeRequest({ apiKey: "x".repeat(101) }), ["connections", "test-real", "credentials"], owner)).status).toBe(422);
    const rows = await pglite.query("SELECT id FROM connector_installations");
    expect(rows.rows).toHaveLength(0);
  });

  it("removes the secret while retaining the installation row", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    await pglite.query(`INSERT INTO connector_installations (id, tenant_id, connector_key, status, credential_reference)
      VALUES ($1, $2, 'test-real', 'connected', 'encrypted-value')`, [id, owner.tenantId]);
    const response = await invoke(new Request(`https://crm.example/api/v1/connections/test-real/credentials?installationId=${id}`, {
      method: "DELETE",
    }), ["connections", "test-real", "credentials"], owner);
    expect(response?.status).toBe(200);
    const rows = await pglite.query<{ credential_reference: string | null; status: string }>("SELECT credential_reference, status FROM connector_installations WHERE id = $1", [id]);
    expect(rows.rows).toEqual([{ credential_reference: null, status: "not_connected" }]);
  });

  it("disconnects by clearing credentials and exposes only safe configuration state", async () => {
    const appRegistry = harness.realGetRegistry!();
    if (!appRegistry.listCatalog().some((manifest) => manifest.key === "test-real")) {
      const base = appRegistry.listCatalog()[0]!;
      appRegistry.register({ manifest: { ...base, key: "test-real", authType: "api_key", availability: "credentials_ready",
        credentialSetup: true, credentialFields: [{ key: "apiKey", label: "API key", inputType: "password", maxLength: 100 }] } });
    }
    const id = "66666666-6666-4666-8666-666666666666";
    await pglite.query(`INSERT INTO connector_installations (id, tenant_id, connector_key, status, credential_reference)
      VALUES ($1, $2, 'test-real', 'connected', 'encrypted-value')`, [id, owner.tenantId]);
    await setConnectorState(owner.tenantId, "test-real", false);
    const rows = await pglite.query<{ credential_reference: string | null; status: string }>("SELECT credential_reference, status FROM connector_installations WHERE id = $1", [id]);
    expect(rows.rows).toEqual([{ credential_reference: null, status: "not_connected" }]);
    const response = await handleCapabilitySettings(new Request("https://crm.example/api/v1/connections"), ["connections"], owner);
    const payload = await response!.json();
    const item = payload.items.find((connection: Record<string, unknown>) => connection.key === "test-real");
    expect(item).toMatchObject({ status: "not_connected", mode: "live_setup", credentialConfigured: false,
      credentialFields: [{ key: "apiKey", label: "API key", inputType: "password", maxLength: 100 }] });
    expect(JSON.stringify(item)).not.toContain("encrypted-value");
  });
});
