import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { completionProofs, fileLinks, files, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { getDocument, statementPeriod } = await import("../lib/api/documents.ts");
let pglite: PGlite;
let db: Database;

const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta, seedIds.northAugusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};
const augustaOnly: SessionActor = { ...owner, allLocations: false, locationIds: new Set([seedIds.augusta]) };
const customer: SessionActor = {
  kind: "customer", userId: "demo-happy-customer", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "carter@example.test", name: "Carter Household",
  customerIds: new Set([seedIds.carter]), locationIds: new Set([seedIds.carterLocation]),
  customerLocationIds: new Map([[seedIds.carter, new Set([seedIds.carterLocation])]]),
};
const terry: SessionActor = {
  ...owner, userId: "demo-happy-tech", name: "Terry Tech", role: "technician", permissions: permissionsForRole("technician"),
  locationIds: new Set([seedIds.augusta]), allLocations: false, membershipId: seedIds.terryMembership,
};
const unassignedTech: SessionActor = { ...terry, membershipId: seedIds.caseyMembership };

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);
afterAll(async () => { await pglite?.close(); });

describe("authorized customer documents", () => {
  it("selects calendar-month boundaries and defaults to the current UTC month", () => {
    expect(statementPeriod("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(statementPeriod(undefined, new Date("2026-09-24T12:00:00Z"))).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(() => statementPeriod("2024-13")).toThrow();
  });

  it("renders the issued invoice snapshot and line items for its tenant", async () => {
    const item = await getDocument(customer, "invoice", seedIds.happyInvoice);
    expect(item).toMatchObject({ kind: "invoice", number: "HY-1001", customer: { name: "Carter Household" } });
    expect(item.lines).toContainEqual(expect.objectContaining({ description: "Weekly yard cleanup", totalMinor: 2500n }));
    expect(item.totals.at(-1)).toMatchObject({ label: "Balance due", amountMinor: 0n });
  });

  it("does not expose a draft estimate to a customer actor", async () => {
    const draftId = crypto.randomUUID();
    await db.insert(schema.estimates).values({ id: draftId, tenantId: seedIds.happyTenant, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, status: "draft", currency: "USD" });
    await expect(getDocument(customer, "estimate", draftId)).rejects.toMatchObject({ status: 404 });
  });

  it("allows customer receipts and statements only for their authorized customer locations", async () => {
    const receipt = await getDocument(customer, "receipt", seedIds.happyPayment);
    expect(receipt.kind).toBe("receipt");
    expect(receipt.totals[0]).toMatchObject({ label: "Amount paid", amountMinor: 2500n });
    const statement = await getDocument(customer, "statement", seedIds.carter);
    expect(statement.lines.some((line) => line.description === "Invoice HY-1001")).toBe(true);
    expect(statement.period?.start).toMatch(/^\d{4}-\d{2}-01$/);
    await expect(getDocument({ ...customer, locationIds: new Set(), customerLocationIds: new Map([[seedIds.carter, new Set()]]) }, "invoice", seedIds.happyInvoice)).rejects.toMatchObject({ status: 404 });
  });

  it("calculates statement opening and closing balances from transactions in the selected month", async () => {
    const ids = { prior: crypto.randomUUID(), inMonth: crypto.randomUUID(), after: crypto.randomUUID(), payment: crypto.randomUUID() };
    await db.insert(schema.invoices).values([
      { id: ids.prior, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, status: "issued", invoiceNumber: `PER-${ids.prior.slice(0, 8)}`, currency: "USD", issuedAt: new Date("2024-01-31T20:00:00Z"), totalMinor: 1000n },
      { id: ids.inMonth, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, status: "issued", invoiceNumber: `PER-${ids.inMonth.slice(0, 8)}`, currency: "USD", issuedAt: new Date("2024-02-01T00:00:00Z"), totalMinor: 2000n },
      { id: ids.after, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, status: "issued", invoiceNumber: `PER-${ids.after.slice(0, 8)}`, currency: "USD", issuedAt: new Date("2024-03-01T00:00:00Z"), totalMinor: 4000n },
    ]);
    await db.insert(schema.payments).values({ id: ids.payment, tenantId: seedIds.happyTenant, customerId: seedIds.carter, status: "succeeded", sourceType: "test", amountMinor: 500n, currency: "USD", receivedAt: new Date("2024-02-29T23:59:59Z"), idempotencyKey: `period-${ids.payment}`, recordedByActorType: "staff" });
    await db.insert(schema.paymentAllocations).values({ tenantId: seedIds.happyTenant, paymentId: ids.payment, invoiceId: ids.inMonth, amountMinor: 500n });

    const statement = await getDocument(owner, "statement", seedIds.carter, { period: "2024-02" });
    expect(statement.period).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(statement.totals.map(({ label, amountMinor }) => [label, Number(amountMinor)])).toEqual([
      ["Opening balance", 1000], ["Period activity", 1500], ["Closing balance", 2500],
    ]);
    expect(statement.lines.map((line) => line.description)).toContain(`Invoice PER-${ids.inMonth.slice(0, 8)}`);
    expect(statement.lines.map((line) => line.description)).not.toContain(`Invoice PER-${ids.prior.slice(0, 8)}`);
    expect(statement.lines.map((line) => line.description)).not.toContain(`Invoice PER-${ids.after.slice(0, 8)}`);
  });

  it("hides statements when the customer actor has no authorized location", async () => {
    await expect(getDocument({ ...customer, locationIds: new Set(), customerLocationIds: new Map([[seedIds.carter, new Set()]]) }, "statement", seedIds.carter, { period: "2024-02" })).rejects.toMatchObject({ status: 404 });
  });

  it("renders customer visible completion details and excludes cross-tenant records", async () => {
    const report = await getDocument(customer, "completion", seedIds.completedJob);
    expect(report).toMatchObject({ kind: "completion", status: "completed", summary: "Yard cleanup completed" });
    expect(report.lines.map((line) => line.description)).toEqual(["Yard swept", "Gate secured"]);
    await expect(getDocument(owner, "invoice", seedIds.cleanInvoice)).rejects.toMatchObject({ status: 404 });
  });

  it("renders the recorded checklist and links a customer-visible proof photo", async () => {
    const [photo] = await db.insert(files).values({ tenantId: seedIds.happyTenant, storageKey: `test-proof/${crypto.randomUUID()}`,
      originalName: "service.jpg", mimeType: "image/jpeg", byteSize: 42, visibility: "customer", uploadedByActorType: "staff" }).returning();
    await db.insert(fileLinks).values({ tenantId: seedIds.happyTenant, fileId: photo!.id, entityType: "job", entityId: seedIds.completedJob, purpose: "proof" });
    await db.insert(completionProofs).values({ tenantId: seedIds.happyTenant, jobId: seedIds.completedJob, completedAt: new Date(),
      completedByMembershipId: seedIds.terryMembership, snapshot: { checklist: { propertyConfirmed: true, gateSecured: true }, fileId: photo!.id } });
    const report = await getDocument(customer, "completion", seedIds.completedJob);
    expect(report.lines.map((line) => line.description).sort()).toEqual(["Gate Secured", "Property Confirmed"]);
    expect(report.proofPhotoUrl).toBe(`/api/v1/files/${photo!.id}/download`);
  });

  it("limits technician completion documents to currently assigned jobs", async () => {
    expect((await getDocument(terry, "completion", seedIds.completedJob)).status).toBe("completed");
    await expect(getDocument(unassignedTech, "completion", seedIds.completedJob)).rejects.toMatchObject({ status: 404 });
  });

  it("limits customer documents to the exact granted service location when location evidence exists", async () => {
    const siblingLocationId = crypto.randomUUID();
    const siblingJobId = crypto.randomUUID();
    const siblingInvoiceId = crypto.randomUUID();
    const branchOnlyInvoiceId = crypto.randomUUID();
    await db.insert(schema.serviceLocations).values({
      id: siblingLocationId, tenantId: seedIds.happyTenant, customerId: seedIds.carter, organizationLocationId: seedIds.augusta,
      name: "Unshared property", addressLine1: "91 Cedar Street", city: "Augusta", region: "GA", postalCode: "30901",
    });
    await db.insert(schema.jobs).values({
      id: siblingJobId, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
      customerId: seedIds.carter, serviceLocationId: siblingLocationId, serviceId: seedIds.weeklyService, status: "completed", scheduledDate: "2026-09-20",
    });
    await db.insert(schema.invoices).values({
      id: siblingInvoiceId, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
      customerId: seedIds.carter, status: "issued", invoiceNumber: `SIB-${siblingInvoiceId.slice(0, 8)}`, currency: "USD", totalMinor: 1500n,
    });
    await db.insert(schema.invoices).values({
      id: branchOnlyInvoiceId, tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
      customerId: seedIds.carter, status: "issued", invoiceNumber: `BR-${branchOnlyInvoiceId.slice(0, 8)}`, currency: "USD", totalMinor: 1000n,
    });
    await db.insert(schema.invoiceItems).values({
      tenantId: seedIds.happyTenant, invoiceId: siblingInvoiceId, jobId: siblingJobId,
      description: "Unshared property service", quantity: "1", unitAmountMinor: 1500n, totalMinor: 1500n,
    });

    await expect(getDocument(customer, "completion", siblingJobId)).rejects.toMatchObject({ status: 404 });
    await expect(getDocument(customer, "invoice", siblingInvoiceId)).rejects.toMatchObject({ status: 404 });
    await expect(getDocument(customer, "invoice", branchOnlyInvoiceId)).rejects.toMatchObject({ status: 404 });
  });

  it("enforces staff location scope on invoice documents", async () => {
    await expect(getDocument(augustaOnly, "invoice", seedIds.franchiseEastInvoice)).rejects.toMatchObject({ status: 404 });
  });
});
