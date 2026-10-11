import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";

const { getDbMock, sendEmail } = vi.hoisted(() => ({ getDbMock: vi.fn(), sendEmail: vi.fn().mockResolvedValue({ providerReference: "test-mail" }) }));
vi.mock("../lib/db", () => ({ getDb: getDbMock }));
vi.mock("../lib/connectors", () => ({ getCapability: vi.fn().mockResolvedValue({ sendEmail }) }));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records");
const { handleWorkflow } = await import("../lib/api/workflows");
const { handleCustomerRecords } = await import("../lib/api/customer-records");
const { handleRecordDetails } = await import("../lib/api/record-details");
const { handlePaymentReads } = await import("../lib/api/payment-reads");
const { handleTicketThread } = await import("../lib/api/ticket-thread");
const { handlePortal } = await import("../lib/api/portal");
const { decryptServiceAccessInstructions } = await import("../lib/api/service-access");
let pg: PGlite, db: Database;
const owner: SessionActor = { kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Owner", role: "owner", permissions: permissionsForRole("owner"), allLocations: true, locationIds: new Set([seedIds.augusta]), membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta };
const office: SessionActor = { ...owner, role: "office", permissions: permissionsForRole("office"), allLocations: false };
const portal: SessionActor = { kind: "customer", userId: "demo-happy-customer", tenantId: owner.tenantId, tenantName: owner.tenantName, packKey: owner.packKey, name: "Customer", email: "customer@happyyards.test", customerIds: new Set([seedIds.carter]), locationIds: new Set([seedIds.carterLocation]), customerLocationIds: new Map([[seedIds.carter, new Set([seedIds.carterLocation])]]) };
const request = (path: string, input?: unknown, method = input === undefined ? "GET" : "POST") => new Request(`http://localhost/api/v1/${path}`, { method, ...(input === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(input) }) });
const address = { name: "Second property", addressLine1: "88 Sales Lane", city: "Augusta", region: "GA", postalCode: "30901" };
async function create(resource: string, input: unknown) { return (await (await handleRecords(request(resource, input), [resource], office))!.json()).item; }
async function action(id: string, name: string, input: unknown = {}) { return (await (await handleWorkflow(request(`estimates/${id}/${name}`, input), ["estimates", id, name], office))!.json()); }
beforeAll(async () => { pg = new PGlite(); const raw = drizzle(pg, { schema }); await migrate(raw, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) }); db = raw as unknown as Database; getDbMock.mockReturnValue(db); await seedDevelopment(db); }, 120_000);
afterAll(async () => { await pg?.close(); });

it("adds and edits a complete property for an addressless customer, preserves private pack fields and schedules work", async () => {
  const customer = await create("customers", { name: "Addressless sales customer" });
  const path = ["customers", customer.id, "properties"];
  await expect(handleCustomerRecords(request("", address), path, { ...office, permissions: new Set(["customers.read"]) })).rejects.toMatchObject({ status: 403 });
  await expect(handleCustomerRecords(request("", { ...address, postalCode: "" }), path, office)).rejects.toMatchObject({ name: "ZodError" });
  const added = await handleCustomerRecords(request("", { ...address, locationFields: { yard_size: "large", gate_code: "private-8812", fenced: true } }), path, office);
  const id = (await added!.json()).item.id;
  const [saved] = await db.select().from(schema.serviceLocations).where(eq(schema.serviceLocations.id, id));
  expect(saved).toMatchObject({ customerId: customer.id, organizationLocationId: seedIds.augusta, city: "Augusta", region: "GA", postalCode: "30901", customFields: { yardSize: "large", fenced: true } });
  expect(saved!.accessInstructionsEncrypted).not.toContain("private-8812"); expect(decryptServiceAccessInstructions(saved!.accessInstructionsEncrypted)).toContain("private-8812");
  await handleCustomerRecords(request("", { ...address, name: "Edited property", expectedUpdatedAt: saved!.updatedAt.toISOString(), locationFields: { yard_size: "small", gate_code: "" } }, "PATCH"), [...path, id], office);
  expect((await db.select().from(schema.serviceLocations).where(eq(schema.serviceLocations.id, id)))[0]!.accessInstructionsEncrypted).toBe(saved!.accessInstructionsEncrypted);
  await expect(handleCustomerRecords(request("", { ...address, expectedUpdatedAt: saved!.updatedAt.toISOString() }, "PATCH"), [...path, id], office)).rejects.toMatchObject({ status: 409 });
  const details = await handleRecords(request(""), ["customers", customer.id], office); expect(JSON.stringify(await details!.json())).not.toContain("private-8812");
  const job = await create("jobs", { customerId: customer.id, serviceLocationId: id, serviceId: seedIds.weeklyService, scheduledDate: "2026-11-01", priceCents: 2200 }); expect(job.serviceLocationId).toBe(id);
  await expect(handleCustomerRecords(request("", address), ["customers", seedIds.riverfront, "properties"], office)).rejects.toMatchObject({ status: 404 });
  await expect(handleCustomerRecords(request("", address), ["customers", seedIds.cleanCarter, "properties"], owner)).rejects.toMatchObject({ status: 404 });
  await expect(handleCustomerRecords(request("", address), path, { ...owner, organizationId: seedIds.cleanOrganization })).rejects.toMatchObject({ status: 404 });
});

