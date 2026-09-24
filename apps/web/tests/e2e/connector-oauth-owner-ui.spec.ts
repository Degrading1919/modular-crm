import { expect, test } from "@playwright/test";

const readyKey = "calendar-oauth-ui-e2e";
const unavailableKey = "accounting-oauth-ui-e2e";

test("owner can start OAuth, return with safe status, and disconnect", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  let connected = false;
  const calls: { method: string; path: string; body?: unknown }[] = [];
  await page.route("**/api/v1/connections**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    calls.push({ method, path, body: method === "GET" ? undefined : request.postDataJSON() });

    if (method === "GET" && path === "/connections") {
      await route.fulfill({ json: { items: [
        { key: readyKey, name: "Google Calendar", providerName: "Google", capability: "Calendar", status: connected ? "connected" : "not_connected", mode: "oauth_setup", oauthAvailable: true },
        { key: unavailableKey, name: "QuickBooks", providerName: "QuickBooks", capability: "Accounting", status: "not_connected", mode: "oauth_setup", oauthAvailable: false },
        { key: "demo-calendar", name: "Demo Calendar", capability: "Calendar", status: "not_connected", mode: "mock", environment: "test" },
      ] } });
      return;
    }
    if (method === "POST" && path === `/connections/${readyKey}/connect`) {
      await route.fulfill({ json: { item: { key: readyKey, status: "authorizing", authorizationUrl: "https://provider.example/authorize?client_id=demo" } } });
      return;
    }
    if (method === "POST" && path === `/connections/${readyKey}/disconnect`) {
      connected = false;
      await route.fulfill({ json: { item: { key: readyKey, status: "not_connected" } } });
      return;
    }
    await route.continue();
  });
  await page.route("https://provider.example/authorize?client_id=demo", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<title>Provider sign in</title><main>Mock provider authorization page</main>",
  }));

  await page.goto("/app/connections");
  const readyCard = page.locator(`[data-connector-key="${readyKey}"]`);
  const unavailableCard = page.locator(`[data-connector-key="${unavailableKey}"]`);
  await expect(readyCard.getByRole("button", { name: "Connect with Google" })).toBeVisible();
  await expect(unavailableCard.getByText(/Connection setup is not ready yet/)).toBeVisible();
  await expect(unavailableCard.getByRole("button", { name: /Connect|Reconnect/ })).toHaveCount(0);
  await expect(page.getByText("Demo connection · no real messages or charges")).toBeVisible();

  const connectResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/connections/${readyKey}/connect`) && response.request().method() === "POST");
  await readyCard.getByRole("button", { name: "Connect with Google" }).click();
  await connectResponse;
  await expect(page).toHaveURL("https://provider.example/authorize?client_id=demo");
  expect(calls.some((call) => call.path.includes("state") || call.path.includes("code"))).toBe(false);
  expect(JSON.stringify(calls)).not.toContain("authorizationUrl");

  connected = true;
  await page.goto(`/app/connections?connection=${readyKey}&status=connected`);
  await expect(page.getByText("Google Calendar is connected.")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/connections$/);
  await expect(readyCard.getByRole("button", { name: "Disconnect" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  const disconnectResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/connections/${readyKey}/disconnect`) && response.request().method() === "POST");
  await readyCard.getByRole("button", { name: "Disconnect" }).click();
  await disconnectResponse;
  await expect(readyCard.getByRole("button", { name: "Connect with Google" })).toBeVisible();
  expect(calls.some((call) => call.method === "POST" && call.path === `/connections/${readyKey}/disconnect`)).toBe(true);
});
