import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { connectorInstallations, connectorOAuthTransactions } from "@modular-crm/db";
import { openSecret, sealSecret } from "@modular-crm/domain";
import type { OAuthCredentialSet } from "@modular-crm/connectors";
import { getRegistry } from "../connectors";
import type { getDb } from "../db";

export const CONNECTOR_CREDENTIAL_MAX_LENGTH = 8_192;
export const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1_000;

type SecretBinding = { tenantId: string; installationId: string; connectorKey: string; actorUserId?: string };

function encryptionKey(): string {
  const key = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new Error("CONNECTOR_CREDENTIAL_ENCRYPTION_KEY is required for connector credentials");
  return key;
}

function sealBoundSecret(secret: string, binding: SecretBinding): string {
  return sealSecret(JSON.stringify({ ...binding, secret }), encryptionKey());
}

function openBoundPayload(envelope: string): Record<string, unknown> {
  const value: unknown = JSON.parse(openSecret(envelope, encryptionKey()));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid bound secret payload");
  return value as Record<string, unknown>;
}

function assertSecretBinding(payload: Record<string, unknown>, binding: SecretBinding): string {
  if (payload.tenantId !== binding.tenantId || payload.installationId !== binding.installationId
    || payload.connectorKey !== binding.connectorKey || (binding.actorUserId !== undefined && payload.actorUserId !== binding.actorUserId)
    || typeof payload.secret !== "string") {
    throw new Error("Secret binding does not match");
  }
  return payload.secret;
}

function openBoundSecret(envelope: string, binding: SecretBinding): string {
  return assertSecretBinding(openBoundPayload(envelope), binding);
}

/** Server-only credential reader. Never pass its result to a response, audit, or log. */
export function openConnectorCredential(envelope: string, binding: SecretBinding): string {
  return openBoundSecret(envelope, binding);
}

/** Server-only reader for manifest-keyed API-key/service-account fields. */
export function openConnectorCredentials(envelope: string, binding: SecretBinding): Record<string, string> {
  const value: unknown = JSON.parse(openBoundSecret(envelope, binding));
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.values(value).some((field) => typeof field !== "string")) throw new Error("Invalid connector credential fields");
  return value as Record<string, string>;
}

/** Server-only durable OAuth transaction creator; callers receive state and the PKCE challenge only. */
export async function beginConnectorOAuthTransaction(
  db: Pick<ReturnType<typeof getDb>, "select" | "insert">,
  binding: SecretBinding & { actorUserId: string },
  now = new Date(),
  options: { supportsPkce?: boolean; registry?: Pick<ReturnType<typeof getRegistry>, "listCatalog"> } = {},
): Promise<{ state: string; codeChallenge?: string; expiresAt: Date }> {
  const manifest = (options.registry ?? getRegistry()).listCatalog().find((candidate) => candidate.key === binding.connectorKey);
  if (!manifest || manifest.availability !== "credentials_ready" || manifest.authType !== "oauth2") {
    throw new Error("OAuth transactions are available only to credentials-ready OAuth connectors");
  }
  const [installation] = await db.select({ id: connectorInstallations.id, connectorKey: connectorInstallations.connectorKey })
    .from(connectorInstallations).where(and(eq(connectorInstallations.id, binding.installationId),
      eq(connectorInstallations.tenantId, binding.tenantId), eq(connectorInstallations.connectorKey, binding.connectorKey))).limit(1);
  if (!installation) throw new Error("Connector installation not found");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + OAUTH_TRANSACTION_TTL_MS);
  const supportsPkce = options.supportsPkce !== false;
  await db.insert(connectorOAuthTransactions).values({
    stateHash: createHash("sha256").update(state).digest("base64url"), tenantId: binding.tenantId,
    actorUserId: binding.actorUserId, connectorKey: binding.connectorKey,
    connectorInstallationId: binding.installationId,
    verifierEnvelope: supportsPkce ? sealBoundSecret(verifier, { ...binding, actorUserId: binding.actorUserId }) : null, expiresAt,
  });
  return { state, ...(supportsPkce ? { codeChallenge: createHash("sha256").update(verifier).digest("base64url") } : {}), expiresAt };
}

