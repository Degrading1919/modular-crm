import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { processDomainEvent, publishPendingDomainEvents } from "./events-db.js";
import { QUEUES } from "./queues.js";

let pg: PGlite, db: Database;
const send = vi.fn(async (..._args: unknown[]) => crypto.randomUUID());
const boss = { send } as unknown as PgBoss;
beforeAll(async () => {
  pg = new PGlite(); const raw = drizzle(pg, { schema });
  await migrate(raw, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = raw as unknown as Database; await seedDevelopment(db);
}, 120_000);
afterAll(async () => { await pg?.close(); });

it.each(["create", "activate"])("does not replay invoice backlog when a rule becomes active via %s", async mode => {
  const cutoff = new Date("2026-11-01T12:00:00Z"), entityId = crypto.randomUUID();
  const event = async (occurredAt: Date) => (await db.insert(schema.domainEvents).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, locationId: seedIds.augusta, eventType: "invoice.issued", entityType: "invoice", entityId, actorType: "system", occurredAt, payload: { customerId: seedIds.carter } }).returning())[0]!;
  const oldEvent = await event(new Date("2026-11-01T11:00:00Z"));
  const [rule] = await db.insert(schema.automationRules).values({ tenantId: seedIds.happyTenant, name: `New invoice rule ${mode}`, source: "tenant", status: mode === "create" ? "active" : "draft", activeFrom: mode === "create" ? cutoff : null, triggerConfig: { event: "invoice.issued" }, conditions: { field: "event.entityId", operator: "equals", value: entityId }, actions: [{ actionType: "notify_staff", configuration: { body: "Review the invoice." } }] }).returning();
  if (mode === "activate") await db.update(schema.automationRules).set({ status: "active", activeFrom: cutoff, updatedAt: cutoff }).where(eq(schema.automationRules.id, rule!.id));
  await publishPendingDomainEvents(db, boss, new Date("2026-11-01T12:02:00Z"));
  expect(send.mock.calls).toContainEqual(expect.arrayContaining([QUEUES.domainEvent, { tenantId: seedIds.happyTenant, eventId: oldEvent.id }]));
  expect((await db.select().from(schema.domainEvents).where(eq(schema.domainEvents.id, oldEvent.id)))[0]!.publishedAt).not.toBeNull();
  expect(await processDomainEvent(db, boss, { tenantId: seedIds.happyTenant, eventId: oldEvent.id })).toMatchObject({ automationRuns: 0 });
  const runs = () => db.select().from(schema.automationRuns).where(and(eq(schema.automationRuns.tenantId, seedIds.happyTenant), eq(schema.automationRuns.automationRuleId, rule!.id)));
  expect(await runs()).toHaveLength(0);
  const newEvent = await event(new Date("2026-11-01T12:01:00Z"));
  await publishPendingDomainEvents(db, boss, new Date("2026-11-01T12:03:00Z"));
  expect(await processDomainEvent(db, boss, { tenantId: seedIds.happyTenant, eventId: newEvent.id })).toMatchObject({ automationRuns: 1 });
  await processDomainEvent(db, boss, { tenantId: seedIds.happyTenant, eventId: newEvent.id });
  expect(await runs()).toMatchObject([{ triggeringEventId: newEvent.id, status: "queued" }]);
  expect(await runs()).toHaveLength(1);
});
