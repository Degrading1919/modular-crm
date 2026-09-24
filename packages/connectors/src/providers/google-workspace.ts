import { createHash } from "node:crypto";
import { ConnectorError, type CapabilityKey, type OAuthProviderAdapter, type OAuthTokenResponse, type ScopedCapabilities } from "../types.ts";
import type { ProviderFetch } from "./http.ts";
import { readBoundedText, requestJson } from "./http.ts";

const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const MAX_PAGES = 10;
const PAGE_SIZE = 250;

export type GoogleWorkspaceConfig = Readonly<{ clientId?: string; clientSecret?: string; fetcher?: ProviderFetch }>;
type GoogleControl = Parameters<OAuthProviderAdapter["createScope"]>[0];
type GoogleTokenBody = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown; id_token?: unknown };
type CalendarListResponse = { items?: readonly { id?: unknown; summary?: unknown; summaryOverride?: unknown }[]; nextPageToken?: unknown };
type EventsResponse = { items?: readonly GoogleEvent[]; nextPageToken?: unknown };
type GoogleEvent = { id?: unknown; summary?: unknown; start?: { dateTime?: unknown }; end?: { dateTime?: unknown } };

function safeConfig(value: string | undefined): string { return typeof value === "string" ? value.trim() : ""; }
function scopesFor(capabilities: readonly CapabilityKey[]): string[] {
  const scopes: string[] = [];
  if (capabilities.includes("calendar")) scopes.push(CALENDAR_EVENTS_SCOPE, CALENDAR_LIST_SCOPE);
  if (capabilities.includes("email")) scopes.push(GMAIL_SEND_SCOPE);
  return scopes;
}
function granted(tokens: GoogleControl["tokens"], scope: string): boolean {
  return tokens.grantedScopes.some((candidate) => candidate.split(/\s+/).includes(scope));
}
function validateId(value: string, label: string): string {
  const id = value.trim();
  if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) throw new ConnectorError("invalid_request", `Enter a valid ${label}`, false);
  return id;
}
function parseTokenResponse(data: GoogleTokenBody): OAuthTokenResponse {
  if (!data || typeof data !== "object" || typeof data.access_token !== "string" || !data.access_token.trim()
    || data.access_token.length > 8_192 || /[\u0000-\u001f\u007f]/.test(data.access_token)
    || (data.refresh_token !== undefined && (typeof data.refresh_token !== "string" || !data.refresh_token.trim() || data.refresh_token.length > 8_192))
    || (data.expires_in !== undefined && (!Number.isSafeInteger(data.expires_in) || Number(data.expires_in) < 1 || Number(data.expires_in) > 31_536_000))
    || (data.scope !== undefined && (typeof data.scope !== "string" || data.scope.length > 8_192))) {
    throw new ConnectorError("provider_error", "Google returned an invalid authorization response", false);
  }
  const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : [];
  return { accessToken: data.access_token, ...(data.refresh_token ? { refreshToken: data.refresh_token as string } : {}),
    ...(data.expires_in !== undefined ? { expiresInSeconds: Number(data.expires_in) } : {}), ...(scopes.length ? { grantedScopes: scopes } : {}) };
}

async function oauthForm(fetcher: ProviderFetch, url: string, form: URLSearchParams, signal: AbortSignal): Promise<GoogleTokenBody> {
  let response: Response;
  try {
    response = await fetcher(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal });
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new ConnectorError("timeout", "Google authorization timed out", true);
    throw new ConnectorError("provider_error", "Google authorization could not be completed", true);
  }
  if (!response.ok) {
    await readBoundedText(response, 8_192).catch(() => "");
    if (response.status === 401 || response.status === 403 || response.status === 400) {
      throw new ConnectorError("authorization_expired", "Reconnect Google Workspace", false);
    }
    throw new ConnectorError("provider_error", "Google authorization could not be completed", response.status === 429 || response.status >= 500);
  }
  const text = await readBoundedText(response, 32_768);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ConnectorError("provider_error", "Google returned an invalid authorization response", false); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ConnectorError("provider_error", "Google returned an invalid authorization response", false);
  return parsed as GoogleTokenBody;
}

