import { expect, test, type Page } from "@playwright/test";

const calendarLabel = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00Z`));
const money = (cents: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

test("real upcoming dates and Next service agree in a west-coast browser", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, timezoneId: "America/Los_Angeles" });
  const page = await context.newPage();
  try {
    await signIn(page, "owner@happyyards.test");
    const customerResponse = await page.request.post("/api/v1/customers", { data: { name: `Trust regression ${Date.now()}`, address: "100 Test Lane" } });
    expect(customerResponse.status()).toBe(201);
    const customer = (await customerResponse.json()).item;
    const tomorrow = new Date(Date.now() + 86_400_000);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(tomorrow);
    const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
    const scheduledDate = `${part("year")}-${part("month")}-${part("day")}`;
    const jobResponse = await page.request.post("/api/v1/jobs", { data: { customerId: customer.id, serviceName: "Yard cleanup", scheduledDate } });
    expect(jobResponse.status()).toBe(201);
    const job = (await jobResponse.json()).item;
    await page.goto("/app/dashboard");
    const upcoming = page.locator(`.job-row[href="/app/jobs/${job.id}"]`);
    await expect(upcoming).toContainText(`${calendarLabel(scheduledDate)} · Time not set`);
    await expect(upcoming).not.toContainText("Today");
    await page.goto("/app/customers");
    await expect(page.locator(`tr[data-record-id="${customer.id}"]`)).toContainText(calendarLabel(scheduledDate));

    const plans = (await (await page.request.get("/api/v1/service-plans")).json()).items;
    await page.goto("/app/service-plans");
    for (const plan of plans.slice(0, 3)) {
      await expect(page.locator(`tr[data-record-id="${plan.id}"]`)).toContainText(plan.nextService ? calendarLabel(plan.nextService) : "Not scheduled");
    }
    await page.request.post("/api/v1/auth/logout");
    await signIn(page, "customer@happyyards.test");
    const overview = (await (await page.request.get("/api/v1/portal/overview")).json()).item;
    const longLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${overview.nextService.scheduledDate}T00:00:00Z`));
    await expect(page.getByRole("heading", { name: longLabel, exact: true })).toBeVisible();
    const portalPlans = (await (await page.request.get("/api/v1/portal/services")).json()).items;
    for (const plan of portalPlans) expect(plan.nextService).toBe(plans.find((officePlan: { id: string }) => officePlan.id === plan.id)?.nextService);
  } finally { await context.close(); }
});

