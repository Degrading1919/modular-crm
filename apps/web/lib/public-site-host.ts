import { and, eq, inArray, sql } from "drizzle-orm";
import { domains, sites, tenants } from "@modular-crm/db";
import { getDb } from "./db";

export type PublishedSiteHost = {
  siteId: string;
  tenantId: string;
  slug: string;
};

/** Canonicalize a Host header value without accepting URLs, credentials, or lists. */
export function normalizeRequestHostname(value: string | null | undefined): string | null {
  if (!value || value.length > 300 || value !== value.trim() || /[\s,/@?#\\]/u.test(value)) return null;

  let parsed: URL;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname.length > 253) return null;
  // Keep loopback IPs recognizable for the local application fallback. For DNS
  // names, reject empty labels and characters outside the canonical IDNA form.
  if (hostname.includes(":")) return /^[0-9a-f:]+$/i.test(hostname) ? hostname : null;
  const labels = hostname.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return hostname;
}

export function isLocalApplicationHostname(hostname: string | null): boolean {
  if (!hostname) return false;
  return hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/** Resolve only a verified primary domain attached to an active tenant's published site. */
export async function resolvePublishedSiteForHost(value: string | null | undefined): Promise<PublishedSiteHost | null> {
  const hostname = normalizeRequestHostname(value);
  if (!hostname || isLocalApplicationHostname(hostname)) return null;

  const [row] = await getDb().select({
    siteId: sites.id,
    tenantId: sites.tenantId,
    slug: sites.slug,
  }).from(domains)
    .innerJoin(sites, and(eq(sites.id, domains.siteId), eq(sites.tenantId, domains.tenantId)))
    .innerJoin(tenants, eq(tenants.id, sites.tenantId))
    .where(and(
      sql`lower(rtrim(${domains.hostname}, '.')) = ${hostname}`,
      eq(domains.isPrimary, true),
      inArray(domains.domainType, ["platform", "custom"]),
      eq(domains.verificationStatus, "verified"),
      eq(sites.status, "published"),
      eq(tenants.status, "active"),
    )).limit(1);

  return row ?? null;
}
