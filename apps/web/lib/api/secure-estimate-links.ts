import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { auditEvents, domainEvents, estimateItems, estimateRevisions, estimates, secureEstimateTokens } from "@modular-crm/db";
import { assertTransition, DomainError } from "@modular-crm/domain";
import { getDb } from "../db";
import { requireTenantFeature } from "./capability-enforcement";
import { json, readBody } from "./http";
import { applySecureEstimateDecisionInTransaction } from "./workflows";
import { z } from "zod";

const RATE_WINDOW_MS = 10 * 60 * 1000;
const windows = new Map<string, { startedAt: number; count: number }>();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const decisionBodySchema = z.object({ comment: z.string().trim().max(1000).nullable().optional() }).strict();

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestIpHash(request: Request): string {
  const raw = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim() || "unknown";
  return digest(raw.slice(0, 160)).slice(0, 24);
}

function requestIp(request: Request): string | null {
  const raw = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim();
  return raw ? raw.slice(0, 160) : null;
}

function rateLimited(request: Request, tokenHash: string, action: string, limit: number): Response | null {
  const now = Date.now();
  const ip = requestIpHash(request);
  const scopedKeys = [`${action}:ip:${ip}`, `${action}:token:${tokenHash}:${ip}`];
  const limits = [limit, Math.max(5, Math.floor(limit / 2))];
  let retryAfter = 0;
  for (let index = 0; index < scopedKeys.length; index += 1) {
    const key = scopedKeys[index]!;
    let window = windows.get(key);
    if (!window || now - window.startedAt >= RATE_WINDOW_MS) {
      window = { startedAt: now, count: 0 };
      windows.set(key, window);
    }
    if (window.count >= limits[index]!) retryAfter = Math.max(retryAfter, Math.ceil((window.startedAt + RATE_WINDOW_MS - now) / 1000));
  }
  if (retryAfter > 0) return json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please try again in a few minutes." } }, 429, { "retry-after": String(retryAfter) });
  for (const key of scopedKeys) windows.get(key)!.count += 1;
  if (windows.size > 5000) {
    for (const [key, value] of windows) if (now - value.startedAt >= RATE_WINDOW_MS) windows.delete(key);
    while (windows.size > 7500) windows.delete(windows.keys().next().value!);
  }
  return null;
}

function notAvailable(): never {
  throw new DomainError("NOT_FOUND", "This estimate link is unavailable.", 404);
}

type CurrentEstimateForToken =
  | { estimate: typeof estimates.$inferSelect; revision: typeof estimateRevisions.$inferSelect }
  | { expired: true };

async function currentEstimateForToken(token: typeof secureEstimateTokens.$inferSelect, request: Request, tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]): Promise<CurrentEstimateForToken> {
  await tx.execute(sql`SELECT id FROM estimates WHERE tenant_id = ${token.tenantId} AND id = ${token.estimateId} FOR UPDATE`);
  const [estimate] = await tx.select().from(estimates).where(and(eq(estimates.tenantId, token.tenantId), eq(estimates.id, token.estimateId))).limit(1);
  if (!estimate) notAvailable();
  const [revision] = await tx.select().from(estimateRevisions).where(and(eq(estimateRevisions.tenantId, token.tenantId), eq(estimateRevisions.estimateId, estimate.id), eq(estimateRevisions.revisionNumber, estimate.currentRevision))).limit(1);
  if (!revision || revision.id !== token.estimateRevisionId) throw new DomainError("CONFLICT", "This estimate link is no longer current.", 409);
  if (token.revokedAt) notAvailable();
  const now = new Date();
  if (token.expiresAt <= now || (estimate.expiresAt && estimate.expiresAt <= now)) {
    if (["sent", "viewed"].includes(estimate.status)) {
      assertTransition("estimate", estimate.status, "expired");
      await tx.update(estimates).set({ status: "expired", updatedAt: now }).where(and(eq(estimates.id, estimate.id), eq(estimates.tenantId, token.tenantId)));
      const ipAddress = requestIp(request);
      const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
      await tx.insert(domainEvents).values({ tenantId: token.tenantId, eventType: "estimate.expired", actorType: "secure_estimate_link", actorId: token.id, entityType: "estimate", entityId: estimate.id, locationId: estimate.organizationLocationId, payload: { status: "expired" } });
      await tx.insert(auditEvents).values({ tenantId: token.tenantId, actorType: "secure_estimate_link", actorId: token.id, action: "estimate.expired", entityType: "estimate", entityId: estimate.id, beforeData: { status: estimate.status }, afterData: { status: "expired" }, ipAddress, userAgent });
    }
    // Return an outcome instead of throwing here: the caller must let this
    // transaction commit the status, domain event, and audit entry before it
    // returns the same unavailable response as any other invalid link.
    return { expired: true };
  }
  return { estimate, revision };
}

