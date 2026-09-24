import { expect, test, type Page } from "@playwright/test";

const password = "Demo12345!";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

function seededPayrollDates() {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  const day = (offset: number) => {
    const value = new Date(date);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  // Seeded approved shift, time, and mileage are recorded seven days ago.
  return { start: day(-8), end: day(-6) };
}

function seededFranchiseInvoiceDates() {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  const day = (offset: number) => {
    const value = new Date(date);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  // Seeded East/West issued invoices are recorded five and three days ago.
  return { start: day(-7), end: day(-1) };
}

test("owner reviews, corrects, approves, and exports seeded payroll inputs", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/payroll");
  await expect(page.getByRole("heading", { name: "Payroll" })).toBeVisible();

  const range = seededPayrollDates();
  await page.getByRole("button", { name: "New pay period" }).click();
  await page.getByLabel("Start date").fill(range.start);
  await page.getByLabel("End date").fill(range.end);
  await page.getByRole("button", { name: "Create pay period" }).click();
  await expect(page.getByRole("button", { name: "Calculate pay" })).toBeVisible();

  await page.getByRole("button", { name: "Calculate pay" }).click();
  await expect(page.getByText("Gross pay calculated from the approved inputs.")).toBeVisible();
  await expect(page.getByText("Terry Tech", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add correction" }).click();
  await page.getByLabel(/Correction amount/).fill("5.00");
  await page.getByLabel("Reason").fill("E2E payroll review adjustment");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText("Correction saved as a new calculation version.")).toBeVisible();
  await expect(page.getByText(/Earlier calculation versions \(1\)/)).toBeVisible();

  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByText("Pay period sent for review.")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Pay period approved.")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^payroll-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  const periods = await page.request.get("/api/v1/payroll/periods");
  expect(periods.status()).toBe(200);
  const periodRows = (await periods.json()).items as Array<{ periodStart: string; periodEnd: string; status: string }>;
  expect(periodRows.find((period) => period.periodStart === range.start && period.periodEnd === range.end)?.status).toBe("exported");
});

test("parent owner creates a franchise location, rolls up branches, and calculates a royalty statement", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/franchise");
  await expect(page.getByRole("heading", { name: "Franchise", exact: true })).toBeVisible();

  const suffix = Date.now();
  const unitName = `E2E Franchise Unit ${suffix}`;
  await page.getByLabel("Unit name").fill(unitName);
  await page.getByLabel("First location").fill(`E2E Branch ${suffix}`);
  await page.getByLabel("Street address").fill("15 Review Road");
  await page.getByLabel("City").fill("Augusta");
  await page.getByLabel("State / region").fill("GA");
  await page.getByLabel("Postal code").fill("30901");
  await page.getByRole("button", { name: "Create unit" }).click();
  await expect(page.getByText("Franchise unit and its agreement were created.")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(unitName) })).toBeVisible();

  const agreementsResponse = await page.request.get("/api/v1/franchise/agreements");
  expect(agreementsResponse.status()).toBe(200);
  const agreements = (await agreementsResponse.json()).items as Array<{ agreement: { id: string }; child: { displayName: string } }>;
  expect(agreements.some((item) => item.child.displayName === unitName)).toBe(true);
  const east = agreements.find((item) => item.child.displayName === "Happy Yards East");
  expect(east, "seeded child unit should be visible to its authorized parent").toBeTruthy();

  const rulesResponse = await page.request.get(`/api/v1/franchise/agreements/${east!.agreement.id}/rules`);
  expect(rulesResponse.status()).toBe(200);
  const rules = (await rulesResponse.json()).items as Array<{ active: boolean; definition: { rateBasisPoints: number } }>;
  expect(rules.some((rule) => rule.active && rule.definition.rateBasisPoints === 500)).toBe(true);

  const dates = seededFranchiseInvoiceDates();
  const statementResponse = await page.request.post(`/api/v1/franchise/agreements/${east!.agreement.id}/statements/calculate`, {
    data: { periodStart: dates.start, periodEnd: dates.end },
  });
  expect([200, 201], await statementResponse.text()).toContain(statementResponse.status());
  const statement = (await statementResponse.json()).item as { basisAmountMinor: number | string; royaltyAmountMinor: number | string; calculationSnapshot: { invoices: unknown[] } };
  expect(Number(statement.basisAmountMinor)).toBe(6800);
  expect(Number(statement.royaltyAmountMinor)).toBe(340);
  expect(statement.calculationSnapshot.invoices).toHaveLength(1);

  const rollupResponse = await page.request.get("/api/v1/reports?type=locations&range=month");
  expect(rollupResponse.status(), await rollupResponse.text()).toBe(200);
  const rows = (await rollupResponse.json()).item.rows as Array<{ locationName: string }>;
  expect(rows.map((row) => row.locationName)).toEqual(expect.arrayContaining([
    "Augusta Branch", "North Augusta Branch", "East Branch", "West Branch", `E2E Branch ${suffix}`,
  ]));

  await page.getByRole("button", { name: "Happy Yards East" }).click();
  await page.getByLabel("Period start").fill(dates.start);
  await page.getByLabel("Period end").fill(dates.end);
  await page.getByRole("button", { name: "Calculate statement" }).click();
  await expect(page.getByText("Statement calculated from issued invoices in this period.")).toBeVisible();
  await expect(page.getByText("$3.40", { exact: true })).toBeVisible();
});
