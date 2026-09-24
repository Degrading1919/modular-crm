import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { and, asc, eq } from "drizzle-orm";
import { auditEvents, domains, domainEvents, sites, tenants } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { json, readBody } from "./http";

const createDomainSchema = z.object({ hostname: z.string().trim().min(1).max(253) });

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Accept a bare, public DNS hostname and canonicalize IDNs/case before persistence. */
export function normalizeCustomHostname(input: string): string {
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
      /^(localhost|.*\.(?:localhost|local|test|invalid|example|modular\.local))$/.test(hostname) ||
      labels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
      !/^(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/.test(labels.at(-1) ?? "")) {
    throw new DomainError("VALIDATION_ERROR", "Use a public domain name, not a local or platform address.", 422);
  }
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

function domainItem(domain: typeof domains.$inferSelect) {
  return {
    id: domain.id, hostname: domain.hostname, domainType: domain.domainType,
    verificationStatus: domain.verificationStatus, isPrimary: domain.isPrimary,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    dnsChallenge: domain.domainType === "custom" ? verificationFor(domain.hostname, domain.verificationData ?? null) : null,
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
  return {
    items: entries.filter((domain) => domain.domainType === "custom").map(domainItem),
    platformDomain: platform ? domainItem(platform) : null,
    simulatedVerificationAvailable: mockDomainVerificationAllowed(tenant?.settings),
  };
}

async function addDomain(actor: SessionActor, hostnameInput: string) {
  const hostname = normalizeCustomHostname(hostnameInput);
  const db = getDb();
  return db.transaction(async (tx) => {
    const site = await getSite(actor, tx);
    const verificationToken = randomBytes(24).toString("base64url");
    const [created] = await tx.insert(domains).values({
      tenantId: actor.tenantId, siteId: site.id, hostname, domainType: "custom",
      verificationStatus: "pending", isPrimary: false,
      verificationData: { verificationToken },
    }).onConflictDoNothing().returning();
    if (!created) throw new DomainError("CONFLICT", "That domain is already connected to a business website.", 409);
    await auditDomainChange(tx, actor, { type: "website.domain_added", action: "website.domain_add", id: created.id, after: { hostname, verificationStatus: "pending" } });
    return domainItem(created);
  });
}

async function verifyDomain(actor: SessionActor, id: string) {
  return getDb().transaction(async (tx) => {
    const site = await getSite(actor, tx);
    const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
    if (!tenant || !mockDomainVerificationAllowed(tenant.settings)) {
      throw new DomainError("CONFLICT", "Domain ownership must be verified by the configured hosting provider. Simulated verification is unavailable here.", 409);
    }
    const [domain] = await tx.select().from(domains).where(and(
      eq(domains.id, id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id), eq(domains.domainType, "custom"),
    )).limit(1);
    if (!domain) throw new DomainError("NOT_FOUND", "Custom domain not found.", 404);
    if (domain.verificationStatus === "verified") return domainItem(domain);
    const verifiedAt = new Date();
    const [updated] = await tx.update(domains).set({ verificationStatus: "verified", verifiedAt })
      .where(and(eq(domains.id, domain.id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id)))
      .returning();
    await auditDomainChange(tx, actor, { type: "website.domain_verified_mock", action: "website.domain_verify_mock", id: domain.id,
      before: { verificationStatus: domain.verificationStatus }, after: { hostname: domain.hostname, verificationStatus: "verified", mode: "mock" } });
    return domainItem(updated!);
  });
}

async function setPrimaryDomain(actor: SessionActor, id: string) {
  return getDb().transaction(async (tx) => {
    const site = await getSite(actor, tx);
    const [domain] = await tx.select().from(domains).where(and(
      eq(domains.id, id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id),
    )).limit(1);
    if (!domain || !["custom", "platform"].includes(domain.domainType)) throw new DomainError("NOT_FOUND", "Website domain not found.", 404);
    if (domain.domainType === "custom" && domain.verificationStatus !== "verified") {
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
    return domainItem(updated!);
  });
}

async function removeDomain(actor: SessionActor, id: string) {
  return getDb().transaction(async (tx) => {
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
    await tx.delete(domains).where(and(eq(domains.id, domain.id), eq(domains.tenantId, actor.tenantId), eq(domains.siteId, site.id)));
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
  if (path.length === 4 && id && path[3] === "primary" && request.method === "POST") return json({ item: await setPrimaryDomain(actor, id) });
  if (path.length === 3 && id && request.method === "DELETE") return json({ item: await removeDomain(actor, id) });
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
