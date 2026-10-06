import { expect, test, type Page } from "@playwright/test";
import { seedIds } from "@modular-crm/db";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}
async function issuedInvoice(page: Page, totalCents: number) {
  const create = await page.request.post("/api/v1/invoices", { data: { customerId: seedIds.carter, description: "Staff payment regression", totalCents } });
  expect(create.status()).toBe(201);
  const { item } = await create.json();
  const issue = await page.request.post(`/api/v1/invoices/${item.id}/issue`, { data: {} });
  expect(issue.status()).toBe(200); return item;
}
test("owner records a check and sees the actual method and reference on payment and receipt", async ({ page }) => {
  await signIn(page, "owner@happyyards.test");
  const invoice = await issuedInvoice(page, 2468);
  await page.goto(`/app/invoices/${invoice.id}`);
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Record a payment" });
  await expect(dialog).toContainText("This does not charge a card");
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("24.68");
  await dialog.getByLabel("How the customer paid").selectOption({ label: "Check" });
  await dialog.getByLabel("Reference (optional)").fill("CHK-8042");
  const recorded = page.waitForResponse((response) => response.url().endsWith(`/invoices/${invoice.id}/pay`) && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Record payment", exact: true }).click();
  const response = await recorded; expect(response.status()).toBe(200);
  const { item } = await response.json();
  expect(item).toMatchObject({ sourceType: "manual", recordedMethod: "check", reference: "CHK-8042", amountMinor: 2468 });
  const retry = await page.request.post(`/api/v1/invoices/${invoice.id}/pay`, { data: response.request().postDataJSON() });
  expect(retry.status()).toBe(200); expect(await retry.json()).toMatchObject({ duplicate: true, item: { id: item.id } });
  await expect(page.getByRole("region", { name: "Payment history" })).toContainText("Check · Reference: CHK-8042");
  await page.getByRole("link", { name: "View receipt", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Payment receipt", exact: true })).toBeVisible();
  await expect(page.getByText("Payment received · Check · Reference: CHK-8042", { exact: true })).toBeVisible();
  await page.goto("/app/payments");
  const row = page.locator(`tr[data-record-id="${item.id}"]`);
  await expect(row.getByRole("cell", { name: "Check", exact: true })).toBeVisible();
  await expect(row.getByRole("cell", { name: "CHK-8042", exact: true })).toBeVisible();
});
test("Morgan's searchable invoice picker exposes only open Augusta invoices and prefills the balance", async ({ page }) => {
  await signIn(page, "manager@happyyards.test");
  const invoice = await issuedInvoice(page, 1765);
  const permitted = await page.request.get("/api/v1/invoices?open=1"); expect(permitted.status()).toBe(200);
  const { items } = await permitted.json();
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) { expect(item.locationName).toBe("Augusta Branch"); expect(Number(item.openBalanceCents)).toBeGreaterThan(0); }
  for (const id of [seedIds.franchiseEastInvoice, seedIds.franchiseWestInvoice, seedIds.cleanInvoice, seedIds.happyInvoice]) expect(items.some((item: { id: string }) => item.id === id)).toBe(false);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/app/payments?new=1");
  const dialog = page.getByRole("dialog", { name: "Record a payment" });
  await expect(dialog.getByText(/Invoice ID/)).toHaveCount(0);
  const picker = dialog.getByRole("combobox", { name: "Invoice", exact: true });
  await picker.fill("HY-E-1001");
  await expect(dialog.getByRole("listbox", { name: "Invoice choices" }).getByRole("option")).toHaveCount(0);
  await expect(dialog.getByText("No matches. Try another name or detail.")).toBeVisible();
  await picker.fill(invoice.number);
  await expect(dialog.getByRole("listbox", { name: "Invoice choices" }).getByRole("option", { name: new RegExp(`${invoice.number}.*Carter Household.*17.65.*Augusta Branch`) })).toBeVisible();
  await picker.press("ArrowDown");
  await expect(dialog.getByRole("listbox", { name: "Invoice choices" }).getByRole("option", { selected: true })).toContainText(invoice.number);
  await picker.press("Enter");
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("17.65");
  await dialog.getByLabel("How the customer paid").selectOption({ label: "Cash" });
  const paid = page.waitForResponse((response) => response.url().endsWith(`/invoices/${invoice.id}/pay`) && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Record payment", exact: true }).click();
  expect((await paid).status()).toBe(200);
  await expect(page.getByText("Payment recorded.", { exact: true })).toBeVisible();
});
test("staff search by contact details, select saved addresses and create real jobs and plans on a phone", async ({ page }) => {
  await signIn(page, "owner@happyyards.test");
  const suffix = crypto.randomUUID().slice(0, 8);
  const created = await page.request.post("/api/v1/customers", { data: { name: `Saved address ${suffix}`, email: `saved-${suffix}@example.test`, phone: `555-${suffix}`, address: `74 Saved Lane ${suffix}` } });
  expect(created.status()).toBe(201); const { item: customer } = await created.json();
  const detail = await page.request.get(`/api/v1/customers/${customer.id}`); const { item: saved } = await detail.json();
  expect(saved.locations).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 900 });
  for (const [resource, title] of [["jobs", "job"], ["service-plans", "service plan"]]) {
    await page.goto(`/app/${resource}?new=1`);
    const dialog = page.getByRole("dialog", { name: `New ${title}`, exact: true });
    const picker = dialog.getByRole("combobox", { name: "Customer", exact: true });
    await picker.fill(`saved-${suffix}@example.test`);
    await expect(dialog.getByRole("option", { name: new RegExp(`Saved address ${suffix}.*74 Saved Lane`) })).toBeVisible();
    await picker.press("ArrowDown"); await picker.press("Enter");
    await expect(dialog.getByLabel("Service address", { exact: true })).toHaveValue(saved.locations[0].id);
    await expect(dialog.getByLabel("Service address", { exact: true }).locator("option:checked")).toContainText(`74 Saved Lane ${suffix}`);
    await dialog.getByRole("combobox", { name: "Service", exact: true }).fill("Yard cleanup");
    await dialog.getByRole("option", { name: "Yard cleanup", exact: true }).click();
    if (resource === "service-plans") await dialog.getByLabel("Frequency").selectOption("weekly");
    else await dialog.getByLabel("Service day", { exact: true }).fill("2026-10-06");
    const request = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/${resource}` && response.request().method() === "POST");
    await dialog.getByRole("button", { name: `Create ${title}`, exact: true }).click();
    const response = await request; expect(response.status()).toBe(201);
    expect((await response.json()).item).toMatchObject({ customerId: customer.id, serviceLocationId: saved.locations[0].id });
  }
  await page.goto("/app/invoices?new=1");
  const invoiceDialog = page.getByRole("dialog", { name: "New invoice" });
  await invoiceDialog.getByRole("combobox", { name: "Customer", exact: true }).fill(`74 Saved Lane ${suffix}`);
  await invoiceDialog.getByRole("option", { name: new RegExp(`Saved address ${suffix}`) }).click();
  await invoiceDialog.getByLabel("Description", { exact: true }).fill("Saved-address work"); await invoiceDialog.getByLabel("Line description", { exact: true }).fill("Saved-address work");
  await invoiceDialog.getByLabel("Unit price", { exact: true }).fill("32.50");
  await invoiceDialog.getByRole("button", { name: "Create invoice", exact: true }).click();
  await expect(page.getByText("Invoice created.", { exact: true })).toBeVisible();
  await page.goto("/app/tickets?new=1");
  const dialog = page.getByRole("dialog", { name: "New ticket" });
  const picker = dialog.getByRole("combobox", { name: "Customer", exact: true });
  await picker.fill(`555-${suffix}`); await dialog.getByRole("option", { name: new RegExp(`Saved address ${suffix}`) }).click();
  await dialog.getByLabel("Subject", { exact: true }).fill("Saved-address question");
  await dialog.getByLabel("Details", { exact: true }).fill("Please confirm our next visit.");
  await dialog.getByLabel("Type", { exact: true }).selectOption("service");
  await dialog.getByRole("button", { name: "Create ticket", exact: true }).click();
  await expect(page.getByText("Ticket created.", { exact: true })).toBeVisible();
});

test("staff without manual recording permission retain read-only payment access", async ({ page }) => {
  await signIn(page, "manager@happyyards.test");
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch(); const identity = await response.json();
    identity.user.permissions = identity.user.permissions.filter((permission: string) => permission !== "payments.record_manual");
    await route.fulfill({ response, json: identity });
  });
  await page.goto("/app/payments?new=1");
  await expect(page.getByRole("heading", { name: "Payments", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Record a payment" })).toHaveCount(0);
  await page.goto(`/app/invoices/${seedIds.overdueInvoice}`);
  await expect(page.getByRole("heading", { name: "HY-1002", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment", exact: true })).toHaveCount(0);
});
