import { and, asc, eq, lte, sql } from "drizzle-orm";
import { billingReadOnly, DomainError, websiteDomainTransition, type WebsiteDnsResolver, type WebsiteEdgeProvider } from "@modular-crm/domain";
import type { Database } from "./client.ts";
import { domains, platformSubscriptions, websiteDomainChecks } from "./schema/index.ts";

export type WebsiteHosting = { dns: WebsiteDnsResolver; edge: WebsiteEdgeProvider; target: string };
/** Serialize checks/removal, not ordinary business writes. No owner credentials or DNS mutations. */
export async function checkWebsiteDomain(db: Database, tenantId: string, domainId: string, hosting: WebsiteHosting, provision = false, now = new Date()) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`website-domain:${domainId}`}, 0))`);
    const [row] = await tx.select().from(domains).innerJoin(websiteDomainChecks, and(eq(websiteDomainChecks.domainId, domains.id), eq(websiteDomainChecks.tenantId, domains.tenantId)))
      .where(and(eq(domains.id, domainId), eq(domains.tenantId, tenantId), eq(domains.domainType, "custom"))).limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "Custom domain not found.", 404);
    const domain = row.domains, check = row.website_domain_checks;
    if (check.state === "removing") return check;
    const token = domain.verificationData?.verificationToken;
    if (typeof token !== "string") {
      const [invalid] = await tx.update(websiteDomainChecks).set({ state: "needs_attention", problem: "Remove and reconnect this domain to get a new ownership record.",
        ownershipVerified: false, routingVerified: false, checkedAt: now, nextCheckAt: new Date(now.getTime() + 15 * 60_000), updatedAt: now })
        .where(and(eq(websiteDomainChecks.domainId, domain.id), eq(websiteDomainChecks.tenantId, tenantId))).returning();
      return invalid!;
    }
    const dns = await hosting.dns.check(domain.hostname, token, hosting.target, check.mockRecords);
    let edge;
    const previouslyVerified = check.ownershipVerified || ["verified", "securing", "live", "needs_attention"].includes(check.state);
    let transition = websiteDomainTransition(dns, previouslyVerified, undefined, check.state as Parameters<typeof websiteDomainTransition>[3]);
    if (dns.ownership === "valid" && dns.routing === "valid" && !dns.unavailable && (provision || check.edgeReference)) {
      try { edge = await hosting.edge.ensure({ id: domain.id, hostname: domain.hostname, reference: check.edgeReference, mockRecords: check.mockRecords });
        transition = websiteDomainTransition(dns, previouslyVerified, edge, check.state as Parameters<typeof websiteDomainTransition>[3]);
      } catch { transition = { state: "needs_attention", problem: "We couldn’t set up your secure connection. We’ll check again shortly; contact support if this continues." }; }
    }
    const [updated] = await tx.update(websiteDomainChecks).set({ ...transition,
      ownershipVerified: dns.unavailable ? check.ownershipVerified : dns.ownership === "valid", routingVerified: dns.unavailable ? check.routingVerified : dns.routing === "valid",
      edgeReference: edge?.reference ?? check.edgeReference, checkedAt: dns.unavailable ? check.checkedAt : now, nextCheckAt: new Date(now.getTime() + (transition.state === "live" ? 15 : 1) * 60_000), updatedAt: now })
      .where(and(eq(websiteDomainChecks.domainId, domain.id), eq(websiteDomainChecks.tenantId, tenantId))).returning();
    return updated!;
  });
}

export async function sweepWebsiteDomains(db: Database, hosting: WebsiteHosting, now = new Date()) {
  const due = await db.select().from(websiteDomainChecks).where(lte(websiteDomainChecks.nextCheckAt, now)).orderBy(asc(websiteDomainChecks.nextCheckAt)).limit(25);
  const started = Date.now();
  for (const entry of due) {
    // A slow external provider cannot keep one queue job busy indefinitely.
    // Finish the current bounded check, then let remaining oldest rows be picked
    // up by the next scheduled job. Serving still fails closed on stale evidence.
    if (Date.now() - started >= 60_000) break;
    if (entry.state === "removing") {
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`website-domain:${entry.domainId}`}, 0))`);
        const [current] = await tx.select().from(websiteDomainChecks).where(eq(websiteDomainChecks.domainId, entry.domainId));
        if (current?.state !== "removing") return;
        let removed;
        try { removed = await hosting.edge.remove(current.edgeReference ?? `crm-domain-${entry.domainId}`); }
        catch {
          await tx.update(websiteDomainChecks).set({ problem: "We couldn’t finish removing the secure connection. We’ll check again shortly; contact support if this continues.", nextCheckAt: new Date(now.getTime() + 60_000) })
            .where(and(eq(websiteDomainChecks.domainId, entry.domainId), eq(websiteDomainChecks.tenantId, entry.tenantId)));
          return;
        }
        if (!removed) {
          await tx.update(websiteDomainChecks).set({ nextCheckAt: new Date(now.getTime() + 60_000) }).where(eq(websiteDomainChecks.domainId, entry.domainId));
          return;
        }
        const [subscription] = await tx.select().from(platformSubscriptions).where(eq(platformSubscriptions.tenantId, entry.tenantId));
        if (subscription && billingReadOnly(subscription.status)) {
          // Edge cleanup is finished; retain the claim until business mutation is
          // permitted again. This never re-enables serving or bypasses billing.
          await tx.update(websiteDomainChecks).set({ edgeReference: null, nextCheckAt: new Date(now.getTime() + 15 * 60_000) }).where(eq(websiteDomainChecks.domainId, entry.domainId));
        } else await tx.delete(domains).where(and(eq(domains.id, entry.domainId), eq(domains.tenantId, entry.tenantId)));
      });
      continue;
    }
    await checkWebsiteDomain(db, entry.tenantId, entry.domainId, hosting, true, now);
  }
}
