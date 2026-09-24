import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  buildOAuthAuthorizationUrl, normalizeOAuthTokenResponse, withOAuthProviderTimeout,
  type ConnectorManifest, type OAuthCredentialSet, type OAuthTokenResponse, type ScopedCapabilities,
} from "@modular-crm/connectors";
import { connectorInstallations, type Database } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { getRegistry } from "../connectors";
import { getDb } from "../db";
import type { SessionActor } from "./actor";
import { assertConnectorEntitlement, usableConnectorCapabilities } from "./capability-settings";
import { recordEvent } from "./events";
import { json } from "./http";
import {
  beginConnectorOAuthTransaction, consumeConnectorOAuthCallbackTransaction, openConnectorOAuthTokens,
  sealConnectorOAuthTokens,
} from "./connector-secrets";

const SAFE_CALLBACK_STATUSES = new Set(["connected", "denied", "failed"]);
const REFRESH_EARLY_MS = 5 * 60 * 1_000;
const refreshInFlight = new Map<string, Promise<void>>();

function assertOwner(actor: SessionActor): asserts actor is SessionActor & { kind: "staff"; membershipId: string; organizationId: string } {
  requirePermission(actor, "connectors.configure");
  if (actor.kind !== "staff" || actor.role !== "owner" || !actor.membershipId || !actor.organizationId) {
    throw new DomainError("FORBIDDEN", "Only a business owner can connect this service.", 403);
  }
}

function trustedBaseUrl(): URL {
  const configured = process.env.APP_BASE_URL;
  if (!configured) throw new DomainError("EXTERNAL_SERVICE_ERROR", "Connection setup is not configured yet.", 503);
  let base: URL;
  try { base = new URL(configured); } catch { throw new DomainError("EXTERNAL_SERVICE_ERROR", "Connection setup is not configured yet.", 503); }
  const localHttp = base.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(base.hostname);
  if ((!localHttp && base.protocol !== "https:") || base.username || base.password || base.search || base.hash
    || (base.pathname !== "/" && base.pathname !== "")) {
    throw new DomainError("EXTERNAL_SERVICE_ERROR", "Connection setup is not configured yet.", 503);
  }
  return base;
}

function callbackUri(base: URL, connectorKey: string): string {
  return new URL(`/api/v1/connections/${encodeURIComponent(connectorKey)}/oauth/callback`, base).toString();
}

function appStatusRedirect(base: URL, connectorKey: string, status: string): Response {
  const safeStatus = SAFE_CALLBACK_STATUSES.has(status) ? status : "failed";
  const target = new URL("/app/connections", base);
  target.searchParams.set("connection", connectorKey);
  target.searchParams.set("status", safeStatus);
  return new Response(null, { status: 303, headers: {
    location: target.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer",
  } });
}

function getOAuthManifest(connectorKey: string): ConnectorManifest | undefined {
  return getRegistry().listCatalog().find((manifest) => manifest.key === connectorKey && manifest.authType === "oauth2"
    && manifest.availability === "credentials_ready");
}

function safeTokenResponse(response: OAuthTokenResponse, now: Date, prior?: OAuthCredentialSet): OAuthCredentialSet {
  try { return normalizeOAuthTokenResponse(response, now, prior); }
  catch { throw new DomainError("EXTERNAL_SERVICE_ERROR", "The service returned an invalid connection response.", 502); }
}

function safeProviderFailure(): DomainError {
  return new DomainError("EXTERNAL_SERVICE_ERROR", "The service could not complete the connection. Try again.", 502);
}

async function findOrCreateInstallation(tenantId: string, manifest: ConnectorManifest) {
  const db = getDb();
  const [existing] = await db.select().from(connectorInstallations)
    .where(and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.connectorKey, manifest.key)))
    .orderBy(desc(connectorInstallations.createdAt)).limit(1);
  if (existing) return existing;
  const id = randomUUID();
  const [created] = await db.insert(connectorInstallations).values({
    id, tenantId, connectorKey: manifest.key, displayName: manifest.name, status: "not_connected", settings: {},
  }).returning();
  if (!created) throw new DomainError("EXTERNAL_SERVICE_ERROR", "The connection could not be started.", 503);
  return created;
}

