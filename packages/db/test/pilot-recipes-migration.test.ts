import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { schema } from "../src/index.ts";
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await migrate(drizzle(pg, { schema }), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
}, 120_000);
afterAll(async () => { await pg?.close(); });
it("offers drafts only to pack tenants and preserves archived or customized choices on replay", async () => {
  const db = drizzle(pg, { schema });
  const [pack, core] = await db.insert(schema.tenants).values([
    { name: "Existing pack business", slug: "pilot-migration-pack", status: "active", industryPackKey: "pet-waste-removal" },
    { name: "Industry-neutral business", slug: "pilot-migration-core", status: "active", industryPackKey: "other" },
  ]).returning();
  const [archived] = await db.insert(schema.automationRules).values({ tenantId: pack!.id, source: "industry_pack", sourceKey: "quote-follow-up", name: "Owner's archived choice", status: "archived", triggerConfig: { event: "estimate.sent" }, actions: [] }).returning();
  const migration = await readFile(fileURLToPath(new URL("../drizzle/0021_mute_shaman.sql", import.meta.url)), "utf8");
  const backfill = migration.slice(migration.indexOf("INSERT INTO automation_rules"));
  await pg.exec(backfill); await pg.exec(backfill);
  const rules = await db.select().from(schema.automationRules).where(eq(schema.automationRules.tenantId, pack!.id));
  expect(rules).toHaveLength(2);
  expect(rules.find(r => r.id === archived!.id)).toEqual(archived);
  expect(rules.find(r => r.sourceKey === "visit-review-request")).toMatchObject({ status: "draft", activeFrom: null, version: 1 });
  expect(await db.select().from(schema.automationRules).where(eq(schema.automationRules.tenantId, core!.id))).toHaveLength(0);
});
