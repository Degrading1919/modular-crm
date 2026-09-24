import { expect, test, type Page } from "@playwright/test";

const password = "Demo12345!";

async function openServices(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("customer@happyyards.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/portal\/home$/);
  await page.getByRole("navigation", { name: "Customer account" }).getByRole("link", { name: "Services" }).click();
  await expect(page.getByRole("heading", { name: "Recent visits" })).toBeVisible();
  const ratingGroup = page.getByRole("radiogroup", { name: /Rate service visit on/ });
  return ratingGroup;
}

test("customer can rate a completed visit and sees the saved response", async ({ page }) => {
  const ratingGroup = await openServices(page);
  if (!(await ratingGroup.count())) {
    await expect(page.getByRole("status").filter({ hasText: /Your feedback: [1-5] out of 5/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
    return;
  }
  await ratingGroup.getByRole("radio", { name: "5 stars" }).check();
  await page.getByLabel(/Anything you’d like us to know/).fill("The gate was closed and the yard looks great.");

  const submitted = page.waitForResponse((response) => response.url().includes("/api/v1/portal/feedback/") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send feedback" }).click();
  const response = await submitted;
  expect([200, 201]).toContain(response.status());
  const payload = await response.json();
  expect(payload.item.rating === 5 || payload.item.duplicate === true).toBeTruthy();

  await expect(page.getByRole("status").filter({ hasText: "Your feedback: 5 out of 5" })).toBeVisible();
  await expect(page.getByText("The gate was closed and the yard looks great.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
});

test("feedback stays available and explains a temporary submission error", async ({ page }) => {
  await page.route("**/api/v1/portal/services", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.items = payload.items.map((plan: { history?: Array<Record<string, unknown>> }) => ({
      ...plan,
      history: plan.history?.map((visit) => ({ ...visit, feedbackRating: null, feedbackComment: null })),
    }));
    await route.fulfill({ response, body: JSON.stringify(payload) });
  });
  await page.route("**/api/v1/portal/feedback/**", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "Feedback is temporarily unavailable." } }),
  }));
  const ratingGroup = await openServices(page);
  await expect(ratingGroup.first()).toBeVisible();
  await ratingGroup.getByRole("radio", { name: "4 stars" }).check();
  await page.getByRole("button", { name: "Send feedback" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Feedback is temporarily unavailable." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeEnabled();
  await expect(ratingGroup.getByRole("radio", { name: "4 stars" })).toBeChecked();
});
