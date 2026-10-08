import { expect, test } from "@playwright/test";

test("completed signup on a custom Host links to the workspace login", async ({ page, browser }) => {
  await page.goto("/login"); await page.getByLabel("Email address").fill("owner@happyyards.test"); await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/app\/dashboard$/);
  const hostname = "signup-e2e.example.test";
  const added = await page.request.post("/api/v1/website/domains", { data: { hostname } }); expect(added.status()).toBe(201);
  const { item } = await added.json();
  expect((await page.request.post(`/api/v1/website/domains/${item.id}/mock-dns`, { data: { ownership: "valid", routing: "valid", certificate: "ready" } })).status()).toBe(200);
  expect((await page.request.post(`/api/v1/website/domains/${item.id}/verify`, { data: {} })).status()).toBe(200);
  const workspace = new URL(page.url());
  const customOrigin = `http://${hostname}:${workspace.port || "80"}`;
  // Development fixture only: production customer sites use HTTPS and have no HMR.
  const customBrowser = await browser.browserType().launch({ args: [`--host-resolver-rules=MAP ${hostname} 127.0.0.1`, "--no-proxy-server"] });
  try {
    const customer = await customBrowser.newPage();
    // Keep Next's development-only socket on the workspace; customer Host routing
    // intentionally denies private endpoints. All website traffic still uses its real Host.
    await customer.addInitScript(({ workspaceHost }) => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          const target = new URL(url);
          if (target.pathname === "/_next/hmr") target.host = workspaceHost;
          super(target, protocols);
        }
      };
    }, { workspaceHost: workspace.host });
    await customer.goto(`${customOrigin}/site/happy-yards/signup`);
    await expect(customer.getByRole("heading", { name: "Where can we help?" })).toBeVisible();
    await customer.getByLabel("Street address").fill("123 Custom Login Street, Augusta, GA"); await customer.getByLabel("ZIP code").fill("30909");
    await customer.getByRole("button", { name: /Check availability/i }).click();
    await customer.getByLabel("Full name").fill("Custom Host Signup"); await customer.getByLabel("Email", { exact: true }).fill(`custom-signup-${crypto.randomUUID()}@example.test`); await customer.getByLabel("Phone").fill("7065550184");
    await customer.getByRole("button", { name: /Continue/i }).click();
    await customer.getByLabel("Service", { exact: true }).selectOption({ label: "Yard cleanup" }); await customer.getByLabel("How often?").selectOption("weekly"); await customer.getByLabel("Pet 1 name").fill("Scout");
    await customer.getByRole("button", { name: /Continue/i }).click(); await customer.getByRole("button", { name: /See my price/i }).click();
    await customer.getByRole("checkbox", { name: /accept the service terms/i }).check();
    const sent = customer.waitForResponse(r => r.url().endsWith("/api/v1/public/signup") && r.request().method() === "POST");
    await customer.getByRole("button", { name: /Send service request/i }).click(); expect((await sent).status()).toBe(201);
    const login = customer.getByRole("link", { name: "Customer login", exact: true });
    await expect(login).toHaveAttribute("href", new URL("/login", workspace.origin).toString());
    await login.click(); await expect(customer).toHaveURL(new URL("/login", workspace.origin).toString());
    await expect(customer.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  } finally {
    await customBrowser.close(); expect((await page.request.delete(`/api/v1/website/domains/${item.id}`)).status()).toBe(200);
  }
});
