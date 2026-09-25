import { and, eq } from "drizzle-orm";
import { connectorInstallations, type Database } from "@modular-crm/db";
import {
  ConnectorError, type ConnectorRegistry, normalizeOAuthTokenResponse, type OAuthCredentialSet,
  withOAuthProviderTimeout,
} from "@modular-crm/connectors";
import { openSecret, sealSecret } from "@modular-crm/domain";

type Installation = typeof connectorInstallations.$inferSelect;

function openInstallationSecret(row: Installation): { secret: string; actorUserId?: string } {
  const key = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  if (!key || !row.credentialReference) throw new ConnectorError("authorization_expired", "Reconnect messaging", false);
  try {
    const value: unknown = JSON.parse(openSecret(row.credentialReference, key));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid connector credential");
    const payload = value as Record<string, unknown>;
    if (payload.tenantId !== row.tenantId || payload.installationId !== row.id
      || payload.connectorKey !== row.connectorKey || typeof payload.secret !== "string") throw new Error("Connector credential binding mismatch");
    return { secret: payload.secret, ...(typeof payload.actorUserId === "string" ? { actorUserId: payload.actorUserId } : {}) };
  } catch {
    throw new ConnectorError("authorization_expired", "Reconnect messaging", false);
  }
}

function oauthTokens(secret: string): OAuthCredentialSet {
  try {
    const parsed: unknown = JSON.parse(secret);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid OAuth tokens");
    const value = parsed as Record<string, unknown>;
    if (typeof value.accessToken !== "string" || !value.accessToken || !Array.isArray(value.grantedScopes)
      || value.grantedScopes.some((scope) => typeof scope !== "string")
      || (value.refreshToken !== undefined && typeof value.refreshToken !== "string")
      || (value.expiresAt !== undefined && (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))))) {
      throw new Error("Invalid OAuth tokens");
    }
    return value as OAuthCredentialSet;
  } catch {
    throw new ConnectorError("authorization_expired", "Reconnect messaging", false);
  }
}

async function connectLive(db: Database, registry: ConnectorRegistry, row: Installation, channel: "email" | "sms"): Promise<void> {
  const manifest = registry.getDefinition(row.connectorKey)?.manifest;
  if (!manifest || !manifest.capabilities.includes(channel)) throw new ConnectorError("connector_unavailable", "Messaging service is unavailable", false);
  const opened = openInstallationSecret(row);
  if (manifest.authType === "api_key" || manifest.authType === "service_account") {
    let credentials: unknown;
    try { credentials = JSON.parse(opened.secret); } catch { throw new ConnectorError("authorization_expired", "Reconnect messaging", false); }
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) throw new ConnectorError("authorization_expired", "Reconnect messaging", false);
    registry.connectConfigured(row.tenantId, row.connectorKey, credentials as Record<string, string>);
    return;
  }
  if (manifest.authType !== "oauth2") throw new ConnectorError("connector_unavailable", "Messaging service is unavailable", false);
  const adapter = registry.getOAuthAdapter(row.connectorKey);
  if (!adapter) throw new ConnectorError("connector_unavailable", "Messaging service is unavailable", false);
  let tokens = oauthTokens(opened.secret);
  const now = new Date();
  if (tokens.expiresAt && Date.parse(tokens.expiresAt) <= now.getTime() + 5 * 60_000) {
    if (!adapter.refreshTokens || !tokens.refreshToken) throw new ConnectorError("authorization_expired", "Reconnect messaging", false);
    try {
      const refreshed = await withOAuthProviderTimeout((signal) => adapter.refreshTokens!({ refreshToken: tokens.refreshToken!, signal }));
      tokens = normalizeOAuthTokenResponse(refreshed, now, tokens);
    } catch { throw new ConnectorError("authorization_expired", "Reconnect messaging", false); }
    const key = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY!;
    const credentialReference = sealSecret(JSON.stringify({ tenantId: row.tenantId, installationId: row.id,
      connectorKey: row.connectorKey, actorUserId: opened.actorUserId, secret: JSON.stringify(tokens) }), key);
    await db.update(connectorInstallations).set({ credentialReference, grantedScopes: [...tokens.grantedScopes],
      settings: { ...(row.settings ?? {}), oauth: { expiresAt: tokens.expiresAt ?? null } }, updatedAt: now })
      .where(and(eq(connectorInstallations.id, row.id), eq(connectorInstallations.tenantId, row.tenantId),
        eq(connectorInstallations.credentialReference, row.credentialReference!)));
  }
  registry.installOAuthScope(row.tenantId, row.connectorKey,
    registry.createOAuthScope(row.tenantId, row.connectorKey, tokens, [channel]));
}

/** Rebuilds a send scope from persisted tenant installations, with local mock delivery only when no service is configured. */
export async function hydrateMessagingConnector(db: Database, registry: ConnectorRegistry, tenantId: string, channel: "email" | "sms"): Promise<{ installationId: string | null; mode: "mock" | "connected" }> {
  const rows = await db.select().from(connectorInstallations).where(eq(connectorInstallations.tenantId, tenantId));
  const relevant = rows.filter((row) => registry.getDefinition(row.connectorKey)?.manifest.capabilities.includes(channel));
  if (relevant.length === 0) {
    if (process.env.MOCK_CONNECTORS !== "true") throw new ConnectorError("not_connected", "Connect a messaging service", false);
    registry.connectMock(tenantId, "mock-communication");
    return { installationId: null, mode: "mock" };
  }
  const connected = relevant.filter((row) => row.status === "connected");
  const live = connected.filter((row) => registry.getDefinition(row.connectorKey)?.manifest.availability === "credentials_ready")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (live) {
    await connectLive(db, registry, live, channel);
    registry.setPrimary(tenantId, channel, live.connectorKey);
    return { installationId: live.id, mode: "connected" };
  }
  const mock = connected.find((row) => row.connectorKey === "mock-communication");
  if (mock) {
    registry.connectMock(tenantId, "mock-communication");
    registry.setPrimary(tenantId, channel, "mock-communication");
    return { installationId: mock.id, mode: "mock" };
  }
  throw new ConnectorError("not_connected", "Connect a messaging service", false);
}
