import { expect, test, type Page } from "@playwright/test";

const seededPassword = "Demo12345!";
const mailpitUrl = process.env.MAILPIT_API_URL ?? "http://localhost:8025";

async function signIn(page: Page, email: string, password = seededPassword) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
}

async function resetLinkFor(page: Page, email: string): Promise<string> {
  const listResponse = await page.request.get(`${mailpitUrl}/api/v1/messages`);
  if (!listResponse.ok()) return "";
  const list = await listResponse.json() as { messages?: Array<{ ID?: string; To?: Array<{ Address?: string }> }> };
  for (const item of (list.messages ?? []).reverse()) {
    if (!item.ID || !item.To?.some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase())) continue;
    const messageResponse = await page.request.get(`${mailpitUrl}/api/v1/message/${item.ID}`);
    if (!messageResponse.ok()) continue;
    const message = await messageResponse.json() as { Text?: string; HTML?: string };
    const links = `${message.Text ?? ""}\n${message.HTML ?? ""}`.match(/https?:\/\/[^\s<>"']+/g) ?? [];
    const resetLink = links.map((link) => link.replace(/[),.;]+$/, "")).find((link) => {
      try { return new URL(link).pathname.includes("/reset-password/"); } catch { return false; }
    });
    if (resetLink) return resetLink;
  }
  return "";
}

test("office invites and activates a customer portal account, then reviews a customer change request", async ({ browser, page }) => {
  const suffix = `${Date.now()}`;
  const email = `portal-e2e-${suffix}@example.test`;
  const password = `Portal-${suffix}!A`;
  await signIn(page, "owner@happyyards.test");
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  const customersResponse = await page.request.get("/api/v1/customers");
  expect(customersResponse.ok()).toBeTruthy();
  const customers = (await customersResponse.json()).items as Array<{ id: string; name: string }>;
  const customer = customers.find((item) => item.name === "Carter Household");
  expect(customer).toBeTruthy();

  await page.goto(`/app/customers/${customer!.id}`);
  await expect(page.getByRole("heading", { name: "Customer portal" })).toBeVisible();
  await page.getByLabel("Customer email").fill(email);
  await expect(page.locator("input[type=checkbox]").first()).toBeChecked();
  await page.getByRole("button", { name: "Invite to customer portal" }).click();
  await expect(page.getByText("Portal invitation sent. The customer will activate access by email.")).toBeVisible();

  let resetUrl = "";
  await expect.poll(async () => { resetUrl = await resetLinkFor(page, email); return resetUrl; }, { timeout: 20_000 }).not.toBe("");
  const resetPage = await browser.newPage();
  let activationCalls = 0;
  resetPage.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/auth/portal-activate") activationCalls += 1;
  });
  await resetPage.goto(resetUrl);
  await expect(resetPage.getByRole("heading", { name: "Set your password" })).toBeVisible();
  await resetPage.getByLabel("New password").fill(password);
  await resetPage.getByLabel("Confirm password").fill(password);
  await resetPage.getByRole("button", { name: "Set password" }).click();
  await expect(resetPage).toHaveURL(/\/portal\/activate\?/);
  await expect(resetPage.getByRole("heading", { name: "Your portal is ready" })).toBeVisible();
  expect(activationCalls).toBe(1);
  await resetPage.getByRole("link", { name: "Sign in" }).click();
  await resetPage.getByLabel("Email address").fill(email);
  await resetPage.getByLabel("Password").fill(password);
  await resetPage.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(resetPage).toHaveURL(/\/portal\/home$/);
  await resetPage.goto("/portal/profile");
  await expect(resetPage.getByText("42 Oak Lane", { exact: false })).toBeVisible();

  const customerPage = await browser.newPage();
  await signIn(customerPage, "customer@happyyards.test");
  await expect(customerPage).toHaveURL(/\/portal\/home$/);
  await customerPage.getByRole("navigation", { name: "Customer account" }).getByRole("link", { name: "Services" }).click();
  await customerPage.getByRole("button", { name: "Request a change" }).first().click();
  const requestDetails = `Please adjust the service time ${suffix}.`;
  await customerPage.getByLabel("Anything we should know?").fill(requestDetails);
  await customerPage.getByRole("button", { name: "Send request" }).click();
  await expect(customerPage.getByText("Your request was sent. The office will review it and follow up.")).toBeVisible();

  const officePage = await browser.newPage();
  await signIn(officePage, "manager@happyyards.test");
  await expect(officePage).toHaveURL(/\/app\/dashboard$/);
  await officePage.getByRole("navigation", { name: "Business navigation" }).getByRole("link", { name: "Requests" }).click();
  await expect(officePage.getByRole("heading", { name: "Customer change requests" })).toBeVisible();
  const requestCard = officePage.locator('section[aria-label="Customer change requests"] > .stack > .card.card-pad').filter({ hasText: requestDetails });
  await expect(requestCard).toBeVisible();
  await requestCard.getByRole("button", { name: "Start review" }).click();
  await expect(requestCard.getByText("Reviewing", { exact: true })).toBeVisible();
  officePage.once("dialog", (dialog) => dialog.accept());
  await requestCard.getByRole("button", { name: "Approve request" }).click();
  await expect(requestCard.getByText("Approved", { exact: true })).toBeVisible();

  await customerPage.getByRole("navigation", { name: "Customer account" }).getByRole("link", { name: "Requests" }).click();
  await expect(customerPage.getByText(requestDetails)).toBeVisible();
  await expect(customerPage.getByText("Approved", { exact: true })).toBeVisible();
  await customerPage.close(); await officePage.close(); await resetPage.close();
});