test("Owner and location-restricted Morgan see scoped, dollar-formatted balances that reconcile", async ({ page }) => {
  for (const email of ["owner@happyyards.test", "manager@happyyards.test"]) {
    await page.request.post("/api/v1/auth/logout");
    await signIn(page, email);
    const dashboard = (await (await page.request.get("/api/v1/dashboard")).json()).item;
    await expect(page.getByText(`Business locations: ${dashboard.scope.label}`, { exact: false })).toBeVisible();
    await expect(page.locator(".metric-card").filter({ has: page.getByText("Open balances", { exact: true }) }).locator(".metric-value"))
      .toHaveText(dashboard.balances.length ? dashboard.balances.map((balance: { cents: number; currency: string }) => money(balance.cents, balance.currency)).join(" · ") : money(0));
    await page.goto("/app/reports");
    await page.getByRole("tab", { name: "Money", exact: true }).click();
    const report = (await (await page.request.get("/api/v1/reports?type=financial&range=month")).json()).item;
    await expect(page.getByRole("columnheader", { name: "Location", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Invoiced", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Collected", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Cents|Location ID/i })).toHaveCount(0);
    await expect(page.getByText(`Business locations: ${report.scope.label}`, { exact: false })).toBeVisible();
    const outstanding = report.metrics.find((metric: { key: string }) => metric.key === "outstandingCents");
    expect(outstanding.value).toBe(dashboard.metrics.openBalanceCents);
    expect(report.rows.reduce((sum: number, row: { outstandingCents: number }) => sum + Number(row.outstandingCents), 0)).toBe(outstanding.value);
    await expect(page.locator(".metric-card").filter({ has: page.getByText("Open balance", { exact: true }) }).locator(".metric-value")).toHaveText(money(outstanding.value));
    for (const metric of report.metrics.filter((entry: { key: string }) => /Cents$/.test(entry.key))) {
      await expect(page.locator(".metric-card").filter({ has: page.getByText(metric.label, { exact: true }) }).locator(".metric-value"))
        .toHaveText(money(metric.value, metric.currency));
    }
    if (email.startsWith("manager")) {
      expect(report.scope.label).toBe("Augusta Branch");
      expect(report.rows.every((row: { locationName: string }) => row.locationName === "Augusta Branch")).toBe(true);
      await expect(page.getByRole("cell", { name: "North Augusta Branch", exact: true })).toHaveCount(0);
    }
    const invoices = (await (await page.request.get("/api/v1/invoices")).json()).items;
    await page.goto("/app/invoices");
    await expect(page.getByRole("columnheader", { name: "Business", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Location", exact: true })).toBeVisible();
    for (const invoice of invoices) {
      const row = page.locator(`tr[data-record-id="${invoice.id}"]`);
      await expect(row).toContainText(invoice.organizationName);
      await expect(row).toContainText(invoice.locationName);
    }
    if (email.startsWith("manager")) expect(invoices.every((invoice: { locationName: string }) => invoice.locationName === "Augusta Branch")).toBe(true);
    else expect(new Set(invoices.map((invoice: { organizationName: string }) => invoice.organizationName)).size).toBeGreaterThan(1);
  }
});

test("sign-in and signup failures give plain recovery copy; a failed summary is not zero data", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".notice[role=\"alert\"]")).toContainText("The email address or password is incorrect. Please try again.");
  await expect(page.locator(".notice[role=\"alert\"]")).not.toContainText("401");
  await page.goto("/create-account");
  await page.getByLabel("Your name").fill("Existing owner");
  await page.getByLabel("Business name").fill("Existing business");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator(".notice[role=\"alert\"]")).toContainText("An account with this email address already exists. Sign in instead.");
  await signIn(page, "owner@happyyards.test");
  await page.route("**/api/v1/reports?**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "SQL undefined internal_state" } }) }));
  await page.goto("/app/reports");
  await expect(page.locator(".notice[role=\"alert\"]")).toContainText("We couldn’t complete that action right now. Please try again shortly.");
  await expect(page.locator(".metric-card")).toHaveCount(0);
  await expect(page.getByText("No report activity yet", { exact: true })).toHaveCount(0);
});

test("record details, portal estimates and payment confirmation use the record currency", async ({ page }) => {
  await signIn(page, "owner@happyyards.test");
  const invoices = (await (await page.request.get("/api/v1/invoices")).json()).items;
  const invoice = invoices.find((item: { status: string }) => item.status === "issued");
  expect(invoice).toBeTruthy();
  await page.route(`**/api/v1/invoices/${invoice.id}`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({ response, json: { ...payload, item: { ...payload.item, currency: "EUR" } } });
  });
  await page.goto(`/app/invoices/${invoice.id}`);
  await expect(page.locator(".detail-list").filter({ has: page.getByText("Total Cents", { exact: true }) }).locator("dd"))
    .toHaveText(money(invoice.totalCents, "EUR"));

  await page.request.post("/api/v1/auth/logout");
  await signIn(page, "customer@happyyards.test");
  // Read-only view fixtures: exercise currency presentation without making a payment
  // or changing persistent records used by later tests.
  await page.route("**/api/v1/portal/invoices", (route) => route.fulfill({ json: { items: [{
    id: "currency-invoice", number: "CURRENCY-1", status: "issued", currency: "EUR",
    totalCents: 12345, paidCents: 345, balanceCents: 12000, openBalanceCents: 12000,
    demoPaymentAvailable: true,
  }] } }));
  await page.route("**/api/v1/portal/estimates", (route) => route.fulfill({ json: { items: [{
    id: "currency-estimate", number: "CURRENCY-2", status: "sent", currency: "EUR", totalCents: 12345,
  }] } }));
  await page.goto("/portal/billing");
  await expect(page.getByText(money(12000, "EUR"), { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Pay invoice", exact: true }).click();
  await expect(page.getByRole("button", { name: `Pay ${money(12000, "EUR")}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/portal/estimates");
  await expect(page.getByText(money(12345, "EUR"), { exact: true })).toBeVisible();
});
