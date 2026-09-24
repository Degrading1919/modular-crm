import { expect, test, type Page } from "@playwright/test";

const password = "Demo12345!";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
}

test("owner can find seeded customer details and add a customer", async ({ page }) => {
  await signIn(page, "owner@happyyards.test");
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.getByRole("heading", { name: /Good morning, Olivia/i })).toBeVisible();
  await page.getByRole("navigation", { name: "Business navigation" }).getByRole("link", { name: "Customers" }).click();
  await page.getByRole("textbox", { name: "Search customers" }).fill("Carter Household");
  await page.getByRole("link", { name: /Carter Household/ }).first().click();
  await expect(page.getByText("Buddy", { exact: true })).toBeVisible();
  await expect(page.getByText("Luna", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Back to customers/i }).click();
  await page.getByRole("button", { name: /New customer/i }).click();
  const unique = `Test Household ${Date.now()}`;
  await page.getByLabel("Customer name").fill(unique);
  await page.getByLabel("Email", { exact: true }).fill(`e2e-${Date.now()}@example.test`);
  await page.getByLabel("Service address").fill("54 Garden Lane, Augusta, GA 30909");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByText("Customer created.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search customers" }).fill(unique);
  await expect(page.getByRole("link", { name: new RegExp(unique) }).first()).toBeVisible();
});

test("technician sees only field work and can inspect assigned route", async ({ page }) => {
  await signIn(page, "tech@happyyards.test");
  await expect(page).toHaveURL(/\/field\/today$/);
  await expect(page.getByRole("heading", { name: /Good morning, Terry/i })).toBeVisible();
  const todayResponse = await page.request.get("/api/v1/field/today");
  expect(todayResponse.ok()).toBeTruthy();
  const todayPayload = await todayResponse.json();
  // An earlier admin flow can publish an empty route for today. It should not
  // expose any stops, and the technician's day should still be clear.
  if (todayPayload.item.route) expect(todayPayload.item.route.status).toBe("published");
  expect(todayPayload.item.jobs).toEqual([]);
  await expect(page.getByText("Your day is clear")).toBeVisible();

  const routeResponse = await page.request.get("/api/v1/field/route");
  expect(routeResponse.ok()).toBeTruthy();
  const routePayload = await routeResponse.json();
  const routeDate = routePayload.item.route.date as string;
  const utcToday = new Date().toISOString().slice(0, 10);
  expect(Date.parse(`${routeDate}T00:00:00.000Z`) - Date.parse(`${utcToday}T00:00:00.000Z`)).toBe(2 * 24 * 60 * 60 * 1000);
  expect(routePayload.item.route.status).toBe("published");
  expect(routePayload.item.jobs.map((job: { id: string }) => job.id)).toEqual([
    "00000000-0000-4000-8000-00000000012d",
    "00000000-0000-4000-8000-00000000012f",
  ]);

  await page.getByRole("navigation", { name: "Field navigation" }).getByRole("link", { name: "Route" }).click();
  await expect(page.getByRole("heading", { name: "Your route" })).toBeVisible();
  const routeDateLabel = await page.evaluate((value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)), routeDate);
  await expect(page.getByRole("heading", { name: routeDateLabel, exact: true })).toBeVisible();
  const openJobHrefs = await page.getByRole("link", { name: /Open job/i }).evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(openJobHrefs).toEqual([
    "/field/job/00000000-0000-4000-8000-00000000012d",
    "/field/job/00000000-0000-4000-8000-00000000012f",
  ]);
  await expect(page.getByText("Carter Household").first()).toBeVisible();
  await page.getByRole("link", { name: /Open job/i }).first().click();
  await expect(page.getByText("Before you begin")).toBeVisible();
  await expect(page.getByText("Buddy", { exact: false })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Business navigation" })).toHaveCount(0);
});

test("customer can see services and submit a change request", async ({ page }) => {
  await signIn(page, "customer@happyyards.test");
  await expect(page).toHaveURL(/\/portal\/home$/);
  await page.getByRole("navigation", { name: "Customer account" }).getByRole("link", { name: "Services" }).click();
  await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
  const requestChange = page.getByRole("button", { name: "Request a change" }).first();
  await expect(requestChange).toBeVisible();
  await requestChange.click();
  const changeNote = `Please call before the next visit to discuss our new gate access ${Date.now()}.`;
  await page.getByLabel("Anything we should know?").fill(changeNote);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/Your request was sent/)).toBeVisible();
  await page.getByRole("navigation", { name: "Customer account" }).getByRole("link", { name: "Requests" }).click();
  await expect(page.getByText(changeNote)).toBeVisible();
});

test("public visitor checks eligibility and submits service signup", async ({ page }) => {
  await page.goto("/site/happy-yards");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const getStarted = page.getByRole("link", { name: "Get started" }).first();
  await expect(getStarted).toBeVisible();
  await getStarted.click();
  await expect(page).toHaveURL(/\/site\/happy-yards\/signup$/);
  await page.getByLabel("Street address").fill("65 Maple Street, Augusta, GA");
  await page.getByLabel("ZIP code").fill("30909");
  await page.getByRole("button", { name: /Check availability/i }).click();
  await page.getByLabel("Full name").fill(`E2E Visitor ${Date.now()}`);
  await page.getByLabel("Email", { exact: true }).fill(`visitor-${Date.now()}@example.test`);
  await page.getByLabel("Phone").fill("555-0199");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByLabel("Service", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Pet 1 name").fill("Scout");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByLabel("Access or safety notes").fill("Please use the side gate.");
  await page.getByRole("button", { name: /See my price/i }).click();
  await page.getByLabel(/I agree to be contacted/).check();
  await page.getByRole("button", { name: /Send service request/i }).click();
  await expect(page.getByText("Request received")).toBeVisible();
});

test("a different business cannot open another tenant's customer", async ({ page }) => {
  await signIn(page, "owner@cleanpaws.test");
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  const carterFromHappyYards = "00000000-0000-4000-8000-000000000064";
  const response = await page.request.get(`/api/v1/customers/${carterFromHappyYards}`);
  expect([403, 404]).toContain(response.status());
  await page.goto(`/app/customers/${carterFromHappyYards}`);
  await expect(page.getByRole("alert").filter({ hasText: /not found|permission|access/i }).first()).toBeVisible();
});
