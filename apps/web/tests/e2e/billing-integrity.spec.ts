import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
}

test("payment retries preserve balance and a customer cannot record a manual payment", async ({ page, browser }) => {
  await signIn(page, "owner@happyyards.test");
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  const created = await page.request.post("/api/v1/invoices", { data: {
    customerId: "00000000-0000-4000-8000-000000000064",
    description: `E2E billing ${Date.now()}`,
    totalCents: 3600,
  } });
  expect(created.status()).toBe(201);
  const invoiceId = (await created.json()).item.id;
  expect((await page.request.post(`/api/v1/invoices/${invoiceId}/issue`, { data: {} })).status()).toBe(200);

  const customer = await browser.newPage();
  await signIn(customer, "customer@happyyards.test");
  await expect(customer).toHaveURL(/\/portal\/home$/);
  const forged = await customer.request.post(`/api/v1/portal/invoices/${invoiceId}/pay`, { data: {
    amountCents: 3600, method: "manual", idempotencyKey: `forged-${invoiceId}`,
  } });
  expect(forged.status()).toBe(403);
  await customer.close();

  const failedKey = `failed-${invoiceId}`;
  const failed = await page.request.post(`/api/v1/invoices/${invoiceId}/pay`, { data: {
    amountCents: 1000, method: "test", fail: true, idempotencyKey: failedKey,
  } });
  expect(failed.status()).toBe(200);
  expect((await failed.json()).item.status).toBe("failed");
  const failedRetry = await page.request.post(`/api/v1/invoices/${invoiceId}/pay`, { data: {
    amountCents: 1000, method: "test", fail: true, idempotencyKey: failedKey,
  } });
  expect(failedRetry.status()).toBe(200);
  expect((await failedRetry.json()).duplicate).toBe(true);

  const successKey = `partial-${invoiceId}`;
  const partial = await page.request.post(`/api/v1/invoices/${invoiceId}/pay`, { data: {
    amountCents: 1200, method: "test", idempotencyKey: successKey,
  } });
  expect(partial.status()).toBe(200);
  const paymentId = (await partial.json()).item.id;
  const retry = await page.request.post(`/api/v1/invoices/${invoiceId}/pay`, { data: {
    amountCents: 1200, method: "test", idempotencyKey: successKey,
  } });
  expect(retry.status()).toBe(200);
  expect((await retry.json()).item.id).toBe(paymentId);
  expect((await retry.json()).duplicate).toBe(true);

  const changedAmount = await page.request.post(`/api/v1/invoices/${invoiceId}/pay`, { data: {
    amountCents: 1300, method: "test", idempotencyKey: successKey,
  } });
  expect(changedAmount.status()).toBe(409);
  const refreshed = await page.request.get(`/api/v1/invoices/${invoiceId}`);
  expect(Number((await refreshed.json()).item.balanceCents)).toBe(2400);
});
