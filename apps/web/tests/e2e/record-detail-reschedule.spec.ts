import { expect, test, type Page } from "@playwright/test";
import { closeDatabase, createDatabase, seedIds, schema } from "@modular-crm/db";
import { and, eq } from "drizzle-orm";

async function signIn(page: Page, email: string) {
  await page.goto("/login"); await page.getByLabel("Email address").fill(email); await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/app\/dashboard$/);
}
test("customer payment history offers receipts only for settled payments", async ({ page }) => {
  const db = createDatabase(process.env.DATABASE_URL!);
  const ownedPayments: string[] = [];
  try {
    for (const status of ["pending", "failed"]) {
      const [payment] = await db.insert(schema.payments).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter,status,amountMinor: status === "pending" ? 123n : 234n,currency: "USD",sourceType: "mock",idempotencyKey: crypto.randomUUID(),recordedByActorType: "staff" }).returning();
      ownedPayments.push(payment!.id);
    }
    await signIn(page,"owner@happyyards.test");
    await page.goto(`/app/customers/${seedIds.carter}`);
    const payments = page.getByRole("region",{ name: "Payments",exact: true });
    await expect(payments).toContainText("Pending"); await expect(payments).toContainText("Failed");
    await expect(payments).toContainText("$1.23"); await expect(payments).toContainText("$2.34");
    for (const id of ownedPayments) await expect(payments.locator(`a[href='/app/documents/receipt/${id}']`)).toHaveCount(0);
    await expect(payments.locator(`a[href='/app/documents/receipt/${seedIds.happyPayment}']`)).toHaveText("View receipt");
  } finally {
    for (const id of ownedPayments) await db.delete(schema.payments).where(and(eq(schema.payments.tenantId,seedIds.happyTenant),eq(schema.payments.id,id)));
    await closeDatabase(db);
  }
});
for (const role of ["owner", "office"] as const) {
  for (const resource of ["customers", "jobs", "invoices", "leads"] as const) {
    test(`${role} opens and edits the ${resource} full detail page in its permitted scope`, async ({ page }, testInfo) => {
      await signIn(page, role === "owner" ? "owner@happyyards.test" : "manager@happyyards.test");
      if (role === "office") await page.setViewportSize({ width: 390, height: 844 });
      const marker = `${resource} detail ${crypto.randomUUID()}`;
      const customerResponse = await page.request.post("/api/v1/customers", { data: { name: marker, email: "detail@example.test", address: "111 Detail Lane" } }); expect(customerResponse.status()).toBe(201);
      const customer = (await customerResponse.json()).item;
      const payload = resource === "jobs" ? { customerId: customer.id, serviceName: "Yard cleanup", scheduledDate: "2026-11-16", notes: marker } : resource === "invoices" ? { customerId: customer.id, description: marker, totalCents: 12345 } : { name: marker, email: "detail@example.test" };
      const response = resource === "customers" ? customerResponse : await page.request.post(`/api/v1/${resource}`, { data: payload });
      expect(response.status()).toBe(201); const record = (await response.json()).item;
      await page.goto(`/app/${resource}/${record.id}`);
      const summary = page.getByRole("region", { name: "Record summary" }); await expect(summary).toBeVisible();
      await expect(page.getByRole("region", { name: "History", exact: true })).toContainText("Record created");
      await expect(page.getByText(/Total Cents|tenant_id|Tenant Id|organization_location_id/)).toHaveCount(0);
      if (resource === "customers") { await expect(page.getByRole("region", { name: "Properties", exact: true })).toContainText("111 Detail Lane"); await expect(page.getByRole("region", { name: "Jobs", exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Invoices", exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Payments", exact: true })).toBeVisible(); }
      if (resource === "jobs") { await expect(page.getByRole("region", { name: "Visits", exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Notes", exact: true })).toContainText(marker); await expect(page.getByRole("region", { name: "Photos", exact: true })).toBeVisible(); }
      if (resource === "invoices") { await expect(summary).toContainText("$123.45"); await expect(page.getByRole("region", { name: "Invoice lines", exact: true })).toContainText(marker); await expect(page.getByRole("region", { name: "Payment history", exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Refunds", exact: true })).toBeVisible(); }
      await page.getByRole("button", { name: `Edit ${resource.slice(0,-1)}`, exact: true }).click();
      const dialog = page.getByRole("dialog");
      if (resource === "customers") await dialog.getByLabel("Name", { exact: true }).fill(`${marker} revised`);
      else if (resource === "jobs") await dialog.getByRole("textbox", { name: "Office notes", exact: true }).fill(`${marker} revised`);
      else if (resource === "leads") await dialog.getByLabel("Source", { exact: true }).fill("Customer referral");
      else { await dialog.getByLabel("Description", { exact: true }).fill(`${marker} revised`); await dialog.getByLabel("Line description", { exact: true }).fill(`${marker} revised`); await dialog.getByLabel("Unit price", { exact: true }).fill("125.50"); }
      const saved = page.waitForResponse((response) => response.url().endsWith(`/api/v1/${resource}/${record.id}`) && response.request().method() === "PATCH");
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click(); expect((await saved).status()).toBe(200);
      await expect(dialog).toHaveCount(0); await expect(page.getByRole("region", { name: "History", exact: true })).toContainText("Details updated");
      const checked = (await (await page.request.get(`/api/v1/${resource}/${record.id}/detail`)).json()).item;
      expect(resource === "invoices" ? Number(checked.totalCents) : resource === "jobs" ? checked.internalSummary : resource === "leads" ? checked.source : checked.name).toBe(resource === "invoices" ? 12550 : resource === "leads" ? "Customer referral" : `${marker} revised`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      if (role === "office") await page.screenshot({ path: testInfo.outputPath(`${resource}-phone.png`), fullPage: true });
    });
  }
}

test("office reschedules dispatched work, publishes the new route, reassigns and cancels with a recorded reason", async ({ page }) => {
  const db = createDatabase(process.env.DATABASE_URL!); const ownedRoutes: string[] = [];
  let addedScope = false;
  await signIn(page, "manager@happyyards.test");
  try {
    await db.insert(schema.membershipLocationScopes).values({ tenantId: seedIds.happyTenant, membershipId: seedIds.caseyMembership, locationId: seedIds.augusta }); addedScope = true;
    const create = await page.request.post("/api/v1/jobs", { data: { customerId: seedIds.carter, serviceName: "Yard cleanup", scheduledDate: "2026-11-21" } }); expect(create.status()).toBe(201); const id = (await create.json()).item.id;
    expect((await page.request.post(`/api/v1/jobs/${id}/assign`, { data: { technicianId: seedIds.terryMembership } })).ok()).toBeTruthy();
    async function publish(date: string) { const route = await page.request.post("/api/v1/routes", { data: { technicianId: seedIds.terryMembership, date } }); expect(route.status()).toBe(201); const routeId = (await route.json()).item.id; ownedRoutes.push(routeId); expect((await page.request.post(`/api/v1/routes/${routeId}/publish`, { data: {} })).ok()).toBeTruthy(); return routeId; }
    const old = await publish("2026-11-21"); await page.goto(`/app/jobs/${id}`);
    await page.getByRole("button", { name: "Reschedule", exact: true }).click(); await page.getByLabel("New service date").fill("2026-11-22");
    const rescheduled = page.waitForResponse((response) => response.url().endsWith(`/jobs/${id}/reschedule`) && response.request().method() === "POST");
    await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click(); expect((await rescheduled).status()).toBe(200); await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Record summary" })).toContainText("Scheduled"); await expect(page.getByRole("region", { name: "Visits", exact: true })).toContainText("Removed after a schedule or assignment change");
    const next = await publish("2026-11-22"); expect(next).not.toBe(old);
    expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id,id)))[0]).toMatchObject({ assignedRouteId: next, scheduledDate: "2026-11-22", status: "dispatched" });
    await page.reload(); await page.getByRole("button", { name: "Reassign", exact: true }).click(); await page.getByRole("combobox", { name: "Technician", exact: true }).selectOption(seedIds.caseyMembership);
    const reassigned = page.waitForResponse((response) => response.url().endsWith(`/jobs/${id}/reassign`) && response.request().method() === "POST"); await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click(); expect((await reassigned).status()).toBe(200); await expect(page.getByRole("dialog")).toHaveCount(0);
    const assignments = await db.select().from(schema.jobAssignments).where(eq(schema.jobAssignments.jobId,id));
    expect(assignments.filter((assignment) => !assignment.removedAt).map((assignment) => assignment.membershipId)).toEqual([seedIds.caseyMembership]);
    expect(assignments.find((assignment) => assignment.membershipId === seedIds.terryMembership)!.removedAt).not.toBeNull();
    await page.getByRole("button", { name: "Cancel job", exact: true }).click(); await page.getByRole("textbox", { name: "Cancellation reason", exact: true }).fill("Customer is away this week");
    const canceled = page.waitForResponse((response) => response.url().endsWith(`/jobs/${id}/cancel`) && response.request().method() === "POST"); await page.getByRole("button", { name: "Confirm cancellation", exact: true }).click(); expect((await canceled).status()).toBe(200);
    await expect(page.getByRole("region", { name: "History", exact: true })).toContainText("Customer is away this week"); await expect(page.getByRole("button", { name: "Reschedule", exact: true })).toHaveCount(0);
    expect(await db.select().from(schema.domainEvents).where(and(eq(schema.domainEvents.entityId,id),eq(schema.domainEvents.eventType,"job.canceled")))).toHaveLength(1);
  } finally {
    // Only this regression's routes: do not leave extra work in later seeded field-day tests.
    for (const id of ownedRoutes) await db.transaction(async (tx) => { await tx.delete(schema.routeStops).where(and(eq(schema.routeStops.tenantId,seedIds.happyTenant),eq(schema.routeStops.routePlanId,id))); await tx.update(schema.jobs).set({ assignedRouteId:null }).where(and(eq(schema.jobs.tenantId,seedIds.happyTenant),eq(schema.jobs.assignedRouteId,id))); await tx.delete(schema.routePlans).where(and(eq(schema.routePlans.tenantId,seedIds.happyTenant),eq(schema.routePlans.id,id))); });
    if (addedScope) await db.delete(schema.membershipLocationScopes).where(and(eq(schema.membershipLocationScopes.tenantId,seedIds.happyTenant),eq(schema.membershipLocationScopes.membershipId,seedIds.caseyMembership),eq(schema.membershipLocationScopes.locationId,seedIds.augusta)));
    await closeDatabase(db);
  }
});

test("owner can see another branch's related invoice while location-limited office cannot open or expose it", async ({ page }) => {
  const db = createDatabase(process.env.DATABASE_URL!);
  const marker = `Outside-branch-${crypto.randomUUID()}`;
  const [invoice] = await db.insert(schema.invoices).values({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.northAugusta, customerId: seedIds.carter, invoiceNumber: marker, status: "draft", currency: "USD", totalMinor: 1234n, balanceMinor: 1234n }).returning();
  try {
    await signIn(page, "owner@happyyards.test");
    await page.goto(`/app/customers/${seedIds.carter}`);
    await expect(page.getByRole("region", { name: "Invoices", exact: true })).toContainText(marker);
    await page.goto(`/app/invoices/${invoice!.id}`); await expect(page.getByRole("region", { name: "Record summary" })).toContainText("$12.34");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, "manager@happyyards.test");
    const auth = await (await page.request.get("/api/v1/auth/me")).json();
    expect(auth.user.role).toBe("office");
    const locations = await (await page.request.get("/api/v1/organization/locations")).json();
    expect(locations.items.map((location: { id: string }) => location.id)).toEqual([seedIds.augusta]);
    await page.goto(`/app/customers/${seedIds.carter}`);
    await expect(page.getByRole("region", { name: "Invoices", exact: true })).not.toContainText(marker);
    const denied = await page.request.get(`/api/v1/invoices/${invoice!.id}/detail`); expect(denied.status()).toBe(404);
    await page.goto(`/app/invoices/${invoice!.id}`); await expect(page.getByRole("heading", { name: "Invoice unavailable", exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Record summary" })).toHaveCount(0);
  } finally { await db.delete(schema.invoices).where(and(eq(schema.invoices.tenantId,seedIds.happyTenant),eq(schema.invoices.id,invoice!.id))); await closeDatabase(db); }
});
