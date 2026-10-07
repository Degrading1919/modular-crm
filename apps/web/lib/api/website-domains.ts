import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { getDomain } from "tldts";
import { and, asc, eq, sql } from "drizzle-orm";
import { auditEvents, checkWebsiteDomain, domains, domainEvents, sites, tenants, websiteDomainChecks } from "@modular-crm/db";
import { createWebsiteHosting } from "@modular-crm/connectors";
import { WEBSITE_DOMAIN_EVIDENCE_MAX_AGE_MS, DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { json, readBody } from "./http";

const createDomainSchema = z.object({ hostname: z.string().trim().min(1).max(253) });

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Accept a bare, public DNS hostname and canonicalize IDNs/case before persistence. */
export function normalizeCustomHostname(input: string, mock = false): string {
  const candidate = input.trim();
  if (!candidate || /[\s/@?#:]/.test(candidate) || candidate.includes("\\") || candidate.includes("://")) {
    throw new DomainError("VALIDATION_ERROR", "Enter a domain name such as www.yourbusiness.com.", 422);
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${candidate}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Enter a valid public domain name.", 422);
  }
  const labels = hostname.split(".");
  // The prefixed TXT challenge name must also fit within DNS's 253-character name limit.
  if (hostname.length > 227 || labels.length < 2 || isIP(hostname) ||
      /^(localhost|.*\.(?:localhost|local|invalid|example|modular\.local))$/.test(hostname) || (!mock && hostname.endsWith(".test")) ||
      labels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
      !/^(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/.test(labels.at(-1) ?? "")) {
    throw new DomainError("VALIDATION_ERROR", "Use a public domain name, not a local or platform address.", 422);
  }
  if (!getDomain(hostname, { allowPrivateDomains: true })) throw new DomainError("VALIDATION_ERROR", "Use a domain you own, not a public suffix.", 422);
  return hostname;
}

/** A simulation is exposed only in a non-production process with an explicit demo/mock setting. */
export function mockDomainVerificationAllowed(tenantSettings: unknown, environment = process.env.NODE_ENV): boolean {
  const settings = tenantSettings && typeof tenantSettings === "object" && !Array.isArray(tenantSettings)
    ? tenantSettings as Record<string, unknown> : {};
  return environment !== "production" && (settings.demoMode === true || process.env.DOMAIN_VERIFICATION_MODE === "mock");
}

function requireDomainManager(actor: SessionActor): asserts actor is SessionActor & { kind: "staff"; organizationId: string } {
  requireStaff(actor);
  requirePermission(actor, "website.domains_manage");
  if (!actor.organizationId) throw new DomainError("FORBIDDEN", "A business workspace is required.", 403);
}

async function getSite(actor: SessionActor, tx: Tx | Db = getDb()) {
  requireDomainManager(actor);
  const [site] = await tx.select().from(sites)
    .where(and(eq(sites.tenantId, actor.tenantId), eq(sites.organizationId, actor.organizationId)))
    .orderBy(asc(sites.createdAt)).limit(1);
  if (!site) throw new DomainError("NOT_FOUND", "Website setup was not found.", 404);
  return site;
}

function verificationFor(hostname: string, data: Record<string, unknown> | null) {
  const token = typeof data?.verificationToken === "string" ? data.verificationToken : null;
  return token ? { recordType: "TXT", recordName: `_modular-crm-verification.${hostname}`, recordValue: `modular-crm-verification=${token}` } : null;
}

function domainItem(domain: typeof domains.$inferSelect, check?: typeof websiteDomainChecks.$inferSelect, target?: string) {
  const stale = check?.state === "live" && (!check.checkedAt || check.checkedAt.getTime() < Date.now() - WEBSITE_DOMAIN_EVIDENCE_MAX_AGE_MS);
  return {
    id: domain.id, hostname: domain.hostname, domainType: domain.domainType,
    verificationStatus: check ? (check.ownershipVerified ? "verified" : "pending") : domain.verificationStatus, isPrimary: domain.isPrimary,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    dnsChallenge: domain.domainType === "custom" ? verificationFor(domain.hostname, domain.verificationData ?? null) : null,
    state: stale ? "needs_attention" : check?.state ?? (domain.domainType === "platform" ? "live" : "waiting_dns"), problem: stale ? "Your domain check is overdue. Choose Check now or contact support." : check?.problem ?? null,
    checkedAt: check?.checkedAt?.toISOString() ?? null,
    routingRecord: target ? { recordType: getDomain(domain.hostname, { allowPrivateDomains: true }) === domain.hostname ? "ALIAS / ANAME" : "CNAME",
      recordName: domain.hostname, recordValue: target } : null,
    certificateChallenge: target ? { recordType: "TXT", recordName: `_cf-challenge.${domain.hostname}`, recordValue: target } : null,
  };
}

async function auditDomainChange(tx: Tx, actor: SessionActor, input: {
  type: string; action: string; id: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null;
}) {
  await tx.insert(domainEvents).values({
    tenantId: actor.tenantId, eventType: input.type, actorType: "staff", actorId: actor.userId,
    entityType: "domain", entityId: input.id, organizationId: actor.organizationId,
    payload: input.after ?? {},
  });
  await tx.insert(auditEvents).values({
    tenantId: actor.tenantId, actorType: "staff", actorId: actor.userId,
    action: input.action, entityType: "domain", entityId: input.id,
    beforeData: input.before ?? undefined, afterData: input.after ?? undefined,
  });
}

async function listDomains(actor: SessionActor) {
  const site = await getSite(actor);
  const [tenant] = await getDb().select({ settings: tenants.settings }).from(tenants)
    .where(eq(tenants.id, actor.tenantId)).limit(1);
  const entries = await getDb().select().from(domains)
    .where(and(eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id)))
    .orderBy(asc(domains.domainType), asc(domains.hostname));
  const platform = entries.find((domain) => domain.domainType === "platform") ?? null;
  const checks = await getDb().select().from(websiteDomainChecks).where(eq(websiteDomainChecks.tenantId, actor.tenantId));
  let target: string | undefined;
  try { target = createWebsiteHosting(process.env, mockDomainVerificationAllowed(tenant?.settings)).target; } catch { /* Included address remains usable before operator configuration. */ }
  return {
    items: entries.filter((domain) => domain.domainType === "custom").map(domain => domainItem(domain, checks.find(check => check.domainId === domain.id), target)),
    platformDomain: platform ? domainItem(platform) : null,
    simulatedVerificationAvailable: mockDomainVerificationAllowed(tenant?.settings),
  };
}

async function addDomain(actor: SessionActor, hostnameInput: string) {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
  const hosting = createWebsiteHosting(process.env, mockDomainVerificationAllowed(tenant?.settings));
  const hostname = normalizeCustomHostname(hostnameInput, hosting.mock);
  const platformHost = new URL(process.env.APP_BASE_URL ?? "http://localhost:3000").hostname;
  if (hostname === platformHost) throw new DomainError("CONFLICT", "Use a domain you own, not the workspace address.", 409);
  return db.transaction(async (tx) => {
    const site = await getSite(actor, tx);
    const verificationToken = randomBytes(24).toString("base64url");
    const [created] = await tx.insert(domains).values({
      tenantId: actor.tenantId, siteId: site.id, hostname, domainType: "custom",
      verificationStatus: "pending", isPrimary: false,
      verificationData: { verificationToken },
    }).onConflictDoNothing().returning();
    if (!created) throw new DomainError("CONFLICT", "That domain is already connected to a business website.", 409);
    const [check] = await tx.insert(websiteDomainChecks).values({ tenantId: actor.tenantId, domainId: created.id }).returning();
    await auditDomainChange(tx, actor, { type: "website.domain_added", action: "website.domain_add", id: created.id, after: { hostname, verificationStatus: "pending" } });
    return domainItem(created, check, hosting.target);
  });
}

async function verifyDomain(actor: SessionActor, id: string) {
    const site = await getSite(actor);
    const [tenant] = await getDb().select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
    const hosting = createWebsiteHosting(process.env, mockDomainVerificationAllowed(tenant?.settings));
    const [domain] = await getDb().select().from(domains).where(and(
      eq(domains.id, id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.domainType, "custom"),
    )).limit(1);
    if (!domain) throw new DomainError("NOT_FOUND", "Custom domain not found.", 404);
    const check = await checkWebsiteDomain(getDb(), actor.tenantId, id, hosting, hosting.mock);
    return domainItem(domain, check, hosting.target);
}

async function setPrimaryDomain(actor: SessionActor, id: string) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`website-domain:${id}`}, 0))`);
    const site = await getSite(actor, tx);
    const [domain] = await tx.select().from(domains).where(and(
      eq(domains.id, id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id),
    )).limit(1);
    if (!domain || !["custom", "platform"].includes(domain.domainType)) throw new DomainError("NOT_FOUND", "Website domain not found.", 404);
    const [check] = await tx.select().from(websiteDomainChecks).where(and(eq(websiteDomainChecks.domainId, domain.id), eq(websiteDomainChecks.tenantId, actor.tenantId)));
    if (domain.domainType === "custom" && (check?.state !== "live" || !check.ownershipVerified || !check.routingVerified || !check.checkedAt || check.checkedAt.getTime() < Date.now() - WEBSITE_DOMAIN_EVIDENCE_MAX_AGE_MS)) {
      throw new DomainError("VALIDATION_ERROR", "Verify this domain before making it your primary website address.", 422);
    }
    const [platform] = await tx.select().from(domains).where(and(
      eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.domainType, "platform"),
    )).limit(1);
    if (!platform) throw new DomainError("NOT_FOUND", "The platform website address is unavailable.", 404);
    const oldPrimary = await tx.select().from(domains).where(and(eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.isPrimary, true)));
    await tx.update(domains).set({ isPrimary: false }).where(and(eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.isPrimary, true)));
    const [updated] = await tx.update(domains).set({ isPrimary: true }).where(and(
      eq(domains.id, domain.id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id),
    )).returning();
    await auditDomainChange(tx, actor, { type: "website.domain_primary_changed", action: "website.domain_primary_set", id: domain.id,
      before: { hostnames: oldPrimary.map((entry) => entry.hostname) }, after: { hostname: domain.hostname } });
    return domainItem(updated!, check);
  });
}

async function removeDomain(actor: SessionActor, id: string) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`website-domain:${id}`}, 0))`);
    const site = await getSite(actor, tx);
    const [domain] = await tx.select().from(domains).where(and(
      eq(domains.id, id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.domainType, "custom"),
    )).limit(1);
    if (!domain) throw new DomainError("NOT_FOUND", "Custom domain not found.", 404);
    const [platform] = await tx.select().from(domains).where(and(
      eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.domainType, "platform"),
    )).limit(1);
    if (domain.isPrimary && !platform) throw new DomainError("CONFLICT", "The platform website address is unavailable, so this custom domain cannot be removed yet.", 409);
    if (domain.isPrimary && platform) {
      await tx.update(domains).set({ isPrimary: false }).where(and(eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.isPrimary, true)));
      await tx.update(domains).set({ isPrimary: true }).where(and(eq(domains.id, platform.id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id)));
    }
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, actor.tenantId));
    // Real provisioning can succeed before its response/reference is saved. Keep
    // the hostname claimed until the worker has checked the deterministic name.
    if (mockDomainVerificationAllowed(tenant?.settings)) await tx.delete(domains).where(and(eq(domains.id, domain.id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id)));
    else await tx.update(websiteDomainChecks).set({ state: "removing", nextCheckAt: new Date(), ownershipVerified: false, routingVerified: false }).where(eq(websiteDomainChecks.domainId, id));
    await auditDomainChange(tx, actor, { type: "website.domain_removed", action: "website.domain_remove", id: domain.id,
      before: { hostname: domain.hostname, verificationStatus: domain.verificationStatus, isPrimary: domain.isPrimary },
      after: { removed: true, revertedToPlatformDomain: domain.isPrimary ? platform?.hostname ?? null : null } });
    return { removed: true, platformDomain: domain.isPrimary && platform ? domainItem({ ...platform, isPrimary: true }) : null };
  });
}

