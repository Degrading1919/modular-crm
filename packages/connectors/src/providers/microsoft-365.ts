import { ConnectorError, type CapabilityKey, type OAuthProviderAdapter, type OAuthTokenResponse, type ScopedCapabilities } from "../types.ts";
import type { ConnectorDefinition } from "../registry.ts";
import type { ProviderFetch } from "./http.ts";
import { readBoundedText, requestJson } from "./http.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const AUTHORITY = "https://login.microsoftonline.com";
const CALENDAR_SCOPE = "Calendars.ReadWrite";
const EMAIL_SCOPE = "Mail.Send";
const MAX_GRAPH_PAGES = 10;
const MAX_GRAPH_ROWS = 1_000;

export type Microsoft365Config = Readonly<{
  clientId?: string;
  clientSecret?: string;
  tenant?: string;
}>;

type TokenPayload = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
type GraphCollection<T> = { value?: unknown; "@odata.nextLink"?: unknown };
type GraphCalendar = { id?: unknown; name?: unknown };
type GraphEvent = {
  id?: unknown;
  subject?: unknown;
  start?: { dateTime?: unknown; timeZone?: unknown };
  end?: { dateTime?: unknown; timeZone?: unknown };
};

const manifest: ConnectorDefinition["manifest"] = {
  key: "microsoft-365",
  name: "Microsoft 365",
  description: "Connect your Microsoft calendar and send email.",
  provider: "Microsoft",
  icon: "microsoft",
  categories: ["calendar", "communication"],
  capabilities: ["calendar", "email"],
  authType: "oauth2",
  requiredScopes: ["offline_access", CALENDAR_SCOPE, EMAIL_SCOPE],
  environments: ["local", "test", "production"],
  setupComplexity: "easy",
  discoverableResources: ["calendars"],
  webhookSupport: false,
  syncModes: ["import", "export"],
  version: "1.0.0",
  availability: "credentials_ready",
};

function resolveConfig(config: Microsoft365Config): Required<Microsoft365Config> {
  const env: Readonly<Record<string, string | undefined>> = typeof process === "undefined" ? {} : process.env;
  const clientId = (config.clientId ?? env.MICROSOFT_365_CLIENT_ID ?? "").trim();
  const clientSecret = (config.clientSecret ?? env.MICROSOFT_365_CLIENT_SECRET ?? "").trim();
  const tenant = (config.tenant ?? env.MICROSOFT_365_TENANT ?? "common").trim();
  const tenantDomain = tenant.length <= 253 && tenant.split(".").length >= 2
    && tenant.split(".").every((label: string) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
  if (!(["common", "organizations", "consumers"].includes(tenant.toLowerCase())
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenant)
    || tenantDomain)) {
    throw new ConnectorError("invalid_request", "Microsoft 365 tenant configuration is invalid", false);
  }
  return { clientId, clientSecret, tenant };
}

function scopesFor(capabilities: readonly CapabilityKey[]): readonly string[] {
  const scopes = ["offline_access"];
  if (capabilities.includes("calendar")) scopes.push(CALENDAR_SCOPE);
  if (capabilities.includes("email")) scopes.push(EMAIL_SCOPE);
  return scopes;
}

function parseTokenResponse(value: TokenPayload): OAuthTokenResponse {
  if (typeof value.access_token !== "string" || !value.access_token.trim() || value.access_token.length > 8_192
    || (value.refresh_token !== undefined && (typeof value.refresh_token !== "string" || !value.refresh_token.trim() || value.refresh_token.length > 8_192))
    || (value.expires_in !== undefined && (!Number.isSafeInteger(value.expires_in) || Number(value.expires_in) < 1 || Number(value.expires_in) > 31_536_000))
    || (value.scope !== undefined && (typeof value.scope !== "string" || value.scope.length > 8_192))) {
    throw new ConnectorError("provider_error", "Microsoft returned an invalid token response", false);
  }
  return {
    accessToken: value.access_token,
    ...(typeof value.refresh_token === "string" ? { refreshToken: value.refresh_token } : {}),
    ...(typeof value.expires_in === "number" ? { expiresInSeconds: value.expires_in } : {}),
    ...(typeof value.scope === "string" ? { grantedScopes: value.scope.split(/\s+/).filter(Boolean) } : {}),
  };
}

function tokenRequest(fetcher: ProviderFetch, endpoint: string, fields: Record<string, string>, signal: AbortSignal): Promise<TokenPayload> {
  const body = new URLSearchParams(fields);
  return requestJson<TokenPayload>(fetcher, endpoint, {
    method: "POST", redirect: "error",
    headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal,
  });
}

function validIsoDate(input: string): string {
  const value = input.trim();
  const date = new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
  if (!value || !Number.isFinite(date.getTime())) throw new ConnectorError("invalid_request", "Enter a valid event date and time", false);
  return date.toISOString();
}

