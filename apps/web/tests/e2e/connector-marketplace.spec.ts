import { expect, test, type Browser, type Page } from "@playwright/test";

const password = "Demo12345!";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

test("connector marketplace groups test connections and scopes connection state by tenant", async ({ page, browser }) => {
  await signIn(page, "owner@happyyards.test");

  const catalogResponse = await page.request.get("/api/v1/connections");
  expect(catalogResponse.ok()).toBeTruthy();
  const catalog = await catalogResponse.json();
  expect(catalog.industryPack).toMatchObject({ key: "pet-waste-removal", displayName: "Pet Waste Removal" });
  expect(catalog.groups).toEqual(expect.arrayContaining([
    expect.objectContaining({ capability: "Accept payments" }),
    expect.objectContaining({ capability: "Sync accounting" }),
    expect.objectContaining({ capability: "Plan efficient routes" }),
  ]));
  const accountingConnector = catalog.items.find((item: { key: string }) => item.key === "mock-accounting");
  expect(accountingConnector).toMatchObject({
    capability: "Sync accounting",
    recommendedForIndustry: true,
    mode: "mock",
    environment: "test",
    status: "not_connected",
  });
  const serializedCatalog = JSON.stringify(catalog);
  expect(serializedCatalog).not.toMatch(/"(?:settings|credentials?|accessToken|refreshToken|clientSecret|webhookSecret|providerAccountId)"\s*:/i);

  await page.goto("/app/connections");
  await expect(page.getByText(/Optional connections for Pet Waste Removal/)).toBeVisible();
  const accountingGroup = page.getByRole("heading", { name: /Sync Accounting.*Suggested for Pet Waste Removal/ });
  await expect(accountingGroup).toBeVisible();
  const accountingCard = page.locator(".module-card").filter({ has: page.getByRole("heading", { name: "Test accounting", exact: true }) });
  await expect(accountingCard.getByText(/Demo connection/)).toBeVisible();
  await expect(accountingCard.getByText("Not Connected", { exact: true })).toBeVisible();

  await accountingCard.getByRole("button", { name: "Connect", exact: true }).click();
  try {
    await expect(page.getByRole("status").filter({ hasText: "Test accounting is connected." })).toBeVisible();
    await expect(accountingCard.getByText("Connected", { exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await accountingCard.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Test accounting was disconnected." })).toBeVisible();
    await expect(accountingCard.getByText("Not Connected", { exact: true })).toBeVisible();

    // Exercise the explicit reconnect action exposed by the API, then confirm
    // its state is reflected in the owner-facing marketplace.
    const reconnectResponse = await page.request.post("/api/v1/connections/mock-accounting/reconnect", { data: {} });
    expect(reconnectResponse.ok()).toBeTruthy();
    expect(await reconnectResponse.json()).toMatchObject({ item: { status: "connected", mode: "mock", environment: "test" } });
    await page.reload();
    await expect(page.locator(".module-card").filter({ has: page.getByRole("heading", { name: "Test accounting", exact: true }) }).getByText("Connected", { exact: true })).toBeVisible();

    const otherTenantContext = await browser.newContext();
    try {
      const otherTenantPage = await otherTenantContext.newPage();
      await signIn(otherTenantPage, "owner@cleanpaws.test");
      const otherTenantResponse = await otherTenantPage.request.get("/api/v1/connections");
      expect(otherTenantResponse.ok()).toBeTruthy();
      const otherTenantCatalog = await otherTenantResponse.json();
      const otherTenantAccounting = otherTenantCatalog.items.find((item: { key: string }) => item.key === "mock-accounting");
      expect(otherTenantAccounting).toMatchObject({ status: "not_connected", mode: "mock", environment: "test" });
      expect(JSON.stringify(otherTenantCatalog)).not.toMatch(/"(?:settings|credentials?|accessToken|refreshToken|clientSecret|webhookSecret|providerAccountId)"\s*:/i);
    } finally {
      await otherTenantContext.close();
    }
  } finally {
    // Restore the shared seed to the state it had before this test.
    await page.request.post("/api/v1/connections/mock-accounting/disconnect", { data: {} });
  }
});
