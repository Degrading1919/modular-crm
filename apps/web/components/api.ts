import { userError } from "../lib/user-errors";
import { moneyValue } from "../lib/presentation";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path.startsWith("/api/") ? path : `/api/v1${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch (issue) {
    if (issue instanceof Error && issue.name === "AbortError") throw issue;
    throw new TypeError("We couldn’t reach the service. Check your connection and try again.");
  }
  const contentType = response.headers.get("content-type") || "";
  let payload;
  try { payload = contentType.includes("application/json") ? await response.json() : null; }
  catch {
    if (response.ok) throw new TypeError("We couldn’t read the response. Please try again.");
    throw new ApiError(userError(undefined, response.status, path), response.status, "INVALID_RESPONSE");
  }
  if (!response.ok) {
    const error = (payload?.error ?? payload) as { code?: string; message?: string; details?: unknown } | undefined;
    throw new ApiError(
      userError(error, response.status, path),
      response.status,
      error?.code,
      error?.details,
    );
  }
  if (payload === null && response.status !== 204) throw new TypeError("We couldn’t read the response. Please try again.");
  return payload as T;
}

export function body(value: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(value) };
}

export function patch(value: unknown): RequestInit {
  return { method: "PATCH", body: JSON.stringify(value) };
}

export function unwrapItem<T>(result: { item?: T } | T): T {
  return result && typeof result === "object" && "item" in result && result.item !== undefined ? result.item : result as T;
}

export function unwrapItems<T>(result: { items?: T[] } | T[]): T[] {
  return Array.isArray(result) ? result : result?.items ?? [];
}

export function money(cents: number | null | undefined, currency = "USD") {
  return moneyValue(Number(cents) || 0, currency);
}

export function date(value: string | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "Not scheduled";
  return formatDateValue(value, options ?? { month: "short", day: "numeric", year: "numeric" });
}

export function friendly(value: string | null | undefined) {
  return (value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
import { formatDateValue } from "../lib/dates";