it("manages customer contacts and internal notes with audited writes and optimistic edit versions", async () => {
  const customer = await create("customers", { name: "Contacts customer" });
  const path = ["customers", customer.id, "contacts"], input = { firstName: "Alex", lastName: "Billing", email: "alex@example.test", billingContact: true };
  const contact = (await (await handleCustomerRecords(request("", input), path, office))!.json()).item;
  const [saved] = await db.select().from(schema.customerContacts).where(eq(schema.customerContacts.id, contact.id));
  await handleCustomerRecords(request("", { ...input, phone: "555-9912", expectedUpdatedAt: saved!.updatedAt.toISOString() }, "PATCH"), [...path, contact.id], office);
  await expect(handleCustomerRecords(request("", { ...input, expectedUpdatedAt: saved!.updatedAt.toISOString() }, "PATCH"), [...path, contact.id], office)).rejects.toMatchObject({ status: 409 });
  await handleCustomerRecords(request("", { body: "Office-only sales note" }), ["customers", customer.id, "notes"], office);
  const data = await (await handleRecordDetails(request(""), ["customers", customer.id, "detail"], office))!.json();
  expect(data.item.contacts).toContainEqual(expect.objectContaining({ id: contact.id, phone: "555-9912" })); expect(data.related.notes[0].body).toBe("Office-only sales note");
  const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, customer.id)); expect(audit.map(item => item.action)).toContain("customer.notes.create"); expect(JSON.stringify(audit)).not.toContain("Office-only sales note");
});

