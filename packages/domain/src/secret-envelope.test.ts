import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "./secret-envelope.ts";

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("secret envelopes", () => {
  it("encrypts and authenticates stored secret material", () => {
    const envelope = sealSecret("endpoint-secret", key);
    expect(envelope).not.toContain("endpoint-secret");
    expect(openSecret(envelope, key)).toBe("endpoint-secret");
    expect(openSecret(sealSecret("endpoint-secret", key), key)).toBe("endpoint-secret");
  });

  it("rejects tampering, wrong keys, and non-32-byte key configuration", () => {
    const envelope = sealSecret("endpoint-secret", key);
    expect(() => openSecret(`${envelope.slice(0, -1)}A`, key)).toThrow();
    expect(() => openSecret(envelope, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")).toThrow();
    expect(() => sealSecret("endpoint-secret", "too-short")).toThrow(/32-byte key/);
  });
});
