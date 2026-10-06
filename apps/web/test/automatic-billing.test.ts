import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole, priceDocument } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor";
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db", () => ({ getDb: getDbMock }));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records");
const { handleWorkflow, transitionJob } = await import("../lib/api/workflows");
const { jobInvoice, finishedWork } = await import("../lib/api/job-billing");
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