function graphDateTime(input: string): { dateTime: string; timeZone: "UTC" } {
  return { dateTime: validIsoDate(input).replace(/\.\d{3}Z$/, ""), timeZone: "UTC" };
}

function graphUrl(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ConnectorError("provider_error", "Microsoft returned an invalid page link", false); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "graph.microsoft.com" || parsed.username || parsed.password || parsed.port) {
    throw new ConnectorError("provider_error", "Microsoft returned an unsafe page link", false);
  }
  return parsed.toString();
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 8_192) throw new ConnectorError("provider_error", message, false);
  return value;
}

async function sendAccepted(fetcher: ProviderFetch, url: string, init: RequestInit): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    let response: Response;
    try { response = await fetcher(url, { ...init, redirect: "error", signal: controller.signal }); }
    catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new ConnectorError("provider_error", "Microsoft may have accepted the email; check Sent Items before retrying", false);
      throw new ConnectorError("provider_error", "Microsoft may have accepted the email; check Sent Items before retrying", false);
    }
    if (response.status === 202) return;
    if (response.status === 401 || response.status === 403) throw new ConnectorError("authorization_expired", "Reconnect this provider", false);
    if (response.status === 429) throw new ConnectorError("provider_error", "Microsoft asked you to retry sending later", true);
    if (response.status >= 500) throw new ConnectorError("provider_error", "Microsoft may have accepted the email; check Sent Items before retrying", false);
    throw new ConnectorError("provider_error", "The provider could not complete the request", false);
  } finally { clearTimeout(timeout); }
}

