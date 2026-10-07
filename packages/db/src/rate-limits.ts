import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Database } from "./client.ts";
import { rateLimitWindows } from "./schema/platform.ts";

export type RateLimitResult = { allowed: boolean; retryAfter: number };
type RateDatabase = Pick<Database, "insert" | "select" | "delete">;
export function rateLimitKey(scope: string): string { return createHash("sha256").update(scope).digest("hex"); }

/** PostgreSQL serializes contenders on the unique key; rejected calls never grow the counter. */
export async function consumeRateLimit(db: RateDatabase, scope: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("Invalid rate limit policy");
  const key = rateLimitKey(scope);
  const expired = sql`${rateLimitWindows.expiresAt} <= statement_timestamp()`;
  const [accepted] = await db.insert(rateLimitWindows).values({ key, count: 1, expiresAt: sql`statement_timestamp() + ${windowMs} * interval '1 millisecond'` })
    .onConflictDoUpdate({ target: rateLimitWindows.key, set: {
      count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimitWindows.count} + 1 END`,
      expiresAt: sql`CASE WHEN ${expired} THEN statement_timestamp() + ${windowMs} * interval '1 millisecond' ELSE ${rateLimitWindows.expiresAt} END`,
    }, setWhere: sql`${expired} OR ${rateLimitWindows.count} < ${limit}` }).returning({ key: rateLimitWindows.key });
  if (accepted) return { allowed: true, retryAfter: 0 };
  const [window] = await db.select({ retryAfter: sql<number>`greatest(1, ceil(extract(epoch from (${rateLimitWindows.expiresAt} - statement_timestamp()))))::integer` })
    .from(rateLimitWindows).where(eq(rateLimitWindows.key, key)).limit(1);
  return { allowed: false, retryAfter: window?.retryAfter ?? 1 };
}

export async function resetRateLimit(db: RateDatabase, scope: string): Promise<void> {
  await db.delete(rateLimitWindows).where(eq(rateLimitWindows.key, rateLimitKey(scope)));
}
export async function cleanupRateLimits(db: Database): Promise<void> {
  await db.delete(rateLimitWindows).where(sql`${rateLimitWindows.expiresAt} <= statement_timestamp()`);
}
