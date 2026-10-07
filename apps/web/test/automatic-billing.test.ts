import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole, priceDocument } from "@modular-crm/domain";
import { readServerConfig } from "@modular-crm/config";
import { createConnectorRegistry } from "@modular-crm/connectors";
import { enqueueInvoiceReminders } from "../../worker/src/invoice-reminders-db";
import { processOutboundMessage } from "../../worker/src/messages-db";
import type { SessionActor } from "../lib/api/actor";
const { getDbMock, sendMail } = vi.hoisted(() => ({ getDbMock: vi.fn(), sendMail: vi.fn() }));
vi.mock("../lib/db", () => ({ getDb: getDbMock }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records");
const { handleWorkflow, transitionJob } = await import("../lib/api/workflows");
const { jobInvoice, finishedWork } = await import("../lib/api/job-billing");
const { handleCapabilitySettings } = await import("../lib/api/capability-settings");
const owner: SessionActor = { kind: "staff", role: "owner", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: null, email: "owner@happyyards.test", name: "Owner", permissions: permissionsForRole("owner"), allLocations: true, locationIds: new Set([seedIds.augusta]), membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta };
const request = (path: string, data: unknown = {}, method = "POST") => new Request(`http://localhost/api/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(data) });
let pg: PGlite, db: Database;
beforeAll(async () => { pg = new PGlite(); const raw = drizzle(pg, { schema }); await migrate(raw, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) }); db = raw as unknown as Database; getDbMock.mockReturnValue(db); await seedDevelopment(db); }, 120_000);
afterAll(async () => { await pg?.close(); });
const scoped = { ...owner, role: "office", userId: "demo-happy-manager", membershipId: seedIds.morganMembership, permissions: permissionsForRole("office"), allLocations: false, locationIds: new Set([seedIds.augusta]) } as SessionActor;
async function completed(customerId = seedIds.carter, price = 2500, branch = seedIds.augusta) {
  const [job] = await db.insert(schema.jobs).values({ tenantId: owner.tenantId, organizationId: owner.organizationId!, organizationLocationId: branch, customerId, serviceLocationId: branch === seedIds.augusta ? seedIds.carterLocation : seedIds.riverfrontLocation, serviceId: seedIds.weeklyService, status: "completed", actualCompletedAt: new Date("2026-09-15T12:00:00Z"), priceSnapshot: { ...priceDocument([{ description: "Finished work", quantity: "1", unitAmountMinor: price }]), currency: "USD" } }).returning(); return job!;
}
async function approvedQuote(recurring: boolean) {
  const [service] = await db.insert(schema.services).values({ tenantId: owner.tenantId, organizationId: owner.organizationId!, key: crypto.randomUUID(), name: "Quoted work", serviceType: recurring ? "recurring" : "one_time" }).returning();
  const lines = [{ description: "Weekly service", quantity: "1", unitAmountMinor: 2500, serviceId: service!.id }, { description: "Initial cleanup", quantity: "1", unitAmountMinor: 5000, charge: "once" }];
  const response = await handleRecords(request("estimates", { customerId: seedIds.carter, title: "Quoted work", lines }), ["estimates"], owner); const id = (await response!.json()).item.id;
  await handleWorkflow(request(`estimates/${id}/send`), ["estimates", id, "send"], owner);
  await handleWorkflow(request(`estimates/${id}/approve`), ["estimates", id, "approve"], owner);
  const [revision] = await db.select().from(schema.estimateRevisions).where(eq(schema.estimateRevisions.estimateId, id));
  return { id, revision: revision! };
}
it("bills setup once on the first completed visit, freezes only recurring lines and refuses estimate double billing", async () => {
  const { id, revision } = await approvedQuote(true);
  const [plan] = await db.select().from(schema.servicePlans).where(and(eq(schema.servicePlans.tenantId, owner.tenantId), eq(schema.servicePlans.serviceId, (revision.snapshot.pricingSnapshot as { items: { serviceId: string }[] }).items[0]!.serviceId)));
  expect(plan!.pricingSnapshot).toMatchObject({ totalMinor: 2500, items: [{ description: "Weekly service", charge: "every_visit" }] });
  expect(plan!.billingConfiguration).toMatchObject({ oneTimePricingSnapshot: { totalMinor: 5000 } });
  await expect(handleWorkflow(request(`estimates/${id}/invoice`), ["estimates", id, "invoice"], owner)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("billed automatically") });
  const invoiceIds = [];
  for (let visit = 0; visit < 2; visit++) {
    const [job] = await db.insert(schema.jobs).values({ tenantId: owner.tenantId, organizationId: owner.organizationId!, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, serviceId: plan!.serviceId, servicePlanId: plan!.id, status: "in_progress", priceSnapshot: plan!.pricingSnapshot }).returning();
    const response = await transitionJob(owner, job!.id, "completed", { completedChecklist: true }); const invoiceId = (await response.json()).invoice.id; invoiceIds.push(invoiceId);
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    expect(invoice!.totalMinor).toBe(visit === 0 ? 7500n : 2500n);
    expect(invoice!.dueAt).toEqual(invoice!.issuedAt);
    const lines = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, invoiceId));
    expect(lines.filter(line => line.description === "Initial cleanup")).toHaveLength(visit === 0 ? 1 : 0);
    expect(lines.every(line => line.jobId === job!.id)).toBe(true);
    const replay = await transitionJob(owner, job!.id, "completed", { completedChecklist: true }); expect((await replay.json()).invoice.id).toBe(invoiceId);
  }
  expect((await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.id, plan!.id)))[0]!.billingConfiguration.oneTimeInvoiceId).toBe(invoiceIds[0]);
});
it("creates an itemized one-time job invoice once and preserves its job links through draft edits", async () => {
  const job = await completed();
  const response = await jobInvoice(owner, job.id); expect(response.status).toBe(201); const invoice = (await response.json()).item;
  expect(invoice).toMatchObject({ status: "draft", totalMinor: 2500 });
  expect((await (await jobInvoice(owner, job.id)).json()).item.id).toBe(invoice.id);
  await handleRecords(request(`invoices/${invoice.id}`, { description: "Finished work", lines: [{ description: "Corrected description", quantity: "1", unitAmountMinor: 2500 }], dueDate: null, expectedUpdatedAt: invoice.updatedAt }, "PATCH"), ["invoices", invoice.id], owner);
  expect((await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, invoice.id)))[0]!.jobId).toBe(job.id);
  expect((await (await jobInvoice(owner, job.id)).json()).item.id).toBe(invoice.id);
});
it("reuses an estimate-converted invoice rather than billing its completed one-time job again", async () => {
  const { id, revision } = await approvedQuote(false);
  const converted = await handleWorkflow(request(`estimates/${id}/invoice`), ["estimates", id, "invoice"], owner); const invoiceId = (await converted!.json()).item.id;
  const work = await db.select().from(schema.jobs).where(eq(schema.jobs.customerId, seedIds.carter));
  const job = work.find(job => job.priceSnapshot?.estimateRevisionId === revision.id)!;
  await db.update(schema.jobs).set({ status: "completed", actualCompletedAt: new Date("2026-09-15T12:00:00Z") }).where(eq(schema.jobs.id, job.id));
  expect((await (await jobInvoice(owner, job.id)).json()).item.id).toBe(invoiceId);
  expect((await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, invoiceId))).every(line => line.jobId === job.id)).toBe(true);
});
it("preserves a finished visit's frozen tax rate and amounts through an unchanged draft edit", async () => {
  const job = await completed();
  const pricing = priceDocument([{ description: "Taxed visit", quantity: "1", unitAmountMinor: 2500, taxable: true }], 800, { type: "amount", value: 500 });
  await db.update(schema.jobs).set({ priceSnapshot: { ...pricing, currency: "USD" } }).where(eq(schema.jobs.id, job.id));
  const invoice = (await (await jobInvoice(owner, job.id)).json()).item;
  expect(invoice).toMatchObject({ totalMinor: 2160, taxMinor: 160, billingSnapshot: { taxRateBasisPoints: 800, discountMinor: 500 } });
  const saved = await handleRecords(request(`invoices/${invoice.id}`, { description: "Taxed visit", lines: [{ description: "Taxed visit", quantity: "1", unitAmountMinor: 2500, discountMinor: 500, taxable: true }], taxRateBasisPoints: invoice.billingSnapshot.taxRateBasisPoints, discount: invoice.billingSnapshot.discount, dueDate: null, expectedUpdatedAt: invoice.updatedAt }, "PATCH"), ["invoices", invoice.id], owner);
  expect((await saved!.json()).item).toMatchObject({ totalMinor: 2160, taxMinor: 160, discountMinor: 500 });
});
it("batch bills two customers with durable replay receipts and excludes previously invoiced work", async () => {
  await completed(seedIds.carter, 1100); await completed(seedIds.riverfront, 2200, seedIds.northAugusta);
  const range = { from: "2026-09-01", through: "2026-09-30" };
  const preview = await finishedWork(request("billing/finished-work?from=2026-09-01&through=2026-09-30", {}, "GET"), owner); const data = await preview.json(); expect(data.items).toHaveLength(2);
  for (const row of data.items) {
    const command = { ...range, customerId: row.customerId, issue: true, idempotencyKey: crypto.randomUUID() };
    const first = await finishedWork(request("billing/finished-work", command), owner); const result = await first.json(); expect(result.created).toBe(1);
    const invoice = result.invoices[0];
    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, row.customerId));
    expect(Date.parse(invoice.dueAt) - Date.parse(invoice.issuedAt)).toBe((customer!.paymentTermsDays ?? 0) * 86400000);
    expect((await (await finishedWork(request("billing/finished-work", command), owner)).json())).toMatchObject({ created: 1, duplicate: true, invoices: result.invoices });
    await expect(finishedWork(request("billing/finished-work", { ...command, issue: false }), owner)).rejects.toMatchObject({ status: 409 });
    expect((await (await finishedWork(request("billing/finished-work", { ...command, idempotencyKey: crypto.randomUUID() }), owner)).json()).created).toBe(0);
  }
  expect((await (await finishedWork(request("billing/finished-work?from=2026-09-01&through=2026-09-30", {}, "GET"), owner)).json()).items).toHaveLength(0);
});
it("keeps job and batch billing tenant, branch, staff and permission scoped", async () => {
  const job = await completed(seedIds.riverfront, 3000, seedIds.northAugusta);
  await expect(jobInvoice(scoped, job.id)).rejects.toMatchObject({ status: 404 });
  await expect(jobInvoice({ ...owner, tenantId: seedIds.cleanTenant }, job.id)).rejects.toMatchObject({ status: 404 });
  await expect(jobInvoice({ ...owner, permissions: new Set(["jobs.read", "invoices.read"]) } as SessionActor, job.id)).rejects.toMatchObject({ status: 403 });
  const preview = await finishedWork(request("billing/finished-work?from=2026-09-01&through=2026-09-30", {}, "GET"), scoped); expect((await preview.json()).items).toHaveLength(0);
  const denied = await finishedWork(request("billing/finished-work", { from: "2026-09-01", through: "2026-09-30", customerId: seedIds.riverfront, idempotencyKey: crypto.randomUUID() }), scoped); expect((await denied.json()).created).toBe(0);
  const allowed = await completed(seedIds.carter, 1600);
  const permitted = await finishedWork(request("billing/finished-work?from=2026-09-01&through=2026-09-30", {}, "GET"), scoped);
  expect((await permitted.json()).items).toEqual([expect.objectContaining({ customerId: seedIds.carter, visits: 1, totals: { USD: 1600 } })]);
  expect((await jobInvoice(scoped, allowed.id)).status).toBe(201);
  const unfinished = await completed(); await db.update(schema.jobs).set({ status: "scheduled" }).where(eq(schema.jobs.id, unfinished.id));
  await expect(jobInvoice(owner, unfinished.id)).rejects.toMatchObject({ status: 409 });
});
it("rejects amount discounts that depend on accepting optional lines", async () => {
  await expect(handleRecords(request("estimates", { customerId: seedIds.carter, title: "Optional fit", lines: [{ description: "Required", quantity: "1.5", unitAmountMinor: 100, discountMinor: 10 }, { description: "Optional", quantity: "1", unitAmountMinor: 1000, optional: true }], discount: { type: "amount", value: 141 } }), ["estimates"], owner)).rejects.toMatchObject({ status: 422, message: expect.stringContaining("required lines") });
});
it("checks an existing invoice's branch independently of the now-accessible job", async () => {
  const job = await completed(); const invoice = (await (await jobInvoice(owner, job.id)).json()).item;
  await db.update(schema.jobs).set({ organizationLocationId: seedIds.northAugusta }).where(eq(schema.jobs.id, job.id));
  const northernOffice = { ...scoped, locationIds: new Set([seedIds.northAugusta]) } as SessionActor;
  await expect(jobInvoice(northernOffice, job.id)).rejects.toMatchObject({ status: 404, message: "Invoice not found." });
  expect((await (await jobInvoice(owner, job.id)).json()).item.id).toBe(invoice.id);
});
it("uses the completed visit's branch calendar at a month boundary, not the server or tenant date", async () => {
  const [branch] = await db.select().from(schema.organizationLocations).where(eq(schema.organizationLocations.id, seedIds.augusta));
  try {
    await db.update(schema.organizationLocations).set({ timezone: "America/Los_Angeles" }).where(eq(schema.organizationLocations.id, seedIds.augusta));
    const job = await completed(); await db.update(schema.jobs).set({ actualCompletedAt: new Date("2026-10-01T06:30:00Z") }).where(eq(schema.jobs.id, job.id));
    const preview = await finishedWork(request("billing/finished-work?from=2026-09-30&through=2026-09-30", {}, "GET"), scoped);
    expect((await preview.json()).items).toEqual([expect.objectContaining({ customerId: seedIds.carter, visits: 1, totals: { USD: 2500 } })]);
    expect((await (await finishedWork(request("billing/finished-work", { from: "2026-09-30", through: "2026-09-30", customerId: seedIds.carter, idempotencyKey: crypto.randomUUID() }), scoped)).json()).created).toBe(1);
  } finally { await db.update(schema.organizationLocations).set({ timezone: branch!.timezone }).where(eq(schema.organizationLocations.id, seedIds.augusta)); }
});
it("rejects legacy total-only PATCH on multi-line drafts without changing their lines", async () => {
  const response = await handleRecords(request("invoices", { customerId: seedIds.carter, description: "Two lines", lines: [{ description: "Work", quantity: "1", unitAmountMinor: 100 }, { description: "Parts", quantity: "1", unitAmountMinor: 200 }] }), ["invoices"], owner); const invoice = (await response!.json()).item;
  await expect(handleRecords(request(`invoices/${invoice.id}`, { description: "Flatten", totalCents: 300, dueDate: null, expectedUpdatedAt: invoice.updatedAt }, "PATCH"), ["invoices", invoice.id], owner)).rejects.toMatchObject({ status: 422 });
  expect(await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, invoice.id))).toHaveLength(2);
});

async function businessSettings() {
  return (await db.select().from(schema.organizations).where(eq(schema.organizations.id, owner.organizationId!)))[0]!.settings;
}
async function setPaymentDueDays(days: number) {
  return handleCapabilitySettings(request("settings", { paymentDueDays: days }, "PATCH"), ["settings"], owner);
}
it("saves only supported business deadlines with authorization and audit, without backfilling issued history", async () => {
  const prior = await businessSettings();
  const [historical] = await db.insert(schema.invoices).values({ tenantId: owner.tenantId, organizationId: owner.organizationId!, customerId: seedIds.carter, invoiceNumber: crypto.randomUUID(), status: "issued", issuedAt: new Date("2026-01-01"), dueAt: null }).returning();
  const other = (await db.select().from(schema.organizations).where(eq(schema.organizations.id, seedIds.cleanOrganization)))[0]!;
  try {
    expect((await (await handleCapabilitySettings(request("settings", {}, "GET"), ["settings"], owner))!.json()).item.paymentDueDays).toBe(0);
    for (const days of [0, 7, 15, 30]) {
      expect((await (await setPaymentDueDays(days))!.json()).item.paymentDueDays).toBe(days);
      expect((await businessSettings()).paymentDueDays).toBe(days);
    }
    await expect(setPaymentDueDays(1)).rejects.toMatchObject({ name: "ZodError" });
    await expect(handleCapabilitySettings(request("settings", { paymentDueDays: 7 }, "PATCH"), ["settings"], { ...scoped, permissions: new Set(["tenant.read"]) } as SessionActor)).rejects.toMatchObject({ status: 403 });
    expect((await db.select().from(schema.invoices).where(eq(schema.invoices.id, historical!.id)))[0]!.dueAt).toBeNull();
    expect((await db.select().from(schema.organizations).where(eq(schema.organizations.id, other.id)))[0]!.settings).toEqual(other.settings);
    expect((await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.tenantId, owner.tenantId), eq(schema.auditEvents.action, "tenant.settings_update")))).some(event => event.afterData?.paymentDueDays === 30)).toBe(true);
  } finally { await db.update(schema.organizations).set({ settings: prior }).where(eq(schema.organizations.id, owner.organizationId!)); }
});
it("sets manual and job-draft deadlines at issuance, preserving explicit dates and customer terms", async () => {
  const prior = await businessSettings();
  try {
    await setPaymentDueDays(7);
    const draft = (await (await jobInvoice(owner, (await completed()).id)).json()).item;
    expect(draft.dueAt).toBeNull();
    // A changed default takes effect on issuance, not when the draft was created.
    await setPaymentDueDays(15);
    const issued = (await (await handleWorkflow(request(`invoices/${draft.id}/issue`), ["invoices", draft.id, "issue"], owner))!.json()).item;
    expect(Date.parse(issued.dueAt) - Date.parse(issued.issuedAt)).toBe(15 * 86400000);
    for (const customerId of [seedIds.carter, seedIds.riverfront]) {
      const created = (await (await handleRecords(request("invoices", { customerId, description: "Manual terms", totalCents: 1000 }), ["invoices"], owner))!.json()).item;
      const result = (await (await handleWorkflow(request(`invoices/${created.id}/issue`), ["invoices", created.id, "issue"], owner))!.json()).item;
      const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, customerId));
      expect(Date.parse(result.dueAt) - Date.parse(result.issuedAt)).toBe((customer!.paymentTermsDays ?? 15) * 86400000);
    }
    const explicit = (await (await handleRecords(request("invoices", { customerId: seedIds.carter, description: "Chosen date", totalCents: 1000, dueDate: "2030-01-15" }), ["invoices"], owner))!.json()).item;
    const saved = (await (await handleWorkflow(request(`invoices/${explicit.id}/issue`), ["invoices", explicit.id, "issue"], owner))!.json()).item;
    expect(saved.dueAt).toBe(explicit.dueAt);
  } finally { await db.update(schema.organizations).set({ settings: prior }).where(eq(schema.organizations.id, owner.organizationId!)); }
});
it("uses the completion invoice's own business default and preserves agreed plan and customer terms", async () => {
  const prior = await businessSettings();
  const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, seedIds.carter));
  try {
    await setPaymentDueDays(30);
    const { revision } = await approvedQuote(true);
    const [plan] = await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.serviceId, (revision.snapshot.pricingSnapshot as { items: { serviceId: string }[] }).items[0]!.serviceId));
    for (const terms of [{ customer: null, plan: undefined, expected: 30 }, { customer: 15, plan: undefined, expected: 15 }, { customer: 15, plan: 7, expected: 7 }, { customer: 0, plan: undefined, expected: 0 }]) {
      await db.update(schema.customers).set({ paymentTermsDays: terms.customer }).where(eq(schema.customers.id, seedIds.carter));
      await db.update(schema.servicePlans).set({ billingConfiguration: { ...plan!.billingConfiguration, netDays: terms.plan } }).where(eq(schema.servicePlans.id, plan!.id));
      const [job] = await db.insert(schema.jobs).values({ tenantId: owner.tenantId, organizationId: owner.organizationId!, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, serviceLocationId: seedIds.carterLocation, serviceId: plan!.serviceId, servicePlanId: plan!.id, status: "in_progress", priceSnapshot: plan!.pricingSnapshot }).returning();
      const invoiceId = (await (await transitionJob(owner, job!.id, "completed", { completedChecklist: true })).json()).invoice.id;
      const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
      expect(invoice!.dueAt!.getTime() - invoice!.issuedAt!.getTime()).toBe(terms.expected * 86400000);
    }
  } finally { await db.update(schema.organizations).set({ settings: prior }).where(eq(schema.organizations.id, owner.organizationId!)); await db.update(schema.customers).set({ paymentTermsDays: customer!.paymentTermsDays }).where(eq(schema.customers.id, seedIds.carter)); }
});
it("uses the issuing business's deadline, not the parent's workspace setting", async () => {
  const prior = await businessSettings();
  const [business] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, seedIds.franchiseEastOrganization));
  try {
    await setPaymentDueDays(30);
    await db.update(schema.organizations).set({ settings: { ...business!.settings, paymentDueDays: 7 } }).where(eq(schema.organizations.id, business!.id));
    const [customer] = await db.insert(schema.customers).values({ tenantId: owner.tenantId, organizationId: business!.id, owningLocationId: seedIds.franchiseEastLocation, displayName: "Business-specific terms" }).returning();
    const [location] = await db.insert(schema.serviceLocations).values({ tenantId: owner.tenantId, customerId: customer!.id, organizationLocationId: seedIds.franchiseEastLocation, name: "Business property", addressLine1: "123 Billing Lane", city: "Augusta", region: "GA", postalCode: "30904" }).returning();
    const [draft] = await db.insert(schema.invoices).values({ tenantId: owner.tenantId, organizationId: business!.id, organizationLocationId: seedIds.franchiseEastLocation, customerId: customer!.id, status: "draft", invoiceNumber: crypto.randomUUID(), subtotalMinor: 1000n, totalMinor: 1000n, balanceMinor: 1000n }).returning();
    const saved = (await (await handleWorkflow(request(`invoices/${draft!.id}/issue`), ["invoices", draft!.id, "issue"], owner))!.json()).item;
    expect(Date.parse(saved.dueAt) - Date.parse(saved.issuedAt)).toBe(7 * 86400000);
    await db.insert(schema.jobs).values({ tenantId: owner.tenantId, organizationId: business!.id, organizationLocationId: seedIds.franchiseEastLocation, customerId: customer!.id, serviceLocationId: location!.id, serviceId: seedIds.weeklyService, status: "completed", actualCompletedAt: new Date("2026-07-15T12:00:00Z"), priceSnapshot: { ...priceDocument([{ description: "Business visit", quantity: "1", unitAmountMinor: 1000 }]), currency: "USD" } });
    const invoice = (await (await finishedWork(request("billing/finished-work", { from: "2026-07-01", through: "2026-07-31", customerId: customer!.id, issue: true, idempotencyKey: crypto.randomUUID() }), owner)).json()).invoices[0];
    expect(Date.parse(invoice.dueAt) - Date.parse(invoice.issuedAt)).toBe(7 * 86400000);
  } finally { await db.update(schema.organizations).set({ settings: prior }).where(eq(schema.organizations.id, owner.organizationId!)); await db.update(schema.organizations).set({ settings: business!.settings }).where(eq(schema.organizations.id, business!.id)); }
});
it("delivers exactly one reminder after the first delay for an issued batch invoice with no customer terms", async () => {
  const prior = await businessSettings();
  try {
    expect((await db.select().from(schema.customers).where(eq(schema.customers.id, seedIds.carter)))[0]!.paymentTermsDays).toBeNull();
    await db.update(schema.organizations).set({ settings: { ...prior, paymentDueDays: 7, overdueReminders: { enabled: true, firstAfterDays: 3, intervalDays: 7, maxReminders: 3 } } }).where(eq(schema.organizations.id, owner.organizationId!));
    const job = await completed(); await db.update(schema.jobs).set({ actualCompletedAt: new Date("2026-08-15T12:00:00Z") }).where(eq(schema.jobs.id, job.id));
    const invoice = (await (await finishedWork(request("billing/finished-work", { from: "2026-08-01", through: "2026-08-31", customerId: seedIds.carter, issue: true, idempotencyKey: crypto.randomUUID() }), owner)).json()).invoices[0];
    expect(Date.parse(invoice.dueAt) - Date.parse(invoice.issuedAt)).toBe(7 * 86400000);
    const firstReminder = new Date(Date.parse(invoice.dueAt) + 3 * 86400000);
    const messages = () => db.select().from(schema.outboundMessages).where(and(eq(schema.outboundMessages.invoiceId, invoice.id), eq(schema.outboundMessages.templateKey, "invoice_overdue")));
    await enqueueInvoiceReminders(db, new Date(firstReminder.getTime() - 1)); expect(await messages()).toHaveLength(0);
    await enqueueInvoiceReminders(db, firstReminder); await enqueueInvoiceReminders(db, firstReminder); expect(await messages()).toHaveLength(1);
    sendMail.mockReset(); sendMail.mockResolvedValue({ accepted: ["carter@example.test"], rejected: [], messageId: "due-regression" });
    const config = readServerConfig({ NODE_ENV: "test", MOCK_CONNECTORS: "false", SMTP_HOST: "localhost", SMTP_FROM: "Platform <mail@platform.test>", APP_BASE_URL: "http://localhost:3000" });
    const message = (await messages())[0]!;
    const deliver = () => processOutboundMessage(db, createConnectorRegistry({ includePlannedProviders: true }), { tenantId: owner.tenantId, messageId: message.id }, firstReminder, config);
    expect(await deliver()).toBe("sent"); expect(await deliver()).toBe("skipped");
    await enqueueInvoiceReminders(db, firstReminder);
    expect(sendMail).toHaveBeenCalledTimes(1); expect(await messages()).toHaveLength(1);
    expect(await db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.entityId, invoice.id), eq(schema.domainEvents.eventType, "invoice.reminder_sent")))).toHaveLength(1);
  } finally { await db.update(schema.organizations).set({ settings: prior }).where(eq(schema.organizations.id, owner.organizationId!)); }
});