async function startOAuth(request: Request, connectorKey: string, actor: SessionActor): Promise<Response> {
  assertOwner(actor);
  const registry = getRegistry();
  const manifest = getOAuthManifest(connectorKey);
  if (!manifest) throw new DomainError("NOT_FOUND", "Connection is not available yet.", 404);
  const adapter = registry.getOAuthAdapter(connectorKey);
  if (!adapter) throw new DomainError("EXTERNAL_SERVICE_ERROR", "This service has not finished connection setup yet.", 503);
  const enabledCapabilities = await assertConnectorEntitlement(actor.tenantId, manifest);
  const base = trustedBaseUrl();
  const redirectUri = callbackUri(base, connectorKey);
  const installation = await findOrCreateInstallation(actor.tenantId, manifest);
  const now = new Date();
  let transaction: Awaited<ReturnType<typeof beginConnectorOAuthTransaction>>;
  let authorizationUrl: string;
  try {
    transaction = await beginConnectorOAuthTransaction(getDb(), {
      tenantId: actor.tenantId, installationId: installation.id, connectorKey, actorUserId: actor.userId,
    }, now, { supportsPkce: adapter.supportsPkce !== false, registry });
    const scopes = adapter.scopesForCapabilities?.(enabledCapabilities) ?? manifest.requiredScopes;
    if (!Array.isArray(scopes) || scopes.length > 100 || scopes.some((scope) => typeof scope !== "string" || !scope.trim() || scope.length > 200)) {
      throw new Error("Invalid OAuth scope configuration");
    }
    authorizationUrl = buildOAuthAuthorizationUrl(adapter, {
      state: transaction.state, redirectUri, scopes,
      ...(transaction.codeChallenge ? { codeChallenge: transaction.codeChallenge } : {}),
    });
    if (authorizationUrl.length > 8_000) throw new Error("OAuth authorization URL is too large");
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("EXTERNAL_SERVICE_ERROR", "This service has not finished connection setup yet.", 503);
  }
  await getDb().update(connectorInstallations).set({ status: "authorizing", lastErrorCode: null, lastErrorMessage: null, updatedAt: now })
    .where(and(eq(connectorInstallations.id, installation.id), eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey)));
  await recordEvent(actor, {
    type: "connector.authorization_started", entityType: "connector_installation", entityId: installation.id,
    payload: { connectorKey }, auditAction: "connector.oauth_start",
    before: { status: installation.status }, after: { status: "authorizing" },
  });
  void request;
  return json({ item: { key: connectorKey, status: "authorizing", authorizationUrl } });
}

function singleQueryParam(url: URL, name: string, maxLength: number): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1 || values[0]!.length < 1 || values[0]!.length > maxLength) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(values[0]!)) return undefined;
  return values[0];
}

