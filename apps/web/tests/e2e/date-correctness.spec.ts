import { expect, test, type Page } from "@playwright/test";

const password = "Demo12345!";

async function signIn(page: Page, email: string) {
  await page.request.post("/api/v1/auth/logout");
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

function calendarLabel(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

test("office, schedule, field route, and portal preserve a calendar service date in a west-coast browser", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "America/Los_Angeles" });
  const page = await context.newPage();
  try {
    await signIn(page, "tech@happyyards.test");
    await expect(page).toHaveURL(/\/field\/today$/);
    const routeResponse = await page.request.get("/api/v1/field/route");
    expect(routeResponse.ok()).toBeTruthy();
    const routePayload = await routeResponse.json();
    const routeDate = routePayload.item.route.date as string;
    const shortDate = calendarLabel(routeDate, { month: "short", day: "numeric", year: "numeric" });
    await page.goto("/field/route");
    await expect(page.getByRole("heading", { name: shortDate, exact: true })).toBeVisible();

    await signIn(page, "owner@happyyards.test");
    const capabilities = await (await page.request.get("/api/v1/capabilities")).json();
    const catalog = capabilities.item ?? capabilities;
    const moduleKeys = (catalog.modules as Array<{ key: string }>).map((module) => module.key);
    const capabilityUpdate = await page.request.post("/api/v1/capabilities/setup", { data: { selection: "custom", answers: {}, moduleKeys } });
    expect(capabilityUpdate.ok()).toBeTruthy();
    await page.goto("/app/jobs");
    await expect(page.getByText(shortDate, { exact: true }).first()).toBeVisible();
    await page.clock.install({ time: new Date("2026-10-06T02:30:00.000Z") });
    await page.goto("/app/schedule");
    await expect(page.getByRole("heading", { name: "Work for Oct 5, 2026", exact: true })).toBeVisible();

    await signIn(page, "customer@happyyards.test");
    const overview = await (await page.request.get("/api/v1/portal/overview")).json();
    const nextServiceDate = overview.item.nextService.scheduledDate as string;
    const longDate = calendarLabel(nextServiceDate, { weekday: "long", month: "long", day: "numeric" });
    await page.goto("/portal/home");
    await expect(page.getByRole("heading", { name: longDate, exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