it("honors the chosen nondefault property and biweekly frequency for every accepted catalog/free line without duplicate work", async () => {
  const customer = await create("customers", { name: "Multi-property estimate", address: "First property", email: "multi@example.test" });
  const property = (await (await handleCustomerRecords(request("", address), ["customers", customer.id, "properties"], office))!.json()).item;
  await expect(create("estimates", { customerId: customer.id, title: "Ambiguous property", totalCents: 10 })).rejects.toMatchObject({ status: 422 });
  await expect(create("estimates", { customerId: customer.id, serviceLocationId: seedIds.riverfrontLocation, title: "Wrong property", totalCents: 10 })).rejects.toMatchObject({ status: 404 });
  const quote = await create("estimates", { customerId: customer.id, serviceLocationId: property.id, title: "Multi-line quote", frequency: "every_two_weeks", lines: [{ description: "Catalog recurring", quantity: "1", unitAmountMinor: 2500, serviceId: seedIds.weeklyService }, { description: "Custom recurring", quantity: "1", unitAmountMinor: 700, charge: "every_visit" }, { description: "Setup", quantity: "1", unitAmountMinor: 500, charge: "once" }, { description: "Declined optional", quantity: "1", unitAmountMinor: 999, charge: "once", optional: true }] });
  await action(quote.id, "send"); await action(quote.id, "approve", { acceptedOptionalIds: [] }); await action(quote.id, "approve", { acceptedOptionalIds: [] });
  const plans = await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.customerId, customer.id)), jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.customerId, customer.id));
  expect(plans).toHaveLength(2); expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ serviceLocationId: property.id, billable: false, priceSnapshot: { totalMinor: 500, billingIncludedInFirstVisit: true } });
  for (const plan of plans) { expect(plan.serviceLocationId).toBe(property.id); expect((await db.select().from(schema.recurrenceRules).where(eq(schema.recurrenceRules.id, plan.recurrenceRuleId!)))[0]).toMatchObject({ frequencyType: "weekly", interval: 2 }); }
  expect(plans.filter(plan => Number((plan.billingConfiguration.oneTimePricingSnapshot as { totalMinor?: number })?.totalMinor) === 500)).toHaveLength(1);
  expect(await db.select().from(schema.estimateApprovals).where(eq(schema.estimateApprovals.estimateId, quote.id))).toHaveLength(1);
  const details = await (await handleRecordDetails(request(""), ["customers", customer.id, "detail"], office))!.json(); expect(details.related.estimates.map((item: { id: string }) => item.id)).toContain(quote.id); expect(details.related.plans).toHaveLength(2);
  const catalog = await (await handleRecords(request(""), ["services"], office))!.json(); expect(catalog.items.some((item: { name: string }) => item.name === "Custom recurring" || item.name === "Setup")).toBe(false);
});

it("creates work for all-free one-time estimates and keeps each frozen invoice line linked to its own job", async () => {
  const quote = await create("estimates", { customerId: seedIds.carter, title: "All free-form", lines: [{ description: "Custom one", quantity: "1", unitAmountMinor: 300 }, { description: "Custom two", quantity: "2", unitAmountMinor: 400 }] });
  await action(quote.id, "send"); await action(quote.id, "approve");
  const work = (await db.select().from(schema.jobs).where(eq(schema.jobs.customerId, seedIds.carter))).filter(item => item.priceSnapshot?.estimateId === quote.id); expect(work).toHaveLength(2); expect(work.every(item => item.billable)).toBe(true);
  const invoice = (await action(quote.id, "invoice")).item; expect(Number(invoice.totalMinor)).toBe(1100);
  const lines = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, invoice.id));
  for (const item of work) expect(lines.find(line => line.sortOrder === item.priceSnapshot?.estimateLineOrder)?.jobId).toBe(item.id);
  expect((await action(quote.id, "invoice")).item.id).toBe(invoice.id);
});

it("keeps multiple catalog work lines and accepted optional work, rejects changed approval replays and never duplicates jobs", async () => {
  const quote = await create("estimates", { customerId: seedIds.carter, title: "Several catalog lines", lines: [{ description: "Catalog first", serviceId: seedIds.weeklyService, charge: "once", quantity: "1", unitAmountMinor: 300 }, { description: "Optional middle", optional: true, charge: "once", quantity: "1", unitAmountMinor: 200 }, { description: "Catalog last", serviceId: seedIds.weeklyService, charge: "once", quantity: "1", unitAmountMinor: 400 }] });
  const [revision] = await db.select().from(schema.estimateRevisions).where(eq(schema.estimateRevisions.estimateId, quote.id));
  const lines = await db.select().from(schema.estimateItems).where(eq(schema.estimateItems.estimateRevisionId, revision!.id));
  const optional = lines.find(line => line.metadata.optional)!;
  await action(quote.id, "send"); await action(quote.id, "approve", { acceptedOptionalIds: [optional.id] });
  await expect(action(quote.id, "approve", { acceptedOptionalIds: [] })).rejects.toMatchObject({ status: 409 });
  const work = (await db.select().from(schema.jobs).where(eq(schema.jobs.customerId, seedIds.carter))).filter(item => item.priceSnapshot?.estimateId === quote.id); expect(work).toHaveLength(3);
  expect(work.filter(item => item.serviceId === seedIds.weeklyService)).toHaveLength(2);
  const invoice = (await action(quote.id, "invoice")).item; expect(Number(invoice.totalMinor)).toBe(900);
  const invoiced = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, invoice.id)); expect(invoiced).toHaveLength(3);
  for (const job of work) expect(invoiced.find(line => line.sortOrder === job.priceSnapshot?.estimateLineOrder)?.jobId).toBe(job.id);
});

