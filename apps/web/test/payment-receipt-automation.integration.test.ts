import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import {
  automationRules, automationRuns, domainEvents, invoices, outboundMessages, schema,
  seedDevelopment, seedIds, grantRecommendedCapabilitySetup, type Database,
} from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import { PET_WASTE_REMOVAL_PACK } from "@modular-crm/industry-packs";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock, getCapabilityMock, requireTenantFeatureMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(), getCapabilityMock: vi.fn(), requireTenantFeatureMock: vi.fn(async () => undefined),
}));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
vi.mock("../lib/connectors.ts", () => ({ getCapability: getCapabilityMock }));
vi.mock("../lib/api/capability-enforcement.ts", () => ({ requireTenantFeature: requireTenantFeatureMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleWorkflow } = await import("../lib/api/workflows.ts");
const { handleRecords } = await import("../lib/api/records.ts");
const { handleRoutesField } = await import("../lib/api/routes-field.ts");
const { handleJobPlanning } = await import("../lib/api/job-planning.ts");
const { processDomainEvent } = await import("../../worker/src/events-db.js");
const { processAutomationRun } = await import("../../worker/src/automations-db.js");
const { QUEUES } = await import("../../worker/src/queues.js");

let pglite: PGlite;
let db: Database;
const queueSend = vi.fn(async (..._args: unknown[]): Promise<string | null> => "queued-worker-job");
const boss = { send: queueSend } as unknown as Parameters<typeof processDomainEvent>[1];
const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};

beforeAll(async () => {
  pglite = new PGlite();
  const pgliteDb = drizzle(pglite, { schema });
  await migrate(pgliteDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = pgliteDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  getCapabilityMock.mockResolvedValue(null);
  await seedDevelopment(db);
  await db.transaction((tx) => grantRecommendedCapabilitySetup(tx, seedIds.happyTenant, ["automation_workflows", "customer_notifications"], {
    source: "payment-receipt-integration-test", sourceReference: "default-automations",
    effectiveFrom: new Date("2020-01-01T00:00:00Z"),
  }));
}, 120_000);

afterAll(async () => { await pglite?.close(); });

it("reschedules through the job API, suppresses old reminders permanently, and executes one fresh enabled reminder for the new date", async () => {
  const jobId = crypto.randomUUID(), routeId = crypto.randomUUID();
  const initialDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const nextDate = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  await db.insert(schema.jobs).values({ id: jobId, tenantId: owner.tenantId, organizationId: owner.organizationId!, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, serviceId: seedIds.weeklyService, scheduledDate: initialDate, status: "scheduled", serviceWindowStart: new Date(`${initialDate}T14:00:00Z`) });
  await db.insert(schema.jobAssignments).values({ tenantId: owner.tenantId, jobId, membershipId: seedIds.terryMembership, assignmentRole: "primary" });
  await db.insert(schema.routePlans).values({ id: routeId, tenantId: owner.tenantId, organizationLocationId: seedIds.augusta, membershipId: seedIds.terryMembership, routeDate: initialDate, status: "draft" });
  await db.insert(schema.routeStops).values({ tenantId: owner.tenantId, routePlanId: routeId, jobId, sequence: 1, status: "planned" });
  const [rule] = await db.insert(automationRules).values({ tenantId: owner.tenantId, name: "Date-bound reminder", source: "tenant", status: "active", triggerConfig: { event: "job.dispatched" }, conditions: { field: "event.entityId", operator: "equals", value: jobId }, actions: [
    { actionType: "send_sms", purpose: "service", configuration: { templateKey: "service-day-reminder", body: "Your service date is ${event.payload.scheduledDate}" } },
    { actionType: "add_note", configuration: { body: "Only actual dispatch writes this note" } },
  ] }).returning();
  const process = async (eventId: string) => {
    await processDomainEvent(db, boss, { tenantId: owner.tenantId, eventId });
    const runs = await db.select().from(automationRuns).where(and(eq(automationRuns.tenantId, owner.tenantId), eq(automationRuns.triggeringEventId, eventId)));
    for (const run of runs) expect(await processAutomationRun(db, boss, { tenantId: owner.tenantId, runId: run.id })).toBe("completed");
  };
  expect((await handleRoutesField(new Request("http://localhost", { method: "POST" }), ["routes", routeId, "publish"], owner))!.status).toBe(200);
  const [dispatch] = await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, jobId), eq(domainEvents.eventType, "job.dispatched")));
  await process(dispatch!.id);
  const [old] = await db.select().from(outboundMessages).where(eq(outboundMessages.jobId, jobId));
  expect(old!.status).toBe("queued");
  const edit = await handleRecords(new Request("http://localhost", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduledDate: nextDate }) }), ["jobs", jobId], owner);
  expect(edit!.status).toBe(200);
  const [reschedule] = await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, jobId), eq(domainEvents.eventType, "job.rescheduled")));
  expect(reschedule!.payload).toMatchObject({ previousScheduledDate: initialDate, scheduledDate: nextDate, customerId: seedIds.carter });
  expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]!.serviceWindowStart).toBeNull();
  await process(reschedule!.id);
  await processDomainEvent(db, boss, { tenantId: owner.tenantId, eventId: reschedule!.id });
  expect(await db.select().from(outboundMessages).where(eq(outboundMessages.jobId, jobId))).toHaveLength(1);
  expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0]).toMatchObject({ status: "scheduled", assignedRouteId: null });
  const newRoute = await handleRoutesField(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: nextDate, technicianId: seedIds.terryMembership }) }), ["routes"], owner);
  const newRouteId = (await newRoute!.json()).item.id;
  expect((await handleRoutesField(new Request("http://localhost", { method: "POST" }), ["routes", newRouteId, "publish"], owner))!.status).toBe(200);
  const dispatches = await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, jobId), eq(domainEvents.eventType, "job.dispatched")));
  const newDispatch = dispatches.find((event) => event.payload.scheduledDate === nextDate)!;
  await process(newDispatch.id);
  await processDomainEvent(db, boss, { tenantId: owner.tenantId, eventId: newDispatch.id });
  const messages = await db.select().from(outboundMessages).where(eq(outboundMessages.jobId, jobId));
  expect(messages).toHaveLength(2);
  expect(messages.find((message) => message.id === old!.id)).toMatchObject({ status: "suppressed", failureCode: "visit_rescheduled" });
  expect(messages.find((message) => message.id !== old!.id)).toMatchObject({ status: "queued", renderedBody: `Your service date is ${nextDate}` });
  expect(messages.find((message) => message.id !== old!.id)!.expiresAt!.getTime()).toBeGreaterThan(old!.expiresAt!.getTime());
  expect(await db.select().from(schema.notes).where(and(eq(schema.notes.entityId, jobId), eq(schema.notes.entityType, "job")))).toHaveLength(2);
  // No-op edits neither revive old mail nor create another scheduling event.
  await handleRecords(new Request("http://localhost", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduledDate: nextDate }) }), ["jobs", jobId], owner);
  expect(await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, jobId), eq(domainEvents.eventType, "job.rescheduled")))).toHaveLength(1);
  await db.update(automationRules).set({ status: "archived" }).where(eq(automationRules.id, rule!.id));
});

