import { expect, test, type Page } from "@playwright/test";
import { closeDatabase, createDatabase, schema, seedIds } from "@modular-crm/db";
import { and, eq, sql } from "drizzle-orm";
import { priceDocument } from "@modular-crm/domain";
import { generateRecurringJobs } from "../../../worker/src/recurring-db";
import { addCalendarDays } from "../../../worker/src/recurrence";
import { enqueueInvoiceReminders } from "../../../worker/src/invoice-reminders-db";
import { chooseStaffRecord } from "./staff-picker";

async function signIn(page: Page, email = "owner@happyyards.test") {
  await page.goto("/login"); await page.getByLabel("Email address").fill(email); await page.getByLabel("Password").fill("Demo12345!"); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(email.startsWith("tech") ? /\/field\/today$/ : /\/app\/dashboard$/);
}
test("recurring estimate setup charge is billed once across two legally completed field visits", async ({ page, browser }, testInfo) => {
  test.setTimeout(150_000);
  const db = createDatabase(process.env.DATABASE_URL!), field = await browser.newPage(); let planId: string | undefined; const routes: string[] = [];
  await signIn(page);
  const settings = (await (await page.request.get("/api/v1/settings")).json()).item;
  try {
    const customerName = `Automatic billing customer ${crypto.randomUUID()}`;
    const customer = await page.request.post("/api/v1/customers", { data: { name: customerName, address: "123 Billing Lane" } }); expect(customer.status(), await customer.text()).toBe(201);
    expect((await page.request.patch("/api/v1/settings", { data: { defaultTaxRateBasisPoints: 0 } })).ok()).toBe(true);
    const catalog = (await (await page.request.get("/api/v1/services")).json()).items;
    const service = catalog.find((item: { serviceType: string }) => item.serviceType === "recurring"); expect(service).toBeTruthy();
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/app/estimates?new=1");
    const dialog = page.getByRole("dialog", { name: "New estimate" }); await chooseStaffRecord(page, "Customer", customerName); await dialog.getByLabel("What is included?").fill(`Automatic billing ${crypto.randomUUID()}`);
    const setup = dialog.getByRole("group", { name: "Line 1", exact: true }); await setup.getByLabel("Line description").fill("Initial cleanup"); await setup.getByLabel("Unit price").fill("50"); await expect(setup.getByLabel("Charge", { exact: true })).toHaveValue("once"); await setup.getByLabel("Charge", { exact: true }).selectOption("once");
    await dialog.getByRole("button", { name: "Add a line", exact: true }).click();
    await chooseStaffRecord(page, "Catalog service 2", service.name);
    const weekly = dialog.getByRole("group", { name: "Line 2", exact: true }); await weekly.getByLabel("Unit price").fill("25"); await expect(weekly.getByLabel("Charge", { exact: true })).toHaveValue("every_visit"); await expect(setup.getByLabel("Charge", { exact: true })).toHaveValue("once");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("recurring-charges-phone.png"), fullPage: true });
    const created = page.waitForResponse(response => response.url().endsWith("/api/v1/estimates") && response.request().method() === "POST"); await dialog.getByRole("button", { name: "Create estimate", exact: true }).click(); const create = await created; expect(create.status(), await create.text()).toBe(201); const estimateId = (await create.json()).item.id;
    expect((await page.request.post(`/api/v1/estimates/${estimateId}/send`, { data: {} })).ok()).toBe(true);
    expect((await page.request.post(`/api/v1/estimates/${estimateId}/approve`, { data: {} })).ok()).toBe(true);
    const [plan] = await db.select().from(schema.servicePlans).where(and(eq(schema.servicePlans.tenantId, seedIds.happyTenant), sql`${schema.servicePlans.pricingSnapshot}->>'estimateId' = ${estimateId}`)); planId = plan!.id;
    expect(plan!.pricingSnapshot).toMatchObject({ totalMinor: 2500, items: [{ charge: "every_visit" }] });
    expect((await page.request.post(`/api/v1/estimates/${estimateId}/invoice`, { data: {} })).status()).toBe(409);
    const generated = await generateRecurringJobs(db, { tenantId: seedIds.happyTenant, planId, through: addCalendarDays(plan!.effectiveFrom, 7) }); expect(generated.invalid).toHaveLength(0);
    const work = await db.select().from(schema.jobs).where(eq(schema.jobs.servicePlanId, planId)).orderBy(schema.jobs.scheduledDate); expect(work.length).toBeGreaterThanOrEqual(2);
    for (const job of work.slice(0, 2)) {
      expect((await page.request.post(`/api/v1/jobs/${job.id}/assign`, { data: { technicianId: seedIds.terryMembership, scheduledDate: job.scheduledDate } })).ok()).toBe(true);
      const createdRoute = await page.request.post("/api/v1/routes", { data: { date: job.scheduledDate, technicianId: seedIds.terryMembership } }); expect(createdRoute.status(), await createdRoute.text()).toBe(201); const route = (await createdRoute.json()).item; routes.push(route.id);
      expect((await page.request.post(`/api/v1/routes/${route.id}/publish`, { data: {} })).ok()).toBe(true);
    }
    await signIn(field, "tech@happyyards.test");
    for (const [index, job] of work.slice(0, 2).entries()) {
      await field.goto(`/field/job/${job.id}`); await field.getByRole("button", { name: "On my way", exact: true }).click(); await expect(field.getByText("En Route", { exact: true })).toBeVisible(); await field.getByRole("button", { name: "Start job", exact: true }).click(); await expect(field.getByText("In Progress", { exact: true })).toBeVisible();
      await field.getByLabel(/I confirmed the correct property/).check(); await field.getByLabel(/I left gates and access points secure/).check();
      const synced = field.waitForResponse(response => response.url().endsWith(`/api/v1/field/jobs/${job.id}/complete`) && response.request().method() === "POST");
      await field.getByRole("button", { name: "Complete job", exact: true }).click(); const completion = await synced; expect(completion.ok(), await completion.text()).toBe(true); await expect(field.getByText("Completed", { exact: true })).toBeVisible();
      const [link] = await db.select().from(schema.jobInvoiceLinks).where(eq(schema.jobInvoiceLinks.jobId, job.id)); expect(link).toBeTruthy();
      await page.goto(`/app/invoices/${link!.invoiceId}`); await expect(page.getByRole("region", { name: "Price breakdown", exact: true })).toContainText(index === 0 ? "$75.00" : "$25.00");
      const lines = page.getByRole("region", { name: "Invoice lines", exact: true }); if (index === 0) await expect(lines).toContainText("Initial cleanup"); else await expect(lines).not.toContainText("Initial cleanup");
    }
  } finally {
    if (planId) await db.update(schema.servicePlans).set({ status: "canceled" }).where(eq(schema.servicePlans.id, planId));
    for (const routeId of routes) await db.transaction(async tx => { await tx.delete(schema.routeStops).where(eq(schema.routeStops.routePlanId, routeId)); await tx.update(schema.jobs).set({ assignedRouteId: null }).where(eq(schema.jobs.assignedRouteId, routeId)); await tx.delete(schema.routePlans).where(eq(schema.routePlans.id, routeId)); });
    expect((await page.request.patch("/api/v1/settings", { data: { defaultTaxRateBasisPoints: settings.defaultTaxRateBasisPoints ?? 0 } })).ok()).toBe(true);
    await field.close(); await closeDatabase(db);
  }
});