async function getPublicView(request: Request, token: typeof secureEstimateTokens.$inferSelect): Promise<Response> {
  const db = getDb();
  const outcome = await db.transaction(async (tx) => {
    // Sending/revoking links locks the estimate before token rows. Keep that
    // same order here so a decision racing a resend cannot deadlock.
    await tx.execute(sql`SELECT id FROM estimates WHERE tenant_id = ${token.tenantId} AND id = ${token.estimateId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM secure_estimate_tokens WHERE id = ${token.id} FOR UPDATE`);
    const [lockedToken] = await tx.select().from(secureEstimateTokens).where(and(eq(secureEstimateTokens.id, token.id), eq(secureEstimateTokens.tenantId, token.tenantId))).limit(1);
    if (!lockedToken || lockedToken.consumedAt) notAvailable();
    const current = await currentEstimateForToken(lockedToken, request, tx);
    if ("expired" in current) return { expired: true as const };
    const { estimate, revision } = current;
    if (!["sent", "viewed"].includes(estimate.status)) notAvailable();
    if (estimate.status === "sent") {
      assertTransition("estimate", estimate.status, "viewed");
      const now = new Date();
      await tx.update(estimates).set({ status: "viewed", updatedAt: now }).where(and(eq(estimates.id, estimate.id), eq(estimates.tenantId, lockedToken.tenantId)));
      const ipAddress = requestIp(request);
      const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
      await tx.insert(domainEvents).values({ tenantId: lockedToken.tenantId, eventType: "estimate.viewed", actorType: "secure_estimate_link", actorId: lockedToken.id, entityType: "estimate", entityId: estimate.id, locationId: estimate.organizationLocationId, payload: { status: "viewed" } });
      await tx.insert(auditEvents).values({ tenantId: lockedToken.tenantId, actorType: "secure_estimate_link", actorId: lockedToken.id, action: "estimate.viewed", entityType: "estimate", entityId: estimate.id, beforeData: { status: "sent" }, afterData: { status: "viewed" }, ipAddress, userAgent });
    }
    const items = await tx.select({ description: estimateItems.description, quantity: estimateItems.quantity, unitAmountMinor: estimateItems.unitAmountMinor, totalMinor: estimateItems.totalMinor })
      .from(estimateItems).where(and(eq(estimateItems.tenantId, lockedToken.tenantId), eq(estimateItems.estimateRevisionId, revision.id))).orderBy(estimateItems.sortOrder);
    const snapshot = (revision.snapshot ?? {}) as Record<string, unknown>;
    return { expired: false as const, item: {
      title: typeof snapshot.title === "string" ? snapshot.title : "Estimate",
      contactName: typeof snapshot.contactName === "string" ? snapshot.contactName : null,
      currency: estimate.currency,
      totalMinor: Number(revision.totalMinor),
      expiresAt: estimate.expiresAt?.toISOString() ?? lockedToken.expiresAt.toISOString(),
      termsText: revision.termsText,
      termsVersion: revision.termsVersion ?? "demo-v1",
      items: items.map((line) => ({ description: line.description, quantity: line.quantity, unitAmountMinor: Number(line.unitAmountMinor), totalMinor: Number(line.totalMinor) })),
    } };
  });
  if (outcome.expired) notAvailable();
  return json({ item: outcome.item });
}