it("does not dispatch reminders for a never-published date edit and delivers a configured cancellation once", async () => {
  const jobId = crypto.randomUUID();
  const [job] = await db.insert(schema.jobs).values({ id: jobId, tenantId: owner.tenantId, organizationId: owner.organizationId!, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, serviceId: seedIds.weeklyService, scheduledDate: "2027-01-01", status: "scheduled" }).returning();
  const rules = await db.insert(automationRules).values([
    { tenantId: owner.tenantId, name: "Only published visits", source: "tenant", status: "active", triggerConfig: { event: "job.dispatched" }, conditions: { field: "event.entityId", operator: "equals", value: jobId }, actions: [{ actionType: "send_sms", purpose: "service", configuration: { templateKey: "service-day-reminder", body: "Service reminder" } }] },
    { tenantId: owner.tenantId, name: "Configured cancellation", source: "tenant", status: "active", triggerConfig: { event: "job.canceled" }, conditions: { field: "event.entityId", operator: "equals", value: jobId }, actions: [{ actionType: "send_sms", purpose: "service", configuration: { templateKey: "visit-cancellation", body: "Your visit was canceled: ${event.payload.reason}" } }] },
  ]).returning();
  const request = (data: unknown) => new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const edited = await handleJobPlanning(request({ idempotencyKey: crypto.randomUUID(), expectedUpdatedAt: job!.updatedAt.toISOString(), scheduledDate: "2027-01-02" }), ["jobs", jobId, "reschedule"], owner);
  expect(edited!.status).toBe(200);
  const [reschedule] = await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, jobId), eq(domainEvents.eventType, "job.rescheduled")));
  expect(reschedule!.payload).toMatchObject({ suppressedReminderCount: 0, awaitingDispatch: true });
  await processDomainEvent(db, boss, { tenantId: owner.tenantId, eventId: reschedule!.id });
  expect(await db.select().from(automationRuns).where(eq(automationRuns.triggeringEventId, reschedule!.id))).toHaveLength(0);
  expect(await db.select().from(outboundMessages).where(eq(outboundMessages.jobId, jobId))).toHaveLength(0);
  const current = (await edited!.json()).item;
  const cancel = { idempotencyKey: crypto.randomUUID(), expectedUpdatedAt: current.updatedAt, reason: "Customer is away" };
  expect((await handleJobPlanning(request(cancel), ["jobs", jobId, "cancel"], owner))!.status).toBe(200);
  expect((await (await handleJobPlanning(request(cancel), ["jobs", jobId, "cancel"], owner))!.json()).duplicate).toBe(true);
  const cancellations = await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, jobId), eq(domainEvents.eventType, "job.canceled")));
  expect(cancellations).toHaveLength(1);
  await processDomainEvent(db, boss, { tenantId: owner.tenantId, eventId: cancellations[0]!.id });
  await processDomainEvent(db, boss, { tenantId: owner.tenantId, eventId: cancellations[0]!.id });
  const runs = await db.select().from(automationRuns).where(eq(automationRuns.triggeringEventId, cancellations[0]!.id));
  expect(runs).toHaveLength(1);
  expect(await processAutomationRun(db, boss, { tenantId: owner.tenantId, runId: runs[0]!.id })).toBe("completed");
  expect(await db.select().from(outboundMessages).where(eq(outboundMessages.jobId, jobId))).toMatchObject([{ status: "queued", renderedBody: "Your visit was canceled: Customer is away" }]);
  for (const rule of rules) await db.update(automationRules).set({ status: "archived" }).where(eq(automationRules.id, rule.id));
});

