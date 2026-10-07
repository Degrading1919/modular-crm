import { Resolver } from "node:dns/promises";
import type { DomainDnsObservation, WebsiteDnsResolver, WebsiteEdgeProvider } from "@modular-crm/domain";

const canonical = (name: string) => name.toLowerCase().replace(/\.$/, "");
const missing = (error: unknown) => ["ENODATA", "ENOTFOUND"].includes((error as { code?: string }).code ?? "");
type DnsNetwork = { resolveTxt(name: string): Promise<string[][]>; resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>; resolve6(name: string): Promise<string[]> };
/** DNS only: never fetch a tenant-supplied URL, change a zone, or follow arbitrary HTTP redirects. */
export function createWebsiteDnsResolver(resolver: DnsNetwork = new Resolver({ timeout: 2000, tries: 1 })): WebsiteDnsResolver {
  async function txt(name: string) { try { return (await resolver.resolveTxt(name)).map(chunks => chunks.join("")); } catch (error) { if (missing(error)) return []; throw error; } }
  async function addresses(name: string) {
    const results = await Promise.all([resolver.resolve4(name), resolver.resolve6(name)].map(promise => promise.catch(error => { if (missing(error)) return []; throw error; })));
    return results.flat().sort();
  }
  return { async check(hostname, token, target) {
    try {
      const proof = await txt(`_modular-crm-verification.${hostname}`);
      const ownership = proof.includes(`modular-crm-verification=${token}`) ? "valid" : proof.length ? "wrong" : "missing";
      let current = hostname;
      let hasCname = false;
      for (let depth = 0; depth < 8; depth++) {
        let names: string[];
        try { names = await resolver.resolveCname(current); } catch (error) { if (missing(error)) break; throw error; }
        if (names.length !== 1) break;
        hasCname = true; current = canonical(names[0]!);
        if (current === canonical(target)) return { ownership, routing: "valid" };
      }
      if (hasCname) return { ownership, routing: "wrong" };
      // Apex ALIAS/ANAME/flattening does not expose a CNAME. Require the exact
      // connection-group challenge AND matching endpoint addresses (not a shared
      // CloudFront IP alone) so another distribution is not accepted as our route.
      const [challenge, actual, expected] = await Promise.all([txt(`_cf-challenge.${hostname}`), addresses(hostname), addresses(target)]);
      const routing = !actual.length ? "missing" : challenge.includes(target) && expected.length > 0 && actual.every(value => expected.includes(value)) ? "valid" : "wrong";
      return { ownership, routing };
    } catch { return { ownership: "missing", routing: "missing", unavailable: true }; }
  } };
}
export const mockWebsiteDnsResolver: WebsiteDnsResolver = { async check(_hostname, _token, _target, records = {}) {
  const value = (key: string): DomainDnsObservation["ownership"] => records[key] === "valid" || records[key] === "wrong" ? records[key] : "missing";
  return { ownership: value("ownership"), routing: value("routing"), ...(records.unavailable === true ? { unavailable: true } : {}) };
} };
export const mockWebsiteEdgeProvider: WebsiteEdgeProvider = {
  async ensure(input) { return { reference: `mock:${input.id}`, state: input.mockRecords?.certificate === "pending" ? "pending" : input.mockRecords?.certificate === "failed" ? "failed" : "ready" }; },
  async remove() { return true; },
};
