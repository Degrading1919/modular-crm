import { trustedWebsiteOrigin } from "./website-origin";
import { and, eq, gte } from "drizzle-orm";
import { domains, sites, tenants, websiteDomainChecks } from "@modular-crm/db";
import { WEBSITE_DOMAIN_EVIDENCE_MAX_AGE_MS, DomainError } from "@modular-crm/domain";
import { getDb } from "./db";

export function websiteRequestHost(request: Request, env: Record<string, string | undefined> = process.env): string | null {
  let raw = request.headers.get("host") ?? new URL(request.url).host;
  const forwarded = request.headers.get("x-website-host");
  if (forwarded) {
    if (!trustedWebsiteOrigin(request, env)) return null;
    raw = forwarded;
  }
  if (!raw || /[\s/@?#\\,%]/.test(raw)) return null;
  try { return new URL(`https://${raw}`).hostname.toLowerCase().replace(/\.$/, ""); } catch { return null; }
}
export function isWorkspaceHost(hostname: string, env = process.env) {
  const configured = [env.APP_BASE_URL, env.BETTER_AUTH_URL, env.PUBLIC_BASE_URL].filter((value): value is string => !!value)
    .map(value => new URL(value).hostname.toLowerCase());
  return configured.includes(hostname) || (env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname));
}
export async function findWebsiteHost(hostname: string, now = new Date()) {
  const [row] = await getDb().select({ slug: sites.slug, tenantId: sites.tenantId, siteId: sites.id, status: sites.status, publishedAt: sites.publishedAt })
    .from(domains).innerJoin(websiteDomainChecks, and(eq(websiteDomainChecks.domainId, domains.id), eq(websiteDomainChecks.tenantId, domains.tenantId)))
    .innerJoin(sites, and(eq(sites.id, domains.siteId), eq(sites.tenantId, domains.tenantId)))
    .innerJoin(tenants, eq(tenants.id, sites.tenantId))
    .where(and(eq(domains.hostname, hostname), eq(domains.domainType, "custom"), eq(websiteDomainChecks.state, "live"),
      eq(websiteDomainChecks.ownershipVerified, true), eq(websiteDomainChecks.routingVerified, true), eq(tenants.status, "active"),
      gte(websiteDomainChecks.checkedAt, new Date(now.getTime() - WEBSITE_DOMAIN_EVIDENCE_MAX_AGE_MS)))).limit(1);
  return row && row.status !== "disabled" && (row.status === "published" || row.publishedAt) ? row : null;
}
/** Defense at the public API boundary as well as the request router: never trust a supplied slug on a customer Host. */
export async function assertWebsiteHostSlug(request: Request, slug: string) {
  const hostname = websiteRequestHost(request);
  if (!hostname) throw new DomainError("NOT_FOUND", "Website not found.", 404);
  if (isWorkspaceHost(hostname)) return;
  const site = await findWebsiteHost(hostname);
  if (!site || site.slug !== slug) throw new DomainError("NOT_FOUND", "Website not found.", 404);
}