it("sends an actual transient approval link, rotates it on resend and never stores raw tokens in mail or audit history", async () => {
  const quote = await create("estimates", { customerId: seedIds.carter, title: "Email contract", totalCents: 100 });
  const first = await action(quote.id, "send"), second = await action(quote.id, "send"); expect(second.delivery.status).toBe("sent"); expect(second.actionUrl).not.toBe(first.actionUrl);
  const token = second.actionUrl.split("/").at(-1)!;
  expect(sendEmail.mock.calls.at(-1)?.[0]).toMatchObject({ to: expect.any(String), body: expect.stringContaining(second.actionUrl) });
  const tokens = await db.select().from(schema.secureEstimateTokens).where(eq(schema.secureEstimateTokens.estimateId, quote.id)); expect(tokens).toHaveLength(2); expect(tokens.filter(item => !item.revokedAt)).toHaveLength(1); expect(tokens.find(item => !item.revokedAt)?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
  const receipts = await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.templateKey, "estimate_approval")), events = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, quote.id));
  expect(JSON.stringify([tokens, receipts, events])).not.toContain(token);
  sendEmail.mockRejectedValueOnce(new Error(`sensitive provider error ${token}`)); const failed = await action(quote.id, "send"); expect(failed.delivery).toMatchObject({ status: "not_sent", message: expect.stringContaining("not confirmed") });
  expect((await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.status, "failed"))).some(item => item.failureMessage?.includes(token))).toBe(false);
  await action(quote.id, "decline"); await action(quote.id, "decline"); expect(await db.select().from(schema.estimateApprovals).where(eq(schema.estimateApprovals.estimateId, quote.id))).toHaveLength(1);
});

it("preserves website messages and full lead addresses, advances the pipeline and links the actual converted customer", async () => {
  const lead = await create("leads", { name: "Website Prospect", address: "1 Lead Lane", city: "Augusta", region: "GA", postalCode: "30901", email: "lead@example.test" });
  await db.update(schema.leads).set({ customFields: { websiteMessage: "Please quote the back yard" } }).where(eq(schema.leads.id, lead.id));
  let current = (await db.select().from(schema.leads).where(eq(schema.leads.id, lead.id)))[0]!;
  await handleWorkflow(request("", { status: "contacted", expectedUpdatedAt: current.updatedAt.toISOString() }), ["leads", lead.id, "status"], office);
  current = (await db.select().from(schema.leads).where(eq(schema.leads.id, lead.id)))[0]!;
  await expect(handleWorkflow(request("", { status: "lost", expectedUpdatedAt: current.updatedAt.toISOString() }), ["leads", lead.id, "status"], office)).rejects.toMatchObject({ status: 422 });
  const quote = await create("estimates", { leadId: lead.id, title: "Lead quote", totalCents: 500 }); expect(quote.leadId).toBe(lead.id);
  await handleWorkflow(request("", {}), ["leads", lead.id, "convert"], office);
  const details = await (await handleRecordDetails(request(""), ["leads", lead.id, "detail"], office))!.json(); expect(details.item.customFields.websiteMessage).toBe("Please quote the back yard"); expect(details.related.customer[0].id).toBe(details.item.customerId);
  expect((await db.select().from(schema.serviceLocations).where(eq(schema.serviceLocations.customerId, details.item.customerId)))[0]).toMatchObject({ city: "Augusta", region: "GA", postalCode: "30901" });
});

