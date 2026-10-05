import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { connectorInstallations, domainEvents, invoices, onlinePaymentAccounts, onlinePaymentEvents, onlinePaymentSessions, paymentAllocations, payments, refunds, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { createMockConnectorRegistry, signMockPaymentEvent, type OnlinePaymentEvent } from "@modular-crm/connectors";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock, getRegistryMock, featureMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), getRegistryMock: vi.fn(), featureMock: vi.fn(async () => {}) }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
vi.mock("../lib/connectors.ts", () => ({ getRegistry: getRegistryMock, getCapability: vi.fn() }));
vi.mock("../lib/api/capability-enforcement.ts", () => ({ requireTenantFeature: featureMock }));
vi.stubEnv("MOCK_CONNECTORS", "true");
vi.stubEnv("CONNECTOR_CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 17).toString("base64url"));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const accountApi = await import("../lib/api/online-payment-accounts.ts");
const { handleOnlinePaymentAccounts, onlineForAccount } = accountApi;
const { handleOnlinePaymentSession } = await import("../lib/api/online-payment-sessions.ts");
const { handleOnlinePaymentWebhook, processOnlinePaymentEvent } = await import("../lib/api/online-payment-webhooks.ts");
const { handleOnlinePaymentRefund } = await import("../lib/api/online-payment-refunds.ts");
const { handleMockHostedPayment } = await import("../lib/api/mock-hosted-payments.ts");
const { openConnectorCredentials } = await import("../lib/api/connector-secrets.ts");
const { refundId } = await import("../lib/api/refunds.ts");
let pglite: PGlite;
let db: Database;
let account: typeof onlinePaymentAccounts.$inferSelect;
const owner: SessionActor = { kind: "staff", role: "owner", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia", permissions: permissionsForRole("owner"), allLocations: true, locationIds: new Set([seedIds.augusta]), membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization };
const customer: SessionActor = { kind: "customer", userId: "demo-happy-customer", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: null, name: "Alex", email: "carter@example.test", customerIds: new Set([seedIds.carter]), locationIds: new Set([seedIds.carterLocation]), customerLocationIds: new Map([[seedIds.carter, new Set([seedIds.carterLocation])]]) };
function request(path: string, data: unknown = {}, method = "POST") { return new Request(`http://localhost:3000/api/v1/${path}`, { method, ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(data) }) }); }
async function fixture() {
  const [invoice] = await db.insert(invoices).values({ tenantId: owner.tenantId, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: seedIds.carter, status: "issued", invoiceNumber: `ONLINE-${crypto.randomUUID()}`, currency: "USD", totalMinor: 1200n, balanceMinor: 1200n, issuedAt: new Date() }).returning();
  return invoice!;
}
async function checkout(invoice: typeof invoices.$inferSelect, data: Record<string, unknown> = {}, actor = customer) {
  return handleOnlinePaymentSession(request(`portal/invoices/${invoice.id}/checkout`, { idempotencyKey: crypto.randomUUID(), ...data }), ["portal", "invoices", invoice.id, "checkout"], actor);
}
async function eventFor(invoice: typeof invoices.$inferSelect, extra: Partial<OnlinePaymentEvent> = {}) {
  await checkout(invoice);
  const [session] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id)).limit(1);
  const status = await (await onlineForAccount(account)).accountStatus();
  return { id: `event_${session!.id}`, accountReference: status.accountReference, type: "payment.succeeded" as const, paymentReference: `mock_payment_${session!.id}`, sessionReference: session!.providerReference!, amountMinor: Number(session!.amountMinor), currency: session!.currency, ...extra };
}
function apply(event: OnlinePaymentEvent) { return processOnlinePaymentEvent("mock-payments", event, createHash("sha256").update(JSON.stringify(event)).digest("hex")); }
async function current(invoiceId: string) { return (await db.select().from(invoices).where(eq(invoices.id, invoiceId)))[0]!; }

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  getRegistryMock.mockReturnValue(createMockConnectorRegistry());
  await seedDevelopment(db);
  await handleOnlinePaymentAccounts(request("connections/mock-payments/online-payments"), ["connections", "mock-payments", "online-payments"], owner);
  await handleOnlinePaymentAccounts(request("connections/mock-payments/online-payments", {}, "GET"), ["connections", "mock-payments", "online-payments"], owner);
  account = (await db.select().from(onlinePaymentAccounts).where(eq(onlinePaymentAccounts.tenantId, owner.tenantId)))[0]!;
}, 120_000);
afterAll(async () => { await pglite?.close(); vi.unstubAllEnvs(); });

