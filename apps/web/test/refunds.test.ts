import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import {
  invoices, paymentAllocations, payments, refunds, schema, seedDevelopment, seedIds, type Database,
} from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock, getCapabilityMock, requireTenantFeatureMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), getCapabilityMock: vi.fn(), requireTenantFeatureMock: vi.fn(async () => undefined) }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
vi.mock("../lib/connectors.ts", () => ({ getCapability: getCapabilityMock }));
vi.mock("../lib/api/capability-enforcement.ts", () => ({ requireTenantFeature: requireTenantFeatureMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleInvoiceRefund } = await import("../lib/api/refunds.ts");

let pglite: PGlite;
let db: Database;
const refundCalls: { paymentReference: string; amountMinor: number; idempotencyKey: string }[] = [];
async function refundMock(input: { paymentReference: string; amountMinor: number; idempotencyKey: string }) {
  refundCalls.push(input);
  return { reference: `mock_ref_${input.idempotencyKey.slice(-8)}`, paymentReference: input.paymentReference, amountMinor: input.amountMinor, status: "succeeded" as const };
}
const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  getCapabilityMock.mockResolvedValue({ refund: refundMock });
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

async function fixture() {
  const key = crypto.randomUUID().slice(0, 8);
  const [invoice] = await db.insert(invoices).values({
    tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta,
    customerId: seedIds.carter, status: "partially_paid", invoiceNumber: `REFUND-${key}`, currency: "USD",
    totalMinor: 10_000n, paidMinor: 6_000n, balanceMinor: 4_000n,
  }).returning();
  if (!invoice) throw new Error("Invoice fixture was not created.");
  const [payment] = await db.insert(payments).values({
    tenantId: seedIds.happyTenant, customerId: seedIds.carter, status: "succeeded", sourceType: "mock",
    providerReference: `mock_pay_${key}`, amountMinor: 6_000n, currency: "USD", receivedAt: new Date(),
    idempotencyKey: `refund-test-${key}`, recordedByActorType: "staff", recordedByActorId: owner.userId,
  }).returning();
  if (!payment) throw new Error("Payment fixture was not created.");
  await db.insert(paymentAllocations).values({ tenantId: seedIds.happyTenant, paymentId: payment.id, invoiceId: invoice.id, amountMinor: 6_000n });
  return { invoice, payment };
}

function request(invoiceId: string, body: Record<string, unknown>) {
  return new Request(`http://localhost/api/v1/invoices/${invoiceId}/refunds`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("invoice refunds", () => {
  it("supports partial then full refunds, persists linked records, and updates balance without exposing processor references", async () => {
    refundCalls.length = 0;
    const { invoice, payment } = await fixture();
    const partial = await handleInvoiceRefund(request(invoice.id, { paymentId: payment.id, amountCents: 2_000, idempotencyKey: "partial-1" }), ["invoices", invoice.id, "refunds"], owner);
    expect(partial?.status).toBe(201);
    const first = await partial!.json() as { item: Record<string, unknown>; invoice: { balanceCents: number } };
    expect(first.invoice.balanceCents).toBe(6_000);
    expect(first.item).toMatchObject({ paymentId: payment.id, amountMinor: 2_000, status: "succeeded" });
    expect(first.item).not.toHaveProperty("providerReference");

    const retry = await handleInvoiceRefund(request(invoice.id, { paymentId: payment.id, amountCents: 2_000, idempotencyKey: "partial-1" }), ["invoices", invoice.id, "refunds"], owner);
    expect(retry?.status).toBe(200);
    expect((await retry!.json()).duplicate).toBe(true);
    expect(refundCalls).toHaveLength(1);

    const full = await handleInvoiceRefund(request(invoice.id, { paymentId: payment.id, amountCents: 4_000, idempotencyKey: "remaining-1" }), ["invoices", invoice.id, "refunds"], owner);
    expect(full?.status).toBe(201);
    expect((await full!.json()).invoice.balanceCents).toBe(10_000);
    const [savedInvoice] = await db.select().from(invoices).where(eq(invoices.id, invoice.id)).limit(1);
    const [savedPayment] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
    expect(savedInvoice).toMatchObject({ status: "issued", balanceMinor: 10_000n, paidMinor: 6_000n });
    expect(savedPayment?.status).toBe("refunded");
    const savedRefunds = await db.select().from(refunds).where(and(eq(refunds.tenantId, owner.tenantId), eq(refunds.paymentId, payment.id)));
    expect(savedRefunds).toHaveLength(2);
    expect(savedRefunds.reduce((sum, item) => sum + item.amountMinor, 0n)).toBe(6_000n);
  });

  it("rejects over-refunds and hides records from unauthorized actors", async () => {
    refundCalls.length = 0;
    const { invoice, payment } = await fixture();
    await expect(handleInvoiceRefund(request(invoice.id, { paymentId: payment.id, amountCents: 6_001, idempotencyKey: "too-much" }), ["invoices", invoice.id, "refunds"], owner))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });

    const manager = { ...owner, role: "office" as const, permissions: new Set([...permissionsForRole("office")].filter((permission) => permission !== "payments.refund")) };
    await expect(handleInvoiceRefund(request(invoice.id, { paymentId: payment.id, amountCents: 100, idempotencyKey: "unauthorized" }), ["invoices", invoice.id, "refunds"], manager))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(refundCalls).toHaveLength(0);
  });

  it("rejects mismatched payments and conflicting retries without changing invoice state", async () => {
    refundCalls.length = 0;
    const { invoice, payment } = await fixture();
    const other = await fixture();
    await expect(handleInvoiceRefund(request(invoice.id, { paymentId: other.payment.id, amountCents: 100, idempotencyKey: "wrong-payment" }), ["invoices", invoice.id, "refunds"], owner))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    const original = { paymentId: payment.id, amountCents: 100, idempotencyKey: "stable-key" };
    await handleInvoiceRefund(request(invoice.id, original), ["invoices", invoice.id, "refunds"], owner);
    await expect(handleInvoiceRefund(request(invoice.id, { ...original, amountCents: 200 }), ["invoices", invoice.id, "refunds"], owner))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  });

  it("lists invoice payment context without capability entitlement or processor references and enforces tenant/location scope", async () => {
    const { invoice, payment } = await fixture();
    await db.insert(refunds).values({ tenantId: seedIds.happyTenant, paymentId: payment.id, providerReference: "secret_processor_ref", amountMinor: 700n, currency: "USD", status: "succeeded" });
    requireTenantFeatureMock.mockClear();

    const response = await handleInvoiceRefund(new Request("http://localhost", { method: "GET" }), ["invoices", invoice.id, "payments"], owner);
    expect(response?.status).toBe(200);
    const payload = await response!.json() as { items: Record<string, unknown>[] };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ id: payment.id, amountCents: 6_000, refundedCents: 700, status: "succeeded", sourceType: "mock" });
    expect(payload.items[0]).toHaveProperty("createdAt");
    expect(payload.items[0]).not.toHaveProperty("providerReference");
    expect(payload.items[0]).not.toHaveProperty("connectorInstallationId");
    expect(JSON.stringify(payload)).not.toContain("secret_processor_ref");
    expect(requireTenantFeatureMock).not.toHaveBeenCalled();

    const anotherTenant = { ...owner, tenantId: seedIds.cleanTenant };
    await expect(handleInvoiceRefund(new Request("http://localhost", { method: "GET" }), ["invoices", invoice.id, "payments"], anotherTenant))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    const wrongLocation = { ...owner, allLocations: false, locationIds: new Set([seedIds.northAugusta]) };
    await expect(handleInvoiceRefund(new Request("http://localhost", { method: "GET" }), ["invoices", invoice.id, "payments"], wrongLocation))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
