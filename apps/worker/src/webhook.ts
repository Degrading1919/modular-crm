import { signWebhook } from "@modular-crm/domain";
import { isIP } from "node:net";

export type WebhookEvent = Readonly<{ id: string; tenantId: string; eventType: string; eventVersion: number; occurredAt: Date; entityType: string; entityId: string; organizationId?: string | null; locationId?: string | null; payload: Record<string, unknown> }>;
export type WebhookAttempt = Readonly<{ success: boolean; responseStatus?: number; responseExcerpt?: string; retryable: boolean }>;
const SENSITIVE_KEY = /secret|token|password|credential|gate.?code|access.?instruction|payment.?method|authorization/i;

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
  validateWebhookUrl(input.url);
  const body = webhookBody(input.event);
  const timestampSeconds = Math.floor(input.now.getTime() / 1000);
  try {
    const response = await (input.fetcher ?? fetch)(input.url, { method: "POST", headers: { "content-type": "application/json", "x-modular-crm-event-id": input.event.id, "x-modular-crm-timestamp": String(timestampSeconds), "x-modular-crm-signature": signWebhook(input.secret, timestampSeconds, body) }, body, signal: AbortSignal.timeout(10000) });
    const excerpt = await responseExcerpt(response);
    return { success: response.ok, responseStatus: response.status, responseExcerpt: excerpt, retryable: response.status === 429 || response.status >= 500 };
  } catch (error) {
    return { success: false, responseExcerpt: error instanceof Error ? error.name : "network_error", retryable: true };
  }
}
