import { expect, test } from "@playwright/test";

const password = "Demo12345!";

type CapabilityCatalog = {
  commercialTermsConfigured: boolean;
  modules: Array<{ key: string; entitled: boolean; enabled: boolean; usable: boolean }>;
};

test("a new owner can choose recommended capabilities and manage them without losing records", async ({ page }) => {
  // Registration creates an isolated tenant for this test; no seeded business state is modified.
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  const email = `capability-${suffix}@example.test`;
  await page.goto("/create-account");
  await page.getByLabel("Your name").fill("Capability Test Owner");
  await page.getByLabel("Business name").fill(`Capability Test ${suffix}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // Industry selection now precedes capability recommendations so they use the selected pack.
  await expect(page.getByRole("heading", { name: "What kind of business do you run?" })).toBeVisible();
  await page.getByRole("radio", { name: /Pet Waste Removal/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();

  // Industry Pack answers change the recommendation set before the owner accepts it.
  await expect(page.getByRole("heading", { name: "Choose the tools you need now" })).toBeVisible();
  await page.getByRole("button", { name: "Choose different tools" }).click();
  const fieldTechnicians = page.getByLabel("Do you send technicians or crews to customer properties?");
  await fieldTechnicians.selectOption("yes");
  await page.getByRole("button", { name: "Refresh suggestions" }).click();
  await expect(page.getByText("Suggestions updated for the answers you gave.")).toBeVisible();
  const fieldOperations = page.getByRole("checkbox", { name: /Field Operations/ });
  await expect(fieldOperations).toBeChecked();
  await expect(page.getByText("Suggested", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Back to suggestions" }).click();
  await page.getByRole("button", { name: "Continue with these tools" }).click();

  // Complete the minimum onboarding records through the same authenticated API so the
  // test can exercise capability management without repeating unrelated onboarding UI.
  const businessName = `Capability Test ${suffix}`;
  const businessStep = await page.request.patch("/api/v1/onboarding", {
    data: { step: 1, data: { businessName, timezone: "America/New_York" } },
  });
  expect(businessStep.status()).toBe(200);
  const servicesStep = await page.request.patch("/api/v1/onboarding", {
    data: { step: 3, data: { services: { "recurring-cleanup": { enabled: true, price: "45" } } } },
  });
  expect(servicesStep.status()).toBe(200);
  const completed = await page.request.post("/api/v1/onboarding/complete", { data: { publishWebsite: false } });
  expect(completed.status()).toBe(200);

  const createdCustomer = await page.request.post("/api/v1/customers", {
    data: { name: `Historical customer ${suffix}`, email: `customer-${suffix}@example.test`, address: "41 Test Lane", customerType: "residential" },
  });
  expect(createdCustomer.status()).toBe(201);
  const customerId = (await createdCustomer.json()).item.id as string;
  const createdInvoice = await page.request.post("/api/v1/invoices", {
    data: { customerId, description: `Historical invoice ${suffix}`, totalCents: 4500 },
  });
  expect(createdInvoice.status()).toBe(201);
  const invoiceId = (await createdInvoice.json()).item.id as string;

  // In this V1, an explicit owner selection creates an unpriced self-service
  // grant. Recommendations alone do not grant access; choosing a tool does.
  await page.goto("/app/capabilities");
  await expect(page.getByRole("heading", { name: "Tools for your business" })).toBeVisible();
  const inventory = page.getByRole("checkbox", { name: "Use Inventory and Supplies" });
  await expect(inventory).toBeEnabled();
  await expect(page.locator(".module-setting").filter({ hasText: "Inventory and Supplies" })).toContainText("Access: Not included");
  if (!(await inventory.isChecked())) await inventory.check();
  await page.getByRole("button", { name: "Save tool choices" }).click();
  await expect(page.getByText("Your capability choices are saved.")).toBeVisible();
  await expect(page.locator(".module-setting").filter({ hasText: "Inventory and Supplies" })).toContainText("Access: Included");
  const afterConfiguration = await page.request.get("/api/v1/capabilities");
  expect(afterConfiguration.ok()).toBeTruthy();
  const catalog = (await afterConfiguration.json()).item as CapabilityCatalog;
  expect(catalog.commercialTermsConfigured).toBe(false);
  expect(catalog.modules.find((module) => module.key === "inventory-and-supplies")).toMatchObject({ entitled: true, enabled: true, usable: true });

  const billing = page.getByRole("checkbox", { name: "Use Billing and Payments" });
  await expect(billing).toBeChecked();
  await billing.uncheck();
  await page.getByRole("button", { name: "Save tool choices" }).click();
  await expect(page.getByText("Your capability choices are saved.")).toBeVisible();

  const deniedInvoice = await page.request.post("/api/v1/invoices", {
    data: { customerId, description: `Should be denied ${suffix}`, totalCents: 1200 },
  });
  expect(deniedInvoice.status()).toBe(403);
  await expect(deniedInvoice.json()).resolves.toMatchObject({ error: { code: "CAPABILITY_UNAVAILABLE" } });

  const historicalInvoice = await page.request.get(`/api/v1/invoices/${invoiceId}`);
  expect(historicalInvoice.status()).toBe(200);
  expect((await historicalInvoice.json()).item.id).toBe(invoiceId);
  const historicalCustomer = await page.request.get(`/api/v1/customers/${customerId}`);
  expect(historicalCustomer.status()).toBe(200);
  expect((await historicalCustomer.json()).item.id).toBe(customerId);
});
