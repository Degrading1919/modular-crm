import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

for (const [role, email] of [["Morgan", "manager@happyyards.test"], ["Owner", "owner@happyyards.test"]]) {
  test(`${role} can use Payments and receipts in desktop and responsive layouts`, async ({ page }) => {
    await signIn(page, email);
    const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/payments" && response.request().method() === "GET");
    await page.goto("/app/payments");
    const payments = await response;
    expect(payments.status()).toBe(200);
    const { items } = await payments.json();
    const settled = items.find((item: { customerName: string; amountCents: number }) => item.customerName === "Carter Household" && item.amountCents === 2500);
    const failed = items.find((item: { status: string }) => item.status === "failed");
    expect(settled).toBeDefined();
    expect(failed).toBeDefined();
    const href = `/app/documents/receipt/${settled.id}`;
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('a[href^="/app/payments/"]')).toHaveCount(0);
      const container = width > 760 ? page.locator(".data-table") : page.locator(".table-card-fallback");
      const record = container.locator(`[data-record-id="${settled.id}"]`);
      const failedRecord = container.locator(`[data-record-id="${failed.id}"]`);
      await expect(record).toBeVisible();
      await expect(failedRecord).toBeVisible();
      await expect(failedRecord.getByRole("link")).toHaveCount(0);
      await expect(failedRecord).not.toHaveAttribute("href", /.+/);
      const receiptLink = width > 760 ? record.getByRole("link", { name: "View receipt", exact: true }) : record;
      await expect(receiptLink).toHaveAttribute("href", href);
      await receiptLink.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByRole("heading", { name: "Payment receipt", exact: true })).toBeVisible();
      await page.goto("/app/payments");
    }
  });
}

test("payment rows never fall back to generic details for any unsettled state", async ({ page }) => {
  await signIn(page, "owner@happyyards.test");
  const statuses = ["succeeded", "refunded", "partially_refunded", "pending", "processing", "failed"];
  await page.route("**/api/v1/payments", (route) => route.fulfill({ json: { items: statuses.map((status) => ({ id: `ui-${status}`, customerName: `Payment state ${status}`, status, amountCents: 1000, currency: "USD", method: "mock", createdAt: "2026-10-04T12:00:00Z" })) } }));
  await page.goto("/app/payments");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const container = width > 760 ? page.locator(".data-table") : page.locator(".table-card-fallback");
    for (const status of statuses) {
      const record = container.locator(`[data-record-id="ui-${status}"]`);
      await expect(record).toBeVisible();
      if (["succeeded", "refunded", "partially_refunded"].includes(status)) {
        const link = width > 760 ? record.getByRole("link", { name: "View receipt", exact: true }) : record;
        await expect(link).toHaveAttribute("href", `/app/documents/receipt/ui-${status}`);
      } else {
        await expect(record.getByRole("link")).toHaveCount(0);
        await expect(record).not.toHaveAttribute("href", /.+/);
      }
    }
    await expect(page.locator('a[href^="/app/payments/"]')).toHaveCount(0);
  }
});
