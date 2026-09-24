import { expect, test } from "@playwright/test";

const password = "Demo12345!";

test("public signup accepts demo payment and creates one customer service plan", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const name = `E2E Signup ${suffix}`;
  const email = `e2e-signup-${suffix}@example.test`;
  const phone = `555${suffix.slice(-7).padStart(7, "0")}`;

  await page.goto("/site/happy-yards/signup");
  await expect(page.getByRole("heading", { name: "Where can we help?" })).toBeVisible();
  await page.getByLabel("Street address").fill(`${Math.floor(Math.random() * 90_000) + 10_000} Maple Street, Augusta, GA`);
  await page.getByLabel("ZIP code").fill("30909");
  await page.getByRole("button", { name: /Check availability/i }).click();

  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Phone").fill(phone);
  await page.getByRole("button", { name: /Continue/i }).click();

  await page.getByLabel("Service", { exact: true }).selectOption({ label: "Yard cleanup" });
  await page.getByLabel("How often?").selectOption("weekly");
  await page.getByLabel("Pet 1 name").fill(`Scout ${suffix}`);
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByLabel("Access or safety notes").fill("Please use the side gate.");
  await page.getByRole("button", { name: /See my price/i }).click();

  const paymentChoice = page.getByRole("checkbox", { name: /Use a demo payment method for local testing/i });
  await expect(paymentChoice).toBeVisible();
  await paymentChoice.check();
  const termsChoice = page.getByRole("checkbox", { name: /accept the service terms/i });
  await expect(termsChoice).toBeVisible();
  await expect(termsChoice).toHaveAttribute("required", "");
  await termsChoice.check();

  const signupResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/public/signup") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Send service request/i }).click();
  const signupResponse = await signupResponsePromise;
  expect(signupResponse.status()).toBe(201);
  const payload = signupResponse.request().postDataJSON() as Record<string, unknown>;
  expect(payload.paymentMethod).toBe("demo");
  expect(payload.termsAccepted).toBe(true);
  expect(payload.idempotencyKey).toEqual(expect.any(String));
  expect((payload.idempotencyKey as string).length).toBeGreaterThanOrEqual(8);

  const created = (await signupResponse.json()).item as {
    id: string;
    kind: string;
    status: string;
    servicePlanId: string;
  };
  expect(created).toMatchObject({ kind: "customer", status: "active" });
  expect(created.servicePlanId).toEqual(expect.any(String));
  await expect(page.getByRole("heading", { name: "You’re all set!" })).toBeVisible();

  // Replaying the exact accepted request must return the existing customer, not create another signup.
  const replay = await page.request.post("/api/v1/public/signup", { data: payload });
  expect(replay.status()).toBe(200);
  const replayed = (await replay.json()).item as { id: string; kind: string; status: string };
  expect(replayed).toMatchObject({ id: created.id, kind: "customer", status: "active" });

  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  const customersResponse = await page.request.get("/api/v1/customers");
  expect(customersResponse.ok()).toBeTruthy();
  const customers = (await customersResponse.json()).items as Array<{ id: string; email: string }>;
  expect(customers.filter((customer) => customer.id === created.id && customer.email === email)).toHaveLength(1);

  const plansResponse = await page.request.get("/api/v1/service-plans");
  expect(plansResponse.ok()).toBeTruthy();
  const plans = (await plansResponse.json()).items as Array<{ id: string; customerId: string }>;
  expect(plans.filter((plan) => plan.id === created.servicePlanId && plan.customerId === created.id)).toHaveLength(1);
});
