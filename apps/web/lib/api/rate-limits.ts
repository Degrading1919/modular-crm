import { createHash } from "node:crypto";
import { consumeRateLimit } from "@modular-crm/db";
import { getDb } from "../db";
import { json } from "./http";

export function clientIpKey(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(ip.slice(0, 160)).digest("hex");
}
export async function limitKey(key: string, limit: number, windowMs: number): Promise<Response | null> {
  const result = await consumeRateLimit(getDb(), key, limit, windowMs);
  return result.allowed ? null : json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please try again in a few minutes." } }, 429, { "retry-after": String(result.retryAfter) });
}
export function limitRequest(request: Request, scope: string, limit: number, windowMs: number): Promise<Response | null> {
  return limitKey(`${scope}:${clientIpKey(request)}`, limit, windowMs);
}
