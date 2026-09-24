import { describe, expect, it } from "vitest";
import { toPasswordSetupUrl } from "../lib/auth-links.ts";

describe("Better Auth password setup links", () => {
  it("maps the API token path to the setup screen and preserves a same-origin activation callback", () => {
    const callback = "http://localhost:3000/portal/activate?accessId=access-1&token=invite-secret";
    const resetUrl = `http://localhost:3000/api/auth/reset-password/reset-secret?callbackURL=${encodeURIComponent(callback)}`;
    const mapped = new URL(toPasswordSetupUrl(resetUrl, "http://localhost:3000"));

    expect(mapped.pathname).toBe("/reset-password/reset-secret");
    expect(mapped.searchParams.get("callbackURL")).toBe(callback);
  });

  it("drops cross-origin callbacks and rejects reset links from an unexpected origin", () => {
    const resetUrl = "http://localhost:3000/api/auth/reset-password/reset-secret?callbackURL=https%3A%2F%2Fevil.example%2Fsteal";
    const mapped = new URL(toPasswordSetupUrl(resetUrl, "http://localhost:3000"));
    expect(mapped.pathname).toBe("/reset-password/reset-secret");
    expect(mapped.searchParams.has("callbackURL")).toBe(false);
    expect(() => toPasswordSetupUrl("https://evil.example/api/auth/reset-password/reset-secret", "http://localhost:3000")).toThrow(/configured app origin/);
  });
});
