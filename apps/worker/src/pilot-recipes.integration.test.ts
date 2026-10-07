import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { processDomainEvent, publishPendingDomainEvents } from "./events-db.js";
import { processAutomationRun, enqueuePendingAutomationRuns } from "./automations-db.js";
import { processOutboundMessage, enqueuePendingMessages } from "./messages-db.js";
import { createMockConnectorRegistry } from "@modular-crm/connectors";
import { withRequestContext } from "@modular-crm/config/observability";
import type { PgBoss } from "pg-boss";
let pg: PGlite, db: Database;
const send = vi.fn(async (..._args: unknown[]) => "queued"), boss = { send } as unknown as PgBoss;
const at = new Date("2026-10-06T16:00:00Z"), week = new Date("2026-10-13T16:00:00Z");
const requestId = "11111111-1111-4111-8111-111111111111";
beforeAll(async () => {
  pg = new PGlite(); const raw = drizzle(pg, { schema });
  await migrate(raw, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = raw as unknown as Database; await seedDevelopment(db);
  // These scenarios run on a fixed clock, not the wall clock used by development seeding.
  await db.update(schema.tenantCapabilityGrants).set({ effectiveFrom: new Date("2020-01-01T00:00:00Z") })
    .where(eq(schema.tenantCapabilityGrants.tenantId, seedIds.happyTenant));
}, 120_000);
afterAll(async () => { await pg?.close(); });
async function activate(key: string) {
  await db.update(schema.automationRules).set({ status: "active", activeFrom: new Date("2020-01-01") }).where(and(eq(schema.automationRules.tenantId, seedIds.happyTenant), eq(schema.automationRules.sourceKey, key)));
}
async function quote() {
  const [estimate] = await db.insert(schema.estimates).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter, organizationLocationId: seedIds.augusta, status: "sent" }).returning();
  const [revision] = await db.insert(schema.estimateRevisions).values({ tenantId: seedIds.happyTenant, estimateId: estimate!.id, revisionNumber: 1, sentAt: at }).returning();
  const [event] = await withRequestContext({ requestId, route: "api.v1" }, async () => await db.insert(schema.domainEvents).values({ tenantId: seedIds.happyTenant, eventType: "estimate.sent", actorType: "staff", entityType: "estimate", entityId: estimate!.id, occurredAt: at, payload: { revisionId: revision!.id, customerId: seedIds.carter } }).returning());
  await processDomainEvent(db, boss, { tenantId: seedIds.happyTenant, eventId: event!.id });
  const [run] = await db.select().from(schema.automationRuns).where(eq(schema.automationRuns.triggeringEventId, event!.id));
  return { estimate: estimate!, event: event!, run };
}
const deliver = (message: typeof schema.outboundMessages.$inferSelect, now = week) => processOutboundMessage(db, createMockConnectorRegistry(), { tenantId: message.tenantId, messageId: message.id }, now);
const runMessages = () => db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.templateKey, "quote-follow-up"));
it("offers both recipes as drafts and does not act before the owner enables them", async () => {
  const recipes = await db.select().from(schema.automationRules).where(eq(schema.automationRules.tenantId, seedIds.happyTenant));
  expect(recipes.filter(r => ["quote-follow-up", "visit-review-request"].includes(r.sourceKey ?? ""))).toHaveLength(2);
  expect(recipes.filter(r => ["quote-follow-up", "visit-review-request"].includes(r.sourceKey ?? "")).every(r => r.status === "draft" && !r.activeFrom)).toBe(true);
  expect((await quote()).run).toBeUndefined();
});
it("waits seven days, then skips approved, expired or replaced quote revisions", async () => {
  await activate("quote-follow-up");
  for (const change of ["approved", "expired", "revised"] as const) {
    const { estimate, run } = await quote();
    expect(await processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: run!.id }, at)).toBe("retry");
    const patch = change === "approved" ? { status: "approved" } : change === "expired" ? { expiresAt: at } : { currentRevision: 2 };
    await db.update(schema.estimates).set(patch).where(eq(schema.estimates.id, estimate.id));
    expect(await processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: run!.id }, week)).toBe("completed");
  }
  expect(await runMessages()).toHaveLength(0);
});
it("requires consent, defers overnight and rechecks quote approval after deferral", async () => {
  const first = await quote();
  await processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: first.run!.id }, week);
  expect(await deliver((await runMessages())[0]!)).toBe("suppressed");
  await db.insert(schema.consentRecords).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter, channel: "email", category: "marketing", state: "opted_in", source: "test", actorType: "customer" });
  const second = await quote();
  await processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: second.run!.id }, week);
  const message = (await runMessages()).find(m => m.sendGuard.estimateId === second.estimate.id)!;
  const overnight = new Date("2026-10-14T05:00:00Z");
  expect(await deliver(message, overnight)).toBe("queued");
  const [saved] = await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.id, message.id));
  expect(saved!.nextSendAt!.toISOString()).toBe("2026-10-14T12:00:00.000Z");
  await db.update(schema.estimates).set({ status: "approved" }).where(eq(schema.estimates.id, second.estimate.id));
  expect(await deliver(saved!, saved!.nextSendAt!)).toBe("suppressed");
});
it("persists request IDs on events, automation runs, messages and recovered queue sends", async () => {
  const { run, event } = await quote();
  expect(event.requestId).toBe(requestId); expect(run!.requestId).toBe(requestId);
  send.mockClear(); await publishPendingDomainEvents(db, boss);
  expect(JSON.stringify(send.mock.calls)).toContain(requestId);
  send.mockClear(); await enqueuePendingAutomationRuns(db, boss, week);
  expect(JSON.stringify(send.mock.calls)).toContain(requestId);
  await withRequestContext({ requestId, route: "mcrm.automation-run" }, () => processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: run!.id }, week));
  const [message] = (await runMessages()).filter(m => m.requestId === requestId);
  expect(message).toBeDefined();
  send.mockClear(); await enqueuePendingMessages(db, boss, week);
  expect(JSON.stringify(send.mock.calls)).toContain(requestId);
});
it("asks for a review after a completed visit, not at activation or before its delay", async () => {
  await activate("visit-review-request");
  const [event] = await db.insert(schema.domainEvents).values({ tenantId: seedIds.happyTenant, eventType: "job.completed", actorType: "staff", entityType: "job", entityId: seedIds.completedJob, occurredAt: at, payload: { customerId: seedIds.carter, job: { status: "completed" } } }).returning();
  await processDomainEvent(db, boss, { tenantId: seedIds.happyTenant, eventId: event!.id });
  const [recipe] = await db.select().from(schema.automationRules).where(eq(schema.automationRules.sourceKey, "visit-review-request"));
  const [run] = await db.select().from(schema.automationRuns).where(and(eq(schema.automationRuns.triggeringEventId, event!.id), eq(schema.automationRuns.automationRuleId, recipe!.id)));
  expect(await processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: run!.id }, at)).toBe("retry");
  expect(await processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: run!.id }, new Date("2026-10-07T16:00:00Z"))).toBe("completed");
  const [message] = await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.templateKey, "visit-review-request"));
  expect(message).toMatchObject({ customerId: seedIds.carter, category: "marketing", jobId: seedIds.completedJob });
  expect(await deliver(message!, new Date("2026-10-07T16:00:00Z"))).toBe("sent");
});
it("keeps ordinary approved-quote automations independent of the unanswered-quote guard", async () => {
  const [rule] = await db.insert(schema.automationRules).values({ tenantId: seedIds.happyTenant, name: "Approval confirmation", source: "tenant", status: "active", activeFrom: new Date("2020-01-01"), triggerConfig: { event: "estimate.approved" }, actions: [{ actionType: "send_email", purpose: "service", configuration: { subject: "Thank you", body: "Your quote is approved." } }] }).returning();
  const [estimate] = await db.insert(schema.estimates).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter, organizationLocationId: seedIds.augusta, status: "approved" }).returning();
  const [event] = await db.insert(schema.domainEvents).values({ tenantId: seedIds.happyTenant, eventType: "estimate.approved", actorType: "customer", entityType: "estimate", entityId: estimate!.id, occurredAt: at, payload: { customerId: seedIds.carter } }).returning();
  await processDomainEvent(db, boss, { tenantId: seedIds.happyTenant, eventId: event!.id });
  const [run] = await db.select().from(schema.automationRuns).where(and(eq(schema.automationRuns.triggeringEventId, event!.id), eq(schema.automationRuns.automationRuleId, rule!.id)));
  expect(await processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: run!.id }, at)).toBe("completed");
  const [message] = await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.idempotencyKey, (run!.contextSnapshot as { plan: { actions: { executionKey: string }[] } }).plan.actions[0]!.executionKey));
  expect(message).toMatchObject({ sendGuard: {}, category: "service" });
  expect(await deliver(message!, at)).toBe("sent");
});
