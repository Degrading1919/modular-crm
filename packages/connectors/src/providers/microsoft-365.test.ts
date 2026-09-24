import { describe, expect, it, vi } from "vitest";
import { buildOAuthAuthorizationUrl } from "../oauth.ts";
import { ConnectorError, type OAuthCredentialSet } from "../types.ts";
import type { ProviderFetch } from "./http.ts";
import { createMicrosoft365ConnectorDefinition } from "./microsoft-365.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const config = { tenant: "organizations", clientId: "client-id", clientSecret: "client-secret" };
const credentials: OAuthCredentialSet = { accessToken: "access-secret", refreshToken: "refresh-secret", grantedScopes: ["Calendars.ReadWrite", "Mail.Send"] };
const control = (enabledCapabilities: readonly ("calendar" | "email")[], tokens: OAuthCredentialSet = credentials) => ({
  tenantId: "tenant-1", now: () => new Date("2026-01-01T00:00:00Z"), ensureAvailable: vi.fn(), tokens, enabledCapabilities,
});

describe("Microsoft 365 OAuth connector", () => {
  it("uses tenant-scoped authorization, PKCE and only scopes for enabled capabilities", () => {
    const definition = createMicrosoft365ConnectorDefinition(config);
    expect(definition.oauth?.authorizationEndpoint).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    expect(definition.oauth?.supportsPkce).toBe(true);
    expect(definition.oauth?.isConfigured?.()).toBe(true);
    expect(definition.oauth?.scopesForCapabilities?.(["calendar"])).toEqual(["offline_access", "Calendars.ReadWrite"]);
    expect(definition.oauth?.scopesForCapabilities?.(["email"])).toEqual(["offline_access", "Mail.Send"]);
    expect(definition.oauth?.scopesForCapabilities?.(["calendar", "email"])).toEqual(["offline_access", "Calendars.ReadWrite", "Mail.Send"]);
    const url = new URL(buildOAuthAuthorizationUrl(definition.oauth!, {
      state: "s".repeat(40), redirectUri: "https://app.example/callback", scopes: ["offline_access", "Mail.Send"], codeChallenge: "c".repeat(43),
    }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("offline_access Mail.Send");
  });

  it("exchanges and refreshes tokens using form encoding and preserves rotation fields", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/token");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
      if (String(init?.body).includes("authorization_code")) {
        expect(String(init?.body)).toContain("code_verifier=pkce-verifier");
        return json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, scope: "Calendars.ReadWrite offline_access" });
      }
      expect(String(init?.body)).toContain("refresh_token=refresh-1");
      return json({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 1800, scope: "Calendars.ReadWrite offline_access" });
    }) as ProviderFetch;
    const oauth = createMicrosoft365ConnectorDefinition(config, fetcher).oauth!;
    const exchanged = await oauth.exchangeCode({ code: "code", redirectUri: "https://app.example/callback", codeVerifier: "pkce-verifier", signal: new AbortController().signal });
    expect(exchanged).toEqual({ accessToken: "access-1", refreshToken: "refresh-1", expiresInSeconds: 3600, grantedScopes: ["Calendars.ReadWrite", "offline_access"] });
    await expect(oauth.refreshTokens!({ refreshToken: exchanged.refreshToken!, signal: new AbortController().signal })).resolves.toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("lists calendars across safe Graph pagination and rejects off-host links before forwarding credentials", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-secret");
      return String(input).includes("page=2")
        ? json({ value: [{ id: "cal-2", name: "Work" }] })
        : json({ value: [{ id: "cal-1", name: "Personal" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars?page=2" });
    }) as ProviderFetch;
    const calendar = createMicrosoft365ConnectorDefinition(config, fetcher).oauth!.createScope(control(["calendar"])).calendar!;
    await expect(calendar.discoverCalendars()).resolves.toEqual([{ id: "cal-1", label: "Personal" }, { id: "cal-2", label: "Work" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);

    const hostile = vi.fn(async () => json({ value: [], "@odata.nextLink": "https://attacker.example/collect" })) as ProviderFetch;
    const hostileCalendar = createMicrosoft365ConnectorDefinition(config, hostile).oauth!.createScope(control(["calendar"])).calendar!;
    await expect(hostileCalendar.discoverCalendars()).rejects.toMatchObject({ code: "provider_error" });
    expect(hostile).toHaveBeenCalledOnce();
  });

  it("rejects capabilities whose required delegated permissions were not granted", () => {
    const oauth = createMicrosoft365ConnectorDefinition(config).oauth!;
    expect(() => oauth.createScope(control(["calendar"], { ...credentials, grantedScopes: ["Mail.Send"] }))).toThrowError(ConnectorError);
    expect(() => oauth.createScope(control(["email"], { ...credentials, grantedScopes: ["Calendars.ReadWrite"] }))).toThrowError(ConnectorError);
    expect(oauth.createScope(control(["calendar"], { ...credentials, grantedScopes: ["Calendars.ReadWrite"] })).calendar).toBeDefined();
  });

  it("bounds calendar and event pagination to ten pages", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const base = String(input).includes("/calendars/cal/events") ? "https://graph.microsoft.com/v1.0/me/calendars/cal/events" : "https://graph.microsoft.com/v1.0/me/calendars";
      return json({ value: [], "@odata.nextLink": `${base}?skip=1` });
    }) as ProviderFetch;
    const calendar = createMicrosoft365ConnectorDefinition(config, fetcher).oauth!.createScope(control(["calendar"])).calendar!;
    await expect(calendar.discoverCalendars()).rejects.toMatchObject({ code: "provider_error", retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(10);

    const eventFetcher = vi.fn(async () => json({ value: [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars/cal/events?skip=1" })) as ProviderFetch;
    const eventCalendar = createMicrosoft365ConnectorDefinition(config, eventFetcher).oauth!.createScope(control(["calendar"])).calendar!;
    await expect(eventCalendar.listEvents("cal")).rejects.toMatchObject({ code: "provider_error", retryable: false });
    expect(eventFetcher).toHaveBeenCalledTimes(10);
  });

  it("creates UTC events with Graph transactionId, lists normalized events and cancels safely", async () => {
    let deleteResponse: Response | undefined;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ transactionId: "retry-key", start: { dateTime: "2026-03-01T15:30:00", timeZone: "UTC" }, end: { dateTime: "2026-03-01T16:00:00", timeZone: "UTC" } });
        expect(String(input)).toBe("https://graph.microsoft.com/v1.0/me/calendars/cal%2Fid/events");
        return json({ id: "event-1" }, 201);
      }
      if (init?.method === "DELETE") {
        deleteResponse = new Response("deleted", { status: 200 });
        return deleteResponse;
      }
      return json({ value: [{ id: "event-1", subject: "Visit", start: { dateTime: "2026-03-01T15:30:00", timeZone: "UTC" }, end: { dateTime: "2026-03-01T16:00:00", timeZone: "UTC" } }] });
    }) as ProviderFetch;
    const calendar = createMicrosoft365ConnectorDefinition(config, fetcher).oauth!.createScope(control(["calendar"])).calendar!;
    await expect(calendar.createEvent({ calendarId: "cal/id", title: "Visit", startsAt: "2026-03-01T10:30:00-05:00", endsAt: "2026-03-01T11:00:00-05:00", idempotencyKey: "retry-key" })).resolves.toEqual({ reference: "event-1" });
    await expect(calendar.listEvents("cal/id")).resolves.toEqual([{ reference: "event-1", title: "Visit", startsAt: "2026-03-01T15:30:00.000Z", endsAt: "2026-03-01T16:00:00.000Z" }]);
    await expect(calendar.cancelEvent("event-1")).resolves.toBeUndefined();
    expect(deleteResponse?.bodyUsed).toBe(true);
  });

  it("sends Graph mail and returns no fabricated message reference on 202", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
      expect(JSON.parse(String(init?.body))).toMatchObject({ message: { subject: "Hello", body: { contentType: "Text", content: "Welcome" }, toRecipients: [{ emailAddress: { address: "owner@example.com" } }] }, saveToSentItems: true });
      return new Response(null, { status: 202 });
    }) as ProviderFetch;
    const email = createMicrosoft365ConnectorDefinition(config, fetcher).oauth!.createScope(control(["email"])).email!;
    await expect(email.sendEmail({ to: "owner@example.com", subject: "Hello", body: "Welcome", idempotencyKey: "mail-1" })).resolves.toEqual({ status: "sent" });
  });

  it("treats ambiguous mail transport and server failures as non-retryable, while preserving explicit throttling retries", async () => {
    const input = { to: "owner@example.com", subject: "Hello", body: "Welcome", idempotencyKey: "mail-1" };
    const makeEmail = (fetcher: ProviderFetch) => createMicrosoft365ConnectorDefinition(config, fetcher).oauth!.createScope(control(["email"])).email!;
    await expect(makeEmail(vi.fn(async () => new Response("private details", { status: 503 })) as ProviderFetch).sendEmail(input))
      .rejects.toMatchObject({ code: "provider_error", retryable: false, message: "Microsoft may have accepted the email; check Sent Items before retrying" });
    await expect(makeEmail(vi.fn(async () => { throw new Error("secret network diagnostic"); }) as ProviderFetch).sendEmail(input))
      .rejects.toMatchObject({ code: "provider_error", retryable: false, message: "Microsoft may have accepted the email; check Sent Items before retrying" });
    await expect(makeEmail(vi.fn(async () => new Response(null, { status: 429 })) as ProviderFetch).sendEmail(input))
      .rejects.toMatchObject({ code: "provider_error", retryable: true });
  });

  it("validates cancellation references and applies an abort timeout", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })) as ProviderFetch;
    const calendar = createMicrosoft365ConnectorDefinition(config, fetcher).oauth!.createScope(control(["calendar"])).calendar!;
    await expect(calendar.cancelEvent("in\nvalid")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(calendar.cancelEvent("x".repeat(1_025))).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();

    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler, milliseconds?: number) => {
      expect(milliseconds).toBe(12_000);
      if (typeof callback === "function") queueMicrotask(() => callback());
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    try {
      const pending = calendar.cancelEvent("valid-event");
      await expect(pending).rejects.toMatchObject({ code: "timeout", retryable: true });
      expect(timeoutSpy).toHaveBeenCalledOnce();
    } finally { timeoutSpy.mockRestore(); }
  });

  it("filters disabled capabilities and normalizes failures without exposing secrets", async () => {
    const partial = createMicrosoft365ConnectorDefinition(config).oauth!.createScope(control(["email"]));
    expect(partial.calendar).toBeUndefined();
    expect(partial.email).toBeDefined();
    const unconfigured = createMicrosoft365ConnectorDefinition({ tenant: "common", clientId: "client-id" }).oauth!;
    expect(unconfigured.isConfigured?.()).toBe(false);

    const denied = createMicrosoft365ConnectorDefinition(config, vi.fn(async () => new Response("refresh-secret private diagnostics", { status: 401 })) as ProviderFetch).oauth!;
    await expect(denied.exchangeCode({ code: "code", redirectUri: "https://app.example/callback", signal: new AbortController().signal })).rejects.toMatchObject({ code: "authorization_expired", message: "Reconnect this provider" });
    try {
      await denied.exchangeCode({ code: "code", redirectUri: "https://app.example/callback", signal: new AbortController().signal });
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as Error).message).not.toContain("refresh-secret");
    }
  });
});
