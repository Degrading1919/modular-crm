import { expect, test, type Page } from "@playwright/test";

const password = "Demo12345!";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

function businessDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  const authResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/v1/auth/login" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  const authResponse = await authResponsePromise;
  const authBody = await authResponse.json().catch(() => ({}));
  const authError = authBody?.error;
  expect(authResponse.ok(), `POST /api/v1/auth/login returned ${authResponse.status()} (${authError?.code ?? "no error code"}): ${authError?.message ?? "no error message"}`).toBeTruthy();
}

test("field queue preserves operation identity and evidence through retry, conflict, reload, and logout", async ({ browser }) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ baseURL });
  const techContext = await browser.newContext({ baseURL });
  try {
    const unique = Date.now();
    const owner = await ownerContext.newPage();
    await signIn(owner, "owner@happyyards.test");
    await expect(owner).toHaveURL(/\/app\/dashboard$/);
    const customersResponse = await owner.request.get("/api/v1/customers");
    expect(customersResponse.ok(), await customersResponse.text()).toBeTruthy();
    const customers = (await customersResponse.json()).items as Array<{ id: string; name?: string; displayName?: string }>;
    const customer = customers.find((item) => (item.name ?? item.displayName) === "Carter Household");
    expect(customer).toBeTruthy();
    const createdResponse = await owner.request.post("/api/v1/jobs", {
      data: { customerId: customer!.id, serviceName: "Yard cleanup", scheduledDate: businessDate(), notes: `Offline queue E2E ${unique}` },
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const jobId = (await createdResponse.json()).item.id as string;
    const staffResponse = await owner.request.get("/api/v1/staff");
    expect(staffResponse.ok(), await staffResponse.text()).toBeTruthy();
    const staff = (await staffResponse.json()).items as Array<{ id: string; name: string }>;
    const technician = staff.find((person) => person.name === "Terry Tech");
    expect(technician).toBeTruthy();
    const assignmentResponse = await owner.request.post(`/api/v1/jobs/${jobId}/assign`, {
      data: { technicianId: technician!.id, scheduledDate: businessDate() },
    });
    expect(assignmentResponse.ok(), await assignmentResponse.text()).toBeTruthy();
    const setupRouteResponse = await owner.request.post("/api/v1/routes", {
      data: { date: businessDate(), technicianId: technician!.id },
    });
    expect(setupRouteResponse.status(), await setupRouteResponse.text()).toBe(201);
    const routeId = (await setupRouteResponse.json()).item.id as string;
    const publishResponse = await owner.request.post(`/api/v1/routes/${routeId}/publish`, { data: {} });
    expect(publishResponse.ok(), await publishResponse.text()).toBeTruthy();

    const field = await techContext.newPage();
    await signIn(field, "tech@happyyards.test");
    await expect(field).toHaveURL(/\/field\/today$/);
    await expect.poll(() => field.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const routeResponse = await field.request.get("/api/v1/field/route");
    expect(routeResponse.ok(), await routeResponse.text()).toBeTruthy();
    const route = (await routeResponse.json()).item as { jobs: Array<{ id: string }> };
    expect(route.jobs.map((job) => job.id)).toContain(jobId);
    await field.goto("/field/route");
    await expect(field.getByRole("link", { name: /Open job/i }).first()).toBeVisible();
    await field.getByRole("link", { name: /Open job/i }).first().click();
    await expect(field.getByText("Before you begin")).toBeVisible();
    const onlineRouteRead = await field.evaluate(async () => {
      const response = await fetch("/api/v1/field/route", { credentials: "include", cache: "no-store" });
      return { status: response.status, payload: await response.json() };
    });
    expect(onlineRouteRead.status).toBe(200);

    await expect.poll(() => field.evaluate(async () => {
      const names = await caches.keys();
      const scoped = names.find((name) => name.startsWith("modular-field-data-v1:"));
      if (!scoped) return [];
      const cache = await caches.open(scoped);
      return (await cache.keys()).map((request) => new URL(request.url).pathname);
    })).toEqual(expect.arrayContaining(["/api/v1/field/route", `/api/v1/field/jobs/${jobId}`]));

    await techContext.setOffline(true);
    const offlineJob = await field.evaluate(async (targetJobId) => {
      const response = await fetch(`/api/v1/field/jobs/${targetJobId}`, { credentials: "include", cache: "no-store" });
      return { status: response.status, payload: await response.json() };
    }, jobId);
    expect(offlineJob.status).toBe(200);
    expect(offlineJob.payload.item.id).toBe(jobId);

    const notePath = `/api/v1/field/jobs/${jobId}/note`;
    const attempts: Array<Record<string, unknown>> = [];
    let transientFailuresRemaining = 2;
    const savedEvidence = `Evidence retained across reconnect ${unique}`;
    await field.getByLabel("What should the office know?").fill(savedEvidence);
    await field.getByRole("button", { name: "Save note" }).click();
    const firstOperation = await field.getByLabel(/Queued update/).first();
    await expect(firstOperation).toContainText(/pending sync/i);
    await expect(firstOperation).toContainText(savedEvidence);
    const persistedOperation = await field.evaluate(() => {
      const queueKey = Object.keys(localStorage).find((key) => key.startsWith("modular-field-queue-v2:"));
      if (!queueKey) return null;
      return JSON.parse(localStorage.getItem(queueKey) || "[]")[0] as { id: string; createdAt: string; payload: Record<string, unknown> } | undefined;
    });
    expect(persistedOperation?.payload.text).toBe(savedEvidence);
    const offlinePayload: Record<string, unknown> = { clientOperationId: persistedOperation?.id, deviceTimestamp: persistedOperation?.createdAt };

    await field.route(notePath, async (route) => {
      attempts.push(route.request().postDataJSON() as Record<string, unknown>);
      if (transientFailuresRemaining > 0) {
        transientFailuresRemaining -= 1;
        await route.abort("internetdisconnected");
      } else {
        await route.continue();
      }
    });

    await techContext.setOffline(false);
    await field.reload();
    const retainedAfterReload = await field.getByLabel(/Queued update/).first();
    await expect(retainedAfterReload).toContainText(savedEvidence);
    await retainedAfterReload.getByRole("button", { name: "Retry update" }).click();
    await expect(field.getByText("Your field updates are synced.", { exact: false })).toBeVisible();
    expect(offlinePayload?.clientOperationId).toBeTruthy();
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts.every((attempt) => attempt.clientOperationId === offlinePayload?.clientOperationId)).toBe(true);
    expect(attempts.every((attempt) => attempt.deviceTimestamp === offlinePayload?.deviceTimestamp)).toBe(true);

    const conflictEvidence = `Keep this evidence for office review ${unique}`;
    await field.unroute(notePath);
    await field.route(notePath, async (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT", message: "The job changed while you were offline.", details: { expectedState: "in_progress", currentState: "canceled" } } }) }));
    await field.getByLabel("What should the office know?").fill(conflictEvidence);
    await field.getByRole("button", { name: "Save note" }).click();
    const conflict = field.getByLabel(/Queued update/).first();
    await expect(conflict).toContainText(/needs review/i);
    await expect(conflict).toContainText("Expected state: in_progress");
    await expect(conflict).toContainText("Current state: canceled");
    await expect(conflict.getByText(conflictEvidence).first()).toBeVisible();

    await field.reload();
    await expect(field.getByLabel(/Queued update/).first()).toContainText(conflictEvidence);
    await field.getByRole("navigation", { name: "Field navigation" }).getByRole("link", { name: "Profile" }).click();
    field.once("dialog", (dialog) => dialog.accept());
    await field.getByRole("button", { name: "Sign out" }).click();
    await expect(field).toHaveURL(/\/login$/);
    await signIn(field, "tech@happyyards.test");
    await expect(field).toHaveURL(/\/field\/today$/);
    await expect(field.getByLabel(/Queued update/).first()).toContainText(conflictEvidence);
  } finally {
    await techContext.close();
    await ownerContext.close();
  }
});