/** Owner-only custom domain setup. The caller wires this handler before the general website handler. */
export async function handleWebsiteDomains(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "website" || path[1] !== "domains") return null;
  requireDomainManager(actor);
  const id = path[2];
  if (path.length === 2 && request.method === "GET") return json(await listDomains(actor));
  if (path.length === 2 && request.method === "POST") {
    const input = await readBody(request, createDomainSchema);
    return json({ item: await addDomain(actor, input.hostname) }, 201);
  }
  if (path.length === 4 && id && path[3] === "verify" && request.method === "POST") return json({ item: await verifyDomain(actor, id) });
  if (path.length === 4 && id && path[3] === "mock-dns" && request.method === "POST") {
    const site = await getSite(actor);
    const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, actor.tenantId));
    if (!mockDomainVerificationAllowed(tenant?.settings)) throw new DomainError("FORBIDDEN", "Local DNS simulation is unavailable here.", 403);
    const [domain] = await getDb().select().from(domains).where(and(eq(domains.id, id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.domainType, "custom")));
    if (!domain) throw new DomainError("NOT_FOUND", "Custom domain not found.", 404);
    const records = await readBody(request, z.object({ ownership: z.enum(["valid", "wrong", "missing"]), routing: z.enum(["valid", "wrong", "missing"]), certificate: z.enum(["ready", "pending", "failed"]).default("ready") }));
    await getDb().update(websiteDomainChecks).set({ mockRecords: records, nextCheckAt: new Date() }).where(and(eq(websiteDomainChecks.domainId, id), eq(websiteDomainChecks.tenantId, actor.tenantId)));
    return json({ item: { simulated: true } });
  }
  if (path.length === 4 && id && path[3] === "primary" && request.method === "POST") return json({ item: await setPrimaryDomain(actor, id) });
  if (path.length === 3 && id && request.method === "DELETE") return json({ item: await removeDomain(actor, id) });
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
