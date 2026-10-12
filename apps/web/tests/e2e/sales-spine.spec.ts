import { expect, test, type Page } from "@playwright/test";
import { createDatabase, closeDatabase, schema, seedIds } from "@modular-crm/db";
import { eq } from "drizzle-orm";
import { chooseStaffRecord } from "./staff-picker";

async function signIn(page: Page, email: string) {
  await page.goto("/login"); await page.getByLabel("Email address").fill(email); await page.getByLabel("Password").fill("Demo12345!"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(email.startsWith("customer@") ? /\/portal\/home$/ : /\/app\/dashboard$/);
}
async function property(page: Page, name: string, street: string) {
  await page.getByRole("button", { name: "Add service property", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add service property", exact: true });
  for (const [label, value] of [["Property name", name], ["Street address", street], ["City", "Augusta"], ["State or region", "GA"], ["Postal code", "30901"]]) await dialog.getByLabel(label!, { exact: true }).fill(value!);
  await dialog.getByLabel("Yard size", { exact: true }).selectOption("large");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByRole("region", { name: "Manage customer details" })).toContainText(street);
}

test("office turns a website message into a two-line biweekly estimate on the second property, emails it, and records verbal approval", async ({ page, browser }, testInfo) => {
  test.setTimeout(150_000);
  const unique = crypto.randomUUID(), name = `Sales prospect ${unique}`, email = `sales-${unique}@example.test`, title = `Biweekly quote ${unique}`;
  await page.goto("/site/happy-yards"); await page.getByLabel("Your name", { exact: true }).fill(name); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Your message", { exact: true }).fill("Please quote both our regular visit and a custom setup.");
  await page.getByRole("button", { name: "Send message", exact: true }).click(); await expect(page.getByText("Thanks! Your message was sent. We’ll be in touch soon.")).toBeVisible();
  // This organization-wide website is intentionally unassigned to a branch;
  // the owner can work its leads without granting branch managers wider access.
  await signIn(page, "owner@happyyards.test");
  const lead = (await (await page.request.get(`/api/v1/leads?search=${encodeURIComponent(email)}`)).json()).items[0]; expect(lead.name).toBe(name);
  await page.goto(`/app/leads/${lead.id}`); await expect(page.getByRole("region", { name: "Lead pipeline" })).toContainText("Please quote both our regular visit and a custom setup.");
  await page.getByLabel("Next stage").selectOption("contacted"); await page.getByRole("button", { name: "Update stage", exact: true }).click(); await expect(page.getByRole("region", { name: "Record summary" })).toContainText("Contacted");
  await page.getByRole("button", { name: "Convert to customer", exact: true }).click();
  await expect(page.getByRole("region", { name: "Record summary" })).toContainText("Converted");
  const converted = (await (await page.request.get(`/api/v1/leads/${lead.id}`)).json()).item;
  await page.goto(`/app/customers/${converted.customerId}`); await property(page, "First property", "101 First Lane"); await property(page, "Second property", "202 Second Lane");
  await page.getByRole("button", { name: "Add contact", exact: true }).click(); const contact = page.getByRole("dialog", { name: "Add contact" }); await contact.getByLabel("First name", { exact: true }).fill("Alex"); await contact.getByLabel("Last name", { exact: true }).fill("Billing"); await contact.getByRole("checkbox", { name: "Billing contact", exact: true }).check(); await contact.getByRole("button", { name: "Save changes", exact: true }).click(); await expect(contact).toHaveCount(0);
  await page.getByRole("button", { name: "Add customer note", exact: true }).click(); const note = page.getByRole("dialog", { name: "Add customer note" }); await note.getByLabel("Office note", { exact: true }).fill("Call before the first visit"); await note.getByRole("button", { name: "Save changes", exact: true }).click(); await expect(note).toHaveCount(0); await expect(page.getByText("Call before the first visit", { exact: true })).toBeVisible();
  const customer = (await (await page.request.get(`/api/v1/customers/${converted.customerId}`)).json()).item, second = customer.locations.find((location: { name: string }) => location.name === "Second property");
  await page.goto(`/app/leads/${lead.id}`); await page.getByRole("button", { name: "Create estimate from lead", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New estimate", exact: true }); await editor.getByLabel("Service property", { exact: true }).selectOption(second.id); await editor.getByLabel("Recurring visit frequency", { exact: true }).selectOption("every_two_weeks"); await editor.getByLabel("What is included?", { exact: true }).fill(title);
  await chooseStaffRecord(page, "Service", "Yard cleanup"); await editor.getByRole("group", { name: "Line 1", exact: true }).getByLabel("Unit price").fill("25"); await editor.getByRole("button", { name: "Add a line", exact: true }).click();
  const setup = editor.getByRole("group", { name: "Line 2", exact: true }); await setup.getByLabel("Line description").fill("Custom setup work"); await setup.getByLabel("Unit price").fill("10"); await setup.getByLabel("Charge", { exact: true }).selectOption("once");
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/estimates") && response.request().method() === "POST"); await editor.getByRole("button", { name: "Create estimate", exact: true }).click(); const response = await created; expect(response.status(), await response.text()).toBe(201); const quote = (await response.json()).item; await expect(page).toHaveURL(new RegExp(`/app/estimates/${quote.id}$`));
  const owner = await browser.newPage(), customerLink = await browser.newPage();
  try {
    await signIn(owner, "owner@happyyards.test"); expect((await owner.request.post("/api/v1/connections/mock-communication/disconnect", { data: {} })).ok()).toBe(true);
    page.once("dialog", dialog => dialog.accept()); const sent = page.waitForResponse(response => response.url().endsWith(`/estimates/${quote.id}/send`)); await page.getByRole("button", { name: "Send estimate", exact: true }).click(); const sentResponse = await sent; expect(sentResponse.status(), await sentResponse.text()).toBe(200); const delivery = await sentResponse.json(); expect(delivery.delivery.status).toBe("sent");
    await expect(page.getByText("Estimate email accepted by the email service.", { exact: true })).toBeVisible();
    const mailbox = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025";
    const messages = (await (await page.request.get(`${mailbox}/api/v1/messages`)).json()).messages;
    const message = messages.find((mail: { To: Array<{ Address: string }> }) => mail.To.some(to => to.Address === email)); expect(message).toBeTruthy();
    const mail = await (await page.request.get(`${mailbox}/api/v1/message/${message.ID}`)).json(); expect(mail.Text).toContain(delivery.actionUrl); const link = mail.Text.match(/https?:\/\/[^\s]+\/estimate\/[A-Za-z0-9_-]+/)?.[0]; expect(link).toBeTruthy();
    await customerLink.goto(link!); await expect(customerLink.getByText("Custom setup work", { exact: true })).toBeVisible();
    await expect(customerLink.getByRole("button", { name: "Approve estimate", exact: true })).toBeDisabled();
    await customerLink.getByRole("checkbox", { name: "I have reviewed this estimate and agree to its terms.", exact: true }).check();
    await expect(customerLink.getByRole("button", { name: "Approve estimate", exact: true })).toBeEnabled();
    page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Record verbal approval", exact: true }).click(); await expect(page.getByText("Customer decision recorded.", { exact: true })).toBeVisible();
    const db = createDatabase(process.env.DATABASE_URL!);
    try {
      const plans = await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.customerId, customer.id)), work = await db.select().from(schema.jobs).where(eq(schema.jobs.customerId, customer.id)); expect(plans).toHaveLength(1); expect(work).toHaveLength(1); expect(plans[0]!.serviceLocationId).toBe(second.id); expect(work[0]).toMatchObject({ serviceLocationId: second.id, billable: true, priceSnapshot: { totalMinor: 1000 } }); expect(plans[0]!.billingConfiguration).not.toHaveProperty("oneTimePricingSnapshot");
      expect((await db.select().from(schema.recurrenceRules).where(eq(schema.recurrenceRules.id, plans[0]!.recurrenceRuleId!)))[0]).toMatchObject({ frequencyType: "weekly", interval: 2 });
      const replay = await page.request.post(`/api/v1/estimates/${quote.id}/approve`, { data: { acceptedOptionalIds: [] } }); expect(replay.status()).toBe(200); expect(await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.customerId, customer.id))).toHaveLength(1);
    } finally { await closeDatabase(db); }
    await page.goto(`/app/customers/${customer.id}`); await expect(page.getByRole("region", { name: "Estimates", exact: true })).toContainText("Approved"); await expect(page.getByRole("region", { name: "Service plans", exact: true })).toContainText("Active");
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath("sales-customer-phone.png"), fullPage: true });
  } finally { expect((await owner.request.post("/api/v1/connections/mock-communication/connect", { data: {} })).ok()).toBe(true); await owner.close(); await customerLink.close(); }
});

