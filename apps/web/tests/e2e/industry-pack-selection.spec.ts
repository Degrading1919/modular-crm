import { expect, test } from "@playwright/test";

const password = "Demo12345!";

test("a new owner can choose a non-default Industry Pack and use its setup", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  await page.goto("/create-account");
  await page.getByLabel("Your name").fill("Industry Pack Test Owner");
  await page.getByLabel("Business name").fill(`Party Setup ${suffix}`);
  await page.getByLabel("Email address").fill(`industry-pack-${suffix}@example.test`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "What kind of business do you run?" })).toBeVisible();
  await page.getByLabel("Search supported businesses").fill("party rentals");
  const partyRentals = page.getByRole("radio", { name: /Party Rentals/ });
  await expect(partyRentals).toBeVisible();
  await expect(partyRentals).toHaveAttribute("aria-checked", "false");
  await partyRentals.click();
  await page.getByRole("button", { name: /Continue/ }).click();

  await expect(page.getByRole("heading", { name: "Choose what helps you run your business." })).toBeVisible();
  await expect(page.getByText(/based on Party Rentals/)).toBeVisible();
  await page.getByRole("button", { name: "Accept recommended tools" }).click();

  await expect(page.getByRole("heading", { name: "Tell us about your business." })).toBeVisible();
  await page.getByLabel("Business name").fill(`Party Setup ${suffix}`);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /Set this later/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();

  await expect(page.getByRole("heading", { name: "What do you offer?" })).toBeVisible();
  await expect(page.getByText("Party Rentals comes with a tailored starting list. Choose what applies and add starting prices if you know them.")).toBeVisible();
  await page.getByRole("checkbox", { name: /Item Rental/ }).check();
  await page.getByLabel("Starting price (optional)").fill("73.50");
  await page.getByRole("button", { name: /Continue/ }).click();

  await expect(page.getByRole("heading", { name: "How do you get paid?" })).toBeVisible();

  const onboarding = await page.evaluate(async () => {
    const response = await fetch("/api/v1/onboarding");
    return { ok: response.ok, status: response.status, body: await response.json() };
  });
  expect(onboarding.ok, `onboarding GET returned ${onboarding.status}`).toBeTruthy();
  expect(onboarding.body.item).toMatchObject({
    packKey: "party-rentals",
    pack: { displayName: "Party Rentals" },
    data: { "3": { services: { "item-rental": { enabled: true, price: "73.50" } } } },
  });
});
