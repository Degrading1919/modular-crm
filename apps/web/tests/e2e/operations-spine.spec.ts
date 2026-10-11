import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { chooseStaffRecord } from "./staff-picker";
import { businessDate } from "../../lib/dates";
import { closeDatabase, createDatabase, schema } from "@modular-crm/db";
import { eq } from "drizzle-orm";
import { generateRecurringJobs } from "../../../worker/src/recurring-db";
import { addCalendarDays } from "../../../worker/src/recurrence";

const today = () => businessDate(new Date(), "America/New_York");
const password = "Demo12345!";
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(`/api/v1${path}`, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function prepare(page: Page, name: string) {
  const catalog = (await (await page.request.get("/api/v1/capabilities")).json()).item;
  await post(page, "/capabilities/setup", { selection: "custom", answers: {}, moduleKeys: catalog.modules.filter((m: { available: boolean; key: string }) => m.available).map((m: { key: string }) => m.key) });
  for (const [step, data] of [[1, { businessName: name, timezone: "America/New_York" }], [3, { services: { recurring: { enabled: true, price: "45" } } }], [6, { importChoice: "fresh" }]] as const) {
    const response = await page.request.patch("/api/v1/onboarding", { data: { step, data } }); expect(response.status()).toBe(200);
  }
}

test("solo owner chooses field work, prices and assigns visits, sees two routes, completes and invoices", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now(), name = `Solo Owner ${suffix}`;
  await page.goto("/create-account");
  await page.getByLabel("Your name").fill(name); await page.getByLabel("Business name").fill(`Solo Business ${suffix}`);
  await page.getByLabel("Email address").fill(`solo-${suffix}@example.test`); await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("button", { name: "Accept recommended tools" })).toBeVisible();
  await prepare(page, `Solo Business ${suffix}`);
  await page.reload();
  await expect(page.getByLabel("Will you work in the field?")).toBeVisible();
  await page.getByLabel("Will you work in the field?").selectOption("yes");
  await page.getByLabel("How many technicians do you have now?").fill("0");
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Your site is taking shape." })).toBeVisible();
  await post(page, "/onboarding/complete", { publishWebsite: false });
  // Preserve the explicit capability selection after the suggestions screen acceptance.
  await prepareCapabilities(page);
  const identity = await (await page.request.get("/api/v1/auth/me")).json(); expect(identity.tenant.ownerFieldWorker).toBe(true);
  const customer = (await post(page, "/customers", { name: `Solo customer ${suffix}`, address: "41 Test Lane", customerType: "residential" })).item;
  const service = (await (await page.request.get("/api/v1/services")).json()).items.find((s: { key: string }) => s.key === "recurring-cleanup");
  const staff = (await (await page.request.get("/api/v1/staff")).json()).items;
  const owner = staff.find((p: { name: string }) => p.name === name); expect(owner.fieldWorker).toBe(true);
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    await page.goto("/app/jobs"); await page.getByRole("button", { name: /^New job$/i }).click();
    await chooseStaffRecord(page, "Customer", customer.name || customer.displayName); await chooseStaffRecord(page, "Service", service.name);
    await page.getByLabel("Visit price").fill("45.67"); await page.getByLabel("Service day").fill(today());
    const created = page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/jobs" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Create job", exact: true }).click();
    const response = await created; expect(response.ok(), await response.text()).toBeTruthy(); const work = (await response.json()).item; ids.push(work.id);
    await page.goto(`/app/jobs/${work.id}`); await page.getByRole("button", { name: "Reassign", exact: true }).click();
    await page.getByRole("combobox", { name: "Technician", exact: true }).selectOption(owner.id); await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Job updated. Publish its route when the schedule is ready.")).toBeVisible();
    const route = (await post(page, "/routes", { date: today(), technicianId: owner.id })).item;
    await post(page, `/routes/${route.id}/publish`, {});
  }
  await page.goto("/app/dashboard"); await page.getByRole("link", { name: "My field work" }).click();
  await expect(page.getByRole("heading", { name: "2 stops on your route", exact: true })).toBeVisible();
  expect([...new Set(await page.getByRole("link", { name: /Open job/ }).evaluateAll(links => links.map(link => link.getAttribute("href"))))].sort()).toEqual(ids.map(id => `/field/job/${id}`).sort());
  const field = (await (await page.request.get("/api/v1/field/today")).json()).item; expect(field.jobs.map((j: { id: string }) => j.id).sort()).toEqual(ids.sort());
  await page.goto(`/field/job/${ids[0]}`); await expect(page.getByText("Arrival window", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start job", exact: true }).click(); await expect(page.getByText(/^In progress$/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause job", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  for (const checkbox of await page.getByRole("checkbox").all()) { await checkbox.check(); await expect(checkbox).toBeChecked(); }
  await page.getByRole("button", { name: /Complete job/ }).click(); await expect(page.getByText(/^Completed$/i)).toBeVisible();
  await page.goto(`/app/jobs/${ids[0]}`); await page.getByRole("button", { name: "Create invoice", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/invoices\/[a-f0-9-]+$/); await expect(page.getByRole("region", { name: "Record summary" })).toContainText("$45.67");
});

async function prepareCapabilities(page: Page) {
  const catalog = (await (await page.request.get("/api/v1/capabilities")).json()).item;
  await post(page, "/capabilities/setup", { selection: "custom", answers: {}, moduleKeys: catalog.modules.filter((m: { available: boolean }) => m.available).map((m: { key: string }) => m.key) });
}

test("office fixes a forgotten clock-out, approves the hours, calculates and exports pay", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now(), name = `Time Owner ${suffix}`;
  await post(page, "/auth/register", { name, businessName: `Time Business ${suffix}`, email: `time-${suffix}@example.test`, password });
  await prepare(page, `Time Business ${suffix}`); await post(page, "/onboarding/complete", { publishWebsite: false });
  const owner = (await (await page.request.get("/api/v1/staff")).json()).items.find((p: { name: string }) => p.name === name);
  await post(page, "/payroll/profiles", { membershipId: owner.id, effectiveFrom: today(), hourlyRateMinor: 2000, currency: "USD" });
  await post(page, "/field/time", { action: "clock_in", clientOperationId: crypto.randomUUID(), deviceTimestamp: new Date(Date.now()-3_600_000).toISOString() });
  await page.goto("/app/time"); await expect(page.getByRole("heading", { name: "Review work time" })).toBeVisible();
  await page.getByRole("button", { name: "Fix clock-out" }).click();
  const end = new Date(Date.now()-60_000), local = new Date(end.getTime()-end.getTimezoneOffset()*60_000).toISOString().slice(0,16);
  await page.getByLabel("Clock-out time").fill(local); await page.getByLabel("Reason", { exact: true }).fill("Forgot to clock out after the last visit");
  await page.getByRole("button", { name: "Record clock-out" }).click(); await expect(page.getByText("Clock-out recorded. Review and approve these hours separately.")).toBeVisible();
  await expect(page.getByRole("article", { name: `Time for ${name}` })).toContainText("Pending");
  await page.getByRole("button", { name: "Approve hours" }).click(); await expect(page.getByText("Hours approved. Recalculate any open pay period to include them.")).toBeVisible();
  await page.goto("/app/payroll"); await page.getByRole("button", { name: "New pay period" }).click();
  await page.getByLabel("Start date", { exact: true }).fill(today()); await page.getByLabel("End date", { exact: true }).fill(today()); await page.getByRole("dialog", { name: "Create a pay period" }).getByRole("button", { name: "Create pay period", exact: true }).click();
  await page.getByRole("button", { name: "Calculate pay" }).click(); await expect(page.getByText("Gross pay calculated from the approved inputs.")).toBeVisible(); await expect(page.getByText(name, { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Send for review" }).click(); await expect(page.getByText("Pay period sent for review.")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click(); await expect(page.getByText("Pay period approved.")).toBeVisible();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export CSV" }).click(); const exported = await download; expect(exported.suggestedFilename()).toMatch(/^payroll-/);
  const content = await readFile((await exported.path())!, "utf8");
  const [header, line] = content.trim().split(/\r?\n/).map(row => row.replace(/^\uFEFF/, "").split(","));
  expect(line![header!.indexOf("staff_name")]).toBe(name);
  expect(Number(line![header!.indexOf("regular_minutes")])).toBeGreaterThan(0);
  expect(Number(line![header!.indexOf("gross_minor")])).toBeGreaterThan(0);
  const periods = (await (await page.request.get("/api/v1/payroll/periods")).json()).items; expect(periods[0].status).toBe("exported");
  const time = await (await page.request.get("/api/v1/time")).json(); expect(time.entries).toHaveLength(1); expect(time.entries[0].approvalStatus).toBe("approved");
});

test("pausing a plan withdraws its generated published visits without billing them", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now(), name = `Plan Owner ${suffix}`;
  await post(page, "/auth/register", { name, businessName: `Plan Business ${suffix}`, email: `plan-${suffix}@example.test`, password });
  await prepare(page, `Plan Business ${suffix}`); await post(page, "/onboarding/complete", { publishWebsite: false });
  const owner = (await (await page.request.get("/api/v1/staff")).json()).items.find((p: { name: string }) => p.name === name);
  const customer = (await post(page, "/customers", { name: `Plan customer ${suffix}`, address: "42 Test Lane", customerType: "residential" })).item;
  const service = (await (await page.request.get("/api/v1/services")).json()).items.find((s: { key: string }) => s.key === "recurring-cleanup");
  const db = createDatabase(process.env.DATABASE_URL!);
  try {
    const [location] = await db.select().from(schema.serviceLocations).where(eq(schema.serviceLocations.customerId, customer.id));
    await db.insert(schema.customerAssets).values({ tenantId: customer.tenantId, customerId: customer.id, serviceLocationId: location!.id, assetTypeKey: "pet", name: "Buddy", status: "active", customFields: {} });
    const plan = (await post(page, "/service-plans", { customerId: customer.id, serviceId: service.id, serviceLocationId: location!.id, frequency: "weekly", startDate: today(), technicianId: owner.id })).item;
    const result = await generateRecurringJobs(db, { tenantId: plan.tenantId, planId: plan.id, through: addCalendarDays(today(), 28) }); expect(result.invalid).toEqual([]);
    const visits = await db.select().from(schema.jobs).where(eq(schema.jobs.servicePlanId, plan.id)).orderBy(schema.jobs.scheduledDate); expect(visits.length).toBeGreaterThanOrEqual(4);
    const route = (await post(page, "/routes", { date: today(), technicianId: owner.id })).item; await post(page, `/routes/${route.id}/publish`, {});
    const fieldWork = (await (await page.request.get(`/api/v1/field/jobs/${visits[0]!.id}`)).json()).item;
    await page.goto(`/app/service-plans/${plan.id}`); await expect(page.getByRole("combobox", { name: "Usual field worker", exact: true })).toHaveValue(owner.id);
    page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Pause plan", exact: true }).click();
    await expect(page.getByRole("button", { name: "Resume plan", exact: true })).toBeVisible();
    const withdrawn = await db.select().from(schema.jobs).where(eq(schema.jobs.servicePlanId, plan.id)); expect(withdrawn.every(j => j.status === "canceled" && !j.billable && j.assignedRouteId === null)).toBe(true);
    expect((await db.select().from(schema.routeStops).where(eq(schema.routeStops.routePlanId, route.id))).every(s => s.status === "removed")).toBe(true);
    await page.goto("/field/today"); await expect(page.getByRole("link", { name: /Open job/ })).toHaveCount(0);
    const complete = await page.request.post(`/api/v1/field/jobs/${visits[0]!.id}/complete`, { data: { checklist: Object.fromEntries(fieldWork.checklist.map((item: { key: string }) => [item.key, true])), clientOperationId: crypto.randomUUID() } }); expect(complete.status()).toBe(409);
    expect(await db.select().from(schema.jobInvoiceLinks).where(eq(schema.jobInvoiceLinks.jobId, visits[0]!.id))).toHaveLength(0);
    expect((await generateRecurringJobs(db, { tenantId: plan.tenantId, planId: plan.id, through: addCalendarDays(today(), 28) })).created).toBe(0);
  } finally { await closeDatabase(db); }
});
