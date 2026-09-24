import { expect, test } from "@playwright/test";

const connectorKey = "credential-setup-e2e";
const secret = "only-in-request-body-7c8e4d";

test("owner can save, connect, and remove live connection details without exposing them", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  let configured = false;
  let connected = false;
  const calls: { method: string; path: string; body?: unknown }[] = [];
  await page.route("**/api/v1/connections**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    calls.push({ method, path, body: method === "GET" ? undefined : request.postDataJSON() });

    if (method === "GET" && path === "/connections") {
      const item = {
        key: connectorKey,
        name: "Example Payments",
        description: "Accept card payments through your existing provider.",
        capability: "Accept payments",
        status: connected ? "connected" : "not_connected",
        mode: "live_setup",
        environment: "production",
        credentialConfigured: configured,
        credentialFields: [{ key: "accountToken", label: "Account token", inputType: "password", helpText: "Find this in your provider account settings.", maxLength: 64 }],
      };
      const demo = {
        key: "demo-payments",
        name: "Demo Payments",
        description: "A local test connection.",
        capability: "Accept payments",
        status: "not_connected",
        mode: "mock",
        environment: "test",
      };
      await route.fulfill({ json: { groups: [], items: [item, demo] } });
      return;
    }

    if (method === "POST" && path === `/connections/${connectorKey}/credentials`) {
      configured = true;
      await route.fulfill({ status: 201, json: { item: { connectorKey, credentialConfigured: true, status: "not_connected" } } });
      return;
    }
    if (method === "POST" && path === `/connections/${connectorKey}/connect`) {
      connected = true;
      await route.fulfill({ json: { item: { key: connectorKey, status: "connected", mode: "live_setup" } } });
      return;
    }
    if (method === "POST" && path === `/connections/${connectorKey}/disconnect`) {
      configured = false;
      connected = false;
      await route.fulfill({ json: { item: { key: connectorKey, status: "not_connected", mode: "live_setup" } } });
      return;
    }
    await route.continue();
  });

  await page.goto("/app/connections");
  const card = page.locator(`[data-connector-key="${connectorKey}"]`);
  await expect(card.getByLabel("Account token")).toHaveAttribute("maxlength", "64");
  await expect(card.getByText("Find this in your provider account settings.")).toBeVisible();
  await expect(page.getByText("Demo connection · no real messages or charges")).toBeVisible();

  const field = card.getByLabel("Account token");
  await field.fill(secret);
  const savedResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/connections/${connectorKey}/credentials`) && response.request().method() === "POST");
  await card.getByRole("button", { name: "Save connection details" }).click();
  await savedResponse;
  await expect(card.getByText(/Connection details saved/)).toBeVisible();
  await expect(field).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(secret);
  expect(calls.find((call) => call.path.endsWith("/credentials"))?.body).toEqual({ credentials: { accountToken: secret } });
  expect(calls.some((call) => call.path.includes(secret))).toBe(false);

  const connectResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/connections/${connectorKey}/connect`) && response.request().method() === "POST");
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await connectResponse;
  expect(calls.some((call) => call.method === "POST" && call.path === `/connections/${connectorKey}/connect`)).toBe(true);
  await expect(card.getByRole("button", { name: "Disconnect and remove details" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  const disconnectResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/connections/${connectorKey}/disconnect`) && response.request().method() === "POST");
  await card.getByRole("button", { name: "Disconnect and remove details" }).click();
  await disconnectResponse;
  expect(calls.some((call) => call.method === "POST" && call.path === `/connections/${connectorKey}/disconnect`)).toBe(true);
  await expect(card.getByText(/This service needs connection details/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(secret);
});
