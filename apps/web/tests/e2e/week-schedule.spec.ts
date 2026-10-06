import { expect, test, type Page } from "@playwright/test";
import { closeDatabase, createDatabase, schema, seedIds } from "@modular-crm/db";
import { eq } from "drizzle-orm";

async function signIn(page: Page, email = "owner@happyyards.test") {
  await page.goto("/login"); await page.getByLabel("Email address").fill(email); await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(email.startsWith("tech") ? /\/field\/today$/ : /\/app\/dashboard$/);
}

test("owner drags unscheduled work to Wednesday, publishes it to field, then moves dispatch to Thursday", async ({ page, browser }, info) => {
  test.setTimeout(120_000); await signIn(page); const db = createDatabase(process.env.DATABASE_URL!), field = await browser.newPage(); const routes: string[] = [];
  let jobId: string | undefined;
  try {
    const name = `Calendar customer ${crypto.randomUUID()}`;
    const response = await page.request.post("/api/v1/customers", { data: { name, address: "123 Calendar Lane" } }); expect(response.status()).toBe(201); const customer = (await response.json()).item;
    const [location] = await db.select().from(schema.serviceLocations).where(eq(schema.serviceLocations.customerId, customer.id));
    const [job] = await db.insert(schema.jobs).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: customer.id, serviceLocationId: location!.id, serviceId: seedIds.weeklyService, status: "unscheduled" }).returning(); jobId = job!.id;
    await page.goto("/app/schedule?week=2027-02-01&day=2027-02-03&view=week");
    const calendar = page.getByRole("region", { name: "Week calendar" });
    const card = page.getByRole("complementary", { name: "Unscheduled visits" }).locator(`[data-visit-id="${jobId}"]`);
    const wednesday = calendar.locator(`[data-schedule-day="2027-02-03"][data-technician-id="${seedIds.terryMembership}"]`);
    await expect(card).toBeVisible(); await card.dragTo(wednesday);
    await expect(wednesday.locator(`[data-visit-id="${jobId}"]`)).toContainText(name);
    const [scheduled] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId!)); expect(scheduled).toMatchObject({ scheduledDate: "2027-02-03", status: "scheduled", assignedRouteId: null });
    const create = await page.request.post("/api/v1/routes", { data: { date: "2027-02-03", technicianId: seedIds.terryMembership } }); expect(create.status(), await create.text()).toBe(201); const route = (await create.json()).item; routes.push(route.id);
    expect((await page.request.post(`/api/v1/routes/${route.id}/publish`, { data: {} })).ok()).toBe(true);
    await signIn(field, "tech@happyyards.test"); await field.goto(`/field/job/${jobId}`); await expect(field.getByText(name, { exact: true }).first()).toBeVisible();
    await page.reload(); const dispatched = wednesday.locator(`[data-visit-id="${jobId}"]`); await expect(dispatched).toContainText("Dispatched");
    const thursday = calendar.locator(`[data-schedule-day="2027-02-04"][data-technician-id="${seedIds.terryMembership}"]`); await dispatched.dragTo(thursday, { sourcePosition: { x: 8, y: 8 }, targetPosition: { x: 20, y: 20 } });
    await expect(page.getByText("Visit moved. Publish the route again to send the new schedule to the technician.", { exact: true })).toBeVisible();
    await expect(thursday.locator(`[data-visit-id="${jobId}"]`)).toContainText(name);
    expect((await db.select().from(schema.routeStops).where(eq(schema.routeStops.routePlanId, route.id)))[0]!.status).toBe("removed");
    const newRoute = await page.request.post("/api/v1/routes", { data: { date: "2027-02-04", technicianId: seedIds.terryMembership } }); expect(newRoute.status(), await newRoute.text()).toBe(201); const next = (await newRoute.json()).item; routes.push(next.id);
    expect((await page.request.post(`/api/v1/routes/${next.id}/publish`, { data: {} })).ok()).toBe(true);
    await field.reload(); await expect(field.getByText(name, { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("week-dispatch.png"), fullPage: true });
  } finally {
    if (jobId) await db.update(schema.jobs).set({ status: "canceled", assignedRouteId: null }).where(eq(schema.jobs.id, jobId));
    for (const id of routes) { await db.delete(schema.routeStops).where(eq(schema.routeStops.routePlanId, id)); await db.delete(schema.routePlans).where(eq(schema.routePlans.id, id)); }
    await field.close(); await closeDatabase(db);
  }
});

test("branch-restricted office sees only its technicians, and phone Move keeps the page within the viewport", async ({ page }, info) => {
  await signIn(page, "manager@happyyards.test");
  const read = await page.request.get("/api/v1/schedule?week=2027-02-01"); expect(read.ok()).toBe(true);
  const data = await read.json(); expect(data.technicians.map((tech: { id: string }) => tech.id)).toContain(seedIds.terryMembership); expect(data.technicians.map((tech: { id: string }) => tech.id)).not.toContain(seedIds.caseyMembership);
  expect((await page.request.get(`/api/v1/schedule?locationId=${seedIds.northAugusta}`)).status()).toBe(404);
  const response = await page.request.post("/api/v1/jobs", { data: { customerId: seedIds.carter, serviceId: seedIds.weeklyService, serviceLocationId: seedIds.carterLocation, scheduledDate: "2027-02-03" } }); expect(response.status(), await response.text()).toBe(201); const job = (await response.json()).item;
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/app/schedule?week=2027-02-01&day=2027-02-03&view=week");
  const day = page.getByRole("region", { name: "Phone day calendar" }); await expect(day).toBeVisible();
  const card = day.locator(`[data-visit-id="${job.id}"]`); await expect(card).toContainText("Any time");
  await card.getByRole("button", { name: "Move Carter Household", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move Carter Household" }); await dialog.getByLabel("Service day").fill("2027-02-04"); await dialog.getByLabel("Technician", { exact: true }).selectOption(seedIds.terryMembership); await dialog.getByLabel("Arrival window start").fill("09:00"); await dialog.getByLabel("Arrival window end").fill("11:00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.getByLabel("Schedule date").fill("2027-02-04"); await expect(day.locator(`[data-visit-id="${job.id}"]`)).toContainText("09:00–11:00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expect(page).toHaveURL(/week=2027-02-04/);
  await page.screenshot({ path: info.outputPath("calendar-phone.png"), fullPage: true });
  const detail = await page.request.get(`/api/v1/jobs/${job.id}/detail`); const updated = (await detail.json()).item;
  expect((await page.request.post(`/api/v1/jobs/${job.id}/cancel`, { data: { expectedUpdatedAt: updated.updatedAt, idempotencyKey: crypto.randomUUID(), reason: "Browser test finished" } })).ok()).toBe(true);
});
