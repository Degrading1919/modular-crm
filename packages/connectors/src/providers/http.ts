import { ConnectorError } from "../types.ts";

export type ProviderFetch = typeof fetch;

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_ERROR_BYTES = 8_192;

/** Reads at most a bounded number of bytes so a malformed provider response cannot exhaust memory. */
export async function readBoundedText(response: Response, limit = MAX_RESPONSE_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new ConnectorError("provider_error", "Provider returned an oversized response", false);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function requestJson<T>(
  fetcher: ProviderFetch,
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new ConnectorError("timeout", "The provider request timed out", true);
      }
      throw new ConnectorError("provider_error", "The provider could not be reached", true);
    }

    if (!response.ok) {
      await readBoundedText(response, MAX_ERROR_BYTES).catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new ConnectorError("authorization_expired", "Reconnect this provider", false);
      }
      throw new ConnectorError("provider_error", "The provider could not complete the request", response.status === 429 || response.status >= 500);
    }

    const text = await readBoundedText(response, options.maxBytes ?? MAX_RESPONSE_BYTES);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ConnectorError("provider_error", "The provider returned an invalid response", false);
    }
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new ConnectorError("timeout", "The provider request timed out", true);
    }
    throw new ConnectorError("provider_error", "The provider request failed", true);
  } finally {
    clearTimeout(timeout);
  }
}

export function validateCoordinates(point: { latitude: number; longitude: number }): void {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
    || point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) {
    throw new ConnectorError("invalid_request", "A route location is invalid", false);
  }
}

export function parseDurationSeconds(value: unknown): number {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?s$/.test(value)) {
    throw new ConnectorError("provider_error", "The provider returned an invalid route duration", false);
  }
  const seconds = Number(value.slice(0, -1));
  if (!Number.isFinite(seconds) || seconds < 0) throw new ConnectorError("provider_error", "The provider returned an invalid route duration", false);
  return seconds;
}
