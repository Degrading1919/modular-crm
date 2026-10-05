import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.getByRole("heading", { name: /Good morning/ })).toBeVisible();
}

async function expectPaymentRows(page: import("@playwright/test").Page, response: import("@playwright/test").Response) {
  expect(response.status()).toBe(200);
  const { items } = await response.json();
  const payment = items.find((item: { customerName: string; amountCents: number }) => item.customerName === "Carter Household" && item.amountCents === 2500);
  expect(payment).toBeDefined();
  // A customer may have several legitimate payments; identify one record by ID.
  const row = page.getByRole("table").locator(`tr[data-record-id="${payment.id}"]`);
  await expect(row.getByText("Carter Household", { exact: true })).toBeVisible();
  await expect(page.locator('a[href^="/app/payments/"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New payment", exact: true })).toHaveCount(0);
  const receipt = await page.request.get(`/api/v1/documents/receipt/${payment.id}`);
  expect(receipt.status()).toBe(200);
  expect(await receipt.json()).toMatchObject({ item: { kind: "receipt", title: "Payment receipt" } });
  await row.getByRole("link", { name: "View receipt", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/documents/receipt/${payment.id}$`));
  await expect(page.getByRole("heading", { name: "Payment receipt", exact: true })).toBeVisible();
  await page.goto("/app/payments");
}

test("Morgan's operational destinations work without owner administration", async ({ page }) => {
  await signIn(page, "manager@happyyards.test");
  const catalog = await page.request.get("/api/v1/capabilities");
  expect(catalog.status()).toBe(200);
  const identity = await page.request.get("/api/v1/auth/me");
  const permissions = (await identity.json()).user.permissions as string[];
  expect(permissions).toContain("organization.read");
  for (const permission of ["tenant.billing_manage", "tenant.update", "tenant.security_manage", "tenant.delete", "organization.update", "organization.locations_manage", "organization.franchise_manage", "compensation.read", "payroll.read", "payments.refund"]) {
    expect(permissions).not.toContain(permission);
  }
  for (const mutation of [
    await page.request.post("/api/v1/capabilities/recommendations", { data: { answers: {} } }),
    await page.request.post("/api/v1/capabilities/setup", { data: { selection: "custom", answers: {}, moduleKeys: [] } }),
    await page.request.patch("/api/v1/capabilities/route-planning", { data: { enabled: false } }),
  ]) expect(mutation.status()).toBe(403);
  for (const endpoint of ["organization", "organization/locations"]) {
    const createLocation = await page.request.post(`/api/v1/${endpoint}`, { data: { name: "Morgan cannot create this location", address: "12 Test Road" } });
    expect(createLocation.status()).toBe(403);
    expect(await createLocation.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  }

  const navigation = page.getByRole("navigation", { name: "Business navigation" });
  for (const name of ["My capabilities", "Developer", "Pay & time", "Franchise"]) {
    await expect(navigation.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  for (const [link, heading] of [["Schedule", "Schedule"], ["Jobs", "Jobs"], ["Routes", "Routes"], ["Get paid", "Get paid"], ["Staff", "Staff"], ["Connections", "Connections"], ["Settings", "Settings"], ["Locations", "Locations"]]) {
    const endpoint = ({ Schedule: "jobs", Jobs: "jobs", Routes: "routes", Staff: "staff", Connections: "connections", Settings: "settings", Locations: "organization" } as Record<string, string>)[link];
    const response = endpoint ? page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/${endpoint}` && response.request().method() === "GET") : null;
    await navigation.getByRole("link", { name: link, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (response) expect((await response).status()).toBe(200);
    await expect(page.getByText("This tool isn’t available yet.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("You do not have access to this action.", { exact: true })).toHaveCount(0);
    if (link === "Locations") await expect(page.getByRole("button", { name: "New location", exact: true })).toHaveCount(0);
  }
  await page.goto("/app/billing");
  const invoiceResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/invoices");
  await page.getByRole("link", { name: "Open invoices", exact: true }).click();
  expect((await invoiceResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
  await page.goto("/app/billing");
  const paymentResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/payments");
  await page.getByRole("link", { name: "Open payments", exact: true }).click();
  await expectPaymentRows(page, await paymentResponse);
  await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();

  for (const [name, heading] of [["New job", "Jobs"], ["Open schedule", "Schedule"], ["See all jobs", "Jobs"], ["Plan a route", "Routes"], ["Add a customer", "Customers"]]) {
    await page.goto("/app/dashboard");
    await page.getByRole("link", { name: new RegExp(`^${name}(?:$|\\s)`) }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  for (const route of ["capabilities", "developer", "payroll", "franchise"]) {
    await page.goto(`/app/${route}`);
    await expect(page.getByRole("heading", { name: "You don’t have access to this tool" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review my capabilities" })).toHaveCount(0);
  }
});

test("owner retains operational and administrative workspace access", async ({ page }) => {
  await signIn(page, "owner@happyyards.test");
  const navigation = page.getByRole("navigation", { name: "Business navigation" });
  for (const name of ["Schedule", "Jobs", "Routes", "Get paid", "My capabilities", "Developer", "Pay & time", "Franchise"]) {
    await expect(navigation.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await navigation.getByRole("link", { name: "My capabilities", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save my capabilities" })).toBeEnabled();
  await navigation.getByRole("link", { name: "Developer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Developer tools", exact: true })).toBeVisible();
  await navigation.getByRole("link", { name: "Locations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Locations", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New location", exact: true })).toBeEnabled();
  const payments = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/payments" && response.request().method() === "GET");
  await page.goto("/app/payments");
  await expectPaymentRows(page, await payments);
});

test("enabled tools without staff permissions are hidden from links and direct routes", async ({ page }) => {
  await signIn(page, "manager@happyyards.test");
  // Restrict only this browser's identity response; never mutate the shared demo
  // role, sessions, capabilities, or clock for the rest of the suite.
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    const identity = await response.json();
    identity.user.permissions = identity.user.permissions.filter((permission: string) => !["jobs.read", "routes.read", "customers.create"].includes(permission));
    await route.fulfill({ response, json: identity });
  });
  await page.goto("/app/dashboard");
  await expect(page.getByRole("heading", { name: /Good morning/ })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Business navigation" });
  for (const name of ["Jobs", "Schedule", "Routes"]) await expect(navigation.getByRole("link", { name, exact: true })).toHaveCount(0);
  for (const name of ["New job", "Open schedule", "See all jobs", "Plan a route", "Add a customer"]) await expect(page.getByRole("link", { name: new RegExp(`^${name}(?:$|\\s)`) })).toHaveCount(0);
  for (const route of ["jobs", "schedule", "routes"]) {
    await page.goto(`/app/${route}`);
    await expect(page.getByRole("heading", { name: "You don’t have access to this tool" })).toBeVisible();
  }
});

test("staff permissions cannot bypass an unavailable tenant capability", async ({ page }) => {
  await signIn(page, "manager@happyyards.test");
  await page.route("**/api/v1/capabilities", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    catalog.item.features.route_planning.usable = false;
    catalog.item.features.route_planning.visible = false;
    await route.fulfill({ response, json: catalog });
  });
  await page.goto("/app/dashboard");
  await expect(page.getByRole("heading", { name: /Good morning/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Business navigation" }).getByRole("link", { name: "Routes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Plan a route/ })).toHaveCount(0);
  await page.goto("/app/routes");
  await expect(page.getByRole("heading", { name: "This tool isn’t available yet.", exact: true })).toBeVisible();
  await expect(page.getByText("Ask a business owner about enabling this tool.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Review my capabilities" })).toHaveCount(0);
});
