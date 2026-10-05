import { expect, test, type Page } from "@playwright/test";
import { closeDatabase, createDatabase, onlinePaymentAccounts, onlinePaymentSessions, refunds, seedIds } from "@modular-crm/db";
import { signMockPaymentEvent } from "@modular-crm/connectors";
import { and, eq } from "drizzle-orm";

async function signIn(page: Page, email: string) {
  await page.goto("/login"); await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("Demo12345!"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(email.startsWith("owner") ? /\/app\/dashboard$/ : /\/portal\/home$/);
}
async function fixture(page: Page) {
  const setup = "/api/v1/connections/mock-payments/online-payments";
  expect((await page.request.post(setup, { data: {} })).ok()).toBeTruthy(); expect((await page.request.get(setup)).ok()).toBeTruthy();
  const created = await page.request.post("/api/v1/invoices", { data: { customerId: seedIds.carter, description: `Payment safety ${crypto.randomUUID()}`, totalCents: 1200 } });
  expect(created.status(), await created.text()).toBe(201); const id = (await created.json()).item.id as string;
  const issued = await page.request.post(`/api/v1/invoices/${id}/issue`, { data: {} }); expect(issued.ok()).toBeTruthy();
  return { id, number: (await issued.json()).item.invoiceNumber as string };
}
test("manual collection closes checkout; a racing late payment stays real and recoverable in both views", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const customer = await browser.newPage(); const db = createDatabase(process.env.DATABASE_URL!);
  await signIn(page, "owner@happyyards.test");
  try {
    const invoice = await fixture(page); await signIn(customer, "customer@happyyards.test");
    const checkout = await customer.request.post(`/api/v1/portal/invoices/${invoice.id}/checkout`, { data: { idempotencyKey: crypto.randomUUID() } });
    expect(checkout.ok(), await checkout.text()).toBeTruthy();
    const [session] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id));
    const manual = await page.request.post(`/api/v1/invoices/${invoice.id}/pay`, { data: { amountCents: 1200, method: "cash", idempotencyKey: crypto.randomUUID() } });
    expect(manual.ok(), await manual.text()).toBeTruthy();
    expect((await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.id, session!.id)))[0]!.status).toBe("expired");
    expect((await customer.request.post(`/api/v1/payments/test-checkout/${session!.providerReference}`, { data: { outcome: "succeeded" } })).status()).toBe(409);
    // Processor success may race expiry. Its signed financial confirmation must still be kept.
    const signed = signMockPaymentEvent({ id: `late_${session!.id}`, type: "payment.succeeded", accountReference: `mock_acct_${session!.accountId}`, paymentReference: `mock_payment_${session!.id}`, sessionReference: session!.providerReference!, amountMinor: 1200, currency: "USD" });
    for (let i=0; i<2; i++) expect((await customer.request.post("/api/v1/payments/webhooks/mock-payments", { headers: { "payment-signature": signed.signature }, data: signed.rawBody })).ok()).toBeTruthy();
    await customer.goto("/portal/billing");
    const card = customer.locator(".card").filter({ has: customer.getByRole("heading", { name: `Invoice ${invoice.number}`, exact: true }) });
    const customerNote = card.getByRole("status");
    await expect(customerNote).toHaveText("We received your payment. Your service team will contact you about the extra amount.");
    await expect(customerNote).not.toHaveClass(/notice-error/); await expect(card).not.toContainText("Review the payment history");
    await expect(card.getByRole("button", { name: "Pay now", exact: true })).toHaveCount(0);
    await page.goto("/app/dashboard");
    const attention = page.locator(".action-item").filter({ hasText: "Extra payment needs attention" }).filter({ hasText: invoice.number });
    await expect(attention.getByRole("link", { name: "Review", exact: true })).toHaveAttribute("href", `/app/invoices/${invoice.id}#invoice-refund`);
    await page.goto(`/app/invoices/${invoice.id}`); await expect(page.getByRole("heading", { name: "Extra payment needs attention" })).toBeVisible();
    await page.getByRole("link", { name: "Refund the extra amount", exact: true }).click();
    const form = page.getByRole("form", { name: "Refund invoice payment" });
    await expect(form.getByLabel("Refund amount (USD)")).toHaveValue("12.00");
    await form.getByRole("button", { name: "Refund payment", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Extra payment needs attention" })).toHaveCount(0);
    const item = (await (await page.request.get(`/api/v1/invoices/${invoice.id}`)).json()).item;
    expect(Number(item.paidCents)).toBe(2400); expect(Number(item.overpaymentCents)).toBe(0); expect(Number(item.openBalanceCents)).toBe(0);
    await customer.reload(); await expect(card.getByRole("status")).toHaveCount(0);
  } finally { await page.request.delete("/api/v1/connections/mock-payments/online-payments"); await customer.close(); await closeDatabase(db); }
});

