import { afterEach, expect, it, vi } from "vitest";
import { authSigningSecret } from "../lib/runtime-secret.ts";

afterEach(() => vi.unstubAllEnvs());

it("requires a private signing key at production runtime", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("BETTER_AUTH_SECRET", "dev-only-replace-before-deploying-0123456789");
  expect(() => authSigningSecret()).toThrow("unique BETTER_AUTH_SECRET");
  vi.stubEnv("BETTER_AUTH_SECRET", "a-private-auth-secret-with-at-least-32-chars");
  expect(authSigningSecret()).toBe("a-private-auth-secret-with-at-least-32-chars");
});
