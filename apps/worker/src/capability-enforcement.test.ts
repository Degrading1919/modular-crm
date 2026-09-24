import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { PgBoss } from "pg-boss";
import { createMockConnectorRegistry } from "@modular-crm/connectors";
import {
  automationRules, automationRuns, communicationEvents,
  customers, domainEvents, jobs, memberships, organizations, outboundMessages, recurrenceRules,
  recurringGenerationLedger, roleTemplates, schema, serviceLocations, servicePlans, services,
  tenantCapabilityGrants, tenants, user, webhookDeliveries, webhookSubscriptions,
} from "@modular-crm/db";
import type { Database } from "@modular-crm/db";
import { grantRecommendedCapabilitySetup, installInitialCapabilityCatalog } from "@modular-crm/db";
import { processAutomationRun } from "./automations-db.js";
import { processDomainEvent } from "./events-db.js";
import { processOutboundMessage } from "./messages-db.js";
import { generateRecurringJobs } from "./recurring-db.js";

let pglite: PGlite;
let db: Database;
let tenantCounter = 0;

beforeAll(async () => {
  pglite = new PGlite();
  const pgliteDb = drizzle(pglite, { schema });
  await migrate(pgliteDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = pgliteDb as unknown as Database;
  await db.transaction((tx) => installInitialCapabilityCatalog(tx));
}, 120_000);

afterAll(async () => { await pglite?.close(); });

async function createTenant(label: string): Promise<string> {
  const suffix = ++tenantCounter;
  const [tenant] = await db.insert(tenants).values({
    name: label,
    slug: "worker-capability-" + suffix,
    status: "active",
  }).returning({ id: tenants.id });
  return tenant!.id;
}

async function grantFeatures(tenantId: string, featureKeys: string[]): Promise<void> {
  await db.transaction((tx) => grantRecommendedCapabilitySetup(tx, tenantId, featureKeys, {
    source: "worker-capability-test",
    sourceReference: tenantId,
    effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
  }));
}

async function createRecurringPlan(tenantId: string): Promise<string> {
  const [organization] = await db.insert(organizations).values({
    tenantId, legalName: "Capability Test Business", displayName: "Capability Test Business",
  }).returning({ id: organizations.id });
  const [customer] = await db.insert(customers).values({
    tenantId, organizationId: organization!.id, displayName: "Recurring Customer",
  }).returning({ id: customers.id });
  const [location] = await db.insert(serviceLocations).values({
    tenantId, customerId: customer!.id, name: "Home", addressLine1: "1 Main Street", city: "Albany", region: "NY", postalCode: "12207",
  }).returning({ id: serviceLocations.id });
  const [service] = await db.insert(services).values({
    tenantId, key: "weekly-service", name: "Weekly service", serviceType: "maintenance",
  }).returning({ id: services.id });
  const [recurrence] = await db.insert(recurrenceRules).values({
    tenantId, frequencyType: "daily", interval: 1, timezone: "UTC",
  }).returning({ id: recurrenceRules.id });
  const [plan] = await db.insert(servicePlans).values({
    tenantId, customerId: customer!.id, serviceLocationId: location!.id, serviceId: service!.id,
    status: "active", effectiveFrom: "2026-09-24", pricingSnapshot: {}, recurrenceRuleId: recurrence!.id,
  }).returning({ id: servicePlans.id });
  return plan!.id;
}

async function createOwnerMembership(tenantId: string): Promise<string> {
  const [organization] = await db.insert(organizations).values({
    tenantId, legalName: "Webhook Test Business", displayName: "Webhook Test Business",
  }).returning({ id: organizations.id });
  const [role] = await db.insert(roleTemplates).values({ tenantId, key: "owner", name: "Owner" }).returning({ id: roleTemplates.id });
  const userId = "worker-test-owner-" + tenantId;
  await db.insert(user).values({ id: userId, name: "Test Owner", email: userId + "@example.test" });
  const [membership] = await db.insert(memberships).values({
    tenantId, userId, organizationId: organization!.id, roleTemplateId: role!.id, status: "active",
  }).returning({ id: memberships.id });
  return membership!.id;
}

function mockBoss() {
  const send = vi.fn(async (..._args: unknown[]): Promise<string | null> => "queued-job");
  return { boss: { send } as unknown as PgBoss, send };
}

it("skips recurring generation without the recurring service capability", async () => {
  const tenantId = await createTenant("Recurring capability business");
  const planId = await createRecurringPlan(tenantId);
  const now = new Date("2026-09-24T12:00:00.000Z");

  expect(await generateRecurringJobs(db, { tenantId, planId, through: "2026-09-24", now })).toEqual({ created: 0, existing: 0 });
  expect(await db.select().from(jobs).where(eq(jobs.tenantId, tenantId))).toHaveLength(0);
  expect(await db.select().from(recurringGenerationLedger).where(eq(recurringGenerationLedger.tenantId, tenantId))).toHaveLength(0);

  await grantFeatures(tenantId, ["recurring_service_management"]);
  expect(await generateRecurringJobs(db, { tenantId, planId, through: "2026-09-24", now })).toEqual({ created: 1, existing: 0 });
  expect(await db.select().from(jobs).where(eq(jobs.tenantId, tenantId))).toHaveLength(1);
});

it("skips automation planning without its capability while still delivering matching webhooks", async () => {
  const tenantId = await createTenant("Event capability business");
  const membershipId = await createOwnerMembership(tenantId);
  await db.insert(automationRules).values({
    tenantId, name: "Add a note", source: "tenant", status: "active",
    triggerConfig: { event: "job.created" },
    actions: [{ actionType: "add_note", configuration: { body: "Check access details." } }],
  });
  const [subscription] = await db.insert(webhookSubscriptions).values({
    tenantId, name: "Job events", url: "https://example.test/events", eventPatterns: ["job.created"],
    secretReference: "test-secret-reference", status: "active", createdByMembershipId: membershipId,
  }).returning({ id: webhookSubscriptions.id });
  const [event] = await db.insert(domainEvents).values({
    tenantId, eventType: "job.created", eventVersion: 1, occurredAt: new Date("2026-09-24T12:00:00.000Z"),
    actorType: "system", entityType: "job", entityId: randomUUID(), payload: {},
  }).returning({ id: domainEvents.id });
  const { boss, send } = mockBoss();

  await expect(processDomainEvent(db, boss, { tenantId, eventId: event!.id }))
    .resolves.toEqual({ automationRuns: 0, webhookDeliveries: 1 });

  expect(await db.select().from(automationRuns).where(eq(automationRuns.tenantId, tenantId))).toHaveLength(0);
  expect(await db.select().from(webhookDeliveries).where(and(
    eq(webhookDeliveries.tenantId, tenantId), eq(webhookDeliveries.webhookSubscriptionId, subscription!.id),
  ))).toHaveLength(1);
  expect(send.mock.calls.map(([queueName]) => queueName)).toEqual(["mcrm.webhook-delivery"]);

  await grantFeatures(tenantId, ["automation_workflows"]);
  await expect(processDomainEvent(db, boss, { tenantId, eventId: event!.id }))
    .resolves.toEqual({ automationRuns: 1, webhookDeliveries: 1 });
  expect(await db.select().from(automationRuns).where(eq(automationRuns.tenantId, tenantId))).toHaveLength(1);
});

it("fails a queued automation after its capability is revoked without retrying", async () => {
  const tenantId = await createTenant("Automation capability business");
  await grantFeatures(tenantId, ["automation_workflows"]);
  const [rule] = await db.insert(automationRules).values({
    tenantId, name: "Pending workflow", source: "tenant", status: "active",
    triggerConfig: { event: "job.created" }, actions: [],
  }).returning({ id: automationRules.id });
  const [run] = await db.insert(automationRuns).values({
    tenantId, automationRuleId: rule!.id, ruleVersion: 1, triggeringEventId: randomUUID(),
    idempotencyKey: "queued-run-loses-capability", status: "queued", contextSnapshot: {},
  }).returning({ id: automationRuns.id });
  const now = new Date("2026-09-24T12:00:00.000Z");
  await db.update(tenantCapabilityGrants).set({ revokedAt: new Date(now.getTime() - 1) })
    .where(eq(tenantCapabilityGrants.tenantId, tenantId));
  const { boss, send } = mockBoss();

  await expect(processAutomationRun(db, boss, { tenantId, runId: run!.id }, now)).resolves.toBe("failed");

  const [persisted] = await db.select().from(automationRuns).where(eq(automationRuns.id, run!.id));
  expect(persisted).toMatchObject({
    status: "failed", attempts: 1, errorCode: "capability_unavailable", nextRetryAt: null,
  });
  expect(persisted!.completedAt).toEqual(now);
  expect(send).not.toHaveBeenCalled();
});

it("suppresses outbound messages when customer notifications are unavailable", async () => {
  const tenantId = await createTenant("Notification capability business");
  const [message] = await db.insert(outboundMessages).values({
    tenantId, channel: "email", recipient: "customer@example.test", renderedBody: "Service update",
    idempotencyKey: "message-without-notification-capability", status: "queued",
  }).returning({ id: outboundMessages.id });
  const registry = createMockConnectorRegistry();

  await expect(processOutboundMessage(db, registry, { tenantId, messageId: message!.id }))
    .resolves.toBe("suppressed");

  const [persisted] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, message!.id));
  expect(persisted).toMatchObject({ status: "suppressed", failureCode: "capability_unavailable" });
  const events = await db.select().from(communicationEvents).where(eq(communicationEvents.outboundMessageId, message!.id));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ eventType: "suppressed", payload: { reason: "capability_unavailable" } });
  expect(registry.getInstallation(tenantId, "mock-communication").state).toBe("not_connected");
});
