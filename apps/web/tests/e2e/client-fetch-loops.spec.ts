import { expect, test } from "@playwright/test";
import { expectBoundedIdleApiGets, trackApiGets } from "./idle-api-guard";

// This repository's browser harness runs `next dev`: Strict Mode deliberately
// mounts effects twice. Assert that exact finite initial lifecycle, not a range
// that could conceal extra reads. Subsequent selections must fetch exactly once.
const initialMountLoads = 2;

test("automation history loads once per selection, not on idle or unrelated renders", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  const requests = trackApiGets(page);
  try {
    const initialHistory = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/automations/runs");
    await page.goto("/app/automations");
    expect((await initialHistory).status()).toBe(200);
    const history = page.getByRole("region", { name: "Run history" });
    await expect(page.getByRole("button", { name: "Create a rule" })).toBeVisible();
    await expect(history.getByText("Loading run history…", { exact: true })).toHaveCount(0);
    await expect(history.locator(".empty, .action-item").first()).toBeVisible();
    await expectBoundedIdleApiGets(page, 0);
    expect(requests.counts.get("/api/v1/automations/runs")).toBe(initialMountLoads);

    // Builder state changes must not reload the independently selected history.
    await page.getByRole("button", { name: "Create a rule" }).click();
    await page.getByLabel("Rule name").fill("Unsaved draft must not refetch history");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const filter = page.getByLabel("Show history for");
    const ruleId = await filter.locator("option").nth(1).getAttribute("value");
    expect(ruleId).toBeTruthy();
    const selectedHistory = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/v1/automations/${ruleId}/runs`);
    await filter.selectOption(ruleId!);
    expect((await selectedHistory).status()).toBe(200);
    await expect(history.getByText("Loading run history…", { exact: true })).toHaveCount(0);
    await expectBoundedIdleApiGets(page, 0);
    expect(requests.counts.get(`/api/v1/automations/${ruleId}/runs`)).toBe(1);
    expect(requests.counts.get("/api/v1/automations/runs")).toBe(initialMountLoads);
    console.info(`Automation history request totals: ${JSON.stringify(Object.fromEntries([...requests.counts].filter(([path]) => path.endsWith("/runs"))))}`);
  } finally { requests.stop(); }
});

test("owner supporting-list screens stay idle after loading", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  for (const path of ["inventory", "payroll", "connections"]) {
    await page.goto(`/app/${path}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".loading")).toHaveCount(0);
    await expectBoundedIdleApiGets(page);
  }
});
