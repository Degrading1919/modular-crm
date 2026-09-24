import { describe, expect, it, vi } from "vitest";
import { ConnectorError, type OAuthCredentialSet } from "../types.ts";
import type { ProviderFetch } from "./http.ts";
import { createGoogleWorkspaceConnector } from "./google-workspace.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const config = { clientId: "google-client", clientSecret: "google-secret" };
const allScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
const tokens: OAuthCredentialSet = { accessToken: "access-token-secret", refreshToken: "refresh-token-secret", grantedScopes: allScopes };
const scopeControl = (enabledCapabilities: ("calendar" | "email")[], grantedScopes = allScopes) => ({
  tenantId: "tenant-1", now: () => new Date("2026-01-01T00:00:00.000Z"), ensureAvailable: vi.fn(), enabledCapabilities,
  tokens: { ...tokens, grantedScopes },
});

describe("Google Workspace OAuth connector", () => {
  it("requests only the enabled capability scopes and gates missing app configuration", () => {
    const connector = createGoogleWorkspaceConnector(config);
    expect(connector.oauth.scopesForCapabilities?.(["calendar", "email", "payments"])).toEqual(allScopes);
    expect(connector.oauth.scopesForCapabilities?.(["email"])).toEqual(["https://www.googleapis.com/auth/gmail.send"]);
    expect(connector.oauth.scopesForCapabilities?.(["calendar"])).toEqual(allScopes.slice(0, 2));
    expect(connector.oauth.authorizationParams).toMatchObject({ access_type: "offline", include_granted_scopes: "true", prompt: "consent" });
    expect(connector.oauth.authorizationParams).toMatchObject({ access_type: "offline", prompt: "consent" });
    expect(connector.oauth.supportsPkce).toBe(true);
    expect(connector.oauth.isConfigured?.()).toBe(true);
    expect(createGoogleWorkspaceConnector({ clientId: "google-client" }).oauth.isConfigured?.()).toBe(false);
  });

  it("exchanges and refreshes tokens with form encoding and maps snake case fields", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body));
      expect(new Headers(init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
      expect(form.get("client_secret")).toBe("google-secret");
      if (form.get("grant_type") === "authorization_code") {
        expect(form.get("code_verifier")).toBe("pkce-verifier");
        return json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, scope: allScopes.join(" ") });
      }
      expect(form.get("refresh_token")).toBe("old-refresh");
      return json({ access_token: "refreshed-access", expires_in: 1800, scope: allScopes.join(" ") });
    }) as ProviderFetch;
    const oauth = createGoogleWorkspaceConnector({ ...config, fetcher }).oauth;
    await expect(oauth.exchangeCode({ code: "one-time-code", redirectUri: "https://app.test/callback", codeVerifier: "pkce-verifier", signal: new AbortController().signal }))
      .resolves.toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh", expiresInSeconds: 3600, grantedScopes: allScopes });
    const refreshed = await oauth.refreshTokens!({ refreshToken: "old-refresh", signal: new AbortController().signal });
    expect(refreshed).toMatchObject({ accessToken: "refreshed-access", expiresInSeconds: 1800 });
    expect(refreshed).not.toHaveProperty("refreshToken");
  });

  it("filters disabled capabilities and enforces granted scopes", async () => {
    const emailOnly = createGoogleWorkspaceConnector({ ...config, fetcher: vi.fn() as ProviderFetch }).oauth.createScope({ ...scopeControl(["email"]), tenantId: "tenant-1" });
    expect(emailOnly.email).toBeDefined();
    expect(emailOnly.calendar).toBeUndefined();
    expect(() => createGoogleWorkspaceConnector(config).oauth.createScope({ ...scopeControl(["calendar"], [allScopes[2]!]), tenantId: "tenant-1" }))
      .toThrowError(ConnectorError);
  });

  it("lists calendars and events with bounded pagination, sends valid MIME, and preserves Google IDs", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.includes("calendarList")) {
        return url.includes("pageToken") ? json({ items: [{ id: "team@example.com", summary: "Team" }] }) : json({ items: [{ id: "primary", summary: "Owner", summaryOverride: "My calendar" }], nextPageToken: "next" });
      }
      if (url.includes("/messages/send")) return json({ id: "gmail-message-42" });
      if (url.includes("/events?") || url.includes("/events&")) return json({ items: [{ id: "event-1", summary: "Service visit", start: { dateTime: "2026-01-02T10:00:00Z" }, end: { dateTime: "2026-01-02T11:00:00Z" } }] });
      return json({ id: "provider-event-id" }, 201);
    }) as ProviderFetch;
    const scope = createGoogleWorkspaceConnector({ ...config, fetcher }).oauth.createScope({ ...scopeControl(["calendar", "email"]), tenantId: "tenant-1" });
    await expect(scope.calendar!.discoverCalendars()).resolves.toEqual([{ id: "primary", label: "My calendar" }, { id: "team@example.com", label: "Team" }]);
    const created = await scope.calendar!.createEvent({ calendarId: "team@example.com", title: "Service visit", startsAt: "2026-01-02T10:00:00Z", endsAt: "2026-01-02T11:00:00Z", idempotencyKey: "visit-123" });
    expect(decodeURIComponent(created.reference)).toContain("team@example.com!");
    expect(JSON.parse(String(calls.find((call) => call.init?.method === "POST")?.init?.body))).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{64}$/), summary: "Service visit" });
    await expect(scope.calendar!.listEvents("team@example.com")).resolves.toMatchObject([{ title: "Service visit", startsAt: "2026-01-02T10:00:00Z" }]);
    expect(calls.find((call) => call.url.includes("/events?"))?.url).toContain("maxResults=250");
    await expect(scope.email!.sendEmail({ to: "owner@example.com", subject: "Visit confirmed", body: "See you soon", idempotencyKey: "mail-1" }))
      .resolves.toEqual({ reference: "gmail-message-42", status: "sent" });
    const emailCall = calls.find((call) => call.url.includes("gmail.googleapis.com"))!;
    const message = JSON.parse(String(emailCall.init?.body)) as { raw: string };
    const decoded = Buffer.from(message.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(decoded).toContain("To: owner@example.com\r\nSubject: Visit confirmed");
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
  });

  it("uses deterministic event IDs to resolve a retry after a lost create response", async () => {
    let first = true;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && first) { first = false; throw new TypeError("connection dropped"); }
      if (init?.method === "POST") return new Response("already exists", { status: 409 });
      if (init?.method === "GET" && url.includes("/events/")) return json({ id: decodeURIComponent(url.split("/").at(-1)!) });
      return json({});
    }) as ProviderFetch;
    const calendar = createGoogleWorkspaceConnector({ ...config, fetcher }).oauth.createScope({ ...scopeControl(["calendar"]), tenantId: "tenant-1" }).calendar!;
    const input = { calendarId: "primary", title: "Visit", startsAt: "2026-01-02T10:00:00Z", endsAt: "2026-01-02T11:00:00Z", idempotencyKey: "stable-key" };
    const firstResult = await calendar.createEvent(input);
    const retryResult = await calendar.createEvent(input);
    expect(retryResult).toEqual(firstResult);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("normalizes authorization failures and rejects unsafe headers without leaking provider details", async () => {
    const denied = createGoogleWorkspaceConnector({ ...config, fetcher: vi.fn(async () => new Response("private token diagnostics", { status: 403 })) as ProviderFetch })
      .oauth.createScope({ ...scopeControl(["email"]), tenantId: "tenant-1" }).email!;
    try {
      await denied.sendEmail({ to: "owner@example.com", subject: "Hi", body: "Hello", idempotencyKey: "one" });
      throw new Error("Expected authorization failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "authorization_expired" });
      expect((error as Error).message).not.toContain("private");
    }
    await expect(denied.sendEmail({ to: "owner@example.com\r\nBcc: bad@example.com", subject: "Hi", body: "Hello", idempotencyKey: "one" }))
      .rejects.toMatchObject({ code: "invalid_request" });
  });

  it("marks ambiguous Gmail send outcomes non-retryable without exposing transport details", async () => {
    const networkFailure = createGoogleWorkspaceConnector({ ...config, fetcher: vi.fn(async () => { throw new TypeError("secret socket diagnostics"); }) as ProviderFetch })
      .oauth.createScope({ ...scopeControl(["email"]), tenantId: "tenant-1" }).email!;
    try {
      await networkFailure.sendEmail({ to: "owner@example.com", subject: "Hi", body: "Hello", idempotencyKey: "one" });
      throw new Error("Expected an ambiguous provider failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "provider_error", retryable: false, message: expect.stringContaining("outcome may be unknown") });
      expect((error as Error).message).not.toContain("secret");
    }

    const rateLimited = createGoogleWorkspaceConnector({ ...config, fetcher: vi.fn(async () => new Response("rate limited", { status: 429 })) as ProviderFetch })
      .oauth.createScope({ ...scopeControl(["email"]), tenantId: "tenant-1" }).email!;
    await expect(rateLimited.sendEmail({ to: "owner@example.com", subject: "Hi", body: "Hello", idempotencyKey: "one" }))
      .rejects.toMatchObject({ code: "provider_error", retryable: true });
  });
});
