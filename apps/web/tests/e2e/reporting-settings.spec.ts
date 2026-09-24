import { expect, test } from "@playwright/test";

test("owner can open the reporting and workspace settings APIs", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  const dashboard = await page.request.get("/api/v1/dashboard");
  expect(dashboard.status()).toBe(200);
  expect((await dashboard.json()).item.metrics).toHaveProperty("todaysJobs");

  for (const path of ["settings", "connections", "automations", "communications"]) {
    const response = await page.request.get(`/api/v1/${path}`);
    expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
  }

  for (const type of ["financial", "customers", "jobs", "routes", "staff", "inventory", "locations"]) {
    const report = await page.request.get(`/api/v1/reports?type=${type}&range=month`);
    expect(report.status(), `${type}: ${await report.text()}`).toBe(200);
    const body = await report.json();
    expect(body.item).toHaveProperty("metrics");
    expect(body.item).toHaveProperty("rows");
  }

});