test("website lead gets an address on its estimate and the customer approves the emailed link into work at that property", async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const unique = crypto.randomUUID(), name = `Website approval ${unique}`, email = `approval-${unique}@example.test`;
  await page.goto("/site/happy-yards"); await page.getByLabel("Your name", { exact: true }).fill(name); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Your message", { exact: true }).fill("Please quote my weekly yard visit.");
  await page.getByRole("button", { name: "Send message", exact: true }).click(); await expect(page.getByText("Thanks! Your message was sent. We’ll be in touch soon.")).toBeVisible();
  await signIn(page, "owner@happyyards.test");
  const lead = (await (await page.request.get(`/api/v1/leads?search=${encodeURIComponent(email)}`)).json()).items[0]; expect(lead.name).toBe(name); expect(lead.customerId).toBeFalsy();
  await page.goto(`/app/leads/${lead.id}`); await page.getByRole("button", { name: "Create estimate from lead", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New estimate", exact: true }); await editor.getByLabel("What is included?", { exact: true }).fill(`Website estimate ${unique}`); await editor.getByRole("group", { name: "Line 1", exact: true }).getByLabel("Line description").fill("Weekly yard visit"); await editor.getByRole("group", { name: "Line 1", exact: true }).getByLabel("Unit price").fill("25"); await editor.getByRole("group", { name: "Line 1", exact: true }).getByLabel("Charge", { exact: true }).selectOption("every_visit");
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/estimates") && response.request().method() === "POST"); await editor.getByRole("button", { name: "Create estimate", exact: true }).click(); const response = await created; expect(response.status(), await response.text()).toBe(201); const quote = (await response.json()).item;
  await expect(page).toHaveURL(new RegExp(`/app/estimates/${quote.id}$`));
  const addressForm = page.getByRole("region", { name: "Estimate service address", exact: true }); await expect(addressForm).toContainText("Add a complete service address here before sending or approving");
  page.once("dialog", dialog => dialog.accept()); const refused = page.waitForResponse(response => response.url().endsWith(`/estimates/${quote.id}/send`)); await page.getByRole("button", { name: "Send estimate", exact: true }).click(); expect((await refused).status()).toBe(422); await expect(page.getByText("Add a complete service address below before sending or approving this estimate.", { exact: true })).toBeVisible();
  for (const [label, value] of [["Street address", "404 Website Lane"], ["City", "Augusta"], ["State or region", "GA"], ["Postal code", "30901"]]) await addressForm.getByLabel(label!, { exact: true }).fill(value!);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath("estimate-address-repair-phone.png"), fullPage: true });
  const addressSaved = page.waitForResponse(response => response.url().includes(`/estimates/${quote.id}/service-address`) && response.request().method() === "POST");
  await addressForm.getByRole("button", { name: "Save service address", exact: true }).click(); expect((await addressSaved).status()).toBe(200); await expect(addressForm).toContainText("404 Website Lane"); await expect(addressForm.getByRole("button", { name: "Save service address", exact: true })).toHaveCount(0);
  const customerLink = await browser.newPage();
  try {
    expect((await page.request.post("/api/v1/connections/mock-communication/disconnect", { data: {} })).ok()).toBe(true);
    page.once("dialog", dialog => dialog.accept()); const sent = page.waitForResponse(response => response.url().endsWith(`/estimates/${quote.id}/send`)); await page.getByRole("button", { name: "Send estimate", exact: true }).click(); const sentResponse = await sent; expect(sentResponse.status(), await sentResponse.text()).toBe(200); const delivery = await sentResponse.json(); expect(delivery.delivery.status).toBe("sent");
    const mailbox = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025";
    const messages = (await (await page.request.get(`${mailbox}/api/v1/messages`)).json()).messages;
    const message = messages.find((mail: { To: Array<{ Address: string }> }) => mail.To.some(to => to.Address === email)); expect(message).toBeTruthy();
    const mail = await (await page.request.get(`${mailbox}/api/v1/message/${message.ID}`)).json(); expect(mail.Text).toContain(delivery.actionUrl); const link = mail.Text.match(/https?:\/\/[^\s]+\/estimate\/[A-Za-z0-9_-]+/)?.[0]; expect(link).toBeTruthy();
    await customerLink.goto(link!); await customerLink.getByRole("checkbox", { name: "I have reviewed this estimate and agree to its terms.", exact: true }).check(); await customerLink.getByRole("button", { name: "Approve estimate", exact: true }).click(); await expect(customerLink.getByText("Thank you. Your estimate is approved.", { exact: true })).toBeVisible();
    const db = createDatabase(process.env.DATABASE_URL!);
    try {
      const [converted] = await db.select().from(schema.leads).where(eq(schema.leads.id, lead.id)); expect(converted!.customerId).toBeTruthy();
      const locations = await db.select().from(schema.serviceLocations).where(eq(schema.serviceLocations.customerId, converted!.customerId!)); expect(locations).toHaveLength(1); expect(locations[0]).toMatchObject({ addressLine1: "404 Website Lane", city: "Augusta", region: "GA", postalCode: "30901", organizationLocationId: seedIds.augusta });
      const plans = await db.select().from(schema.servicePlans).where(eq(schema.servicePlans.customerId, converted!.customerId!)); expect(plans).toHaveLength(1); expect(plans[0]).toMatchObject({ serviceLocationId: locations[0]!.id, pricingSnapshot: { totalMinor: 2500 } });
      expect(await db.select().from(schema.estimateApprovals).where(eq(schema.estimateApprovals.estimateId, quote.id))).toEqual([expect.objectContaining({ actorType: "secure_estimate_link" })]);
    } finally { await closeDatabase(db); }
  } finally { expect((await page.request.post("/api/v1/connections/mock-communication/connect", { data: {} })).ok()).toBe(true); await customerLink.close(); }
});