describe("account-bound online invoice payments", () => {
  it("saves account identifiers only in bound encryption and verifies readiness from the capability", async () => {
    const [installation] = await db.select().from(connectorInstallations).where(eq(connectorInstallations.id, account.installationId));
    const credentials = openConnectorCredentials(installation!.credentialReference!, { tenantId: owner.tenantId, installationId: account.installationId, connectorKey: account.provider });
    expect(credentials.accountReference).toBe(`mock_acct_${account.id}`);
    expect(installation!.providerAccountId).toBeNull();
    expect(installation!.credentialReference).not.toContain(credentials.accountReference);
    expect(account.chargesEnabled).toBe(true);
    const response = await handleOnlinePaymentAccounts(request("connections/mock-payments/online-payments", {}, "GET"), ["connections", "mock-payments", "online-payments"], owner);
    const value = await response!.json();
    expect(value).toMatchObject({ item: { message: "Ready to accept cards", allowPartial: false } });
    expect(JSON.stringify(value).includes("mock_acct")).toBe(false);
  });
  it("rejects staff without owner authority, missing permission, and cross-tenant business setup", async () => {
    await expect(handleOnlinePaymentAccounts(request("connections/mock-payments/online-payments"), ["connections", "mock-payments", "online-payments"], { ...owner, role: "office" })).rejects.toMatchObject({ status: 403 });
    await expect(handleOnlinePaymentAccounts(request("connections/mock-payments/online-payments"), ["connections", "mock-payments", "online-payments"], { ...owner, permissions: new Set() })).rejects.toMatchObject({ status: 403 });
    const withoutInstall = new Set(owner.permissions); withoutInstall.delete("connectors.install");
    await expect(handleOnlinePaymentAccounts(request("connections/mock-payments/online-payments"), ["connections", "mock-payments", "online-payments"], { ...owner, permissions: withoutInstall })).rejects.toMatchObject({ status: 403 });
    expect((await db.select().from(onlinePaymentAccounts).where(eq(onlinePaymentAccounts.tenantId, owner.tenantId)))).toHaveLength(1);
    await expect(handleOnlinePaymentAccounts(request("connections/mock-payments/online-payments", { organizationId: seedIds.cleanOrganization }), ["connections", "mock-payments", "online-payments"], owner)).rejects.toMatchObject({ status: 404 });
  });
  it("computes the full server balance, rejects amount tampering, and dedupes concurrent-page intent", async () => {
    const invoice = await fixture();
    const response = await checkout(invoice, { idempotencyKey: "retry_a" });
    const first = await response!.json();
    expect(first.item.amountCents).toBe(1200);
    expect(first.item.url).toContain("/test-checkout/");
    expect(await (await checkout(invoice, { idempotencyKey: "retry_a" }))!.json()).toEqual(first);
    expect(await (await checkout(invoice))!.json()).toEqual(first);
    expect((await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id)))).toHaveLength(1);
    await expect(checkout(invoice, { amountCents: 1 })).rejects.toMatchObject({ status: 422 });
    await expect(checkout(invoice, { amountCents: 1201 })).rejects.toMatchObject({ status: 422 });
    await expect(checkout(invoice, { currency: "EUR" })).rejects.toThrow();
  });
  it("allows partial payment only after the owner explicitly enables it", async () => {
    const path = ["connections", "mock-payments", "online-payments"];
    await handleOnlinePaymentAccounts(request(path.join("/"), { allowPartial: true }, "PATCH"), path, owner);
    const invoice = await fixture();
    expect((await (await checkout(invoice, { amountCents: 400 }))!.json()).item.amountCents).toBe(400);
    await handleOnlinePaymentAccounts(request(path.join("/"), { allowPartial: false }, "PATCH"), path, owner);
    await expect(checkout(await fixture(), { amountCents: 400 })).rejects.toMatchObject({ status: 422 });
  });
  it("does not let a different amount overtake a checkout whose creation response is still pending", async () => {
    const path = ["connections", "mock-payments", "online-payments"];
    await handleOnlinePaymentAccounts(request(path.join("/"), { allowPartial: true }, "PATCH"), path, owner);
    try {
      const invoice = await fixture();
      const [pending] = await db.insert(onlinePaymentSessions).values({ tenantId: owner.tenantId, invoiceId: invoice.id, accountId: account.id,
        clientKey: "pending_creation", amountMinor: 400n, currency: "USD", expiresAt: new Date(Date.now() + 60 * 60 * 1000) }).returning();
      await expect(checkout(invoice, { amountCents: 800 })).rejects.toMatchObject({ status: 409 });
      expect((await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id)))).toHaveLength(1);
      expect((await (await checkout(invoice, { amountCents: 400 }))!.json()).item.amountCents).toBe(400);
      expect((await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id)))[0]!.id).toBe(pending!.id);
    } finally {
      await handleOnlinePaymentAccounts(request(path.join("/"), { allowPartial: false }, "PATCH"), path, owner);
    }
  });
  it("preserves customer, staff location, and tenant restrictions", async () => {
    const invoice = await fixture();
    await expect(checkout(invoice, {}, { ...customer, tenantId: seedIds.cleanTenant })).rejects.toMatchObject({ status: 404 });
    await expect(checkout(invoice, {}, { ...customer, customerLocationIds: new Map() })).rejects.toMatchObject({ status: 404 });
    await expect(checkout(invoice, {}, { ...owner, role: "office", allLocations: false, locationIds: new Set([seedIds.northAugusta]) })).rejects.toMatchObject({ status: 404 });
    await expect(checkout(invoice, {}, { ...owner, permissions: new Set() })).rejects.toMatchObject({ status: 403 });
  });
  it("only signed success records money, balances, receipt history, and one automation event", async () => {
    const invoice = await fixture();
    const event = await eventFor(invoice);
    expect((await current(invoice.id)).paidMinor).toBe(0n); // Checkout creation/return is not payment proof.
    const signed = signMockPaymentEvent(event);
    const send = () => handleOnlinePaymentWebhook(new Request("http://localhost:3000/api/v1/payments/webhooks/mock-payments", { method: "POST", headers: { "payment-signature": signed.signature }, body: signed.rawBody }), ["payments", "webhooks", "mock-payments"]);
    expect((await send())!.status).toBe(200);
    expect(await (await send())!.json()).toMatchObject({ duplicate: true });
    expect(await current(invoice.id)).toMatchObject({ paidMinor: 1200n, balanceMinor: 0n, status: "paid" });
    const rows = await db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoice.id));
    expect(rows).toHaveLength(1);
    const [payment] = await db.select().from(payments).where(eq(payments.id, rows[0]!.paymentId));
    expect(payment).toMatchObject({ recordedMethod: "card", sourceType: "mock", amountMinor: 1200n, feeMinor: null, connectorInstallationId: account.installationId });
    expect((await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, payment!.id), eq(domainEvents.eventType, "payment.succeeded"))))).toHaveLength(1);
  });
  it("rejects bad signatures, changed event contents, wrong amount/currency and another account's session", async () => {
    const invoice = await fixture();
    const event = await eventFor(invoice);
    await expect(handleOnlinePaymentWebhook(new Request("http://localhost/payments/webhooks/mock-payments", { method: "POST", body: JSON.stringify(event) }), ["payments", "webhooks", "mock-payments"])).rejects.toMatchObject({ status: 400 });
    const signed = signMockPaymentEvent(event);
    await expect(handleOnlinePaymentWebhook(new Request("http://localhost/payments/webhooks/mock-payments", { method: "POST", headers: { "payment-signature": signed.signature }, body: `\uFEFF${signed.rawBody}` }), ["payments", "webhooks", "mock-payments"])).rejects.toMatchObject({ status: 400 });
    await expect(apply({ ...event, amountMinor: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(apply({ ...event, currency: "EUR" })).rejects.toMatchObject({ status: 409 });
    expect(await apply({ ...event, accountReference: "mock_acct_other_tenant" })).toMatchObject({ ignored: true });
    expect((await current(invoice.id)).paidMinor).toBe(0n);
    await apply(event);
    await expect(apply({ ...event, currency: "EUR" })).rejects.toMatchObject({ status: 409 });
  });
  it("handles failure then success, late failure, and distinct repeated successful deliveries without duplicate side effects", async () => {
    const invoice = await fixture();
    const event = await eventFor(invoice);
    await apply({ ...event, id: "failed_" + event.id, type: "payment.failed" });
    const [failed] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id));
    expect(failed!.failureMessage).toContain("did not go through");
    expect((await (await checkout(invoice, { idempotencyKey: failed!.clientKey }))!.json()).item.url).toBe(failed!.url);
    expect((await (await checkout(invoice))!.json()).item.url).toBe(failed!.url);
    expect((await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id)))).toHaveLength(1);
    await apply(event);
    await apply({ ...event, id: "late_" + event.id, type: "payment.failed" });
    await apply({ ...event, id: "again_" + event.id });
    expect(await current(invoice.id)).toMatchObject({ balanceMinor: 0n, paidMinor: 1200n, status: "paid" });
    expect((await db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoice.id)))).toHaveLength(1);
  });
  it("refund-before-payment returns a retryable conflict without deduping, then partial/full confirmations reconcile once", async () => {
    const invoice = await fixture();
    const event = await eventFor(invoice);
    const refund: OnlinePaymentEvent = { ...event, id: "refund_" + event.id, type: "payment.refunded", amountMinor: 400, refundReference: "refund_" + event.paymentReference };
    await expect(apply(refund)).rejects.toMatchObject({ status: 409 });
    expect((await db.select().from(onlinePaymentEvents).where(eq(onlinePaymentEvents.providerEventId, refund.id)))).toHaveLength(0);
    await apply(event);
    await apply(refund);
    await apply({ ...refund, id: "another_" + refund.id });
    expect(await current(invoice.id)).toMatchObject({ paidMinor: 1200n, balanceMinor: 400n, status: "partially_paid" });
    await apply({ ...refund, id: "rest_" + refund.id, refundReference: "rest_" + refund.refundReference, amountMinor: 800 });
    expect(await current(invoice.id)).toMatchObject({ paidMinor: 1200n, balanceMinor: 1200n, status: "issued" });
    await expect(apply({ ...refund, id: "excess_" + refund.id, refundReference: "excess_" + refund.refundReference, amountMinor: 1 })).rejects.toMatchObject({ status: 409 });
  });
  it("owner refunds go through the capability and signed mock confirmation; retries and permission denial are safe", async () => {
    const invoice = await fixture();
    const event = await eventFor(invoice);
    await apply(event);
    const [allocation] = await db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoice.id));
    const data = { paymentId: allocation!.paymentId, amountCents: 500, reason: "Partial service credit", idempotencyKey: "refund_a" };
    const path = ["invoices", invoice.id, "refunds"];
    const send = (actor = owner, changed = {}) => handleOnlinePaymentRefund(request(path.join("/"), { ...data, ...changed }), path, actor);
    await expect(send({ ...owner, role: "office" })).rejects.toMatchObject({ status: 403 });
    expect((await send())!.status).toBe(202);
    await send();
    await expect(send(owner, { amountCents: 600 })).rejects.toMatchObject({ status: 409 });
    await expect(send(owner, { amountCents: 701, idempotencyKey: "excess_a" })).rejects.toMatchObject({ status: 422 });
    expect(await current(invoice.id)).toMatchObject({ balanceMinor: 500n });
    expect((await db.select().from(refunds).where(eq(refunds.paymentId, allocation!.paymentId)))).toHaveLength(1);
  });
  it("recovers a confirmed checkout whose response was lost, even after local page expiration", async () => {
    const invoice = await fixture(); const event = await eventFor(invoice);
    const [session] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id));
    await db.update(onlinePaymentSessions).set({ providerReference: null, url: null, status: "expired" }).where(eq(onlinePaymentSessions.id, session!.id));
    await apply({ ...event, sessionRequestReference: session!.id });
    expect(await current(invoice.id)).toMatchObject({ balanceMinor: 0n, paidMinor: 1200n, status: "paid" });
    await apply({ ...event, id: "recovery_again_" + event.id });
    expect((await db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoice.id)))).toHaveLength(1);
  });
  it("failed refund confirmations release reservations without changing balances or undoing late success", async () => {
    const invoice = await fixture(); const event = await eventFor(invoice); await apply(event);
    const [pending] = await db.insert(refunds).values({ tenantId: owner.tenantId, paymentId: (await db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoice.id)))[0]!.paymentId,
      connectorInstallationId: account.installationId, status: "pending", amountMinor: 400n, currency: "USD" }).returning();
    const failed: OnlinePaymentEvent = { ...event, id: `refund_failed_${pending!.id}`, type: "refund.failed", refundReference: `re_${pending!.id}`, refundRequestReference: pending!.id, amountMinor: 400 };
    await apply(failed);
    expect((await db.select().from(refunds).where(eq(refunds.id, pending!.id)))[0]!.status).toBe("failed");
    expect((await current(invoice.id)).balanceMinor).toBe(0n);
    await apply({ ...failed, id: `refund_success_${pending!.id}`, type: "payment.refunded" });
    await apply({ ...failed, id: `late_failure_${pending!.id}` });
    expect((await current(invoice.id)).balanceMinor).toBe(400n);
    expect((await db.select().from(refunds).where(eq(refunds.id, pending!.id)))[0]!.status).toBe("succeeded");
  });
  it("known second-tenant account cannot bind to another tenant's checkout reference or request ID", async () => {
    const otherOwner = { ...owner, tenantId: seedIds.cleanTenant, organizationId: seedIds.cleanOrganization };
    await handleOnlinePaymentAccounts(request("connections/mock-payments/online-payments"), ["connections", "mock-payments", "online-payments"], otherOwner);
    await handleOnlinePaymentAccounts(request("connections/mock-payments/online-payments", {}, "GET"), ["connections", "mock-payments", "online-payments"], otherOwner);
    const [otherAccount] = await db.select().from(onlinePaymentAccounts).where(eq(onlinePaymentAccounts.tenantId, seedIds.cleanTenant));
    const invoice = await fixture(); const event = await eventFor(invoice);
    const [session] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id));
    const accountReference = (await (await onlineForAccount(otherAccount!)).accountStatus()).accountReference;
    await expect(apply({ ...event, accountReference, sessionRequestReference: session!.id })).rejects.toMatchObject({ status: 409 });
    expect((await current(invoice.id)).paidMinor).toBe(0n);
    expect((await db.select().from(onlinePaymentEvents).where(eq(onlinePaymentEvents.providerEventId, event.id)))).toHaveLength(0);
  });
  it("rejects an oversized signed endpoint body before parsing or recording effects", async () => {
    await expect(handleOnlinePaymentWebhook(new Request("http://localhost/payments/webhooks/mock-payments", { method: "POST", body: "x".repeat(1_000_001) }), ["payments", "webhooks", "mock-payments"])).rejects.toMatchObject({ status: 413 });
  });
  it("does not expose the local hosted payment action when mocks are disabled", async () => {
    const invoice = await fixture(); await checkout(invoice);
    const [session] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id));
    const path = ["payments", "test-checkout", session!.providerReference!];
    vi.stubEnv("MOCK_CONNECTORS", "false");
    try {
      await expect(handleMockHostedPayment(request(path.join("/"), { outcome: "succeeded" }), path, customer)).rejects.toMatchObject({ status: 404 });
      expect((await current(invoice.id)).paidMinor).toBe(0n);
    } finally { vi.stubEnv("MOCK_CONNECTORS", "true"); }
  });
  it("replaces a deadline-expired page without asking the processor to expire it again", async () => {
    const invoice = await fixture(); await checkout(invoice);
    const [old] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id));
    await db.update(onlinePaymentSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(onlinePaymentSessions.id, old!.id));
    const online = await onlineForAccount(account);
    const expire = vi.fn(async () => { throw new Error("Processor rejects expiring an already expired page"); });
    const spy = vi.spyOn(accountApi, "onlineForAccount").mockResolvedValue({ ...online, expireHostedPage: expire });
    try {
      const result = await (await checkout(invoice))!.json();
      expect(result.item.url).not.toBe(old!.url);
      expect(expire).not.toHaveBeenCalled();
      expect((await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.id, old!.id)))[0]!.status).toBe("expired");
      expect((await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id)))).toHaveLength(2);
    } finally { spy.mockRestore(); }
  });
  it("binds a child business independently and attributes its history to that business, not the parent owner", async () => {
    const path = ["connections", "mock-payments", "online-payments"];
    const organizationId = seedIds.franchiseEastOrganization;
    await handleOnlinePaymentAccounts(request(path.join("/"), { organizationId }), path, owner);
    await handleOnlinePaymentAccounts(request(path.join("/"), { organizationId, allowPartial: true }, "PATCH"), path, owner);
    const [child] = await db.select().from(onlinePaymentAccounts).where(eq(onlinePaymentAccounts.organizationId, organizationId));
    const [installation] = await db.select().from(connectorInstallations).where(eq(connectorInstallations.id, child!.installationId));
    expect(installation!.organizationId).toBe(organizationId);
    expect(child!.accountHash).not.toBe(account.accountHash);
    expect(child!.allowPartial).toBe(true);
    expect((await db.select().from(onlinePaymentAccounts).where(eq(onlinePaymentAccounts.id, account.id)))[0]!.allowPartial).toBe(false);
    const events = await db.select().from(domainEvents).where(eq(domainEvents.entityId, child!.installationId));
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.organizationId === organizationId && event.actorId === owner.userId)).toBe(true);
  });
  it("pending refunds reserve money and an ambiguous old request cannot be sent again with expired processor idempotency", async () => {
    const invoice = await fixture(); const event = await eventFor(invoice); await apply(event);
    const paymentId = (await db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoice.id)))[0]!.paymentId;
    const key = "old_ambiguous_refund";
    const id = refundId(owner.tenantId, invoice.id, key);
    await db.insert(refunds).values({ id, tenantId: owner.tenantId, paymentId, connectorInstallationId: account.installationId, status: "pending", amountMinor: 400n, currency: "USD", createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });
    const path = ["invoices", invoice.id, "refunds"];
    await expect(handleOnlinePaymentRefund(request(path.join("/"), { paymentId, amountCents: 801, idempotencyKey: "new_excess" }), path, owner)).rejects.toMatchObject({ status: 422 });
    await expect(handleOnlinePaymentRefund(request(path.join("/"), { paymentId, amountCents: 400, idempotencyKey: key }), path, owner)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("payment-service review") });
    expect((await current(invoice.id)).balanceMinor).toBe(0n);
    expect((await db.select().from(refunds).where(eq(refunds.paymentId, paymentId)))).toHaveLength(1);
    await apply({ ...event, id: "old_refund_confirmation", type: "payment.refunded", amountMinor: 400, refundReference: "confirmed_old_refund", refundRequestReference: id });
    expect((await current(invoice.id)).balanceMinor).toBe(400n);
  });
});
