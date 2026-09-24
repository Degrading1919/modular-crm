import { signWebhook } from "@modular-crm/domain";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export type WebhookEvent = Readonly<{ id: string; tenantId: string; eventType: string; eventVersion: number; occurredAt: Date; entityType: string; entityId: string; organizationId?: string | null; locationId?: string | null; payload: Record<string, unknown> }>;
export type WebhookAttempt = Readonly<{ success: boolean; responseStatus?: number; responseExcerpt?: string; retryable: boolean }>;
const SENSITIVE_KEY = /secret|token|password|credential|gate.?code|access.?instruction|payment.?method|authorization/i;
class UnsafeWebhookDestination extends Error { constructor() { super("Webhook endpoint must resolve to a public address"); } }
const blockedDestinations = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedDestinations.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["2001::", 32], ["2001:2::", 48], ["2001:10::", 28], ["2001:20::", 28],
  ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blockedDestinations.addSubnet(address, prefix, "ipv6");

export function isPublicWebhookAddress(address: string, family: 4 | 6): boolean {
  if (isIP(address) !== family) return false;
  if (family === 6 && /^(?:::ffff:|0:0:0:0:0:ffff:)/i.test(address)) return false;
  return !blockedDestinations.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function matchesEventPattern(eventType: string, pattern: string): boolean {
  return pattern === "*" || pattern === eventType || (pattern.endsWith(".*") && eventType.startsWith(pattern.slice(0, -1)));
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[omitted]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(item, depth + 1)]));
  return value;
}

export function webhookBody(event: WebhookEvent): string {
  return JSON.stringify({ event_id: event.id, event_type: event.eventType, event_version: event.eventVersion, occurred_at: event.occurredAt.toISOString(), tenant_id: event.tenantId, entity: { type: event.entityType, id: event.entityId }, organization_id: event.organizationId ?? null, location_id: event.locationId ?? null, payload: sanitize(event.payload) });
}

export function nextWebhookRetryAt(attempt: number, now: Date): Date {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("Attempt must be positive");
  return new Date(now.getTime() + Math.min(3600000, 60000 * 2 ** (attempt - 1)));
}

export function validateWebhookUrl(raw: string): URL {
  const endpoint = new URL(raw);
  const host = endpoint.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Webhook endpoint must use HTTPS without URL credentials");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Webhook endpoint cannot target a local host");
  if (isIP(host)) throw new Error("Webhook endpoint cannot target a private address");
  return endpoint;
}

/** Check every DNS answer and pin the validated address used by the HTTPS socket. */
export async function resolveWebhookDestination(endpoint: URL): Promise<{ address: string; family: 4 | 6 }> {
  const addresses = await lookup(endpoint.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address, family }) =>
    (family !== 4 && family !== 6) || !isPublicWebhookAddress(address, family))) {
    throw new UnsafeWebhookDestination();
  }
  const selected = addresses[0]!;
  return { address: selected.address, family: selected.family as 4 | 6 };
}

async function verifiedHttpsPost(endpoint: URL, body: string, headers: Record<string, string>): Promise<WebhookAttempt> {
  const resolved = await resolveWebhookDestination(endpoint);
  return new Promise<WebhookAttempt>((resolve, reject) => {
    const request = httpsRequest(endpoint, {
      method: "POST", headers, signal: AbortSignal.timeout(10_000),
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
    }, (response) => {
      const status = response.statusCode ?? 0;
      const excerpt: Buffer[] = [];
      let collected = 0;
      response.on("data", (chunk: Buffer) => {
        if (collected >= 500) return;
        const part = chunk.subarray(0, 500 - collected);
        excerpt.push(part);
        collected += part.length;
      });
      response.on("error", reject);
      response.on("end", () => resolve({
        success: status >= 200 && status < 300,
        responseStatus: status,
        responseExcerpt: Buffer.concat(excerpt).toString("utf8"),
        retryable: status === 429 || status >= 500,
      }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function responseExcerpt(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (bytes < 500) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value.slice(0, 500 - bytes);
      chunks.push(chunk);
      bytes += chunk.length;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(joined);
}

export async function deliverWebhookAttempt(input: { url: string; secret: string; event: WebhookEvent; now: Date; fetcher?: typeof fetch }): Promise<WebhookAttempt> {
  const endpoint = validateWebhookUrl(input.url);
  const body = webhookBody(input.event);
  const timestampSeconds = Math.floor(input.now.getTime() / 1000);
  const headers = { "content-type": "application/json", "x-modular-crm-event-id": input.event.id, "x-modular-crm-timestamp": String(timestampSeconds), "x-modular-crm-signature": signWebhook(input.secret, timestampSeconds, body) };
  try {
    if (!input.fetcher) return await verifiedHttpsPost(endpoint, body, headers);
    const response = await input.fetcher(input.url, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(10000) });
    const excerpt = await responseExcerpt(response);
    return { success: response.ok, responseStatus: response.status, responseExcerpt: excerpt, retryable: response.status === 429 || response.status >= 500 };
  } catch (error) {
    return { success: false, responseExcerpt: error instanceof Error ? error.name : "network_error", retryable: !(error instanceof UnsafeWebhookDestination) };
  }
}
