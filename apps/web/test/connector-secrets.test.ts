import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/connectors", () => ({
  getRegistry: () => ({ listCatalog: () => [{ key: "test-oauth", availability: "credentials_ready", authType: "oauth2" }] }),
}));
import {
  beginConnectorOAuthTransaction, consumeConnectorOAuthTransaction, openConnectorCredentials,
  sealConnectorCredentials,
} from "../lib/api/connector-secrets.ts";

const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const binding = { tenantId: "11111111-1111-4111-8111-111111111111", installationId: "22222222-2222-4222-8222-222222222222", connectorKey: "test-oauth" };
let pglite: PGlite;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = key;
  pglite = new PGlite();
  db = drizzle(pglite);
  await pglite.exec(`
    CREATE TABLE connector_installations (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, connector_key text NOT NULL);
    CREATE TABLE connector_oauth_transactions (
      state_hash text PRIMARY KEY, tenant_id uuid NOT NULL, actor_user_id text NOT NULL, connector_key text NOT NULL,
      connector_installation_id uuid NOT NULL, verifier_envelope text, expires_at timestamptz NOT NULL,
      consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO connector_installations (id, tenant_id, connector_key)
      VALUES ('${binding.installationId}', '${binding.tenantId}', '${binding.connectorKey}');
  `);
});

afterEach(async () => { await pglite.close(); delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY; });

describe("connector secrets and OAuth transactions", () => {
  it("authenticates tenant, installation, and connector context and rejects tampering", () => {
    const envelope = sealConnectorCredentials({ apiKey: "sensitive-provider-key" }, binding);
    expect(envelope).not.toContain("sensitive-provider-key");
    expect(openConnectorCredentials(envelope, binding)).toEqual({ apiKey: "sensitive-provider-key" });
    expect(() => openConnectorCredentials(envelope, { ...binding, tenantId: "33333333-3333-4333-8333-333333333333" })).toThrow();
    expect(() => openConnectorCredentials(envelope, { ...binding, installationId: "44444444-4444-4444-8444-444444444444" })).toThrow();
    const parts = envelope.split(":");
    parts[4] = `${parts[4]![0] === "A" ? "B" : "A"}${parts[4]!.slice(1)}`;
    expect(() => openConnectorCredentials(parts.join(":"), binding)).toThrow();
  });

  it("stores only a hash of state, binds the transaction, and consumes PKCE once", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const actorUserId = "owner-user";
    const transaction = await beginConnectorOAuthTransaction(db as never, { ...binding, actorUserId }, now);
    expect(transaction.state).not.toBe(transaction.codeChallenge);
    const rows = await pglite.query<{ state_hash: string; verifier_envelope: string }>("SELECT state_hash, verifier_envelope FROM connector_oauth_transactions");
    expect(rows.rows[0]!.state_hash).not.toBe(transaction.state);
    expect(rows.rows[0]!.verifier_envelope).not.toContain(transaction.codeChallenge);
    expect(await consumeConnectorOAuthTransaction(db as never, { ...binding, actorUserId: "other-user", state: transaction.state }, now)).toBeNull();
    expect(await consumeConnectorOAuthTransaction(db as never, { ...binding, connectorKey: "other", actorUserId, state: transaction.state }, now)).toBeNull();
    const verifier = await consumeConnectorOAuthTransaction(db as never, { ...binding, actorUserId, state: transaction.state }, now);
    expect(verifier).toBeTruthy();
    expect(await consumeConnectorOAuthTransaction(db as never, { ...binding, actorUserId, state: transaction.state }, now)).toBeNull();
    const cleared = await pglite.query<{ verifier_envelope: string | null; consumed_at: string | null }>("SELECT verifier_envelope, consumed_at FROM connector_oauth_transactions");
    expect(cleared.rows[0]).toMatchObject({ verifier_envelope: null });
    expect(cleared.rows[0]!.consumed_at).toBeTruthy();
  });

  it("rejects expired state and installations owned by another tenant", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const transaction = await beginConnectorOAuthTransaction(db as never, { ...binding, actorUserId: "owner-user" }, now);
    expect(await consumeConnectorOAuthTransaction(db as never, { ...binding, actorUserId: "owner-user", state: transaction.state }, new Date(transaction.expiresAt.getTime() + 1))).toBeNull();
    await expect(beginConnectorOAuthTransaction(db as never, {
      ...binding, tenantId: "33333333-3333-4333-8333-333333333333", actorUserId: "owner-user",
    }, now)).rejects.toThrow("Connector installation not found");
  });
});