it("routes the successful payment producer event through the default receipt recipe and worker", async () => {
  const recipe = PET_WASTE_REMOVAL_PACK.defaultAutomations.find(({ sourceKey }) => sourceKey === "payment-receipt");
  expect(recipe).toBeDefined();
  const [rule] = await db.insert(automationRules).values({
    tenantId: seedIds.happyTenant,
    name: recipe!.name,
    description: recipe!.description,
    source: "industry_pack",
    sourceKey: recipe!.sourceKey,
    status: "active",
    version: 1,
    triggerConfig: { event: recipe!.event, ...(recipe!.filters ? { filters: recipe!.filters } : {}) },
    conditions: {},
    actions: recipe!.actions.map((action) => ({ actionType: action.actionType, configuration: action.configuration })),
    createdByMembershipId: seedIds.oliviaMembership,
  }).returning({ id: automationRules.id });

  const [invoice] = await db.insert(invoices).values({
    tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
    customerId: seedIds.carter, status: "issued", invoiceNumber: `RECEIPT-${crypto.randomUUID().slice(0, 8)}`,
    currency: "USD", issuedAt: new Date(), totalMinor: 2_500n, paidMinor: 0n, balanceMinor: 2_500n,
  }).returning({ id: invoices.id });

  const paymentResponse = await handleWorkflow(new Request(`http://localhost/api/v1/invoices/${invoice!.id}/pay`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ amountCents: 2_500, method: "cash", idempotencyKey: "receipt-producer-worker" }),
  }), ["invoices", invoice!.id, "pay"], owner);
  expect(paymentResponse?.status).toBe(200);
  const payment = (await paymentResponse!.json() as { item: { id: string; status: string } }).item;
  expect(payment.status).toBe("succeeded");

  const [event] = await db.select().from(domainEvents).where(and(
    eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.eventType, "payment.succeeded"), eq(domainEvents.entityId, payment.id),
  )).limit(1);
  expect(event).toMatchObject({
    entityType: "payment",
    payload: { invoiceId: invoice!.id, customerId: seedIds.carter, amountCents: 2_500 },
  });

  await expect(processDomainEvent(db, boss, { tenantId: seedIds.happyTenant, eventId: event!.id }))
    .resolves.toMatchObject({ automationRuns: 1, webhookDeliveries: 0 });
  expect(queueSend.mock.calls.at(-1)?.[0]).toBe(QUEUES.automationRun);
  const [run] = await db.select().from(automationRuns).where(and(
    eq(automationRuns.tenantId, seedIds.happyTenant), eq(automationRuns.automationRuleId, rule!.id),
  )).limit(1);
  expect(run).toBeDefined();
  await expect(processAutomationRun(db, boss, { tenantId: seedIds.happyTenant, runId: run!.id }, new Date(Date.now() + 1_000)))
    .resolves.toBe("completed");

  const [message] = await db.select().from(outboundMessages).where(and(
    eq(outboundMessages.tenantId, seedIds.happyTenant), eq(outboundMessages.customerId, seedIds.carter),
    eq(outboundMessages.templateKey, "payment-receipt"),
  )).limit(1);
  expect(message).toMatchObject({
    customerId: seedIds.carter, invoiceId: null, recipient: "carter@example.test", channel: "email",
    renderedSubject: "Payment received", renderedBody: "We received your payment. You can view your receipt in your account.", status: "queued",
  });
  expect(queueSend.mock.calls.some(([name]) => name === QUEUES.outboundMessage)).toBe(true);
});