async function finishOAuth(request: Request, connectorKey: string, actor: SessionActor): Promise<Response> {
  const base = trustedBaseUrl();
  try {
    assertOwner(actor);
    const manifest = getOAuthManifest(connectorKey);
    if (!manifest) return appStatusRedirect(base, connectorKey, "failed");
    const registry = getRegistry();
    const adapter = registry.getOAuthAdapter(connectorKey);
    if (!adapter) return appStatusRedirect(base, connectorKey, "failed");
    const url = new URL(request.url);
    const state = singleQueryParam(url, "state", 128);
    const code = singleQueryParam(url, "code", 4_096);
    const providerError = singleQueryParam(url, "error", 128);
    const hasMalformedDuplicate = ["state", "code", "error"].some((key) => url.searchParams.getAll(key).length > 1);
    if (!state || hasMalformedDuplicate || (!!providerError === !!code) || (providerError && !/^[a-zA-Z0-9_.-]+$/.test(providerError))) {
      return appStatusRedirect(base, connectorKey, "failed");
    }
    const transaction = await consumeConnectorOAuthCallbackTransaction(getDb(), {
      tenantId: actor.tenantId, actorUserId: actor.userId, connectorKey, state,
    });
    if (!transaction) return appStatusRedirect(base, connectorKey, "failed");
    const [boundInstallation] = await getDb().select({ id: connectorInstallations.id, credentialReference: connectorInstallations.credentialReference }).from(connectorInstallations)
      .where(and(eq(connectorInstallations.id, transaction.installationId), eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey))).limit(1);
    if (!boundInstallation) return appStatusRedirect(base, connectorKey, "failed");
    if (providerError) {
      await getDb().update(connectorInstallations).set({ status: "not_connected", lastErrorCode: null, lastErrorMessage: null, updatedAt: new Date() })
        .where(and(eq(connectorInstallations.id, transaction.installationId), eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey)));
      return appStatusRedirect(base, connectorKey, "denied");
    }
    const enabledCapabilities = await assertConnectorEntitlement(actor.tenantId, manifest);
    const now = new Date();
    let priorTokens: OAuthCredentialSet | undefined;
    if (boundInstallation.credentialReference) {
      // Reauthorization may omit a rotating refresh token or scopes when the provider does not change them.
      // The reader verifies tenant, installation, connector, and the actor binding sealed with the envelope.
      priorTokens = openConnectorOAuthTokens(boundInstallation.credentialReference, {
        tenantId: actor.tenantId, installationId: transaction.installationId, connectorKey,
      }).tokens;
    }
    const response = await withOAuthProviderTimeout((signal) => adapter.exchangeCode({
      code: code!, redirectUri: callbackUri(base, connectorKey), ...(transaction.codeVerifier ? { codeVerifier: transaction.codeVerifier } : {}), signal,
    }));
    const tokens = safeTokenResponse(response, now, priorTokens);
    const capabilities = registry.createOAuthScope(actor.tenantId, connectorKey, tokens, enabledCapabilities);
    const db = getDb();
    const credentialReference = sealConnectorOAuthTokens(tokens, {
      tenantId: actor.tenantId, installationId: transaction.installationId, connectorKey, actorUserId: actor.userId,
    });
    const [updated] = await db.update(connectorInstallations).set({
      credentialReference, status: "connected", grantedScopes: [...tokens.grantedScopes],
      providerAccountId: tokens.providerAccountId ?? null, healthCheckedAt: now, lastSuccessAt: now,
      lastErrorCode: null, lastErrorMessage: null,
      settings: { oauth: { expiresAt: tokens.expiresAt ?? null } }, updatedAt: now,
    }).where(and(eq(connectorInstallations.id, transaction.installationId), eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey))).returning({ id: connectorInstallations.id });
    if (!updated) return appStatusRedirect(base, connectorKey, "failed");
    registry.installOAuthScope(actor.tenantId, connectorKey, capabilities);
    await recordEvent(actor, {
      type: "connector.connected", entityType: "connector_installation", entityId: updated.id,
      payload: { connectorKey, mode: "oauth", grantedScopeCount: tokens.grantedScopes.length },
      auditAction: "connector.oauth_connected", after: { status: "connected" },
    });
    return appStatusRedirect(base, connectorKey, "connected");
  } catch {
    return appStatusRedirect(base, connectorKey, "failed");
  }
}

/** Handles only the shared OAuth route contract. Provider implementations stay behind the registry adapter. */
export async function handleConnectorOAuth(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "connections" || !path[1]) return null;
  if (path.length === 3 && ["connect", "reconnect"].includes(path[2]!) && request.method === "POST") {
    const manifest = getOAuthManifest(path[1]!);
    return manifest ? startOAuth(request, path[1]!, actor) : null;
  }
  if (path.length === 4 && path[2] === "oauth" && path[3] === "callback") {
    if (request.method !== "GET") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    const manifest = getOAuthManifest(path[1]!);
    return manifest ? finishOAuth(request, path[1]!, actor) : null;
  }
  return null;
}

function withOAuthMetadata(tokens: OAuthCredentialSet, response: OAuthTokenResponse, now: Date): OAuthCredentialSet {
  return normalizeOAuthTokenResponse(response, now, tokens);
}