test("signed account health immediately hides collection, and a later failed refund ends in owner review", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const customer = await browser.newPage(); const db = createDatabase(process.env.DATABASE_URL!);
  await signIn(page, "owner@happyyards.test");
  try {
    const invoice = await fixture(page); await signIn(customer, "customer@happyyards.test");
    const [account] = await db.select().from(onlinePaymentAccounts).where(and(eq(onlinePaymentAccounts.tenantId, seedIds.happyTenant), eq(onlinePaymentAccounts.organizationId, seedIds.happyOrganization)));
    const notify = async (event: Parameters<typeof signMockPaymentEvent>[0]) => {
      const signed = signMockPaymentEvent(event); const response = await page.request.post("/api/v1/payments/webhooks/mock-payments", { headers: { "payment-signature": signed.signature }, data: signed.rawBody });
      expect(response.ok(), await response.text()).toBeTruthy();
    };
    await notify({ id: `health_disabled_${invoice.id}`, accountReference: `mock_acct_${account!.id}`, type: "account.updated", chargesEnabled: false, detailsNeeded: true });
    await customer.goto("/portal/billing");
    const card = customer.locator(".card").filter({ has: customer.getByRole("heading", { name: `Invoice ${invoice.number}`, exact: true }) });
    await expect(card.getByRole("button", { name: "Pay now", exact: true })).toHaveCount(0);
    expect((await customer.request.post(`/api/v1/portal/invoices/${invoice.id}/checkout`, { data: { idempotencyKey: crypto.randomUUID() } })).status()).toBe(503);
    await notify({ id: `health_enabled_${invoice.id}`, accountReference: `mock_acct_${account!.id}`, type: "account.updated", chargesEnabled: true, detailsNeeded: false });
    const checkout = await customer.request.post(`/api/v1/portal/invoices/${invoice.id}/checkout`, { data: { idempotencyKey: crypto.randomUUID() } }); expect(checkout.ok()).toBeTruthy();
    const [session] = await db.select().from(onlinePaymentSessions).where(eq(onlinePaymentSessions.invoiceId, invoice.id));
    expect((await customer.request.post(`/api/v1/payments/test-checkout/${session!.providerReference}`, { data: { outcome: "succeeded" } })).ok()).toBeTruthy();
    const refunded = await page.request.post(`/api/v1/invoices/${invoice.id}/refunds`, { data: { paymentId: session!.id, amountCents: 400, idempotencyKey: crypto.randomUUID() } }); expect(refunded.ok()).toBeTruthy();
    const [refund] = await db.select().from(refunds).where(eq(refunds.paymentId, session!.id));
    await notify({ id: `refund_late_fail_${invoice.id}`, accountReference: `mock_acct_${account!.id}`, type: "refund.failed", paymentReference: `mock_payment_${session!.id}`, refundReference: refund!.providerReference!, amountMinor: 400, currency: "USD" });
    await page.goto(`/app/invoices/${invoice.id}`); await expect(page.getByRole("heading", { name: "Refund needs review" })).toBeVisible();
    await expect(page.getByText("Recorded money has not been changed.", { exact: false })).toBeVisible();
    expect(Number((await (await page.request.get(`/api/v1/invoices/${invoice.id}`)).json()).item.balanceCents)).toBe(400);
    expect((await page.request.post(`/api/v1/invoices/${invoice.id}/refunds`, { data: { paymentId: session!.id, amountCents: 100, idempotencyKey: crypto.randomUUID() } })).status()).toBe(409);
  } finally { await page.request.delete("/api/v1/connections/mock-payments/online-payments"); await customer.close(); await closeDatabase(db); }
});
