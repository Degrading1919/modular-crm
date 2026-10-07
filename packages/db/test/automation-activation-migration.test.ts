import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { inArray } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "../src/index.ts";
let pg: PGlite, db: Database;
beforeAll(async () => { pg = new PGlite(); const raw = drizzle(pg, { schema }); await migrate(raw, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) }); db = raw as unknown as Database; await seedDevelopment(db); }, 120_000);
afterAll(async () => { await pg?.close(); });
it("backfills active legacy cutoffs across tenants, preserves explicit/inactive cutoffs and is replay-safe", async () => {
  const updatedAt = new Date("2026-10-01T12:00:00Z"), known = new Date("2026-09-01T12:00:00Z");
  const rows = await db.insert(schema.automationRules).values([
    { status: "active", tenantId: seedIds.happyTenant, activeFrom: null },
    { status: "active", tenantId: seedIds.cleanTenant, activeFrom: null },
    { status: "active", tenantId: seedIds.happyTenant, activeFrom: known },
    { status: "paused", tenantId: seedIds.happyTenant, activeFrom: known },
    { status: "draft", tenantId: seedIds.happyTenant, activeFrom: null },
    { status: "archived", tenantId: seedIds.happyTenant, activeFrom: null },
  ].map(rule => ({ ...rule, name: "Legacy rule", source: "tenant", updatedAt, triggerConfig: { event: "invoice.issued" }, actions: [] }))).returning();
  const sql = await readFile(fileURLToPath(new URL("../drizzle/0019_automation_activation_backfill.sql", import.meta.url)), "utf8");
  await pg.exec(sql); await pg.exec(sql);
  const saved = await db.select().from(schema.automationRules).where(inArray(schema.automationRules.id, rows.map(row => row.id)));
  for (const row of rows) {
    const migrated = saved.find(item => item.id === row.id)!;
    expect(migrated.activeFrom).toEqual(row.status === "active" ? row.activeFrom ?? updatedAt : row.activeFrom);
    expect(migrated.updatedAt).toEqual(updatedAt); expect(migrated.version).toBe(row.version);
  }
});
