import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, inArray } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import type { PgBoss } from "pg-boss";
import {
  automationRules, automationRuns, consentRecords, customers, domainEvents, internalNotifications,
  invoices, jobs, memberships, organizationLocations, organizations, outboundMessages, payments,
  roleTemplates, schema, serviceLocations, services, tenants, ticketStatusDefinitions,
  ticketTypeDefinitions, tickets, user,
  grantRecommendedCapabilitySetup, installInitialCapabilityCatalog, type Database,
} from "@modular-crm/db";
import { createMockConnectorRegistry } from "@modular-crm/connectors";
import { PET_WASTE_REMOVAL_PACK } from "../../../packages/industry-packs/src/pet-waste-removal.ts";
import { processAutomationRun } from "./automations-db.js";
import { processDomainEvent } from "./events-db.js";
import { processOutboundMessage } from "./messages-db.js";
import { QUEUES } from "./queues.js";

let pglite: PGlite;
let db: Database;
let tenantId: string;
let organizationId: string;
let locationId: string;
let customerOne: { id: string; email: string; phone: string; serviceLocationId: string };
let customerTwo: { id: string; email: string; phone: string; serviceLocationId: string };
let serviceId: string;
let ownerMembershipId: string;
const priorMockConnectors = process.env.MOCK_CONNECTORS;

const queueSend = vi.fn(async (..._args: unknown[]): Promise<string | null> => "queued-worker-job");
const boss = { send: queueSend } as unknown as PgBoss;
const workerNow = () => new Date(Date.now() + 1_000);

