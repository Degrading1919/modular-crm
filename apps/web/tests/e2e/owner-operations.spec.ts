import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

test("owner records inventory movements and refunds a collected invoice payment", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signIn(page);

  await page.getByRole("navigation", { name: "Business navigation" }).getByRole("link", { name: "Inventory" }).click();
  await expect(page.getByRole("heading", { name: "Stock on hand" })).toBeVisible();

  const itemName = `E2E supplies ${suffix}`;
  await page.getByRole("button", { name: "Add inventory item" }).click();
  await page.getByLabel("Item name").fill(itemName);
  await page.getByLabel("SKU").fill(`E2E-${suffix}`);
  await page.getByLabel("Starting branch").selectOption({ index: 1 });
  await page.getByLabel("Starting quantity").fill("0");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(page.getByText("Inventory item added.")).toBeVisible();

  const itemRow = page.getByRole("row", { name: new RegExp(itemName) });
  await expect(itemRow).toContainText("0 unit");
  await itemRow.getByRole("button", { name: "Receive" }).click();
  await page.getByLabel("Quantity (unit)").fill("4");
  await page.getByLabel("Receive at branch").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Receive stock" }).click();
  await expect(page.getByText("Stock received.")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(itemName) })).toContainText("4 unit");

  await page.getByRole("row", { name: new RegExp(itemName) }).getByRole("button", { name: "Use on job" }).click();
  await expect(page.getByLabel("Job")).toBeVisible();
  await expect(page.getByLabel("Job").locator("option").nth(1)).toBeAttached();
  await page.getByLabel("Quantity (unit)").fill("1");
  await page.getByLabel("Take stock from").selectOption({ index: 1 });
  await page.getByLabel("Job").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Record material used" }).click();
  await expect(page.getByText("Material usage recorded on the job.")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(itemName) })).toContainText("3 unit");

  await page.goto("/app/invoices");
  await page.getByRole("button", { name: "New invoice" }).click();
  await page.getByLabel("Customer", { exact: true }).selectOption({ label: "Carter Household" });
  const description = `E2E refundable invoice ${suffix}`;
  await page.getByLabel("Description").fill(description);
  await page.getByLabel("Amount").fill("32.50");
  const createdResponse = page.waitForResponse((response) =>
    response.url().includes("/api/v1/invoices") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create invoice" }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const invoice = (await created.json()).item as { id: string };

  await page.goto(`/app/invoices/${invoice.id}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByText("Issue invoice completed.")).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("button", { name: "Record payment", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Refund a payment" })).toBeVisible();
  await expect(page.getByText("Mock · Succeeded", { exact: false })).toBeVisible();

  await page.getByLabel("Refund amount (USD)").fill("5.00");
  await page.getByLabel("Reason (optional)").fill(`E2E refund ${suffix}`);
  await page.getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refunded $5.00", { exact: false })).toBeVisible();
  await expect(page.getByText("Current balance $5.00", { exact: false })).toBeVisible();
  await expect(page.getByText("Up to $27.50 for this payment.", { exact: true })).toBeVisible();
});
