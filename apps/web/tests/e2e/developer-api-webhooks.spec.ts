import { expect, test, type Page } from "@playwright/test";

const password = "Demo12345!";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

test.describe.configure({ mode: "serial" });

test("owner manages a scoped API key and sends a logged webhook test event", async ({ page, browser }) => {
  await signIn(page, "owner@happyyards.test");
  await page.goto("/app/developer");

  const keyName = `E2E customer reader ${Date.now()}`;
  await page.getByRole("button", { name: "Create key" }).click();
  await page.getByLabel("Name", { exact: true }).fill(keyName);
  await page.getByLabel("leads:read", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Create key", exact: true }).last().click();

  const secretNotice = page.locator(".notice-success").filter({ hasText: "Copy this API key now" });
  await expect(secretNotice).toBeVisible();
  const apiKey = (await secretNotice.locator("code").innerText()).trim();
  expect(apiKey).toMatch(/^mcrm_[A-Za-z0-9_-]{43}$/);

  const credentialRow = page.locator(".action-item").filter({ hasText: keyName });
  await expect(credentialRow).toBeVisible();
  await expect(credentialRow).toContainText("customers:read");
  await expect(credentialRow).not.toContainText("leads:read");

  const cleanContext = await browser.newContext();
  let foreignCustomerId = "";
  try {
    const cleanPage = await cleanContext.newPage();
    await signIn(cleanPage, "owner@cleanpaws.test");
    const cleanCustomersResponse = await cleanPage.request.get("/api/v1/customers");
    expect(cleanCustomersResponse.ok()).toBeTruthy();
    const cleanCustomers = (await cleanCustomersResponse.json()).items as Array<{ id: string; name: string }>;
    foreignCustomerId = cleanCustomers.find((customer) => customer.name === "Carter Household")?.id ?? "";
    expect(foreignCustomerId).toBeTruthy();
  } finally {
    await cleanContext.close();
  }

  const bearer = { Authorization: `Bearer ${apiKey}` };
  const publicCustomers = await page.request.get("/api/v1/public/customers", { headers: bearer });
  expect(publicCustomers.status()).toBe(200);
  expect((await publicCustomers.json()).items.length).toBeGreaterThan(0);

  const foreignCustomer = await page.request.get(`/api/v1/public/customers/${foreignCustomerId}`, { headers: bearer });
  expect(foreignCustomer.status()).toBe(404);
  const overriddenTenant = await page.request.get("/api/v1/public/customers?tenantId=cleanpaws", { headers: bearer });
  expect(overriddenTenant.status()).toBe(422);

  page.once("dialog", (dialog) => dialog.accept());
  await credentialRow.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `The API key “${keyName}” was revoked.` })).toBeVisible();
  const revokedUse = await page.request.get("/api/v1/public/customers", { headers: bearer });
  expect(revokedUse.status()).toBe(401);

  await page.getByRole("button", { name: "Add endpoint" }).click();
  const hookName = `E2E signed delivery ${Date.now()}`;
  await page.getByLabel(/Name \(optional\)/).fill(hookName);
  // .invalid is reserved and intentionally has no receiver. The app's HTTPS
  // and public-host validation remains enabled; the worker still exercises
  // the signed delivery attempt and records its retryable network failure.
  await page.getByLabel("HTTPS endpoint").fill("https://modular-crm-e2e.invalid/events");
  await page.getByLabel("Events (comma separated)").fill("webhook.test");
  await page.getByRole("dialog", { name: "Add event endpoint" }).getByRole("button", { name: "Add endpoint", exact: true }).click();

  const webhookSecretNotice = page.locator(".notice-success").filter({ hasText: "Copy this webhook signing secret now" });
  await expect(webhookSecretNotice).toBeVisible();
  expect((await webhookSecretNotice.locator("code").innerText()).trim()).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
  const webhookRow = page.locator(".action-item").filter({ hasText: hookName });
  await expect(webhookRow).toBeVisible();
  await webhookRow.getByRole("button", { name: "Send test event" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Test event queued for delivery." })).toBeVisible();
  await webhookRow.getByRole("button", { name: "Delivery history" }).click();

  const hookResponse = await page.request.get("/api/v1/developer/webhooks");
  expect(hookResponse.ok()).toBeTruthy();
  const hook = ((await hookResponse.json()).items as Array<{ id: string; name: string }>).find((item) => item.name === hookName);
  expect(hook).toBeTruthy();
  const historyResponse = await page.request.get(`/api/v1/developer/webhooks/${hook!.id}/deliveries`);
  expect(historyResponse.ok()).toBeTruthy();
  const deliveries = (await historyResponse.json()).items as Array<{
    id: string; eventType: string; status: string; attemptCount: number;
  }>;
  const delivery = deliveries.find((item) => item.eventType === "webhook.test");
  expect(delivery).toBeTruthy();

  // A live worker may have already tried the reserved .invalid host. When it
  // has reached a retryable state, exercise the supported manual retry route.
  if (delivery!.status === "retry" || delivery!.status === "failed") {
    const retry = await page.request.post(
      `/api/v1/developer/webhooks/${hook!.id}/deliveries/${delivery!.id}/retry`,
      { data: {} },
    );
    expect(retry.status()).toBe(202);
    expect((await retry.json()).item).toMatchObject({ id: delivery!.id, status: "queued" });
  }

  await expect(webhookRow).toContainText("webhook.test");
  await expect(webhookRow.locator("table tbody tr").first()).toContainText(/queued|retry|failed|delivered/i);
});
