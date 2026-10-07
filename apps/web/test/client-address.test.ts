import { expect, it } from "vitest";
import { clientAddress } from "../lib/api/client-address";
const request = (value?: string) => new Request("http://localhost", { headers: { ...(value ? { "x-forwarded-for": value } : {}), "x-real-ip": "203.0.113.99" } });
it("ignores all address headers without an explicitly configured local proxy", () => {
  for (const NODE_ENV of ["development", "test"]) expect(clientAddress(request("198.51.100.1"), { NODE_ENV })).toBe("local");
});
it("uses the first trusted proxy's observed address, not spoofed leftmost entries", () => {
  const env = { NODE_ENV: "production" };
  for (const spoof of ["198.51.100.1", "198.51.100.2", "invalid"]) expect(clientAddress(request(`${spoof}, 203.0.113.10`), env)).toBe("203.0.113.10");
  expect(clientAddress(request("spoof, 203.0.113.10, 10.0.0.1"), { TRUSTED_PROXY_HOPS: "2" })).toBe("203.0.113.10");
});
it("normalizes IPv6 and proxy-preserved client ports; malformed or short chains fail closed", () => {
  const env = { TRUSTED_PROXY_HOPS: "1" };
  expect(clientAddress(request("203.0.113.10:443"), env)).toBe("203.0.113.10");
  expect(clientAddress(request("[2001:0db8:0:0:0:0:0:1]:54321"), env)).toBe("2001:db8::1");
  for (const value of [undefined, "garbage", "203.0.113.10:99999", "203.0.113.10:0"]) expect(clientAddress(request(value), env)).toBe("local");
  expect(clientAddress(request("203.0.113.10"), { TRUSTED_PROXY_HOPS: "2" })).toBe("local");
});
it("adds the website edge hop only for a secret-authenticated origin, never a viewer's header", () => {
  const env = { NODE_ENV: "production", WEBSITE_ORIGIN_SECRET: "x".repeat(48) };
  const routed = (key: string) => new Request("http://localhost", { headers: { "x-forwarded-for": "forged, 203.0.113.10, 192.0.2.20", "x-website-host": "www.example.test", "x-website-origin-key": key } });
  expect(clientAddress(routed("x".repeat(48)), env)).toBe("203.0.113.10");
  expect(clientAddress(routed("forged"), env)).toBe("192.0.2.20");
  expect(clientAddress(routed("x".repeat(48)), { ...env, NODE_ENV: "test", TRUSTED_PROXY_HOPS: "0" })).toBe("local");
  expect(() => clientAddress(routed("x".repeat(48)), { ...env, TRUSTED_PROXY_HOPS: "0" })).toThrow("TRUSTED_PROXY_HOPS");
});