async function decide(request: Request, tokenHash: string, action: "approve" | "decline"): Promise<Response> {
  const db = getDb();
  const [identity] = await db.select({ tenantId: secureEstimateTokens.tenantId, estimateId: secureEstimateTokens.estimateId }).from(secureEstimateTokens).where(eq(secureEstimateTokens.tokenHash, tokenHash)).limit(1);
  if (!identity) notAvailable();
  await requireTenantFeature(identity.tenantId, "estimate_management");
  const body = await readBody(request, decisionBodySchema);
  const outcome = await db.transaction(async (tx) => {
    // Match the estimate-before-token lock order used by send/revoke and GET.
    await tx.execute(sql`SELECT id FROM estimates WHERE tenant_id = ${identity.tenantId} AND id = ${identity.estimateId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM secure_estimate_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`);
    const [token] = await tx.select().from(secureEstimateTokens).where(and(eq(secureEstimateTokens.tokenHash, tokenHash), eq(secureEstimateTokens.tenantId, identity.tenantId))).limit(1);
    if (!token || token.revokedAt) notAvailable();
    if (!token.allowedActions.includes(action)) notAvailable();
    const current = await currentEstimateForToken(token, request, tx);
    if ("expired" in current) return { expired: true as const };
    const { estimate } = current;
    if (token.consumedAt) {
      if (token.consumedAction !== action) throw new DomainError("CONFLICT", "This estimate link has already been used.", 409);
      const expectedStatus = action === "approve" ? "approved" : "declined";
      if (estimate.status !== expectedStatus) throw new DomainError("CONFLICT", "This estimate link has already been used.", 409);
      return { expired: false as const, estimate, duplicate: true };
    }
    if (!["sent", "viewed"].includes(estimate.status)) notAvailable();
    const saved = await applySecureEstimateDecisionInTransaction(tx, {
      request, tenantId: token.tenantId, estimateId: token.estimateId, tokenId: token.id, action,
      comment: body.comment ?? null,
    });
    const now = new Date();
    await tx.update(secureEstimateTokens).set({ consumedAt: now, consumedAction: action, updatedAt: now })
      .where(and(eq(secureEstimateTokens.id, token.id), eq(secureEstimateTokens.tenantId, token.tenantId), isNull(secureEstimateTokens.consumedAt)));
    return { expired: false as const, estimate: saved, duplicate: false };
  });
  if (outcome.expired) notAvailable();
  // A bearer link authorizes this decision, not access to the CRM record or
  // its tenant/customer/lead identifiers.
  return json({ item: { status: outcome.estimate.status }, duplicate: outcome.duplicate });
}

/** Public bearer-link access to a sent estimate. The URL token is never stored in the database. */
export async function handleSecureEstimateLink(request: Request, path: string[]): Promise<Response | null> {
  if (path[0] !== "public" || path[1] !== "estimate-links") return null;
  if (path.length !== 3 && path.length !== 4) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  const token = tokenSchema.safeParse(path[2]);
  if (!token.success) throw new DomainError("NOT_FOUND", "This estimate link is unavailable.", 404);
  if (new URL(request.url).searchParams.size > 0) throw new DomainError("VALIDATION_ERROR", "Estimate links do not accept query parameters.", 422);
  const tokenHash = digest(token.data);
  if (request.method === "GET" && path.length === 3) {
    const limited = rateLimited(request, tokenHash, "view", 120);
    if (limited) return limited;
    const [record] = await getDb().select().from(secureEstimateTokens).where(eq(secureEstimateTokens.tokenHash, tokenHash)).limit(1);
    if (!record) notAvailable();
    await requireTenantFeature(record.tenantId, "estimate_management");
    return getPublicView(request, record);
  }
  if (request.method === "POST" && path.length === 4 && (path[3] === "approve" || path[3] === "decline")) {
    const limited = rateLimited(request, tokenHash, "decision", 30);
    if (limited) return limited;
    return decide(request, tokenHash, path[3]);
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
