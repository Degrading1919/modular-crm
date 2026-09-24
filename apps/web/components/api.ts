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
  const response = await fetch(path.startsWith("/api/") ? path : `/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = payload?.error as { code?: string; message?: string; details?: unknown } | undefined;
    throw new ApiError(
      error?.message || `We couldn’t complete that action (${response.status}). Please try again.`,
      response.status,
      error?.code,
      error?.details,
    );
  }
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
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100);
}

export function date(value: string | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-US", options ?? { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

export function friendly(value: string | null | undefined) {
  return (value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
