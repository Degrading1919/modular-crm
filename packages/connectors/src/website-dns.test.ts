import { describe, expect, it, vi } from "vitest";
import { createWebsiteDnsResolver } from "./website-dns.ts";
const missing = () => Promise.reject(Object.assign(new Error("absent"), { code: "ENODATA" }));
const hostname = "www.example.test", target = "endpoint.cloudfront.net";
function resolver(options: { ownership?: string[][]; cnames?: Record<string, string[]>; challenge?: string; addresses?: Record<string, string[]>; outage?: boolean } = {}) {
  return { resolveTxt: vi.fn(async (name: string) => {
    if (options.outage) throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
    if (name.startsWith("_modular")) return options.ownership ?? [["modular-crm-verification=", "token"]];
    return options.challenge ? [[options.challenge]] : missing();
  }), resolveCname: vi.fn(async (name: string) => options.cnames?.[name] ?? missing()),
  resolve4: vi.fn(async (name: string) => options.addresses?.[name] ?? missing()), resolve6: vi.fn(missing) };
}
describe("real DNS resolver behind a mockable network boundary", () => {
  it("joins TXT chunks and follows a bounded CNAME chain to the exact endpoint", async () => {
    const network = resolver({ cnames: { [hostname]: ["alias.example.test"], "alias.example.test": ["ENDPOINT.CLOUDFRONT.NET."] } });
    expect(await createWebsiteDnsResolver(network).check(hostname, "token", target)).toEqual({ ownership: "valid", routing: "valid" });
    expect(network.resolveTxt).toHaveBeenCalledWith(`_modular-crm-verification.${hostname}`);
  });
  it("rejects another endpoint and terminates a cyclic chain", async () => {
    for (const cnames of [{ [hostname]: ["elsewhere.example.test"] }, { [hostname]: [hostname] }]) {
      const network = resolver({ cnames });
      expect(await createWebsiteDnsResolver(network).check(hostname, "token", target)).toEqual({ ownership: "valid", routing: "wrong" });
      expect(network.resolveCname.mock.calls.length).toBeLessThanOrEqual(8);
    }
  });
  it("handles an IPv4-only flattened apex but never accepts a shared IP without the exact endpoint challenge", async () => {
    const addresses = { "example.test": ["192.0.2.1"], [target]: ["192.0.2.1"] };
    expect(await createWebsiteDnsResolver(resolver({ addresses, challenge: target })).check("example.test", "token", target)).toEqual({ ownership: "valid", routing: "valid" });
    expect((await createWebsiteDnsResolver(resolver({ addresses })).check("example.test", "token", target)).routing).toBe("wrong");
    expect((await createWebsiteDnsResolver(resolver({ addresses, challenge: "other.cloudfront.net" })).check("example.test", "token", target)).routing).toBe("wrong");
    expect((await createWebsiteDnsResolver(resolver({ addresses: { ...addresses, "example.test": ["192.0.2.2"] }, challenge: target })).check("example.test", "token", target)).routing).toBe("wrong");
  });
  it("distinguishes absent/wrong records from unavailable DNS, without retries or HTTP", async () => {
    expect(await createWebsiteDnsResolver(resolver({ ownership: [] })).check(hostname, "token", target)).toEqual({ ownership: "missing", routing: "missing" });
    expect((await createWebsiteDnsResolver(resolver({ ownership: [["another-token"]] })).check(hostname, "token", target)).ownership).toBe("wrong");
    expect(await createWebsiteDnsResolver(resolver({ outage: true })).check(hostname, "token", target)).toEqual({ ownership: "missing", routing: "missing", unavailable: true });
  });
});
