import { describe, expect, it } from "vitest";
import { websiteDomainTransition } from "./website-domains.ts";

describe("independent website DNS and TLS evidence", () => {
  it.each(["missing", "wrong"] as const)("never treats %s ownership as verified", ownership => {
    expect(websiteDomainTransition({ ownership, routing: "valid" }, false).state).toBe("waiting_dns");
    expect(websiteDomainTransition({ ownership, routing: "valid" }, true).state).toBe("needs_attention");
  });
  it.each(["missing", "wrong"] as const)("never treats %s routing as live", routing => {
    expect(websiteDomainTransition({ ownership: "valid", routing }, false, { reference: "edge", state: "ready" }).state).toBe("waiting_dns");
    expect(websiteDomainTransition({ ownership: "valid", routing }, true).state).toBe("needs_attention");
  });
  it("requires certificate and deployment readiness, retaining prior state on unavailable DNS", () => {
    const dns = { ownership: "valid", routing: "valid" } as const;
    expect(websiteDomainTransition(dns, false).state).toBe("verified");
    expect(websiteDomainTransition(dns, true, { reference: "edge", state: "pending" }).state).toBe("securing");
    expect(websiteDomainTransition(dns, true, { reference: "edge", state: "ready" }).state).toBe("live");
    expect(websiteDomainTransition(dns, true, { reference: "edge", state: "failed" }).state).toBe("needs_attention");
    expect(websiteDomainTransition({ ...dns, unavailable: true }, true, { reference: "edge", state: "ready" }, "live").state).toBe("live");
    expect(websiteDomainTransition({ ...dns, unavailable: true }, false, undefined, "waiting_dns").state).toBe("waiting_dns");
  });
});