it("replies and closes portal tickets idempotently without leaking office notes, other customers or branch data", async () => {
  const created = (await (await handlePortal(request("", { subject: "Sales support", description: "Please clarify", type: "support" }), ["portal", "tickets"], portal))!.json()).item;
  const path = ["tickets", created.id, "thread"], input = { body: "We can help", visibility: "customer", commentId: crypto.randomUUID(), close: true };
  await handleTicketThread(request("", { body: "Private office note", visibility: "internal", commentId: crypto.randomUUID() }), path, office);
  await expect(handleTicketThread(request("", input), path, { ...office, permissions: new Set(["tickets.read"]) })).rejects.toMatchObject({ status: 403 });
  await handleTicketThread(request("", input), path, office); await handleTicketThread(request("", input), path, office);
  expect(await db.select().from(schema.ticketComments).where(eq(schema.ticketComments.ticketId, created.id))).toHaveLength(2);
  const thread = await (await handlePortal(request(""), ["portal", "tickets", created.id, "thread"], portal))!.json(); expect(thread.items.map((item: { body: string }) => item.body)).toEqual(["We can help"]);
  const [ticket] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, created.id)); expect(ticket!.closedAt).not.toBeNull(); expect((await db.select().from(schema.ticketStatusDefinitions).where(eq(schema.ticketStatusDefinitions.id, ticket!.statusDefinitionId)))[0]!.normalizedCategory).toBe("closed");
  await expect(handlePortal(request(""), ["portal", "tickets", created.id, "thread"], { ...portal, customerIds: new Set([seedIds.riverfront]), customerLocationIds: new Map() } as SessionActor)).rejects.toMatchObject({ status: 404 });
  await expect(handleTicketThread(request(""), path, { ...office, locationIds: new Set([seedIds.northAugusta]) })).rejects.toMatchObject({ status: 404 });
});

it("searches and pages customers, invoices and payments beyond 200 records on the server with literal scoped filters", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ tenantId: owner.tenantId, organizationId: owner.organizationId!, owningLocationId: seedIds.augusta, displayName: `Paging customer ${index}`, status: "active", createdAt: new Date(2020, 0, index + 1) }));
  const inserted = await db.insert(schema.customers).values(rows).returning();
  const target = inserted[0]!;
  await db.insert(schema.payments).values(inserted.map((customer, index) => ({ tenantId: owner.tenantId, customerId: customer.id, amountMinor: 100n, status: "succeeded", sourceType: "manual", reference: `Paging receipt ${index}`, idempotencyKey: crypto.randomUUID(), recordedByActorType: "staff" })));
  await db.insert(schema.invoices).values(inserted.map((customer, index) => ({ tenantId: owner.tenantId, organizationId: owner.organizationId!, organizationLocationId: seedIds.augusta, customerId: customer.id, invoiceNumber: `PAGING-${index}`, status: "draft", totalMinor: 100n, balanceMinor: 100n })));
  for (const resource of ["customers", "invoices", "payments"]) {
    const handler = resource === "payments" ? handlePaymentReads : handleRecords;
    const first = await (await handler(request(`${resource}?page=0`), [resource], office))!.json(); expect(first.items).toHaveLength(50); expect(first.hasMore).toBe(true);
    const fifth = await (await handler(request(`${resource}?page=4`), [resource], office))!.json(); expect(fifth.items.length).toBeGreaterThan(0); expect(new Set([...first.items, ...fifth.items].map((item: { id: string }) => item.id)).size).toBe(first.items.length + fifth.items.length);
    const search = resource === "customers" ? "Paging customer 0" : resource === "invoices" ? "PAGING-0" : "Paging receipt 0";
    const found = await (await handler(request(`${resource}?page=0&search=${encodeURIComponent(search)}`), [resource], office))!.json(); expect(found.items).toHaveLength(1); if (resource === "customers") expect(found.items[0].id).toBe(target.id);
    const excluded = await (await handler(request(`${resource}?page=0&search=${encodeURIComponent(search)}`), [resource], { ...office, locationIds: new Set([seedIds.northAugusta]) }))!.json(); expect(excluded.items).toHaveLength(0);
    const literal = await (await handler(request(`${resource}?page=0&search=%25`), [resource], office))!.json(); expect(literal.items).toHaveLength(0);
  }
});
