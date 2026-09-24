import { expect, test } from "@playwright/test";

test("owner can export each report category as CSV", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  const locationReport = await page.request.get("/api/v1/reports?type=locations&range=month");
  expect(locationReport.status()).toBe(200);
  const locationNames = (await locationReport.json()).item.rows.map((row: { locationName: string }) => row.locationName);
  expect(locationNames).toEqual(expect.arrayContaining(["Augusta Branch", "North Augusta Branch"]));
  expect(locationNames).not.toContain("Main Branch");

  for (const type of ["financial", "customers", "jobs", "routes", "staff", "inventory", "locations"]) {
    const response = await page.request.get(`/api/v1/reports/export?type=${type}&range=month`);
    expect(response.status(), `${type}: ${await response.text()}`).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain(`filename="${type}-report.csv"`);
    const csv = await response.text();
    expect(csv).toMatch(/^"[^"]+"/);
    expect(csv).not.toBe("");
  }
});