test("owner bills last month's finished work for two customers and a rerun creates nothing", async ({ page }, testInfo) => {
  test.setTimeout(90_000); await signIn(page); const db = createDatabase(process.env.DATABASE_URL!);
  const preview = (await (await page.request.get("/api/v1/billing/finished-work")).json()); const names: string[] = [], ids: string[] = [];
  try {
    for (const amount of [1100, 2200]) {
      const name = `Batch customer ${crypto.randomUUID()}`; names.push(name); const response = await page.request.post("/api/v1/customers", { data: { name, address: "123 Billing Lane" } }); expect(response.status()).toBe(201); const customer = (await response.json()).item; ids.push(customer.id);
      const [location] = await db.select().from(schema.serviceLocations).where(eq(schema.serviceLocations.customerId, customer.id));
      await db.insert(schema.jobs).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: customer.id, serviceLocationId: location!.id, serviceId: seedIds.weeklyService, status: "completed", actualCompletedAt: new Date(`${preview.from.slice(0, 7)}-15T12:00:00Z`), priceSnapshot: { ...priceDocument([{ description: "Recorded finished visit", quantity: "1", unitAmountMinor: amount }]), currency: "USD" } });
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/app/invoices"); await page.getByRole("button", { name: "Bill finished work", exact: true }).click();
    const billing = page.getByRole("region", { name: "Bill finished work", exact: true }); await expect(billing.getByLabel("Completed from")).toHaveValue(preview.from);
    await expect(billing.getByRole("checkbox", { name: names[1], exact: true })).toBeVisible();
    for (const checkbox of await billing.getByRole("checkbox").all()) await checkbox.uncheck();
    for (const name of names) await billing.getByRole("checkbox", { name, exact: true }).check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath("batch-invoices-phone.png"), fullPage: true });
    await billing.getByRole("button", { name: "Create 2 invoices", exact: true }).click(); await expect(billing.getByRole("status", { name: "Billing progress" })).toHaveText("Created 2 draft invoices for 2 visits.");
    const after = (await (await page.request.get("/api/v1/billing/finished-work")).json()).items;
    expect(after.filter((row: { customerId: string }) => ids.includes(row.customerId))).toHaveLength(0);
    for (const customerId of ids) { const repeated = await page.request.post("/api/v1/billing/finished-work", { data: { from: preview.from, through: preview.through, customerId, idempotencyKey: crypto.randomUUID() } }); expect(repeated.ok(), await repeated.text()).toBe(true); expect((await repeated.json()).created).toBe(0); }
  } finally { await closeDatabase(db); }
});

