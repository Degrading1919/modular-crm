import { describe, expect, it, vi } from "vitest";
import { buildOAuthAuthorizationUrl, normalizeOAuthTokenResponse, withOAuthProviderTimeout } from "./oauth.ts";
import type { OAuthProviderAdapter } from "./types.ts";

const adapter: OAuthProviderAdapter = {
  authorizationEndpoint: "https://provider.example/authorize",
  clientId: "public-client-id",
  authorizationParams: { access_type: "offline" },
  exchangeCode: vi.fn(),
  createScope: () => ({}),
};

describe("provider-neutral OAuth protocol", () => {
  it("builds a provider URL with server state and S256 PKCE without secret parameters", () => {
    const url = new URL(buildOAuthAuthorizationUrl(adapter, {
      state: "server-generated-random-state-0001", redirectUri: "https://crm.example/api/callback",
      scopes: ["calendar.read", "calendar.write"], codeChallenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    }));
    expect(url.searchParams.get("state")).toBe("server-generated-random-state-0001");
    expect(url.searchParams.get("code_challenge")).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("calendar.read calendar.write");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("omits PKCE only when the adapter does not support it and rejects secret URL parameters", () => {
    const url = new URL(buildOAuthAuthorizationUrl({ ...adapter, authorizationParams: { prompt: "consent" } }, {
      state: "server-generated-random-state-0002", redirectUri: "https://crm.example/callback", scopes: [],
    }));
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(() => buildOAuthAuthorizationUrl({ ...adapter, authorizationParams: { client_secret: "must-not-appear" } }, {
      state: "server-generated-random-state-0003", redirectUri: "https://crm.example/callback", scopes: [],
    })).toThrow();
  });

  it("preserves rotated token metadata when a refresh response omits unchanged fields", () => {
    const prior = {
      accessToken: "old-access", refreshToken: "old-refresh", expiresAt: "2026-09-24T12:00:00.000Z",
      grantedScopes: ["calendar.read"], providerAccountId: "account-1",
    };
    expect(normalizeOAuthTokenResponse({ accessToken: "new-access", refreshToken: "rotated-refresh", expiresInSeconds: 3600 }, new Date("2026-09-24T11:00:00.000Z"), prior))
      .toEqual({ accessToken: "new-access", refreshToken: "rotated-refresh", expiresAt: "2026-09-24T12:00:00.000Z", grantedScopes: ["calendar.read"], providerAccountId: "account-1" });
    expect(() => normalizeOAuthTokenResponse({ accessToken: "token", unexpectedSecret: "leak" } as never, new Date())).toThrow();
  });

  it("aborts a provider operation that exceeds its deadline", async () => {
    const operation = vi.fn((_signal: AbortSignal) => new Promise<string>(() => {}));
    await expect(withOAuthProviderTimeout(operation, 1)).rejects.toThrow("timed out");
    expect(operation.mock.calls[0]![0].aborted).toBe(true);
  });
});
