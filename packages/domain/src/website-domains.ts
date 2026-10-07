export const WEBSITE_DOMAIN_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60_000;
export type WebsiteDomainState = "waiting_dns" | "verified" | "securing" | "live" | "needs_attention" | "removing";
export type DomainDnsObservation = { ownership: "valid" | "missing" | "wrong"; routing: "valid" | "missing" | "wrong"; unavailable?: boolean };
export type WebsiteEdgeResult = { reference: string; state: "pending" | "ready" | "failed" };
/** Ownership, routing and HTTPS are independent evidence; losing either DNS proof revokes serving. */
export function websiteDomainTransition(dns: DomainDnsObservation, wasVerified: boolean, edge?: WebsiteEdgeResult, previousState: WebsiteDomainState = wasVerified ? "verified" : "waiting_dns") {
  if (dns.unavailable) return { state: previousState, problem: "We couldn’t check your domain. We’ll check again shortly." };
  if (dns.ownership !== "valid") return { state: wasVerified ? "needs_attention" as const : "waiting_dns" as const,
    problem: dns.ownership === "wrong" ? "The ownership record has a different value. Copy the value shown below." : "Waiting for your ownership record to appear." };
  if (dns.routing !== "valid") return { state: wasVerified ? "needs_attention" as const : "waiting_dns" as const,
    problem: dns.routing === "wrong" ? "This record points somewhere else. Update the website address record shown below." : "Waiting for your website address record to appear." };
  if (!edge) return { state: "verified" as const, problem: null };
  if (edge.state === "failed") return { state: "needs_attention" as const, problem: "Your secure connection needs attention. Check your DNS records or contact support." };
  return { state: edge.state === "ready" ? "live" as const : "securing" as const, problem: null };
}
export interface WebsiteDnsResolver { check(hostname: string, token: string, target: string, mockRecords?: Record<string, unknown>): Promise<DomainDnsObservation> }
export interface WebsiteEdgeProvider {
  ensure(input: { id: string; hostname: string; reference?: string | null; mockRecords?: Record<string, unknown> }): Promise<WebsiteEdgeResult>;
  remove(reference: string): Promise<boolean>;
}