test("a completed customer record keeps properties, contacts and approved work usable on a phone", async ({ page }, info) => {
  await signIn(page, "owner@happyyards.test");
  const unique = crypto.randomUUID(), name = `Sales prospect ${unique}`, email = `sales-${unique}@example.test`;
  const created = await page.request.post("/api/v1/customers", { data: { name, email } }); expect(created.status()).toBe(201); const customer = (await created.json()).item;
  const properties = [];
  for (const [name, addressLine1] of [["First property", "101 First Lane"], ["Second property", "202 Second Lane"]]) {
    const response = await page.request.post(`/api/v1/customers/${customer.id}/properties`, { data: { name, addressLine1, city: "Augusta", region: "GA", postalCode: "30901", countryCode: "US" } }); expect(response.status()).toBe(201); properties.push((await response.json()).item);
  }
  expect((await page.request.post(`/api/v1/customers/${customer.id}/contacts`, { data: { firstName: name, lastName: "", email, billingContact: true } })).status()).toBe(201);
  expect((await page.request.post(`/api/v1/customers/${customer.id}/notes`, { data: { body: "Call before the first visit" } })).status()).toBe(201);
  const quoteResponse = await page.request.post("/api/v1/estimates", { data: { customerId: customer.id, serviceLocationId: properties[1].id, title: `Biweekly quote ${unique}`, frequency: "every_two_weeks", lines: [{ serviceId: seedIds.weeklyService, description: "Regular visit", quantity: "1", unitAmountMinor: 2500, charge: "every_visit" }, { description: "Custom setup work", quantity: "1", unitAmountMinor: 1000, charge: "once" }] } }); expect(quoteResponse.status()).toBe(201); const quote = (await quoteResponse.json()).item;
  expect((await page.request.post(`/api/v1/estimates/${quote.id}/send`, { data: {} })).status()).toBe(200);
  expect((await page.request.post(`/api/v1/estimates/${quote.id}/approve`, { data: { acceptedOptionalIds: [] } })).status()).toBe(200);
  await page.goto(`/app/customers/${customer.id}`); await expect(page.getByRole("region", { name: "Estimates", exact: true })).toContainText("Approved"); await expect(page.getByRole("region", { name: "Service plans", exact: true })).toContainText("Active");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, overflowing: [...document.querySelectorAll("main *")].filter(element => element.getBoundingClientRect().right > innerWidth).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, text: element.textContent?.slice(0, 80) })).slice(0, 20) }));
    await page.screenshot({ path: info.outputPath(`customer-${width}.png`), fullPage: true });
    expect(layout.width, JSON.stringify(layout.overflowing)).toBeLessThanOrEqual(layout.viewport);
    const editor = page.getByRole("region", { name: "Manage customer details", exact: true });
    await expect(editor.getByRole("button", { name: "Edit property", exact: true })).toHaveCount(2);
    await editor.getByRole("button", { name: "Edit property", exact: true }).nth(1).click();
    const dialog = page.getByRole("dialog", { name: "Edit service property", exact: true }); await expect(dialog.getByLabel("Street address", { exact: true })).toHaveValue("202 Second Lane"); await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("office adds an address to an addressless customer and schedules a priced job using it", async ({ page }) => {
  await signIn(page, "manager@happyyards.test"); const name = `Addressless ${crypto.randomUUID()}`;
  const response = await page.request.post("/api/v1/customers", { data: { name } }); expect(response.status()).toBe(201); const customer = (await response.json()).item;
  await page.goto(`/app/customers/${customer.id}`); await property(page, "Service home", "303 New Home Lane");
  await page.goto("/app/jobs?new=1"); await chooseStaffRecord(page, "Customer", name); await chooseStaffRecord(page, "Service", "Yard cleanup"); await page.getByLabel("Visit price", { exact: true }).fill("42.50"); await page.getByLabel("Service day", { exact: true }).fill("2026-11-01");
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/jobs") && response.request().method() === "POST"); await page.getByRole("button", { name: "Create job", exact: true }).click(); const result = await created; expect(result.status(), await result.text()).toBe(201); expect((await result.json()).item).toMatchObject({ customerId: customer.id, address: "303 New Home Lane", status: "scheduled" });
});