/** Atomically consumes callback state and reveals its bound installation only after tenant/actor/provider checks. */
export async function consumeConnectorOAuthCallbackTransaction(
  db: Pick<ReturnType<typeof getDb>, "select" | "update">,
  input: Omit<SecretBinding, "installationId"> & { actorUserId: string; state: string },
  now = new Date(),
): Promise<{ installationId: string; codeVerifier?: string } | null> {
  if (input.state.length < 32 || input.state.length > 128) return null;
  const stateHash = createHash("sha256").update(input.state).digest("base64url");
  const conditions = and(eq(connectorOAuthTransactions.stateHash, stateHash), eq(connectorOAuthTransactions.tenantId, input.tenantId),
    eq(connectorOAuthTransactions.actorUserId, input.actorUserId), eq(connectorOAuthTransactions.connectorKey, input.connectorKey),
    isNull(connectorOAuthTransactions.consumedAt), gt(connectorOAuthTransactions.expiresAt, now));
  const [transaction] = await db.select().from(connectorOAuthTransactions).where(conditions).limit(1);
  if (!transaction) return null;
  const [claimed] = await db.update(connectorOAuthTransactions)
    .set({ consumedAt: now, verifierEnvelope: null })
    .where(conditions).returning({ stateHash: connectorOAuthTransactions.stateHash });
  if (!claimed) return null;
  const binding = { tenantId: input.tenantId, actorUserId: input.actorUserId,
    connectorKey: input.connectorKey, installationId: transaction.connectorInstallationId };
  const codeVerifier = transaction.verifierEnvelope ? openBoundSecret(transaction.verifierEnvelope, binding) : undefined;
  return { installationId: transaction.connectorInstallationId, ...(codeVerifier ? { codeVerifier } : {}) };
}

/** Atomically consumes a matching, unexpired OAuth state and returns its PKCE verifier once. */
export async function consumeConnectorOAuthTransaction(
  db: Pick<ReturnType<typeof getDb>, "select" | "update">,
  input: SecretBinding & { actorUserId: string; state: string },
  now = new Date(),
): Promise<string | null> {
  if (input.state.length < 32 || input.state.length > 128) return null;
  const stateHash = createHash("sha256").update(input.state).digest("base64url");
  const conditions = and(eq(connectorOAuthTransactions.stateHash, stateHash), eq(connectorOAuthTransactions.tenantId, input.tenantId),
    eq(connectorOAuthTransactions.actorUserId, input.actorUserId), eq(connectorOAuthTransactions.connectorKey, input.connectorKey),
    eq(connectorOAuthTransactions.connectorInstallationId, input.installationId), isNull(connectorOAuthTransactions.consumedAt),
    gt(connectorOAuthTransactions.expiresAt, now));
  const [transaction] = await db.select().from(connectorOAuthTransactions).where(conditions).limit(1);
  if (!transaction?.verifierEnvelope) return null;
  const verifier = openBoundSecret(transaction.verifierEnvelope, input);
  const [claimed] = await db.update(connectorOAuthTransactions)
    .set({ consumedAt: now, verifierEnvelope: null })
    .where(conditions).returning({ stateHash: connectorOAuthTransactions.stateHash });
  return claimed ? verifier : null;
}

export function sealConnectorCredential(secret: string, binding: SecretBinding): string {
  return sealBoundSecret(secret, binding);
}

export function sealConnectorCredentials(credentials: Record<string, string>, binding: SecretBinding): string {
  return sealBoundSecret(JSON.stringify(credentials), binding);
}

export function sealConnectorOAuthTokens(tokens: OAuthCredentialSet, binding: SecretBinding & { actorUserId: string }): string {
  return sealBoundSecret(JSON.stringify(tokens), binding);
}

export function openConnectorOAuthTokens(envelope: string, binding: SecretBinding): { tokens: OAuthCredentialSet; actorUserId: string } {
  const payload = openBoundPayload(envelope);
  const raw = assertSecretBinding(payload, binding);
  if (typeof payload.actorUserId !== "string" || !payload.actorUserId) throw new Error("OAuth credential actor binding is invalid");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("OAuth credential payload is invalid");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["accessToken", "refreshToken", "expiresAt", "grantedScopes", "providerAccountId"]);
  if (Object.keys(record).some((key) => !allowed.has(key)) || typeof record.accessToken !== "string" || !record.accessToken
    || record.accessToken.length > CONNECTOR_CREDENTIAL_MAX_LENGTH
    || (record.refreshToken !== undefined && (typeof record.refreshToken !== "string" || !record.refreshToken || record.refreshToken.length > CONNECTOR_CREDENTIAL_MAX_LENGTH))
    || (record.expiresAt !== undefined && (typeof record.expiresAt !== "string" || !Number.isFinite(Date.parse(record.expiresAt))))
    || !Array.isArray(record.grantedScopes) || record.grantedScopes.length > 100
    || record.grantedScopes.some((scope) => typeof scope !== "string" || scope.length > 200)
    || (record.providerAccountId !== undefined && (typeof record.providerAccountId !== "string" || record.providerAccountId.length > 8192))) {
    throw new Error("OAuth credential payload is invalid");
  }
  return { tokens: Object.freeze(record as unknown as OAuthCredentialSet), actorUserId: payload.actorUserId };
}
