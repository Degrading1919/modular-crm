import { beforeAll, afterAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { consumeRateLimit, resetRateLimit, cleanupRateLimits } from "../src/rate-limits.ts";
import { schema } from "../src/schema/index.ts";
import type { Database } from "../src/client.ts";
let pg: PGlite, db: Database;
beforeAll(async () => {
  pg = new PGlite(); db = drizzle(pg, { schema }) as unknown as Database;
  await db.execute(sql`CREATE TABLE rate_limit_windows (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL)`);
}, 20_000);
afterAll(async () => { await pg?.close(); });
it("bounds shared atomic counters without retaining raw identifiers", async () => {
  for (let i = 0; i < 3; i++) expect(await consumeRateLimit(db, "customer@example.test:secret", 3, 60_000)).toEqual({ allowed: true, retryAfter: 0 });
  expect(await consumeRateLimit(db, "customer@example.test:secret", 3, 60_000)).toMatchObject({ allowed: false });
  const [row] = await db.select().from(schema.rateLimitWindows);
  expect(row!.count).toBe(3); expect(row!.key).toMatch(/^[0-9a-f]{64}$/);
  await resetRateLimit(db, "customer@example.test:secret");
  expect(await consumeRateLimit(db, "customer@example.test:secret", 3, 60_000)).toMatchObject({ allowed: true });
});
it("resets an expired window and cleans only expired counters", async () => {
  await consumeRateLimit(db, "expired", 1, 60_000);
  await db.execute(sql`UPDATE rate_limit_windows SET expires_at=statement_timestamp()-interval '1 second'`);
  expect(await consumeRateLimit(db, "expired", 1, 60_000)).toMatchObject({ allowed: true });
  await cleanupRateLimits(db);
  expect(await db.select().from(schema.rateLimitWindows)).toHaveLength(1);
});