export function createMicrosoft365ConnectorDefinition(config: Microsoft365Config = {}, fetcher: ProviderFetch = fetch): ConnectorDefinition {
  const resolved = resolveConfig(config);
  const configured = Boolean(resolved.clientId && resolved.clientSecret);
  const tokenEndpoint = `${AUTHORITY}/${resolved.tenant}/oauth2/v2.0/token`;
  const oauth: OAuthProviderAdapter = {
    authorizationEndpoint: `${AUTHORITY}/${resolved.tenant}/oauth2/v2.0/authorize`,
    clientId: resolved.clientId || "microsoft-365-unconfigured",
    supportsPkce: true,
    authorizationParams: { response_mode: "query" },
    isConfigured: () => configured,
    scopesForCapabilities: scopesFor,
    async exchangeCode(input) {
      const response = await tokenRequest(fetcher, tokenEndpoint, {
        client_id: resolved.clientId,
        client_secret: resolved.clientSecret,
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
      }, input.signal);
      return parseTokenResponse(response);
    },
    async refreshTokens(input) {
      const response = await tokenRequest(fetcher, tokenEndpoint, {
        client_id: resolved.clientId,
        client_secret: resolved.clientSecret,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
      }, input.signal);
      return parseTokenResponse(response);
    },
    createScope(control): ScopedCapabilities {
      const capabilities: ScopedCapabilities = {};
      const enabled = new Set(control.enabledCapabilities);
      const granted = new Set(control.tokens.grantedScopes);
      if ((enabled.has("calendar") && !granted.has(CALENDAR_SCOPE)) || (enabled.has("email") && !granted.has(EMAIL_SCOPE))) {
        throw new ConnectorError("authorization_expired", "Reconnect Microsoft 365 and grant the requested access", false);
      }
      const graphHeaders = () => ({ authorization: `Bearer ${control.tokens.accessToken}` });
      if (enabled.has("calendar")) capabilities.calendar = {
        async discoverCalendars() {
          control.ensureAvailable();
          const calendars: { id: string; label: string }[] = [];
          let next: string | undefined = `${GRAPH}/me/calendars`;
          let pages = 0;
          while (next) {
            if (pages >= MAX_GRAPH_PAGES) throw new ConnectorError("provider_error", "Microsoft returned too many calendar pages", false);
            pages++;
            const page: GraphCollection<GraphCalendar> = await requestJson<GraphCollection<GraphCalendar>>(fetcher, graphUrl(next), { method: "GET", headers: graphHeaders(), redirect: "error" });
            if (!Array.isArray(page.value)) throw new ConnectorError("provider_error", "Microsoft returned invalid calendars", false);
            for (const raw of page.value) {
              if (calendars.length >= MAX_GRAPH_ROWS) throw new ConnectorError("provider_error", "Microsoft returned too many calendars", false);
              const item = raw as GraphCalendar;
              calendars.push({ id: requireString(item.id, "Microsoft returned an invalid calendar"), label: requireString(item.name, "Microsoft returned an invalid calendar") });
            }
            next = typeof page["@odata.nextLink"] === "string" ? page["@odata.nextLink"] : undefined;
          }
          return calendars;
        },
        async createEvent(input) {
          control.ensureAvailable();
          const title = input.title.trim();
          if (!input.calendarId.trim() || !title || title.length > 500 || !input.idempotencyKey.trim() || input.idempotencyKey.length > 255) {
            throw new ConnectorError("invalid_request", "Enter a calendar, event title and retry key", false);
          }
          const startsAt = validIsoDate(input.startsAt);
          const endsAt = validIsoDate(input.endsAt);
          if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new ConnectorError("invalid_request", "Event end must be after its start", false);
          const created = await requestJson<GraphEvent>(fetcher, `${GRAPH}/me/calendars/${encodeURIComponent(input.calendarId)}/events`, {
            method: "POST", redirect: "error", headers: { ...graphHeaders(), "content-type": "application/json" },
            body: JSON.stringify({ subject: title, start: graphDateTime(startsAt), end: graphDateTime(endsAt), transactionId: input.idempotencyKey }),
          });
          return { reference: requireString(created.id, "Microsoft returned an invalid event") };
        },
        async cancelEvent(reference) {
          control.ensureAvailable();
          if (typeof reference !== "string" || reference.length > 1_024 || /[\u0000-\u001f\u007f]/.test(reference)) throw new ConnectorError("invalid_request", "Event reference is invalid", false);
          const value = reference.trim();
          if (!value) throw new ConnectorError("invalid_request", "Event reference is invalid", false);
          const id = encodeURIComponent(value);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 12_000);
          let response: Response;
          try {
            try { response = await fetcher(`${GRAPH}/me/events/${id}`, { method: "DELETE", headers: graphHeaders(), redirect: "error", signal: controller.signal }); }
            catch (error) {
              if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new ConnectorError("timeout", "The provider request timed out", true);
              throw new ConnectorError("provider_error", "The provider could not be reached", true);
            }
            await readBoundedText(response, 8_192).catch(() => "");
            if (controller.signal.aborted) throw new ConnectorError("timeout", "The provider request timed out", true);
            if (response.status === 401 || response.status === 403) throw new ConnectorError("authorization_expired", "Reconnect this provider", false);
            if (!response.ok && response.status !== 404) throw new ConnectorError("provider_error", "The provider could not complete the request", response.status === 429 || response.status >= 500);
          } finally { clearTimeout(timeout); }
        },
        async listEvents(calendarId) {
          control.ensureAvailable();
          if (!calendarId.trim()) throw new ConnectorError("invalid_request", "Calendar is required", false);
          const events: { reference: string; title: string; startsAt: string; endsAt: string }[] = [];
          let next: string | undefined = `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/events`;
          let pages = 0;
          while (next) {
            if (pages >= MAX_GRAPH_PAGES) throw new ConnectorError("provider_error", "Microsoft returned too many event pages", false);
            pages++;
            const page: GraphCollection<GraphEvent> = await requestJson<GraphCollection<GraphEvent>>(fetcher, graphUrl(next), { method: "GET", headers: { ...graphHeaders(), Prefer: 'outlook.timezone="UTC"' }, redirect: "error" });
            if (!Array.isArray(page.value)) throw new ConnectorError("provider_error", "Microsoft returned invalid events", false);
            for (const raw of page.value) {
              if (events.length >= MAX_GRAPH_ROWS) throw new ConnectorError("provider_error", "Microsoft returned too many events", false);
              const item = raw as GraphEvent;
              const start = item.start?.dateTime;
              const end = item.end?.dateTime;
              if (typeof start !== "string" || typeof end !== "string") throw new ConnectorError("provider_error", "Microsoft returned an invalid event", false);
              events.push({ reference: requireString(item.id, "Microsoft returned an invalid event"), title: typeof item.subject === "string" ? item.subject : "", startsAt: validIsoDate(start), endsAt: validIsoDate(end) });
            }
            next = typeof page["@odata.nextLink"] === "string" ? page["@odata.nextLink"] : undefined;
          }
          return events;
        },
      };
      if (enabled.has("email")) capabilities.email = {
        async sendEmail(input) {
          control.ensureAvailable();
          const to = input.to.trim();
          const subject = input.subject.trim();
          const body = input.body;
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || subject.length > 998 || !body.trim() || body.length > 100_000 || !input.idempotencyKey.trim()) {
            throw new ConnectorError("invalid_request", "Enter a valid recipient, subject and message", false);
          }
          await sendAccepted(fetcher, `${GRAPH}/me/sendMail`, {
            method: "POST", headers: { ...graphHeaders(), "content-type": "application/json" },
            body: JSON.stringify({ message: { subject, body: { contentType: "Text", content: body }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }),
          });
          return { status: "sent" as const };
        },
      };
      return capabilities;
    },
  };
  return { manifest, oauth };
}
