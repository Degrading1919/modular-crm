import { and, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import { apiCredentials, auditEvents } from "@modular-crm/db";
import { createApiKey, hashApiKey, DomainError } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import type { SessionActor } from "./actor";
import { json, readBody } from "./http";
import { listDeveloperWebhookSubscriptions } from "./developer-webhooks";

export const API_CREDENTIAL_SCOPES = [
  "customers:read", "customers:write", "leads:read", "leads:write", "jobs:read", "jobs:write",
  "estimates:read", "estimates:write", "invoices:read", "payments:read", "service_plans:read",
  "service_plans:write", "tickets:read", "tickets:write", "webhooks:manage",
] as const;

export const createApiCredentialBodySchema = z.object({
  name: z.string().trim().min(1).max(100).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Name contains unsupported characters."),
  scopes: z.array(z.enum(API_CREDENTIAL_SCOPES)).min(1).max(API_CREDENTIAL_SCOPES.length)
    .transform((scopes) => [...new Set(scopes)]),
}).strict();

export type ApiCredentialRecord = typeof apiCredentials.$inferSelect;
export type PublicApiCredentialFields = Pick<ApiCredentialRecord,
  "id" | "name" | "tokenPrefix" | "scopes" | "status" | "expiresAt" | "lastUsedAt" | "createdAt" | "revokedAt"
>;

/** Fields safe to return to the owner UI; hashes and creator identity stay server-side. */
export function presentApiCredential(row: PublicApiCredentialFields) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: [...row.scopes],
    status: row.status,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

function requireOwner(actor: SessionActor): asserts actor is SessionActor & { kind: "staff"; role: "owner"; membershipId: string } {
  if (actor.kind !== "staff" || actor.role !== "owner" || !actor.membershipId) {
    throw new DomainError("FORBIDDEN", "Only a business owner can manage API credentials.", 403);
  }
}

function apiKeyHasValidShape(apiKey: string): boolean {
  // 32 random bytes encode to 43 base64url characters.
  return /^mcrm_[A-Za-z0-9_-]{43}$/.test(apiKey);
}

export function apiKeyFromAuthorization(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(mcrm_[A-Za-z0-9_-]{43})$/i.exec(authorization);
  return match?.[1] ?? null;
}

export interface ResolvedApiCredential {
  credentialId: string;
  tenantId: string;
  scopes: string[];
}

/**
 * Resolves and marks a valid key as used in one update. Tenant authority and
 * scopes always come from the stored credential, never from request input.
 */
export async function resolveApiCredential(apiKey: string, now = new Date()): Promise<ResolvedApiCredential | null> {
  if (!apiKeyHasValidShape(apiKey)) return null;
  const [credential] = await getDb().update(apiCredentials).set({ lastUsedAt: now })
    .where(and(
      eq(apiCredentials.tokenHash, hashApiKey(apiKey)),
      eq(apiCredentials.status, "active"),
      isNull(apiCredentials.revokedAt),
      or(isNull(apiCredentials.expiresAt), gt(apiCredentials.expiresAt, now)),
    ))
    .returning({ id: apiCredentials.id, tenantId: apiCredentials.tenantId, scopes: apiCredentials.scopes });
  if (!credential) return null;
  return { credentialId: credential.id, tenantId: credential.tenantId, scopes: [...credential.scopes] };
}

export async function resolveApiCredentialFromRequest(request: Request, now = new Date()): Promise<ResolvedApiCredential | null> {
  const apiKey = apiKeyFromAuthorization(request);
  return apiKey ? resolveApiCredential(apiKey, now) : null;
}

async function listCredentials(tenantId: string): Promise<PublicApiCredentialFields[]> {
  return getDb().select({
    id: apiCredentials.id,
    name: apiCredentials.name,
    tokenPrefix: apiCredentials.tokenPrefix,
    scopes: apiCredentials.scopes,
    status: apiCredentials.status,
    expiresAt: apiCredentials.expiresAt,
    lastUsedAt: apiCredentials.lastUsedAt,
    createdAt: apiCredentials.createdAt,
    revokedAt: apiCredentials.revokedAt,
  }).from(apiCredentials).where(eq(apiCredentials.tenantId, tenantId))
    .orderBy(desc(apiCredentials.createdAt)).limit(100);
}

async function createCredential(request: Request, actor: SessionActor & { kind: "staff"; role: "owner"; membershipId: string }): Promise<Response> {
  const body = await readBody(request, createApiCredentialBodySchema);
  const key = createApiKey();
  const created = await getDb().transaction(async (tx) => {
    const [credential] = await tx.insert(apiCredentials).values({
      tenantId: actor.tenantId,
      name: body.name,
      tokenHash: key.hash,
      tokenPrefix: key.prefix,
      scopes: body.scopes,
      status: "active",
      expiresAt: null,
      lastUsedAt: null,
      createdByMembershipId: actor.membershipId,
      revokedAt: null,
    }).returning({
      id: apiCredentials.id,
      name: apiCredentials.name,
      tokenPrefix: apiCredentials.tokenPrefix,
      scopes: apiCredentials.scopes,
      status: apiCredentials.status,
      expiresAt: apiCredentials.expiresAt,
      lastUsedAt: apiCredentials.lastUsedAt,
      createdAt: apiCredentials.createdAt,
      revokedAt: apiCredentials.revokedAt,
    });
    if (!credential) throw new Error("The API credential could not be created.");
    await tx.insert(auditEvents).values({
      tenantId: actor.tenantId,
      actorType: "staff",
      actorId: actor.userId,
      action: "developer.api_credential_created",
      entityType: "api_credential",
      entityId: credential.id,
      afterData: { name: credential.name, scopes: credential.scopes, status: credential.status },
    });
    return credential;
  });
  // This is the only response that contains the plaintext key.
  return json({ item: { ...presentApiCredential(created), key: key.plain } }, 201);
}

async function revokeCredential(id: string, actor: SessionActor & { kind: "staff"; role: "owner"; membershipId: string }): Promise<Response> {
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) throw new DomainError("NOT_FOUND", "Credential not found.", 404);
  const now = new Date();
  const revoked = await getDb().transaction(async (tx) => {
    const [updated] = await tx.update(apiCredentials).set({ status: "revoked", revokedAt: now })
      .where(and(
        eq(apiCredentials.id, parsedId.data),
        eq(apiCredentials.tenantId, actor.tenantId),
        ne(apiCredentials.status, "revoked"),
      ))
      .returning({
        id: apiCredentials.id,
        name: apiCredentials.name,
        tokenPrefix: apiCredentials.tokenPrefix,
        scopes: apiCredentials.scopes,
        status: apiCredentials.status,
        expiresAt: apiCredentials.expiresAt,
        lastUsedAt: apiCredentials.lastUsedAt,
        createdAt: apiCredentials.createdAt,
        revokedAt: apiCredentials.revokedAt,
      });
    if (updated) {
      await tx.insert(auditEvents).values({
        tenantId: actor.tenantId,
        actorType: "staff",
        actorId: actor.userId,
        action: "developer.api_credential_revoked",
        entityType: "api_credential",
        entityId: updated.id,
        afterData: { name: updated.name, scopes: updated.scopes, status: updated.status },
      });
      return updated;
    }
    // A repeated DELETE is idempotent, while IDs from another tenant stay hidden.
    const [existing] = await tx.select({
      id: apiCredentials.id,
      name: apiCredentials.name,
      tokenPrefix: apiCredentials.tokenPrefix,
      scopes: apiCredentials.scopes,
      status: apiCredentials.status,
      expiresAt: apiCredentials.expiresAt,
      lastUsedAt: apiCredentials.lastUsedAt,
      createdAt: apiCredentials.createdAt,
      revokedAt: apiCredentials.revokedAt,
    }).from(apiCredentials).where(and(eq(apiCredentials.id, parsedId.data), eq(apiCredentials.tenantId, actor.tenantId))).limit(1);
    if (!existing) throw new DomainError("NOT_FOUND", "Credential not found.", 404);
    return existing;
  });
  return json({ item: presentApiCredential(revoked) });
}

/** Owner-only API key management used by the existing Developer view. */
export async function handleDeveloperCredentials(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "developer") return null;
  const rootList = path.length === 1 && request.method === "GET";
  const credentialPath = path[1] === "credentials";
  if (!rootList && !credentialPath) return null;

  requireOwner(actor);
  if (rootList) {
    const [credentials, webhooks] = await Promise.all([
      listCredentials(actor.tenantId).then((items) => items.map(presentApiCredential)),
      listDeveloperWebhookSubscriptions(actor.tenantId),
    ]);
    return json({ item: { credentials, webhooks } });
  }

  if (path.length === 2 && request.method === "GET") {
    return json({ items: (await listCredentials(actor.tenantId)).map(presentApiCredential) });
  }
  if (path.length === 2 && request.method === "POST") return createCredential(request, actor);
  if (path.length === 3 && request.method === "DELETE") return revokeCredential(path[2]!, actor);
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