async function hydrateOAuthInstallationOnce(tenantId: string, installationId: string): Promise<void> {
  const db = getDb();
  const [installation] = await db.select().from(connectorInstallations)
    .where(and(eq(connectorInstallations.id, installationId), eq(connectorInstallations.tenantId, tenantId))).limit(1);
  if (!installation || installation.status !== "connected" || !installation.credentialReference) return;
  const registry = getRegistry();
  const manifest = getOAuthManifest(installation.connectorKey);
  const adapter = registry.getOAuthAdapter(installation.connectorKey);
  if (!manifest || !adapter) {
    registry.disconnect(tenantId, installation.connectorKey);
    await db.update(connectorInstallations).set({ status: "needs_attention", lastErrorCode: "connector_unavailable", updatedAt: new Date() })
      .where(and(eq(connectorInstallations.id, installation.id), eq(connectorInstallations.tenantId, tenantId)));
    return;
  }
  let opened: ReturnType<typeof openConnectorOAuthTokens>;
  try { opened = openConnectorOAuthTokens(installation.credentialReference, { tenantId, installationId: installation.id, connectorKey: installation.connectorKey }); }
  catch {
    registry.disconnect(tenantId, installation.connectorKey);
    await db.update(connectorInstallations).set({ status: "needs_attention", lastErrorCode: "credential_unavailable", updatedAt: new Date() })
      .where(and(eq(connectorInstallations.id, installation.id), eq(connectorInstallations.tenantId, tenantId)));
    return;
  }
  const now = new Date();
  let tokens = opened.tokens;
  let changedTokens = false;
  if (tokens.expiresAt && Date.parse(tokens.expiresAt) <= now.getTime() + (adapter.refreshTokens && tokens.refreshToken ? REFRESH_EARLY_MS : 0)) {
    if (Date.parse(tokens.expiresAt) <= now.getTime() && (!adapter.refreshTokens || !tokens.refreshToken)) {
      registry.disconnect(tenantId, installation.connectorKey);
      await db.update(connectorInstallations).set({ status: "needs_attention", lastErrorCode: "authorization_expired", updatedAt: now })
        .where(and(eq(connectorInstallations.id, installation.id), eq(connectorInstallations.tenantId, tenantId)));
      return;
    }
    if (adapter.refreshTokens && tokens.refreshToken) {
      try {
        const response = await withOAuthProviderTimeout((signal) => adapter.refreshTokens!({ refreshToken: tokens.refreshToken!, signal }));
        tokens = withOAuthMetadata(tokens, response, now);
        changedTokens = true;
      } catch {
        registry.disconnect(tenantId, installation.connectorKey);
        await db.update(connectorInstallations).set({ status: "needs_attention", lastErrorCode: "authorization_expired", lastErrorMessage: "Reconnect this service to continue.", updatedAt: now })
          .where(and(eq(connectorInstallations.id, installation.id), eq(connectorInstallations.tenantId, tenantId)));
        return;
      }
    }
  }
  const enabledCapabilities = await usableConnectorCapabilities(tenantId, manifest);
  if (enabledCapabilities.length === 0) {
    registry.disconnect(tenantId, installation.connectorKey);
    return;
  }
  let capabilities: ScopedCapabilities;
  try { capabilities = registry.createOAuthScope(tenantId, installation.connectorKey, tokens, enabledCapabilities); }
  catch {
    registry.disconnect(tenantId, installation.connectorKey);
    await db.update(connectorInstallations).set({ status: "needs_attention", lastErrorCode: "provider_error", lastErrorMessage: "Reconnect this service to continue.", updatedAt: now })
      .where(and(eq(connectorInstallations.id, installation.id), eq(connectorInstallations.tenantId, tenantId)));
    return;
  }
  if (changedTokens) {
    const credentialReference = sealConnectorOAuthTokens(tokens, {
      tenantId, installationId: installation.id, connectorKey: installation.connectorKey, actorUserId: opened.actorUserId,
    });
    await db.update(connectorInstallations).set({
      credentialReference, grantedScopes: [...tokens.grantedScopes], providerAccountId: tokens.providerAccountId ?? null,
      settings: { ...(installation.settings ?? {}), oauth: { expiresAt: tokens.expiresAt ?? null } }, lastSuccessAt: now,
      healthCheckedAt: now, lastErrorCode: null, lastErrorMessage: null, updatedAt: now,
    }).where(and(eq(connectorInstallations.id, installation.id), eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.credentialReference, installation.credentialReference)));
  }
  registry.installOAuthScope(tenantId, installation.connectorKey, capabilities);
}