test("completed one-time job opens its itemized invoice and simultaneous requests cannot bill it twice", async ({ page }) => {
  await signIn(page); const db = createDatabase(process.env.DATABASE_URL!);
  try {
    const response = await page.request.post("/api/v1/customers", { data: { name: `One-time billing customer ${crypto.randomUUID()}`, address: "123 Billing Lane" } }); expect(response.status(), await response.text()).toBe(201);
    const customer = (await response.json()).item;
    const [location] = await db.select().from(schema.serviceLocations).where(eq(schema.serviceLocations.customerId, customer.id));
    const pricing = priceDocument([{ description: "Finished repair", quantity: "1", unitAmountMinor: 4000 }, { description: "Parts supplied", quantity: "2", unitAmountMinor: 500 }]);
    const [job] = await db.insert(schema.jobs).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId: customer.id, serviceLocationId: location!.id, serviceId: seedIds.weeklyService, status: "completed", actualCompletedAt: new Date(), priceSnapshot: { ...pricing, currency: "USD" } }).returning();
    const responses = await Promise.all([page.request.post(`/api/v1/jobs/${job!.id}/invoice`, { data: {} }), page.request.post(`/api/v1/jobs/${job!.id}/invoice`, { data: {} })]);
    expect(responses.map(response => response.status()).sort()).toEqual([200, 201]);
    const results = await Promise.all(responses.map(response => response.json())); expect(results[0].item.id).toBe(results[1].item.id);
    await page.goto(`/app/jobs/${job!.id}`); await page.getByRole("button", { name: "Create invoice", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/app/invoices/${results[0].item.id}$`));
    await expect(page.getByRole("region", { name: "Price breakdown", exact: true })).toContainText("$50.00");
    const lines = page.getByRole("region", { name: "Invoice lines", exact: true }); await expect(lines).toContainText("Finished repair"); await expect(lines).toContainText("Parts supplied");
    const saved = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, results[0].item.id)); expect(saved).toHaveLength(2); expect(saved.every(line => line.jobId === job!.id)).toBe(true);
    expect(await db.select().from(schema.jobInvoiceLinks).where(eq(schema.jobInvoiceLinks.jobId, job!.id))).toHaveLength(1);
  } finally { await closeDatabase(db); }
});

test("overdue invoice sends exactly one Mailpit reminder and none after payment", async ({ page }) => {
  test.setTimeout(120_000); await signIn(page); const db = createDatabase(process.env.DATABASE_URL!); const mailpit = process.env.MAILPIT_API_URL ?? "http://localhost:8025";
  const prior = (await (await page.request.get("/api/v1/settings")).json()).item;
  const email = `overdue-${crypto.randomUUID()}@example.test`, name = `Overdue customer ${crypto.randomUUID()}`;
  try {
    expect((await page.request.post("/api/v1/connections/mock-communication/disconnect", { data: {} })).ok()).toBe(true);
    const created = await page.request.post("/api/v1/customers", { data: { name, email } }); expect(created.status()).toBe(201); const customerId = (await created.json()).item.id;
    const invoice = await page.request.post("/api/v1/invoices", { data: { customerId, description: "Unpaid invoice reminder", totalCents: 3000, dueDate: "2026-01-01" } }); expect(invoice.status()).toBe(201); const id = (await invoice.json()).item.id;
    expect((await page.request.post(`/api/v1/invoices/${id}/issue`, { data: {} })).ok()).toBe(true);
    await page.goto("/app/settings"); const settings = page.getByRole("form", { name: "Unpaid invoice reminders" }); await settings.getByRole("checkbox", { name: "Remind customers about unpaid invoices", exact: true }).check(); await settings.getByRole("button", { name: "Save invoice settings", exact: true }).click(); await expect(settings.getByText("Invoice payment and reminder settings saved.", { exact: true })).toBeVisible();
    const reminderMail = async () => { const data = await (await page.request.get(`${mailpit}/api/v1/messages`)).json(); return data.messages.filter((item: { To: { Address: string }[]; Subject: string }) => item.To.some(to => to.Address === email) && item.Subject.startsWith("Reminder: invoice ")); };
    await expect.poll(async () => (await reminderMail()).length, { timeout: 60_000 }).toBe(1);
    const mail = (await reminderMail())[0]; const content = await (await page.request.get(`${mailpit}/api/v1/message/${mail.ID}`)).json(); expect(content.Text).toContain("$30.00"); expect(content.Text).toContain(`/portal/billing/${id}`);
    await page.goto(`/app/invoices/${id}`); await expect(page.getByText("Unpaid invoice reminder sent", { exact: true })).toBeVisible();
    expect((await page.request.post(`/api/v1/invoices/${id}/pay`, { data: { amountCents: 3000, method: "cash", idempotencyKey: crypto.randomUUID() } })).ok()).toBe(true);
    await enqueueInvoiceReminders(db, new Date(Date.now() + 8 * 86400000));
    expect(await db.select().from(schema.outboundMessages).where(and(eq(schema.outboundMessages.invoiceId, id), eq(schema.outboundMessages.templateKey, "invoice_overdue")))).toHaveLength(1); expect(await reminderMail()).toHaveLength(1);
  } finally {
    expect((await page.request.patch("/api/v1/settings", { data: { overdueReminders: prior.overdueReminders ?? { enabled: false, firstAfterDays: 3, intervalDays: 7, maxReminders: 3 } } })).ok()).toBe(true);
    expect((await page.request.post("/api/v1/connections/mock-communication/connect", { data: {} })).ok()).toBe(true); await closeDatabase(db);
  }
});

test("Payment due saves independently of reminders and applies to no-terms batch issuance, not historical invoices", async ({ page, browser }, testInfo) => {
  await signIn(page); const db = createDatabase(process.env.DATABASE_URL!), office = await browser.newPage();
  const prior = (await (await page.request.get("/api/v1/settings")).json()).item;
  try {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/app/settings");
    const settings = page.getByRole("form", { name: "Unpaid invoice reminders" });
    await expect(settings.getByLabel("Payment due", { exact: true })).toHaveValue(String(prior.paymentDueDays));
    await settings.getByRole("checkbox", { name: "Remind customers about unpaid invoices", exact: true }).uncheck();
    await settings.getByLabel("Payment due", { exact: true }).selectOption("7");
    await settings.getByRole("button", { name: "Save invoice settings", exact: true }).click();
    await expect(settings.getByText("Invoice payment and reminder settings saved.", { exact: true })).toBeVisible();
    await page.reload(); await expect(settings.getByLabel("Payment due", { exact: true })).toHaveValue("7");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("payment-due-phone.png"), fullPage: true });
    const response = await page.request.post("/api/v1/customers", { data: { name: `Payment due customer ${crypto.randomUUID()}`, address: "123 Billing Lane" } }); expect(response.status(), await response.text()).toBe(201); const customerId = (await response.json()).item.id;
    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, customerId)); expect(customer!.paymentTermsDays).toBeNull();
    const [location] = await db.select().from(schema.serviceLocations).where(eq(schema.serviceLocations.customerId, customerId));
    await db.insert(schema.jobs).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.augusta, customerId, serviceLocationId: location!.id, serviceId: seedIds.weeklyService, status: "completed", actualCompletedAt: new Date("2026-08-15T12:00:00Z"), priceSnapshot: { ...priceDocument([{ description: "Terms regression", quantity: "1", unitAmountMinor: 1000 }]), currency: "USD" } });
    const batch = await page.request.post("/api/v1/billing/finished-work", { data: { from: "2026-08-01", through: "2026-08-31", customerId, issue: true, idempotencyKey: crypto.randomUUID() } }); expect(batch.ok(), await batch.text()).toBe(true);
    const invoice = (await batch.json()).invoices[0]; expect(Date.parse(invoice.dueAt) - Date.parse(invoice.issuedAt)).toBe(7 * 86400000);
    await page.goto("/app/settings"); await settings.getByLabel("Payment due", { exact: true }).selectOption("0"); await settings.getByRole("button", { name: "Save invoice settings", exact: true }).click(); await expect(settings.getByText("Invoice payment and reminder settings saved.", { exact: true })).toBeVisible();
    expect((await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.id)))[0]!.dueAt!.toISOString()).toBe(invoice.dueAt);
    await signIn(office, "manager@happyyards.test"); await office.goto("/app/settings");
    await expect(office.getByLabel("Payment due", { exact: true })).toHaveValue("0"); await expect(office.getByLabel("Payment due", { exact: true })).toBeDisabled();
    expect((await office.request.patch("/api/v1/settings", { data: { paymentDueDays: 30 } })).status()).toBe(403);
  } finally {
    expect((await page.request.patch("/api/v1/settings", { data: { paymentDueDays: prior.paymentDueDays, overdueReminders: prior.overdueReminders } })).ok()).toBe(true);
    await office.close(); await closeDatabase(db);
  }
});
