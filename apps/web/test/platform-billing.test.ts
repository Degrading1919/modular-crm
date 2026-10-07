import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { applyPlatformBillingEvent, initializePlatformTrials, loadTenantCapabilities, memberships, outboundMessages, platformBillingEvents, platformSubscriptions,
  platformSubscription, schema, seedDevelopment, seedIds, startPlatformTrial, sweepPlatformBilling, type Database } from "@modular-crm/db";
import { readPlatformBillingConfig, DEVELOPMENT_AUTH_SECRET } from "@modular-crm/config";
import { signMockBillingEvent, signMockPaymentEvent } from "@modular-crm/connectors";
import { permissionsForRole, type BillingNotification } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";
import { surfaceAccess, canUseAction } from "../lib/workspace-access.ts";
const { getDbMock, sessionMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), sessionMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
vi.mock("../lib/auth.ts", () => ({ auth: { api: { getSession: sessionMock } } }));
vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("PLATFORM_BILLING_PROVIDER", "mock"); vi.stubEnv("PLATFORM_BILLING_PLANS_JSON", undefined);
for (const key of ["PLATFORM_STRIPE_SECRET_KEY", "PLATFORM_STRIPE_WEBHOOK_SECRET", "PLATFORM_STRIPE_MODE"]) vi.stubEnv(key, undefined);
const { handlePlatformBilling, handlePlatformBillingPublic, guardBusinessRequest } = await import("../lib/api/platform-billing.ts");
const { apiError } = await import("../lib/api/http.ts");
const { handleDataPortability } = await import("../lib/api/data-portability.ts");
const { requireApiCapability, requirePaymentLinkFeature } = await import("../lib/api/capability-enforcement.ts");
const config = readPlatformBillingConfig({});
const mail = { secret: DEVELOPMENT_AUTH_SECRET, baseUrl: "http://localhost:3000" };
const owner: SessionActor = { kind: "staff", role: "owner", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia", permissions: permissionsForRole("owner"), allLocations: true, locationIds: new Set([seedIds.augusta]), membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization };
// Exhaustive, intentional exemptions from the business-write subscription guard.
// These are recovery/provider bookkeeping, immutable delivery/audit ledgers or
// operator-maintained projections, not owner-writable business data. New tenant
// tables must install the trigger or receive an explicitly reviewed entry here.
const BILLING_GUARD_EXEMPT_TABLES = [
  "platform_subscriptions", "platform_billing_events", "platform_billing_sessions", // Billing and card recovery remain available.
  "online_payment_events", "online_payment_sessions", // Signed customer-payment recovery.
  "domain_events", "audit_events", "activity_events", "internal_notifications", // Internal event/audit delivery.
  "outbound_messages", "communication_events", "automation_runs", "webhook_deliveries", "webhook_events", // In-flight delivery ledgers.
  "platform_email_usage", "platform_email_policies", // Platform email accounting/policy.
  "api_credentials", "connector_oauth_transactions", "sync_states", "metric_snapshots", // Revocation, OAuth recovery and internal projections.
  "commercial_account_entries", "commercial_usage_events", "usage_allowances", // Immutable platform usage accounting.
  "tenant_capability_grants", "tenant_capability_settings", // Operator-maintained entitlements.
  "website_domain_checks", // Internal DNS/TLS projection and cleanup; owner domain mutations remain guarded.
];
let pglite: PGlite; let db: Database;
function request(path: string, data: unknown = {}, method = "POST") { return new Request(`http://localhost:3000/api/v1/${path}`, { method, ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(data) }) }); }
async function call(path = "", data: unknown = {}, method = "POST", actor = owner) { return handlePlatformBilling(request(`platform-billing${path ? `/${path}` : ""}`, data, method), ["platform-billing", ...path.split("/").filter(Boolean)], actor); }
async function hosted(purpose = "subscribe", planKey = "local-standard") { const response = await call("hosted", { purpose, planKey, idempotencyKey: randomUUID() }); return (await response!.json()).item.url.split("/").at(-1) as string; }
async function state() { return (await platformSubscription(db, owner.tenantId))!; }
function event(status: "active" | "past_due", created = Math.floor(Date.now()/1000)): BillingNotification {
  return { id: `platform_${randomUUID()}`, created, type: status === "active" ? "invoice.paid" : "invoice.payment_failed", customerId: "mock_customer", subscriptionId: "mock_subscription",
    snapshot: { customerId: "mock_customer", subscriptionId: "mock_subscription", status, planKey: "local-standard", currency: "USD", interval: "month" } };
}
async function apply(input: BillingNotification, settings = config, resolve = async () => input.snapshot!) {
  return applyPlatformBillingEvent(db, settings, input, createHash("sha256").update(JSON.stringify(input)).digest("hex"), resolve, mail);
}
beforeAll(async () => {
  pglite = new PGlite(); const database = drizzle(pglite, { schema });
  await migrate(database, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = database as unknown as Database; getDbMock.mockReturnValue(db); await seedDevelopment(db);
  await startPlatformTrial(db, owner.tenantId, config);
}, 120000);
beforeEach(async () => {
  sessionMock.mockReset();
  await db.update(platformSubscriptions).set({ status: "trialing", provider: "mock", planKey: "local-standard", capabilities: ["*"], includedSeats: 10,
    customerId: null, subscriptionId: null, pastDueAt: null, graceEnd: null, lastEventAt: null, trialEnd: new Date(Date.now()+14*86400000) }).where(eq(platformSubscriptions.tenantId, owner.tenantId));
  // Hosted pages are ephemeral, unlike the append-only event history.
  await db.delete(schema.platformBillingSessions).where(eq(schema.platformBillingSessions.tenantId, owner.tenantId));
});
afterAll(async () => { vi.unstubAllEnvs(); await pglite?.close(); });
describe("platform subscriptions, recovery and tenant-safe enforcement", () => {
  it("exports subscription history in read-only mode without hosted-page bearer URLs", async () => {
    const id = await hosted();
    const [session] = await db.select().from(schema.platformBillingSessions).where(eq(schema.platformBillingSessions.id, id));
    await call(`mock/session/${id}`, { action: "pay" });
    await db.update(platformSubscriptions).set({ status: "read_only" }).where(eq(platformSubscriptions.tenantId, owner.tenantId));
    const response = await handleDataPortability(request("exports/business-data", {}, "GET"), ["exports", "business-data"], owner);
    expect(response!.status).toBe(200);
    const payload = await response!.json();
    expect(payload.data.platformSubscriptions).toHaveLength(1);
    expect(payload.data.platformBillingEvents.length).toBeGreaterThan(0);
    expect(payload.data).not.toHaveProperty("platformBillingSessions");
    expect(JSON.stringify(payload)).not.toContain(session!.url);
  });
  it("starts one no-card trial and never resets legacy trials on restart", async () => {
    const first = await state(); const later = await startPlatformTrial(db, owner.tenantId, config, new Date(Date.now()+365*86400000));
    expect(later.trialEnd).toEqual(first.trialEnd); expect(later.customerId).toBeNull(); expect(later.status).toBe("trialing");
    await initializePlatformTrials(db, config);
    const clean = await platformSubscription(db, seedIds.cleanTenant);
    expect(clean?.status).toBe("trialing");
    await initializePlatformTrials(db, config, new Date(Date.now()+365*86400000));
    expect((await platformSubscription(db, seedIds.cleanTenant))?.trialEnd).toEqual(clean?.trialEnd);
  });
  it("does not trust opening or returning from checkout, activates only a signed event, and replays once", async () => {
    const id = await hosted();
    expect((await call("", {}, "GET"))!.status).toBe(200); expect((await state()).status).toBe("trialing");
    await call(`mock/session/${id}`, { action: "pay" }); await call(`mock/session/${id}`, { action: "pay" });
    expect((await state()).status).toBe("active");
    expect(await db.select().from(platformBillingEvents).where(eq(platformBillingEvents.eventId, `platform_session_${id}`))).toHaveLength(1);
    await expect(call(`mock/session/${id}`, { action: "change", planKey: "local-small" })).rejects.toMatchObject({ status: 403 });
  });
  it("keeps a pending subscribe page bound to its chosen plan and rejects tenant/owner impersonation", async () => {
    const id = await hosted(); expect(await hosted()).toBe(id);
    await expect(hosted("subscribe", "local-small")).rejects.toMatchObject({ status: 409 });
    await expect(call("hosted", { purpose: "subscribe", idempotencyKey: randomUUID() }, "POST", { ...owner, role: "office" })).rejects.toMatchObject({ status: 403 });
    await expect(call(`mock/session/${id}`, {}, "GET", { ...owner, tenantId: seedIds.cleanTenant })).rejects.toMatchObject({ status: 404 });
    expect((await call("", {}, "GET", { ...owner, role: "office" }))!.status).toBe(200);
    expect((await (await call("", {}, "GET"))!.json()).item.plans[0].prices.USD).not.toHaveProperty("monthlyPriceId");
  });
  it("records failures, expires grace, keeps reads/recovery available and returns useful 402s", async () => {
    const id = await hosted(); await call(`mock/session/${id}`, { action: "pay" });
    await call("mock/fail"); const due = await state(); expect(due.status).toBe("past_due"); expect(due.graceEnd!.getTime()-due.pastDueAt!.getTime()).toBe(7*86400000);
    await call("mock/fail"); expect((await state()).graceEnd).toEqual(due.graceEnd);
    await call("mock/expire-grace"); expect((await state()).status).toBe("read_only");
    for (const path of ["customers", "jobs", "invoices", "payments", "routes", "staff", "website/publish", "inventory", "automations", "field/time", "settings", "imports"]) {
      await expect(guardBusinessRequest(request(path), path.split("/"), owner)).rejects.toMatchObject({ status: 402, code: "BILLING_REQUIRED" });
    }
    await expect(guardBusinessRequest(request("exports/business", {}, "GET"), ["exports", "business"], owner)).resolves.toBeUndefined();
    await expect(guardBusinessRequest(request("customers", {}, "GET"), ["customers"], owner)).resolves.toBeUndefined();
    expect((await call("", {}, "GET"))!.status).toBe(200);
    const card = await hosted("card"); await call(`mock/session/${card}`, { action: "pay" });
    expect(await state()).toMatchObject({ status: "active", pastDueAt: null, graceEnd: null });
    await expect(guardBusinessRequest(request("customers"), ["customers"], owner)).resolves.toBeUndefined();
  });
  it("protects direct database writes throughout seeded modules, including deletes, not just HTTP routes", async () => {
    await db.update(platformSubscriptions).set({ status: "read_only" }).where(eq(platformSubscriptions.tenantId, owner.tenantId));
    const tenantTables = await pglite.query<{ table_name: string }>(`select t.table_name from information_schema.tables t
      where t.table_schema='public' and t.table_type='BASE TABLE' and (t.table_name='tenants' or exists (
        select 1 from information_schema.columns c where c.table_schema=t.table_schema and c.table_name=t.table_name and c.column_name='tenant_id'))`);
    const triggers = await pglite.query<{ table_name: string; operation: string }>("select event_object_table as table_name, event_manipulation as operation from information_schema.triggers where trigger_schema='public' and trigger_name='platform_business_write_guard'");
    const expectedGuarded = tenantTables.rows.map(row => row.table_name).filter(name => !BILLING_GUARD_EXEMPT_TABLES.includes(name)).sort();
    expect([...new Set(triggers.rows.map(row => row.table_name))].sort()).toEqual(expectedGuarded);
    expect(BILLING_GUARD_EXEMPT_TABLES.every(name => tenantTables.rows.some(row => row.table_name === name))).toBe(true);
    for (const table of expectedGuarded) expect(triggers.rows.filter(row => row.table_name === table).map(row => row.operation).sort())
      .toEqual(table === "tenants" ? ["DELETE", "UPDATE"] : ["DELETE", "INSERT", "UPDATE"]);
    const tables = { rows: expectedGuarded.map(table_name => ({ table_name })) };
    const blocked: string[] = [];
    for (const { table_name: table } of tables.rows) {
      expect(table).toMatch(/^[a-z_]+$/);
      const field = table === "tenants" ? "id" : "tenant_id";
      const count = await pglite.query<{ count: number }>(`select count(*)::int as count from "${table}" where "${field}"=$1`, [owner.tenantId]);
      if (!count.rows[0]!.count) continue;
      await expect(pglite.query(`update "${table}" set "${field}"="${field}" where "${field}"=$1`, [owner.tenantId])).rejects.toMatchObject({ code: "P0402" });
      blocked.push(table);
    }
    expect(blocked).toEqual(expect.arrayContaining(["tenants", "customers", "jobs", "invoices", "payments", "service_plans", "route_plans", "memberships", "services", "tickets", "sites", "automation_rules", "inventory_items", "time_entries"]));
    await expect(db.delete(schema.customers).where(eq(schema.customers.id, seedIds.carter))).rejects.toBeDefined();
    await expect(db.update(schema.customers).set({ displayName: "Other business still writable" }).where(eq(schema.customers.id, seedIds.cleanCarter))).resolves.toBeDefined();
    try { await db.update(schema.customers).set({ displayName: "Blocked" }).where(eq(schema.customers.id, seedIds.carter)); } catch (error) { const response = apiError(error); expect(response.status).toBe(402); expect((await response.json()).error.message).toContain("view and export"); }
  });
  it("enforces seats without deleting existing staff on downgrade, and preserves historical screens/payment links", async () => {
    const id = await hosted(); await call(`mock/session/${id}`, { action: "pay" });
    const change = await hosted("portal"); await call(`mock/session/${change}`, { action: "change", planKey: "local-small" });
    expect(await state()).toMatchObject({ includedSeats: 2, planKey: "local-small" });
    const staff = await db.select().from(memberships).where(eq(memberships.tenantId, owner.tenantId)); expect(staff.length).toBeGreaterThan(2);
    await expect(db.insert(memberships).values({ tenantId: owner.tenantId, userId: "demo-clean-owner", organizationId: seedIds.happyOrganization, roleTemplateId: seedIds.happyOfficeRole, status: "invited" })).rejects.toBeDefined();
    await expect(db.update(memberships).set({ status: "active" }).where(eq(memberships.id, seedIds.oliviaMembership))).resolves.toBeDefined();
    const capabilities = await loadTenantCapabilities(db, owner.tenantId);
    expect(capabilities.features.route_planning).toMatchObject({ usable: false, historicalRead: true });
    const access = { role: "owner", permissions: [...owner.permissions], features: capabilities.features };
    expect(surfaceAccess(access, "routes", true)).toBe("allowed"); expect(canUseAction(access, "routes", ["routes.create"])).toBe(false);
    await expect(requireApiCapability(owner.tenantId, ["routes"], "POST")).rejects.toMatchObject({ status: 403 });
    await expect(requireApiCapability(owner.tenantId, ["reports"], "GET")).resolves.toBeUndefined();
    await expect(requirePaymentLinkFeature(owner.tenantId, "payment_collection")).resolves.toBeUndefined();
    const cancel = await hosted("portal", "local-small"); await call(`mock/session/${cancel}`, { action: "cancel" });
    expect((await state()).status).toBe("canceled"); expect(await db.select().from(memberships).where(eq(memberships.tenantId, owner.tenantId))).toHaveLength(staff.length);
  });
  it("rejects wrong-signed customer-payment events and leaves both ledgers untouched", async () => {
    const signed = signMockPaymentEvent({ id: randomUUID(), accountReference: "acct_tenant", type: "payment.succeeded", paymentReference: "payment_tenant", amountMinor: 2500, currency: "USD" });
    const before = await db.select().from(platformBillingEvents);
    await expect(handlePlatformBillingPublic(new Request("http://localhost/api/v1/platform-billing/webhook", { method: "POST", headers: { "platform-billing-signature": signed.signature }, body: signed.rawBody }), ["platform-billing", "webhook"])).rejects.toMatchObject({ status: 400 });
    expect(await db.select().from(platformBillingEvents)).toEqual(before);
    expect(await db.select().from(schema.onlinePaymentEvents)).toHaveLength(0);
  });
  it("processes signed notifications once and rejects a changed replay payload", async () => {
    await db.update(platformSubscriptions).set({ customerId: "mock_customer", subscriptionId: "mock_subscription" }).where(eq(platformSubscriptions.tenantId, owner.tenantId));
    const input = event("active"), signed = signMockBillingEvent(input);
    const send = () => handlePlatformBillingPublic(new Request("http://localhost/api/v1/platform-billing/webhook", { method: "POST", headers: { "platform-billing-signature": signed.signature }, body: signed.rawBody }), ["platform-billing", "webhook"]);
    expect((await (await send())!.json()).duplicate).toBe(false); expect((await (await send())!.json()).duplicate).toBe(true);
    await expect(apply({ ...input, type: "invoice.payment_failed" })).rejects.toMatchObject({ status: 409 });
    const [history] = await db.select().from(platformBillingEvents).where(eq(platformBillingEvents.eventId, input.id));
    await expect(db.update(platformBillingEvents).set({ outcome: "forged" }).where(eq(platformBillingEvents.id, history!.id))).rejects.toBeDefined();
    await expect(db.delete(platformBillingEvents).where(eq(platformBillingEvents.id, history!.id))).rejects.toBeDefined();
  });
  it("ignores stale mock payloads but reconciles delayed Stripe events to current canonical status", async () => {
    await db.update(platformSubscriptions).set({ customerId: "mock_customer", subscriptionId: "mock_subscription" }).where(eq(platformSubscriptions.tenantId, owner.tenantId));
    const created = Math.floor(Date.now()/1000);
    await apply(event("past_due", created)); expect((await state()).status).toBe("past_due");
    const stale = event("active", created-100); expect(await apply(stale)).toMatchObject({ ignored: true }); expect((await state()).status).toBe("past_due");
    await apply(event("active", created+1)); expect((await state()).status).toBe("active");
    const settings = { ...config, provider: "stripe" as const, plans: [{ ...config.plans[0]!, prices: { USD: { monthly: 4900, monthlyPriceId: "price_month" } } }] };
    await db.update(platformSubscriptions).set({ provider: "stripe" }).where(eq(platformSubscriptions.tenantId, owner.tenantId));
    const old = event("past_due", created-500), resolve = vi.fn(async () => ({ ...old.snapshot!, status: "active" as const, priceId: "price_month" }));
    expect(await apply(old, settings, resolve)).toMatchObject({ ignored: false }); expect((await state()).status).toBe("active"); expect((await state()).lastEventAt).toEqual(new Date((created+1)*1000));
    await apply(old, settings, resolve); expect(resolve).toHaveBeenCalledOnce();
  });
  it("records delayed events from a replaced subscription without changing current access", async () => {
    const created = Math.floor(Date.now()/1000);
    await db.update(platformSubscriptions).set({ provider: "stripe", status: "active", customerId: "mock_customer", subscriptionId: "sub_replacement", lastEventAt: new Date(created*1000) }).where(eq(platformSubscriptions.tenantId, owner.tenantId));
    const settings = { ...config, provider: "stripe" as const };
    const resolve = vi.fn(async () => ({ ...event("past_due").snapshot!, subscriptionId: "sub_retired" }));
    const delayed = { ...event("past_due", created+1), subscriptionId: "sub_retired" };
    expect(await apply(delayed, settings, resolve)).toMatchObject({ ignored: true });
    expect(resolve).not.toHaveBeenCalled(); expect((await state()).status).toBe("active");
    await db.update(platformSubscriptions).set({ status: "canceled" }).where(eq(platformSubscriptions.tenantId, owner.tenantId));
    expect(await apply({ ...delayed, id: `platform_${randomUUID()}`, type: "customer.subscription.updated" }, settings, resolve)).toMatchObject({ ignored: true });
    expect((await state()).status).toBe("canceled"); expect(resolve).not.toHaveBeenCalled();
    expect(await db.select().from(platformBillingEvents).where(eq(platformBillingEvents.eventId, delayed.id))).toMatchObject([{ outcome: "stale" }]);
  });
  it("closes only the tenant-bound hosted request on verified Stripe checkout completion", async () => {
    const id = await hosted();
    await db.update(schema.platformBillingSessions).set({ providerReference: "cs_completed" }).where(eq(schema.platformBillingSessions.id, id));
    await db.update(platformSubscriptions).set({ provider: "stripe", customerId: "mock_customer", subscriptionId: "mock_subscription" }).where(eq(platformSubscriptions.tenantId, owner.tenantId));
    const settings = { ...config, provider: "stripe" as const, plans: [{ ...config.plans[0]!, prices: { USD: { monthly: 4900, monthlyPriceId: "price_month" } } }] };
    const input = { ...event("active"), type: "checkout.session.completed", hostedSessionReference: "cs_completed" };
    await apply(input, settings, async () => ({ ...input.snapshot!, priceId: "price_month" }));
    const [session] = await db.select().from(schema.platformBillingSessions).where(eq(schema.platformBillingSessions.id, id));
    expect(session!.completedAt).toBeInstanceOf(Date);
    await apply(input, settings); // Duplicate delivery does not resolve/charge again.
    expect((await state()).status).toBe("active");
  });
  it("queues encrypted trial-ending/failure/read-only notices once, without requiring a messaging connector", async () => {
    const previousIds = new Set((await db.select().from(outboundMessages)).map(message => message.id));
    const trialEnd = new Date(Date.now()+2*86400000);
    await db.update(platformSubscriptions).set({ trialEnd }).where(eq(platformSubscriptions.tenantId, owner.tenantId));
    await sweepPlatformBilling(db, config, mail, new Date(), owner.tenantId); await sweepPlatformBilling(db, config, mail, new Date(), owner.tenantId);
    await sweepPlatformBilling(db, config, mail, new Date(trialEnd.getTime()+7*86400000), owner.tenantId);
    await sweepPlatformBilling(db, config, mail, new Date(trialEnd.getTime()+8*86400000), owner.tenantId);
    const notices = await db.select().from(outboundMessages).where(and(eq(outboundMessages.tenantId, owner.tenantId), eq(outboundMessages.category, "account")));
    const current = notices.filter(notice => !previousIds.has(notice.id));
    expect(current.map(notice => notice.templateKey).sort()).toEqual(["platform-billing-payment-failed", "platform-billing-read-only", "platform-billing-trial-ending"]);
    expect(current.every(notice => !notice.renderedBody.includes("http://localhost"))).toBe(true);
  });
  it("requires a platform-operator identity, not merely a tenant-owner role", async () => {
    sessionMock.mockResolvedValue({ user: { id: owner.userId } });
    await expect(handlePlatformBillingPublic(request("platform-admin/billing", {}, "GET"), ["platform-admin", "billing"])).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("PLATFORM_OPERATOR_USER_IDS", owner.userId);
    try {
      const response = await handlePlatformBillingPublic(request("platform-admin/billing?status=trialing", {}, "GET"), ["platform-admin", "billing"]);
      expect(response!.status).toBe(200); const result = await response!.json(); expect(result.items.length).toBeGreaterThan(0); expect(result.items.every((row: { status: string }) => row.status === "trialing")).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/customerId|subscriptionId|secret/);
    } finally { vi.stubEnv("PLATFORM_OPERATOR_USER_IDS", undefined); }
  });
});
