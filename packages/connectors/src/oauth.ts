import type { OAuthCredentialSet, OAuthProviderAdapter, OAuthTokenResponse } from "./types.ts";

export const OAUTH_PROVIDER_TIMEOUT_MS = 10_000;
export const OAUTH_TOKEN_RESPONSE_MAX_BYTES = 32_768;
export const OAUTH_TOKEN_MAX_LENGTH = 8_192;

const reservedAuthorizationParams = new Set([
  "response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method",
]);
const secretAuthorizationParam = /(?:secret|token|password|verifier|authorization_code|^code$)/i;

export function buildOAuthAuthorizationUrl(adapter: OAuthProviderAdapter, input: {
  state: string;
  redirectUri: string;
  scopes: readonly string[];
  codeChallenge?: string;
}): string {
  const url = new URL(adapter.authorizationEndpoint);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  let redirect: URL;
  try { redirect = new URL(input.redirectUri); } catch { throw new Error("OAuth redirect URI is invalid"); }
  const localRedirect = redirect.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(redirect.hostname);
  if ((!localHttp && url.protocol !== "https:") || url.username || url.password || url.search || url.hash
    || !adapter.clientId.trim() || adapter.clientId.length > 500 || /[\u0000-\u001f\u007f]/.test(adapter.clientId)
    || input.state.length < 32 || input.state.length > 128
    || (!localRedirect && redirect.protocol !== "https:") || redirect.username || redirect.password || redirect.search || redirect.hash
    || input.redirectUri.length > 2_000
    || (input.codeChallenge !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge))
    || input.scopes.length > 100 || input.scopes.some((scope) => typeof scope !== "string" || !scope.trim() || scope.length > 200 || /\s|[\u0000-\u001f\u007f]/.test(scope))) {
    throw new Error("OAuth authorization request is invalid");
  }
  for (const [key, value] of Object.entries(adapter.authorizationParams ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) || reservedAuthorizationParams.has(key.toLowerCase())
      || secretAuthorizationParam.test(key) || typeof value !== "string" || value.length > 500) {
      throw new Error("OAuth authorization parameters are invalid");
    }
    url.searchParams.set(key, value);
  }
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", adapter.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  if (input.scopes.length) url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  if (input.codeChallenge) {
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export function normalizeOAuthTokenResponse(response: OAuthTokenResponse, now: Date, prior?: OAuthCredentialSet): OAuthCredentialSet {
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("OAuth token response is invalid");
  const serialized = JSON.stringify(response);
  if (Buffer.byteLength(serialized, "utf8") > OAUTH_TOKEN_RESPONSE_MAX_BYTES) throw new Error("OAuth token response is too large");
  const input = response as Record<string, unknown>;
  const allowed = new Set(["accessToken", "refreshToken", "expiresInSeconds", "grantedScopes", "providerAccountId"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("OAuth token response contains unsupported fields");
  const safeToken = (value: unknown, required = false): string | undefined => {
    if (value === undefined && !required) return undefined;
    if (typeof value !== "string" || !value.trim() || value.length > OAUTH_TOKEN_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error("OAuth token response is invalid");
    }
    return value;
  };
  const accessToken = safeToken(input.accessToken, true)!;
  const refreshToken = safeToken(input.refreshToken) ?? prior?.refreshToken;
  const expiresIn = input.expiresInSeconds;
  if (expiresIn !== undefined && (!Number.isSafeInteger(expiresIn) || Number(expiresIn) < 1 || Number(expiresIn) > 31_536_000)) {
    throw new Error("OAuth token expiry is invalid");
  }
  const expiresAt = expiresIn === undefined ? prior?.expiresAt : new Date(now.getTime() + Number(expiresIn) * 1_000).toISOString();
  const rawScopes = input.grantedScopes ?? prior?.grantedScopes ?? [];
  if (!Array.isArray(rawScopes) || rawScopes.length > 100 || rawScopes.some((scope) => typeof scope !== "string" || !scope.trim() || scope.length > 200 || /[\u0000-\u001f\u007f]/.test(scope))) {
    throw new Error("OAuth scopes are invalid");
  }
  const providerAccountId = safeToken(input.providerAccountId) ?? prior?.providerAccountId;
  return Object.freeze({
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    grantedScopes: Object.freeze([...new Set(rawScopes as string[])]),
    ...(providerAccountId ? { providerAccountId } : {}),
  });
}

export async function withOAuthProviderTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs = OAUTH_PROVIDER_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("OAuth provider operation timed out"));
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
