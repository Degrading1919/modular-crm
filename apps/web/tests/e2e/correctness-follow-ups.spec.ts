import { expect, test, type Page } from "@playwright/test";
import { closeDatabase, createDatabase, jobs, notes, refunds, routePlans, routeStops, seedIds } from "@modular-crm/db";
import { signMockPaymentEvent } from "@modular-crm/connectors";
import { and, eq, sql } from "drizzle-orm";

async function signIn(page: Page, email: string, destination: RegExp) {
  await page.goto("/login"); await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("Demo12345!"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(destination);
}

test("owner resolves both checked refund outcomes without another processor request, then can refund eligible money", async ({ page, browser }) => {
  const db = createDatabase(process.env.DATABASE_URL!); const customer = await browser.newPage();
  await signIn(page, "owner@happyyards.test", /\/app\/dashboard$/);
  await signIn(customer, "customer@happyyards.test", /\/portal\/home$/);
  try {
    const setup = "/api/v1/connections/mock-payments/online-payments";
    expect((await page.request.post(setup, { data: {} })).ok()).toBeTruthy(); expect((await page.request.get(setup)).ok()).toBeTruthy();
    for (const outcome of ["refunded", "not_refunded"] as const) {
      const created = await page.request.post("/api/v1/invoices", { data: { customerId: seedIds.carter, description: `Reviewed refund ${crypto.randomUUID()}`, totalCents: 1200 } });
      expect(created.status()).toBe(201); const invoiceId = (await created.json()).item.id as string;
      expect((await page.request.post(`/api/v1/invoices/${invoiceId}/issue`, { data: {} })).ok()).toBeTruthy();
      const checkout = await customer.request.post(`/api/v1/portal/invoices/${invoiceId}/checkout`, { data: { idempotencyKey: crypto.randomUUID() } });
      expect(checkout.ok(), await checkout.text()).toBeTruthy(); const hosted = (await checkout.json()).item;
      await customer.goto(hosted.url);
      await customer.getByRole("button", { name: "Complete test payment", exact: true }).click();
      await expect(customer.getByRole("heading", { name: "Payment receipt", exact: true })).toBeVisible();
      const context = (await (await page.request.get(`/api/v1/invoices/${invoiceId}/payments`)).json()).items[0];
      const partial = await page.request.post(`/api/v1/invoices/${invoiceId}/refunds`, { data: { paymentId: context.id, amountCents: 400, idempotencyKey: crypto.randomUUID() } });
      expect(partial.status()).toBe(202); const refundId = (await partial.json()).item.id as string;
      const [refund] = await db.select().from(refunds).where(eq(refunds.id, refundId));
      // Real signed mock notification exercises the conflicting provider outcome.
      const payment = (await db.execute<{ provider_reference: string; account_id: string }>(
        // Test-only lookup; financial references are never returned to the UI.
        sql`select p.provider_reference, a.id as account_id from payments p join online_payment_accounts a on a.tenant_id=p.tenant_id and a.installation_id=p.connector_installation_id where p.id=${context.id} and p.tenant_id=${seedIds.happyTenant}`)).rows[0]!;
      const signed = signMockPaymentEvent({ id: crypto.randomUUID(), accountReference: `mock_acct_${payment.account_id}`, type: "refund.failed", paymentReference: payment.provider_reference, refundReference: refund!.providerReference!, amountMinor: 400, currency: "USD" });
      expect((await page.request.post("/api/v1/payments/webhooks/mock-payments", { headers: { "payment-signature": signed.signature }, data: signed.rawBody })).ok()).toBeTruthy();
      await page.goto(`/app/invoices/${invoiceId}`);
      await expect(page.getByRole("heading", { name: "Refund needs review", exact: true })).toBeVisible();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: outcome === "refunded" ? "The refund went through" : "No refund happened", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Refund needs review", exact: true })).toHaveCount(0);
      expect(Number((await (await page.request.get(`/api/v1/invoices/${invoiceId}`)).json()).item.balanceCents)).toBe(outcome === "refunded" ? 400 : 0);
      const form = page.getByRole("form", { name: "Refund invoice payment" });
      await form.getByLabel("Refund amount (USD)").fill("1.00");
      const response = page.waitForResponse((item) => new URL(item.url()).pathname === `/api/v1/invoices/${invoiceId}/refunds` && item.request().method() === "POST");
      await form.getByRole("button", { name: "Refund payment", exact: true }).click();
      const accepted = await response; expect(accepted.status()).toBe(202); expect((await accepted.json()).item.status).toBe("succeeded");
      await expect(page.getByText(outcome === "refunded" ? "Refunded $5.00" : "Refunded $1.00", { exact: true })).toBeVisible();
      expect(Number((await (await page.request.get(`/api/v1/invoices/${invoiceId}`)).json()).item.balanceCents)).toBe(outcome === "refunded" ? 500 : 100);
      expect((await db.select().from(refunds).where(eq(refunds.id, refundId)))[0]).toMatchObject({ reviewReason: null, reviewResolution: outcome });
    }
  } finally { await page.request.delete("/api/v1/connections/mock-payments/online-payments"); await customer.close(); await closeDatabase(db); }
});

test("first publication skips a canceled stop and lapsed sign-in resumes saved technician evidence automatically", async ({ page, browser }) => {
  const db = createDatabase(process.env.DATABASE_URL!); const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000" });
  let testRouteId: string | undefined;
  await signIn(page, "owner@happyyards.test", /\/app\/dashboard$/);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const date = ["year", "month", "day"].map((part) => parts.find((item) => item.type === part)!.value).join("-");
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const created = await page.request.post("/api/v1/jobs", { data: { customerId: seedIds.carter, serviceName: "Yard cleanup", scheduledDate: date, notes: `Queue recovery ${crypto.randomUUID()}` } });
      expect(created.status()).toBe(201); const id = (await created.json()).item.id as string; ids.push(id);
      expect((await page.request.post(`/api/v1/jobs/${id}/assign`, { data: { technicianId: seedIds.terryMembership, scheduledDate: date } })).ok()).toBeTruthy();
    }
    const route = await page.request.post("/api/v1/routes", { data: { technicianId: seedIds.terryMembership, date } });
    expect(route.status()).toBe(201); const routeId = (await route.json()).item.id as string; testRouteId = routeId;
    expect((await page.request.post(`/api/v1/jobs/${ids[1]}/transition`, { data: { status: "canceled", reason: "Customer canceled before publication" } })).ok()).toBeTruthy();
    const publish = await page.request.post(`/api/v1/routes/${routeId}/publish`, { data: {} });
    expect(publish.ok(), await publish.text()).toBeTruthy();
    const field = await context.newPage(); await signIn(field, "tech@happyyards.test", /\/field\/today$/);
    await field.goto(`/field/job/${ids[0]}`); await expect(field.getByRole("button", { name: "Start job", exact: true })).toBeVisible();
    const evidence = `Evidence after sign-in ${crypto.randomUUID()}`;
    await context.setOffline(true); await field.getByLabel("What should the office know?").fill(evidence); await field.getByRole("button", { name: "Save note", exact: true }).click();
    const queued = field.getByLabel(/Queued update/).first(); await expect(queued).toContainText(evidence);
    const original = await field.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith("modular-field-queue-v2:"))!)!)[0]);
    await context.clearCookies(); await context.setOffline(false);
    await expect(queued).toContainText("Sign in again to sync");
    const synced = field.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/field/jobs/${ids[0]}/note` && response.request().method() === "POST" && response.ok());
    await signIn(field, "tech@happyyards.test", /\/field\/today$/);
    const received = await synced; expect(received.ok(), await received.text()).toBeTruthy();
    await expect(field.getByLabel(/Queued update/)).toHaveCount(0);
    const saved = await db.select().from(notes).where(and(eq(notes.tenantId, seedIds.happyTenant), eq(notes.entityId, ids[0]!), eq(notes.body, evidence)));
    expect(saved).toHaveLength(1); expect(original.payload.text).toBe(evidence);
    const receipts = await db.execute(sql`select client_operation_id from field_operation_receipts where tenant_id=${seedIds.happyTenant} and client_operation_id=${original.id}`);
    expect(receipts.rows).toHaveLength(1);
  } finally {
    await context.close();
    // Remove only this test's route, so later clear-day/seeded-route assertions
    // are independent of the recovery scenario's newly published work.
    if (testRouteId) await db.transaction(async (tx) => {
      await tx.delete(routeStops).where(and(eq(routeStops.tenantId, seedIds.happyTenant), eq(routeStops.routePlanId, testRouteId!)));
      await tx.update(jobs).set({ assignedRouteId: null }).where(and(eq(jobs.tenantId, seedIds.happyTenant), eq(jobs.assignedRouteId, testRouteId!)));
      await tx.delete(routePlans).where(and(eq(routePlans.tenantId, seedIds.happyTenant), eq(routePlans.id, testRouteId!)));
    });
    await closeDatabase(db);
  }
});
