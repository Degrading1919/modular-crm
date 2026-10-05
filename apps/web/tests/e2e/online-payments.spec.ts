import { expect, test, type Page } from "@playwright/test";
import { seedIds } from "@modular-crm/db";

async function signIn(page: Page, email: string, destination: RegExp) {
  await page.goto("/login"); await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("Demo12345!"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(destination);
}
test("owner setup → service invoice email → customer hosted card payment and receipt → owner partial refund", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const rules: string[] = []; const customer = await browser.newPage();
  const endpoint = "/api/v1/connections/mock-payments/online-payments";
  await signIn(page, "owner@happyyards.test", /\/app\/dashboard$/);
  try {
    await page.goto("/app/connections");
    const setup = page.locator('[data-online-payment-provider="mock-payments"]');
    await setup.getByRole("button", { name: "Set up online payments", exact: true }).click();
    await expect(setup.getByText("Ready to accept cards", { exact: true })).toBeVisible();
    await expect(setup.getByRole("checkbox", { name: "Allow customers to make partial invoice payments" })).not.toBeChecked();
    const created = await page.request.post("/api/v1/invoices", { data: { customerId: seedIds.carter, description: `Online acceptance ${crypto.randomUUID()}`, totalCents: 1200 } });
    expect(created.status(), await created.text()).toBe(201); const invoiceId = (await created.json()).item.id as string;
    for (const [trigger, field, subject] of [["invoice.issued", "event.entityId", `Invoice online ${invoiceId}`], ["payment.succeeded", "event.payload.invoiceId", `Receipt online ${invoiceId}`]]) {
      const rule = await page.request.post("/api/v1/automations", { data: { name: subject, trigger, status: "active", conditions: { field, operator: "equals", value: invoiceId },
        actions: [{ actionType: "send_email", purpose: "service", configuration: { subject, body: "Please review your account." } }] } });
      expect(rule.status(), await rule.text()).toBe(201); rules.push((await rule.json()).item.id);
    }
    const issued = await page.request.post(`/api/v1/invoices/${invoiceId}/issue`, { data: {} });
    expect(issued.ok(), await issued.text()).toBeTruthy(); const number = (await issued.json()).item.invoiceNumber as string;
    await expect.poll(async () => {
      const messages = (await (await page.request.get("/api/v1/communications")).json()).items;
      return messages.find((message: { subject: string }) => message.subject === `Invoice online ${invoiceId}`)?.message;
    }, { timeout: 45_000 }).toContain(`/portal/billing/${invoiceId}`);
    await signIn(customer, "customer@happyyards.test", /\/portal\/home$/);
    await customer.goto(`/portal/billing/${invoiceId}`);
    const dialog = customer.getByRole("dialog", { name: `Pay invoice ${number}` });
    await expect(dialog).toBeVisible(); await expect(dialog.getByLabel("Payment amount")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Pay $12.00", exact: true }).click();
    await expect(customer).toHaveURL(/\/test-checkout\/mock_session_/);
    await expect(customer.getByText("No real card information is needed and no money will move.")).toBeVisible();
    const hostedUrl = customer.url();
    await customer.getByRole("button", { name: "Decline test payment", exact: true }).click();
    const invoiceCard = customer.locator(".card").filter({ has: customer.getByRole("heading", { name: `Invoice ${number}`, exact: true }) });
    await expect(invoiceCard).toContainText("did not go through");
    await invoiceCard.getByRole("button", { name: "Pay now", exact: true }).click();
    await dialog.getByRole("button", { name: "Pay $12.00", exact: true }).click();
    await expect(customer).toHaveURL(hostedUrl);
    await customer.getByRole("button", { name: "Complete test payment", exact: true }).click();
    await expect(customer.getByRole("heading", { name: "Payment receipt", exact: true })).toBeVisible();
    await expect(customer.getByText("Card (test payment)", { exact: false })).toBeVisible();
    const receiptUrl = customer.url();
    await customer.goto("/portal/billing");
    await expect(invoiceCard.getByText("Paid", { exact: true })).toHaveCount(2); // status and money summary label
    await expect(invoiceCard.getByRole("button", { name: "Pay now", exact: true })).toHaveCount(0);
    await expect.poll(async () => {
      const messages = (await (await page.request.get("/api/v1/communications")).json()).items;
      return messages.filter((message: { subject: string }) => message.subject === `Receipt online ${invoiceId}`).length;
    }, { timeout: 45_000 }).toBe(1);
    await page.goto(`/app/invoices/${invoiceId}`);
    const refund = page.getByRole("form", { name: "Refund invoice payment" });
    await refund.getByLabel("Refund amount (USD)").fill("1.10");
    await refund.getByLabel("Reason (optional)").fill("Partial service credit");
    await refund.getByRole("button", { name: "Refund payment", exact: true }).click();
    await expect(page.getByText("Refunded $1.10", { exact: true })).toBeVisible();
    await expect.poll(async () => Number((await (await page.request.get(`/api/v1/invoices/${invoiceId}`)).json()).item.balanceCents)).toBe(110);
    await customer.goto("/portal/billing");
    await expect(invoiceCard.getByRole("button", { name: "Pay now", exact: true })).toBeVisible();
    await expect(invoiceCard.getByText("$1.10", { exact: true })).toBeVisible();
    await customer.goto(receiptUrl); await expect(customer.getByRole("heading", { name: "Payment receipt", exact: true })).toBeVisible();
  } finally {
    for (const id of rules) expect((await page.request.patch(`/api/v1/automations/${id}`, { data: { status: "archived" } })).ok()).toBeTruthy();
    expect((await page.request.delete(endpoint)).ok()).toBeTruthy();
    await customer.close();
  }
});