/** Rebuilds the live scope at server use time and refreshes/rotates expiring tokens server-side. */
export async function hydrateOAuthInstallation(tenantId: string, installationId: string): Promise<void> {
  const key = `${tenantId}:${installationId}`;
  const existing = refreshInFlight.get(key);
  if (existing) return existing;
  const pending = hydrateOAuthInstallationOnce(tenantId, installationId).finally(() => refreshInFlight.delete(key));
  refreshInFlight.set(key, pending);
  return pending;
}

export type OAuthDisconnectPreparation = {
  installations: typeof connectorInstallations.$inferSelect[];
  revocationStatus: "revoked" | "failed" | "not_supported";
};

/** Revocation is best effort and external; it must finish before the local transaction begins. */
export async function prepareOAuthDisconnect(tenantId: string, connectorKey: string): Promise<OAuthDisconnectPreparation> {
  const installations = await getDb().select().from(connectorInstallations)
    .where(and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.connectorKey, connectorKey)));
  const adapter = getRegistry().getOAuthAdapter(connectorKey);
  let revocationStatus: "revoked" | "failed" | "not_supported" = adapter?.revoke ? "revoked" : "not_supported";
  if (adapter?.revoke) {
    for (const installation of installations) {
      if (!installation.credentialReference) continue;
      try {
        const { tokens } = openConnectorOAuthTokens(installation.credentialReference, { tenantId, installationId: installation.id, connectorKey });
        await withOAuthProviderTimeout((signal) => adapter.revoke!({ accessToken: tokens.accessToken, ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}), signal }));
      } catch { revocationStatus = "failed"; }
    }
  }
  return { installations, revocationStatus };
}

/** Persist every prepared disconnect or roll the whole transaction back on any stale snapshot. */
export async function persistOAuthDisconnect(
  writer: Pick<Database, "update" | "insert">,
  actor: SessionActor,
  connectorKey: string,
  prepared: OAuthDisconnectPreparation,
): Promise<typeof connectorInstallations.$inferSelect[]> {
  const changed: typeof connectorInstallations.$inferSelect[] = [];
  for (const before of prepared.installations) {
    const credentialCondition = before.credentialReference
      ? eq(connectorInstallations.credentialReference, before.credentialReference)
      : isNull(connectorInstallations.credentialReference);
    const [updated] = await writer.update(connectorInstallations).set({
      status: "not_connected", credentialReference: null, grantedScopes: [], providerAccountId: null,
      lastErrorCode: prepared.revocationStatus === "failed" ? "revocation_failed" : null,
      lastErrorMessage: null, updatedAt: new Date(),
    }).where(and(
      eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.id, before.id),
      eq(connectorInstallations.connectorKey, connectorKey), credentialCondition,
    )).returning();
    if (!updated) throw new DomainError("CONFLICT", "The connection changed while it was being disconnected. Try again.", 409);
    await recordEvent(actor, {
      type: "connector.disconnected", entityType: "connector_installation", entityId: updated.id,
      payload: { connectorKey, mode: "live", health: "unavailable", revocationStatus: prepared.revocationStatus },
      auditAction: "connector.disconnect", before: { status: before.status }, after: { status: updated.status, mode: "live" },
    }, writer);
    changed.push(updated);
  }
  return changed;
}

/** Revokes when supported, then clears local tokens while retaining the installation and history. */
export async function disconnectOAuthConnector(tenantId: string, connectorKey: string) {
  const { revocationStatus } = await prepareOAuthDisconnect(tenantId, connectorKey);
  const db = getDb();
  await db.update(connectorInstallations).set({
    status: "not_connected", credentialReference: null, grantedScopes: [], providerAccountId: null,
    lastErrorCode: revocationStatus === "failed" ? "revocation_failed" : null,
    lastErrorMessage: null, updatedAt: new Date(),
  }).where(and(eq(connectorInstallations.tenantId, tenantId), eq(connectorInstallations.connectorKey, connectorKey)));
  const state = getRegistry().disconnect(tenantId, connectorKey);
  return { ...state, revocationStatus };
}