test("office finds a customer older than the first 200 and replies to and closes a portal ticket without claiming email delivery", async ({ page, browser }) => {
  const suffix = crypto.randomUUID(), target = `Old search target ${suffix}`, db = createDatabase(process.env.DATABASE_URL!);
  try { await db.insert(schema.customers).values(Array.from({ length: 205 }, (_, index) => ({ tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, owningLocationId: seedIds.augusta, displayName: index === 0 ? target : `Sales paging ${suffix} ${index}`, createdAt: new Date(2020, 0, index + 1) }))); } finally { await closeDatabase(db); }
  await signIn(page, "manager@happyyards.test"); await page.goto("/app/customers"); await expect(page.getByText("Page 1", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search customers", exact: true }).fill(target); await expect(page.getByText("Page 1", { exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: target, exact: true }).first()).toBeVisible();
  const customer = await browser.newPage();
  try {
    await signIn(customer, "customer@happyyards.test"); const ticketResponse = await customer.request.post("/api/v1/portal/tickets", { data: { type: "support", subject: `Sales support ${suffix}`, description: "Please confirm the visit" } }); expect(ticketResponse.status()).toBe(201); const ticket = (await ticketResponse.json()).item;
    await page.goto(`/app/tickets/${ticket.id}`); await page.getByLabel("Reply", { exact: true }).fill("Your visit is confirmed."); await page.getByRole("button", { name: "Save reply", exact: true }).click(); await expect(page.getByText("Saved. Customer-visible replies can be read in the portal; no email notification was sent.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close ticket", exact: true }).click(); await expect(page.getByRole("button", { name: "Close ticket", exact: true })).toHaveCount(0);
    await customer.goto("/portal/requests"); const card = customer.locator(".action-item").filter({ has: customer.getByText(ticket.title, { exact: true }) }); await expect(card).toContainText("Your visit is confirmed."); await expect(card).toContainText("Closed");
  } finally { await customer.close(); }
});
