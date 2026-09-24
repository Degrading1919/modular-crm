import { expect, test, type Page } from "@playwright/test";

const password = "Demo12345!";

async function signInAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

test("an issued invoice triggers an active automation and records its action", async ({ page }) => {
  test.setTimeout(90_000);
  await signInAsOwner(page);

  const suffix = `${Date.now()}`;
  const ruleName = `E2E invoice event follow-up ${suffix}`;
  const ticketTitle = `E2E invoice event ticket ${suffix}`;

  await page.goto("/app/automations");
  await page.getByRole("button", { name: "Create a rule" }).click();
  await page.getByLabel("Rule name").fill(ruleName);
  await page.getByLabel("What should this rule do?").fill("Create a team follow-up when an invoice is issued.");
  await page.locator("#automation-trigger").selectOption("invoice.issued");
  await page.locator("#automation-action").selectOption("create_ticket");
  await page.locator("#automation-ticket-title").fill(ticketTitle);
  await page.locator("#automation-ticket-description").fill("Follow up on the newly issued invoice.");
  await page.getByRole("button", { name: "Turn on rule" }).click();

  const ruleCard = page.locator("article.action-item").filter({ hasText: ruleName });
  await expect(page.getByText("Automation rule saved.")).toBeVisible();
  await expect(ruleCard.getByText("On", { exact: true })).toBeVisible();

  await page.goto("/app/invoices");
  await page.getByRole("button", { name: "New invoice" }).click();
  await page.getByLabel("Customer", { exact: true }).selectOption({ label: "Carter Household" });
  await page.getByLabel("Description").fill(`Automation acceptance invoice ${suffix}`);
  await page.getByLabel("Amount").fill("72.00");

  const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/v1\/invoices$/.test(response.url()));
  await page.getByRole("button", { name: "Create invoice" }).click();
  const response = await createResponse;
  expect(response.ok()).toBeTruthy();
  const created = await response.json() as { item?: { id?: string; status?: string } };
  expect(created.item?.id).toBeTruthy();
  expect(created.item?.status).toBe("draft");

  await page.goto(`/app/invoices/${created.item!.id}`);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByText("Issue invoice completed.")).toBeVisible();
  await expect(page.getByText("Issued", { exact: true })).toBeVisible();

  await page.goto("/app/automations");
  const historyFilter = page.locator("#automation-history-filter");
  const ruleId = (await historyFilter.selectOption({ label: ruleName }))[0]!;
  await expect.poll(async () => {
    const response = await page.request.get(`/api/v1/automations/${encodeURIComponent(ruleId)}/runs?limit=20`);
    if (!response.ok()) return "request_failed";
    const result = await response.json() as { items?: Array<{ status?: string; trigger?: string }> };
    const run = result.items?.find((item) => item.trigger === "invoice.issued");
    return run?.status ?? "waiting";
  }, { timeout: 70_000, intervals: [1_000, 2_000, 5_000] }).toBe("completed");

  await page.reload();
  await page.locator("#automation-history-filter").selectOption({ label: ruleName });
  const history = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Run history" }) });
  const completedRun = history.locator("article.action-item").filter({ hasText: ruleName });
  await expect(completedRun).toContainText("An invoice is sent");
  await expect(completedRun.getByText("Completed", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.goto("/app/tickets");
  await expect(page.getByRole("link", { name: ticketTitle, exact: true })).toBeVisible({ timeout: 30_000 });
});