beforeAll(async () => {
  pglite = new PGlite();
  const pgliteDb = drizzle(pglite, { schema });
  await migrate(pgliteDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = pgliteDb as unknown as Database;
  await db.transaction((tx) => installInitialCapabilityCatalog(tx));

  const [tenant] = await db.insert(tenants).values({
    name: "Automation Pack Test", slug: "automation-pack-test", status: "active",
    industryPackKey: PET_WASTE_REMOVAL_PACK.key, industryPackVersion: PET_WASTE_REMOVAL_PACK.version,
  }).returning({ id: tenants.id });
  tenantId = tenant!.id;
  await db.transaction((tx) => grantRecommendedCapabilitySetup(tx, tenantId, ["automation_workflows", "customer_notifications"], {
    source: "integration-test", sourceReference: "default-automations", effectiveFrom: new Date("2020-01-01T00:00:00Z"),
  }));

  const [organization] = await db.insert(organizations).values({ tenantId, legalName: "Automation Pack Test", displayName: "Automation Pack Test" }).returning({ id: organizations.id });
  organizationId = organization!.id;
  const [location] = await db.insert(organizationLocations).values({ tenantId, organizationId, name: "Main", code: "MAIN" }).returning({ id: organizationLocations.id });
  locationId = location!.id;
  const [role] = await db.insert(roleTemplates).values({ tenantId, key: "owner", name: "Owner" }).returning({ id: roleTemplates.id });
  const ownerUserId = "automation-pack-owner";
  await db.insert(user).values({ id: ownerUserId, name: "Pack Owner", email: "automation-pack-owner@example.test" });
  const [membership] = await db.insert(memberships).values({
    tenantId, userId: ownerUserId, organizationId, defaultLocationId: locationId,
    roleTemplateId: role!.id, status: "active", joinedAt: new Date(),
  }).returning({ id: memberships.id });
  ownerMembershipId = membership!.id;
  await db.insert(ticketTypeDefinitions).values({ tenantId, key: "plan_change_review", name: "Service plan change review" });
  await db.insert(ticketStatusDefinitions).values({ tenantId, key: "open", name: "Open", normalizedCategory: "open", sortOrder: 1 });

  const [service] = await db.insert(services).values({ tenantId, organizationId, key: "yard-cleanup", name: "Yard cleanup", serviceType: "maintenance" }).returning({ id: services.id });
  serviceId = service!.id;
  customerOne = await createCustomer("Signup Customer", "signup");
  customerTwo = await createCustomer("Dispatch Customer", "dispatch");
  await installPackRecipes();
  process.env.MOCK_CONNECTORS = "true";
}, 120_000);

afterAll(async () => {
  if (priorMockConnectors === undefined) delete process.env.MOCK_CONNECTORS;
  else process.env.MOCK_CONNECTORS = priorMockConnectors;
  await pglite?.close();
});

async function createCustomer(name: string, key: string) {
  const email = `${key}@example.test`;
  const phone = key === "signup" ? "+15555550101" : "+15555550102";
  const [customer] = await db.insert(customers).values({
    tenantId, organizationId, owningLocationId: locationId, displayName: name, billingEmail: email, billingPhone: phone,
  }).returning({ id: customers.id });
  const [serviceLocation] = await db.insert(serviceLocations).values({
    tenantId, customerId: customer!.id, organizationLocationId: locationId, name: "Home",
    addressLine1: "1 Main Street", city: "Albany", region: "NY", postalCode: "12207",
  }).returning({ id: serviceLocations.id });
  await db.insert(consentRecords).values({
    tenantId, customerId: customer!.id, channel: "sms", category: "transactional", state: "opted_in",
    source: "integration-test", actorType: "customer", evidence: { confirmation: true },
  });
  return { id: customer!.id, email, phone, serviceLocationId: serviceLocation!.id };
}

async function installPackRecipes() {
  await db.insert(automationRules).values(PET_WASTE_REMOVAL_PACK.defaultAutomations.map((recipe) => ({
    tenantId,
    name: recipe.name,
    description: recipe.description,
    source: "industry_pack",
    sourceKey: recipe.sourceKey,
    status: recipe.enabledByDefault ? "active" : "draft",
    version: 1,
    triggerConfig: { event: recipe.event, ...(recipe.filters ? { filters: recipe.filters } : {}) },
    conditions: {},
    actions: recipe.actions.map((action) => ({ actionType: action.actionType, configuration: action.configuration })),
    createdByMembershipId: ownerMembershipId,
  })));
}

async function createJob(customer: typeof customerOne, status: string) {
  const [job] = await db.insert(jobs).values({
    tenantId, organizationId, organizationLocationId: locationId, customerId: customer.id,
    serviceLocationId: customer.serviceLocationId, serviceId, status, scheduledDate: "2026-09-25",
  }).returning({ id: jobs.id });
  return job!.id;
}

async function createInvoiceAndPayment(customer: typeof customerOne, status: "succeeded" | "failed") {
  const [invoice] = await db.insert(invoices).values({
    tenantId, organizationId, organizationLocationId: locationId, customerId: customer.id,
    status: "issued", invoiceNumber: `AUTO-${crypto.randomUUID().slice(0, 8)}`, currency: "USD",
    issuedAt: new Date(), totalMinor: 2_500n, paidMinor: 0n, balanceMinor: 2_500n,
  }).returning({ id: invoices.id });
  const [payment] = await db.insert(payments).values({
    tenantId, customerId: customer.id, status, sourceType: "mock", amountMinor: 2_500n,
    currency: "USD", receivedAt: status === "succeeded" ? new Date() : null,
    idempotencyKey: `automation-${status}-${crypto.randomUUID()}`,
    recordedByActorType: "system", recordedByActorId: "payment-processor",
  }).returning({ id: payments.id });
  return { invoiceId: invoice!.id, paymentId: payment!.id };
}

async function triggerEvent(event: {
  type: string; entityType: string; entityId: string; payload?: Record<string, unknown>;
}) {
  const [eventRow] = await db.insert(domainEvents).values({
    tenantId, eventType: event.type, eventVersion: 1, occurredAt: new Date(Date.now() - 10_000),
    actorType: "system", entityType: event.entityType, entityId: event.entityId,
    organizationId, locationId, payload: event.payload ?? {},
  }).returning({ id: domainEvents.id });
  const before = await db.select({ id: outboundMessages.id }).from(outboundMessages).where(eq(outboundMessages.tenantId, tenantId));
  const beforeIds = new Set(before.map(({ id }) => id));
  const planning = await processDomainEvent(db, boss, { tenantId, eventId: eventRow!.id });
  const runs = await db.select().from(automationRuns).where(and(eq(automationRuns.tenantId, tenantId), eq(automationRuns.triggeringEventId, eventRow!.id)));
  for (const run of runs) await processAutomationRun(db, boss, { tenantId, runId: run.id }, workerNow());
  const newMessages = (await db.select().from(outboundMessages).where(eq(outboundMessages.tenantId, tenantId))).filter((message) => !beforeIds.has(message.id));
  const updatedRuns = runs.length ? await db.select().from(automationRuns).where(inArray(automationRuns.id, runs.map((run) => run.id))) : [];
  return { eventId: eventRow!.id, planning, runs: updatedRuns, messages: newMessages };
}

it("matches and executes default pack automation recipes against emitted event contracts", async () => {
  const signup = await triggerEvent({
    type: "site_submission.created", entityType: "site_submission", entityId: crypto.randomUUID(),
    payload: { formType: "signup", kind: "customer", customerId: customerOne.id, servicePlanId: crypto.randomUUID() },
  });
  expect(signup.planning.automationRuns).toBe(1);
  expect(signup.runs).toHaveLength(1);
  expect(signup.messages).toHaveLength(1);
  expect(signup.messages[0]).toMatchObject({ customerId: customerOne.id, recipient: customerOne.email, channel: "email", templateKey: "signup-confirmation", status: "queued" });

  const reviewSubmissionId = crypto.randomUUID();
  const review = await triggerEvent({
    type: "site_submission.created", entityType: "site_submission", entityId: reviewSubmissionId,
    payload: { formType: "signup", kind: "lead", leadId: crypto.randomUUID(), reviewReason: "additional_details_needed" },
  });
  expect(review.planning.automationRuns).toBe(1);
  expect(review.messages).toHaveLength(0);
  const reviewNotifications = await db.select().from(internalNotifications).where(and(
    eq(internalNotifications.tenantId, tenantId), eq(internalNotifications.entityId, reviewSubmissionId),
  ));
  expect(reviewNotifications).toHaveLength(1);
  expect(reviewNotifications[0]).toMatchObject({ notificationType: "site_submission.created", membershipId: ownerMembershipId });
  const routeReminder = (await db.select().from(automationRules).where(and(
    eq(automationRules.tenantId, tenantId), eq(automationRules.sourceKey, "route-published"),
  )))[0]!;
  expect(routeReminder.status).toBe("draft");
  await db.update(automationRules).set({ status: "active", version: 2 }).where(eq(automationRules.id, routeReminder.id));
  const firstJobId = await createJob(customerOne, "dispatched");
  const secondJobId = await createJob(customerTwo, "dispatched");

  const routeWide = await triggerEvent({ type: "route.published", entityType: "route", entityId: crypto.randomUUID(), payload: {} });
  expect(routeWide.planning.automationRuns).toBe(0);
  expect(routeWide.messages).toHaveLength(0);
  const dispatchedOne = await triggerEvent({
    type: "job.dispatched", entityType: "job", entityId: firstJobId,
    payload: { customerId: customerOne.id, jobId: firstJobId, routeId: crypto.randomUUID() },
  });
  const dispatchedTwo = await triggerEvent({
    type: "job.dispatched", entityType: "job", entityId: secondJobId,
    payload: { customerId: customerTwo.id, jobId: secondJobId, routeId: crypto.randomUUID() },
  });
  expect(dispatchedOne.messages).toMatchObject([{ customerId: customerOne.id, jobId: firstJobId, recipient: customerOne.phone, channel: "sms", templateKey: "service-day-reminder", status: "queued" }]);
  expect(dispatchedTwo.messages).toMatchObject([{ customerId: customerTwo.id, jobId: secondJobId, recipient: customerTwo.phone, channel: "sms", templateKey: "service-day-reminder", status: "queued" }]);
  expect(queueSend.mock.calls.filter(([name]) => name === QUEUES.automationRun).length).toBeGreaterThanOrEqual(4);
  expect(queueSend.mock.calls.filter(([name]) => name === QUEUES.outboundMessage).length).toBe(3);

  const completion = await triggerEvent({
    type: "job.completed", entityType: "job", entityId: firstJobId,
    payload: { customerId: customerOne.id, from: "in_progress", to: "completed" },
  });
  expect(completion.messages).toMatchObject([{ customerId: customerOne.id, jobId: firstJobId, recipient: customerOne.phone, channel: "sms", templateKey: "cleanup-completed", status: "queued" }]);

  const failedPayment = await createInvoiceAndPayment(customerOne, "failed");
  const failed = await triggerEvent({
    type: "payment.failed", entityType: "payment", entityId: failedPayment.paymentId,
    payload: { invoiceId: failedPayment.invoiceId, customerId: customerOne.id, amountCents: 2_500 },
  });
  expect(failed.messages).toMatchObject([{ customerId: customerOne.id, recipient: customerOne.email, channel: "email", templateKey: "payment-failed", status: "queued" }]);
  const failedNotifications = await db.select().from(internalNotifications).where(and(
    eq(internalNotifications.tenantId, tenantId), eq(internalNotifications.entityId, failedPayment.paymentId),
  ));
  expect(failedNotifications).toHaveLength(1);

  const pauseRule = (await db.select().from(automationRules).where(and(
    eq(automationRules.tenantId, tenantId), eq(automationRules.sourceKey, "pause-request"),
  )))[0]!;
  const pauseRequestId = crypto.randomUUID();
  const pause = await triggerEvent({
    type: "customer_change_request.submitted", entityType: "customer_change_request", entityId: pauseRequestId,
    payload: { customerId: customerOne.id, type: "pause", serviceLocationId: customerOne.serviceLocationId },
  });
  expect(pause.planning.automationRuns).toBe(1);
  const pauseTickets = await db.select().from(tickets).where(and(
    eq(tickets.tenantId, tenantId), eq(tickets.createdByActorId, pauseRule.id),
  ));
  expect(pauseTickets).toMatchObject([{ customerId: customerOne.id, title: "Follow up needed" }]);

  const otherChange = await triggerEvent({
    type: "customer_change_request.submitted", entityType: "customer_change_request", entityId: crypto.randomUUID(),
    payload: { customerId: customerOne.id, type: "change", serviceLocationId: customerOne.serviceLocationId },
  });
  expect(otherChange.planning.automationRuns).toBe(0);
  expect(await db.select().from(tickets).where(and(
    eq(tickets.tenantId, tenantId), eq(tickets.createdByActorId, pauseRule.id),
  ))).toHaveLength(1);

  const receiptRule = (await db.select().from(automationRules).where(and(
    eq(automationRules.tenantId, tenantId), eq(automationRules.sourceKey, "payment-receipt"),
  )))[0]!;
  expect(receiptRule.status).toBe("draft");
  const paidPayment = await createInvoiceAndPayment(customerOne, "succeeded");
  const paidEvent = {
    type: "payment.succeeded", entityType: "payment", entityId: paidPayment.paymentId,
    payload: { invoiceId: paidPayment.invoiceId, customerId: customerOne.id, amountCents: 2_500 },
  };
  const receiptWhileDraft = await triggerEvent(paidEvent);
  expect(receiptWhileDraft.planning.automationRuns).toBe(0);
  expect(receiptWhileDraft.messages).toHaveLength(0);

  await db.update(automationRules).set({ status: "active", version: 2 }).where(eq(automationRules.id, receiptRule.id));
  const receipt = await triggerEvent(paidEvent);
  expect(receipt.planning.automationRuns).toBe(1);
  expect(receipt.messages).toMatchObject([{
    customerId: customerOne.id, recipient: customerOne.email, channel: "email", templateKey: "payment-receipt",
    renderedSubject: "Payment received", renderedBody: "We received your payment. You can view your receipt in your account.", status: "queued",
  }]);

  const registry = createMockConnectorRegistry();
  const expectedMessages = [signup.messages[0]!, dispatchedOne.messages[0]!, dispatchedTwo.messages[0]!, completion.messages[0]!, failed.messages[0]!, receipt.messages[0]!];
  for (const message of expectedMessages) {
    await expect(processOutboundMessage(db, registry, { tenantId, messageId: message.id }, workerNow())).resolves.toBe("sent");
  }
  const sentMessages = await db.select().from(outboundMessages).where(and(
    eq(outboundMessages.tenantId, tenantId), inArray(outboundMessages.id, expectedMessages.map((message) => message.id)),
  ));
  expect(sentMessages.every((message) => message.status === "sent")).toBe(true);
});