function validEmail(value: string): string {
  const address = value.trim();
  if (address.length > 254 || /[\r\n\u0000-\u001f\u007f<>(),;:\\"]/.test(address)
    || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(address)) {
    throw new ConnectorError("invalid_request", "Enter a valid recipient email address", false);
  }
  return address;
}
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function encodedSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${base64Url(new TextEncoder().encode(subject)).replace(/-/g, "+").replace(/_/g, "/")}?=`;
}
function wrapBase64(value: string): string { return value.match(/.{1,76}/g)?.join("\r\n") ?? ""; }
function mimeMessage(to: string, subject: string, body: string): string {
  const body64 = wrapBase64(base64Url(new TextEncoder().encode(body)).replace(/-/g, "+").replace(/_/g, "/"));
  return `To: ${to}\r\nSubject: ${encodedSubject(subject)}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body64}`;
}
function timestamp(value: string): string {
  const parsed = new Date(value);
  if (!value || value.length > 64 || !Number.isFinite(parsed.getTime()) || !/^\d{4}-\d\d-\d\dT/.test(value)) throw new ConnectorError("invalid_request", "Enter valid event start and end times", false);
  return parsed.toISOString();
}
function eventReference(calendarId: string, key: string): string {
  // Google event IDs allow lowercase base32hex characters (0-9, a-v). SHA-256 hex is valid.
  return createHash("sha256").update(`${calendarId}\0${key}`).digest("hex");
}
function externalEventReference(calendarId: string, eventId: string): string { return `${encodeURIComponent(calendarId)}!${eventId}`; }
function splitEventReference(reference: string): { calendarId: string; eventId: string } {
  const separator = reference.indexOf("!");
  if (separator <= 0 || separator === reference.length - 1) throw new ConnectorError("invalid_request", "Enter a valid event reference", false);
  let calendarId: string;
  try { calendarId = decodeURIComponent(reference.slice(0, separator)); }
  catch { throw new ConnectorError("invalid_request", "Enter a valid event reference", false); }
  return { calendarId: validateId(calendarId, "calendar"), eventId: validateId(reference.slice(separator + 1), "event reference") };
}

export function createGoogleWorkspaceConnector(config: GoogleWorkspaceConfig = {}) {
  const clientId = safeConfig(config.clientId ?? process.env.GOOGLE_CLIENT_ID);
  const clientSecret = safeConfig(config.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET);
  const fetcher = config.fetcher ?? fetch;
  const oauth: OAuthProviderAdapter = {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId,
    supportsPkce: true,
    scopesForCapabilities: (capabilities) => scopesFor(capabilities.filter((capability) => capability === "calendar" || capability === "email")),
    // Consent is requested during an explicit connect/reconnect action so an account switch cannot reuse a prior account's refresh token.
    authorizationParams: { access_type: "offline", include_granted_scopes: "true", prompt: "consent" },
    isConfigured: () => Boolean(clientId && clientSecret),
    async exchangeCode(input) {
      if (!clientId || !clientSecret) throw new ConnectorError("connector_unavailable", "Google Workspace is not configured", false);
      const form = new URLSearchParams({ code: input.code, client_id: clientId, client_secret: clientSecret, redirect_uri: input.redirectUri, grant_type: "authorization_code" });
      if (input.codeVerifier) form.set("code_verifier", input.codeVerifier);
      return parseTokenResponse(await oauthForm(fetcher, "https://oauth2.googleapis.com/token", form, input.signal));
    },
    async refreshTokens(input) {
      if (!clientId || !clientSecret) throw new ConnectorError("connector_unavailable", "Google Workspace is not configured", false);
      const form = new URLSearchParams({ refresh_token: input.refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
      return parseTokenResponse(await oauthForm(fetcher, "https://oauth2.googleapis.com/token", form, input.signal));
    },
    async revoke(input) {
      const token = input.refreshToken ?? input.accessToken;
      if (!token) return;
      let response: Response;
      try {
        response = await fetcher("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: input.signal });
      } catch (error) {
        if (input.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new ConnectorError("timeout", "Google disconnect timed out", true);
        throw new ConnectorError("provider_error", "Google disconnect could not be completed", true);
      }
      if (!response.ok) {
        await readBoundedText(response, 8_192).catch(() => "");
        throw new ConnectorError(response.status === 401 || response.status === 403 ? "authorization_expired" : "provider_error", "Google disconnect could not be completed", response.status === 429 || response.status >= 500);
      }
      // Google revokes a shared grant, which can affect other apps using this Google authorization.
    },
    createScope(control) { return createScope(control, fetcher); },
  };
  return {
    manifest: {
      key: "google-workspace", name: "Google Workspace", description: "Connect Google Calendar and Gmail", provider: "Google",
      icon: "google", categories: ["calendar", "communication"], capabilities: ["calendar", "email"], authType: "oauth2",
      requiredScopes: [CALENDAR_EVENTS_SCOPE, CALENDAR_LIST_SCOPE, GMAIL_SEND_SCOPE], environments: ["local", "test", "production"],
      setupComplexity: "easy", discoverableResources: ["calendars"], webhookSupport: false, syncModes: ["import", "export"],
      version: "1.0.0", availability: "credentials_ready",
    },
    oauth,
  } as const;
}

function createScope(control: GoogleControl, fetcher: ProviderFetch): ScopedCapabilities {
  const enabled = new Set(control.enabledCapabilities);
  const missing = scopesFor([...enabled]).filter((scope) => !granted(control.tokens, scope));
  if (missing.length) throw new ConnectorError("authorization_expired", "Reconnect Google Workspace to grant the requested access", false);
  const headers = { authorization: `Bearer ${control.tokens.accessToken}` };
  const result: ScopedCapabilities = {};
  if (enabled.has("calendar")) result.calendar = {
    async discoverCalendars() {
      control.ensureAvailable();
      const calendars: { id: string; label: string }[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(`${GOOGLE_API}/users/me/calendarList`);
        url.searchParams.set("maxResults", String(PAGE_SIZE));
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const response = await requestJson<CalendarListResponse>(fetcher, url.toString(), { method: "GET", headers });
        for (const item of response.items ?? []) {
          if (typeof item.id !== "string" || item.id.length > 512) continue;
          const label = typeof item.summaryOverride === "string" && item.summaryOverride ? item.summaryOverride : item.summary;
          calendars.push({ id: item.id, label: typeof label === "string" && label.trim() ? label.slice(0, 300) : item.id });
        }
        if (typeof response.nextPageToken !== "string" || !response.nextPageToken || calendars.length >= MAX_PAGES * PAGE_SIZE) break;
        pageToken = response.nextPageToken;
      }
      return calendars.slice(0, MAX_PAGES * PAGE_SIZE);
    },
    async createEvent(input) {
      control.ensureAvailable();
      const calendarId = validateId(input.calendarId, "calendar");
      const title = input.title.trim();
      const startsAt = timestamp(input.startsAt);
      const endsAt = timestamp(input.endsAt);
      const key = input.idempotencyKey.trim();
      if (!title || title.length > 500 || /[\u0000-\u001f\u007f]/.test(title) || !key || key.length > 512 || /[\u0000-\u001f\u007f]/.test(key) || Date.parse(endsAt) <= Date.parse(startsAt)) {
        throw new ConnectorError("invalid_request", "Enter a title and valid event times", false);
      }
      const id = eventReference(calendarId, key);
      const url = `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events`;
      const body = JSON.stringify({ id, summary: title, start: { dateTime: startsAt }, end: { dateTime: endsAt } });
      try {
        const event = await requestJson<GoogleEvent>(fetcher, url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body });
        if (typeof event.id !== "string") throw new ConnectorError("provider_error", "Google Calendar returned an invalid event", false);
        return { reference: externalEventReference(calendarId, event.id) };
      } catch (error) {
        // The deterministic provider ID makes a replay safe after a timeout or lost response.
        if (!(error instanceof ConnectorError) || error.code !== "provider_error") throw error;
        try {
          const existing = await requestJson<GoogleEvent>(fetcher, `${url}/${encodeURIComponent(id)}`, { method: "GET", headers });
          if (existing.id === id) return { reference: externalEventReference(calendarId, id) };
        } catch { /* Preserve the original create error when no prior event can be confirmed. */ }
        throw error;
      }
    },
    async cancelEvent(reference) {
      control.ensureAvailable();
      const { calendarId, eventId } = splitEventReference(reference);
      const url = `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
      let response: Response;
      try { response = await fetcher(url, { method: "DELETE", headers }); }
      catch { throw new ConnectorError("provider_error", "Google Calendar could not cancel this event", true); }
      if (response.status === 404 || response.status === 410 || response.ok) { await readBoundedText(response, 8_192).catch(() => ""); return; }
      await readBoundedText(response, 8_192).catch(() => "");
      throw new ConnectorError(response.status === 401 || response.status === 403 ? "authorization_expired" : "provider_error", "Google Calendar could not cancel this event", response.status === 429 || response.status >= 500);
    },
    async listEvents(calendarId) {
      control.ensureAvailable();
      const id = validateId(calendarId, "calendar");
      const events: { reference: string; title: string; startsAt: string; endsAt: string }[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(`${GOOGLE_API}/calendars/${encodeURIComponent(id)}/events`);
        url.searchParams.set("maxResults", String(PAGE_SIZE)); url.searchParams.set("singleEvents", "true");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const response = await requestJson<EventsResponse>(fetcher, url.toString(), { method: "GET", headers });
        for (const event of response.items ?? []) {
          if (typeof event.id !== "string") continue;
          const start = event.start?.dateTime;
          const end = event.end?.dateTime;
          if (typeof start !== "string" || typeof end !== "string") continue;
          events.push({ reference: externalEventReference(id, event.id), title: typeof event.summary === "string" ? event.summary.slice(0, 500) : "(Untitled event)", startsAt: start, endsAt: end });
        }
        if (events.length >= MAX_PAGES * PAGE_SIZE || typeof response.nextPageToken !== "string" || !response.nextPageToken) break;
        pageToken = response.nextPageToken;
      }
      return events.slice(0, MAX_PAGES * PAGE_SIZE);
    },
  };
  if (enabled.has("email")) result.email = { async sendEmail(input) {
    control.ensureAvailable();
    const to = validEmail(input.to);
    const subject = input.subject.trim();
    const body = input.body;
    const key = input.idempotencyKey.trim();
    if (!subject || subject.length > 998 || /[\r\n\u0000-\u001f\u007f]/.test(subject) || typeof body !== "string" || body.length > 100_000
      || /\u0000/.test(body) || !key || key.length > 512 || /[\u0000-\u001f\u007f]/.test(key)) {
      throw new ConnectorError("invalid_request", "Enter a valid email subject and message", false);
    }
    // Gmail's send endpoint does not support a caller-supplied idempotency key; the key is validated but not advertised as guaranteed deduplication.
    const raw = mimeMessage(to, subject, body);
    let uncertainOutcome = false;
    let explicitRateLimit = false;
    let message: { id?: unknown };
    try {
      message = await requestJson<{ id?: unknown }>(async (input, init) => {
        const response = await fetcher(input, init);
        if (response.status === 429) explicitRateLimit = true;
        if (response.status >= 500) {
          uncertainOutcome = true;
          await readBoundedText(response, 8_192).catch(() => "");
          // requestJson normally retries 5xx responses. A sent message has no provider
          // idempotency key, so suppress automatic retries when acceptance is ambiguous.
          return new Response("", { status: 400 });
        }
        return response;
      }, `${GMAIL_API}/users/me/messages/send`, {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ raw: base64Url(new TextEncoder().encode(raw)) }),
      });
    } catch (error) {
      if (error instanceof ConnectorError && error.code === "authorization_expired") throw error;
      if (explicitRateLimit) throw error;
      if (uncertainOutcome || error instanceof ConnectorError && (error.code === "timeout" || (error.code === "provider_error" && error.retryable))) {
        throw new ConnectorError("provider_error", "Gmail's outcome may be unknown. Review the Sent folder before retrying.", false);
      }
      throw error;
    }
    if (typeof message.id !== "string" || !message.id || message.id.length > 512) throw new ConnectorError("provider_error", "Gmail returned an invalid message reference", false);
    // Accepted by Gmail; this status does not claim delivery to the recipient.
    return { reference: message.id, status: "sent" as const };
  } };
  return result;
}
