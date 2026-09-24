import { expect, test, type Page } from "@playwright/test";

const password = "Demo12345!";

async function signInAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

test.describe.configure({ mode: "serial" });

test("owner connects, verifies, and selects a custom website address", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/app/website");

  const domainName = `www.happy-yards-e2e-${Date.now()}.com`;
  const domainCard = page.locator("article.card").filter({ has: page.getByRole("heading", { name: domainName, exact: true }) });

  await page.getByRole("textbox", { name: "Domain name" }).fill(domainName);
  await page.getByRole("button", { name: "Add domain" }).click();
  await expect(page.getByText("Domain added. Add the DNS record below to prove you control it.")).toBeVisible();

  await expect(domainCard.getByText("TXT", { exact: true })).toBeVisible();
  await expect(domainCard.getByText(`_modular-crm-verification.${domainName}`, { exact: true })).toBeVisible();
  await expect(domainCard.locator("code").filter({ hasText: /^modular-crm-verification=/ })).toBeVisible();
  await expect(domainCard.getByText("Local demo mode can simulate DNS verification for this test domain.")).toBeVisible();

  await domainCard.getByRole("button", { name: "Simulate verification (local)" }).click();
  await expect(page.getByText("Domain verified in local demo mode.")).toBeVisible();
  await expect(domainCard.getByText("Verified", { exact: true })).toBeVisible();

  await domainCard.getByRole("button", { name: "Make primary" }).click();
  await expect(page.getByText("Primary website address updated.")).toBeVisible();
  await expect(domainCard.getByText("Primary website address", { exact: true })).toBeVisible();
  await expect(domainCard.getByText("Primary", { exact: true })).toBeVisible();
  await expect(domainCard.getByRole("button", { name: "Make primary" })).toHaveCount(0);
});

test("owner creates a useful automation and finds it in run history", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/app/automations");

  const suffix = `${Date.now()}`;
  const ruleName = `E2E positive invoice follow-up ${suffix}`;
  await page.getByRole("button", { name: "Create a rule" }).click();
  await page.getByLabel("Rule name").fill(ruleName);
  await page.getByLabel("What should this rule do?").fill("Create a team follow-up for larger invoices.");
  await page.locator("#automation-trigger").selectOption("invoice.issued");
  await page.getByRole("button", { name: "Add a check" }).click();
  await page.locator("#automation-field-0").selectOption({ label: "Invoice balance (cents)" });
  await page.locator("#automation-operator-0").selectOption("greater_than");
  await page.locator("#automation-value-0").fill("5000");
  await page.locator("#automation-action").selectOption("create_ticket");
  await page.locator("#automation-ticket-title").fill("Review large invoice follow-up");
  await page.locator("#automation-ticket-description").fill("Contact the customer about the outstanding invoice balance.");
  await page.getByRole("button", { name: "Turn on rule" }).click();

  const ruleCard = page.locator("article.action-item").filter({ hasText: ruleName });
  await expect(page.getByText("Automation rule saved.")).toBeVisible();
  await expect(ruleCard).toBeVisible();
  await expect(ruleCard.getByText("On", { exact: true })).toBeVisible();
  await ruleCard.getByRole("button", { name: `View history for ${ruleName}` }).click();

  const historyFilter = page.getByLabel("Show history for");
  await expect(historyFilter.locator("option:checked")).toHaveText(ruleName);
  const historySection = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Run history" }) });
  await expect(historySection.getByText("No runs to show", { exact: true })).toBeVisible();
});
