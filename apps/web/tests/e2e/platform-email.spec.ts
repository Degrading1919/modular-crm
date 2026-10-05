import { expect, test, type Page } from "@playwright/test";
import { createDatabase, closeDatabase, platformEmailUsage, reservePlatformEmail, tenants, seedIds } from "@modular-crm/db";
import { eq } from "drizzle-orm";
const mailpitUrl = process.env.MAILPIT_API_URL ?? "http://localhost:8025";
type Mail = { ID: string; From: { Name: string; Address: string }; ReplyTo?: Array<{ Address: string }>; Text: string; HTML: string };
async function mailFor(page: Page, address: string): Promise<Mail | undefined> {
  const list = await (await page.request.get(`${mailpitUrl}/api/v1/messages`)).json() as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
  const item = list.messages.find((entry) => entry.To.some((to) => to.Address === address));
  return item ? (await (await page.request.get(`${mailpitUrl}/api/v1/message/${item.ID}`)).json()) as Mail : undefined;
}
test("promotional opt-out leaves appointment reminders available and suppresses only later promotions", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/login"); await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!"); await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  const email = `platform-email-${crypto.randomUUID()}@example.test`;
  const customerResponse = await page.request.post("/api/v1/customers", { data: { name: "Platform Email Acceptance", email } });
  expect(customerResponse.status()).toBe(201); const customerId = (await customerResponse.json()).item.id as string;
  const disconnect = await page.request.post("/api/v1/connections/mock-communication/disconnect", { data: {} });
  expect(disconnect.ok()).toBeTruthy();
  let ruleId: string | undefined;
  try {
    const ruleResponse = await page.request.post("/api/v1/automations", { data: {
      name: `Platform invoice email ${email}`, trigger: "invoice.issued", status: "active",
      conditions: { field: "event.entityId", operator: "in", value: [] },
      actions: [{ actionType: "send_email", purpose: "marketing", configuration: { customerId, subject: "Seasonal service offer", body: "Ask us about our seasonal service offer." } }],
    } });
    expect(ruleResponse.status(), await ruleResponse.text()).toBe(201); ruleId = (await ruleResponse.json()).item.id;
    const issue = async () => {
      const created = await page.request.post("/api/v1/invoices", { data: { customerId, description: "Platform email acceptance", totalCents: 2500 } });
      expect(created.status()).toBe(201); const invoiceId = (await created.json()).item.id as string;
      const targeted = await page.request.patch(`/api/v1/automations/${ruleId}`, { data: { conditions: { field: "event.entityId", operator: "equals", value: invoiceId } } });
      expect(targeted.ok(), await targeted.text()).toBeTruthy();
      const issued = await page.request.post(`/api/v1/invoices/${invoiceId}/issue`, { data: {} });
      expect(issued.ok(), await issued.text()).toBeTruthy(); return invoiceId;
    };
    await issue();
    let mail: Mail | undefined;
    await expect.poll(async () => { mail = await mailFor(page, email); return Boolean(mail); }, { timeout: 45_000 }).toBe(true);
    expect(mail!.From.Name).toBe(`Happy Yards Pet Waste via ${process.env.PLATFORM_NAME ?? "Modular CRM"}`);
    const expectedFrom = (process.env.SMTP_FROM ?? "no-reply@localhost").match(/<([^<>]+)>/)?.[1] ?? process.env.SMTP_FROM ?? "no-reply@localhost";
    expect(mail!.From.Address).toBe(expectedFrom);
    expect(mail!.ReplyTo).toContainEqual(expect.objectContaining({ Address: "hello@happyyards.local" }));
    expect(mail!.Text).toContain("125 Broad Street"); expect(mail!.Text).toContain("Happy Yards Pet Waste");
    expect(mail!.HTML).toContain("125 Broad Street"); expect(mail!.HTML).toContain("Stop promotional emails");
    const raw = await (await page.request.get(`${mailpitUrl}/api/v1/message/${mail!.ID}/raw`)).text();
    expect(raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    const link = mail!.Text.match(/http[^\s]+\/email\/unsubscribe\?token=[^\s]+/)?.[0]; expect(link).toBeTruthy();
    expect(raw.replace(/\r?\n\s+/g, " ")).toContain(`List-Unsubscribe: <${link}>`);
    await page.goto(link!); await expect(page.getByRole("heading", { name: "Email preferences" })).toBeVisible();
    const before = await page.request.get("/api/v1/communications");
    expect((await before.json()).items.filter((item: { recipient: string; status: string }) => item.recipient === email)).toMatchObject([{ status: "sent", mode: "platform" }]);
    await page.getByRole("button", { name: "Stop promotional emails", exact: true }).click();
    await expect(page.getByText("You’ve stopped promotional emails from this business.", { exact: false })).toBeVisible();
    await expect(page.getByText("Service updates such as appointment reminders and invoices, and account access emails, continue.", { exact: false })).toBeVisible();
    const reminder = await page.request.post("/api/v1/communications", { data: { customerId, category: "service", channel: "email", subject: "Appointment reminder", message: "Your next service appointment is coming up. Contact us if you need help." } });
    expect(reminder.status()).toBe(201); const reminderId = (await reminder.json()).item.id;
    await expect.poll(async () => {
      const items = (await (await page.request.get("/api/v1/communications")).json()).items as Array<{ id: string; status: string }>;
      return items.find((item) => item.id === reminderId)?.status;
    }, { timeout: 45_000 }).toBe("sent");
    await expect.poll(async () => (await mailFor(page, email))?.Text, { timeout: 45_000 }).toContain("Your next service appointment is coming up.");
    const reminderMail = await mailFor(page, email);
    expect(reminderMail!.Text).not.toContain("Stop promotional emails");
    await issue();
    await expect.poll(async () => {
      const items = (await (await page.request.get("/api/v1/communications")).json()).items as Array<{ recipient: string; status: string; failureCode: string }>;
      return items.filter((item) => item.recipient === email && item.status === "suppressed" && item.failureCode === "customer_unsubscribed").length;
    }, { timeout: 45_000 }).toBe(1);
    const list = await (await page.request.get(`${mailpitUrl}/api/v1/messages`)).json() as { messages: Array<{ To: Array<{ Address: string }> }> };
    expect(list.messages.filter((item) => item.To.some((to) => to.Address === email))).toHaveLength(2);
    await page.goto("/app/communications");
    await page.getByRole("textbox", { name: "Search communications" }).fill(email);
    await expect(page.getByRole("columnheader", { name: "Delivery note" })).toBeVisible();
    await expect(page.getByText("This customer has stopped promotional emails.", { exact: true })).toBeVisible();
    const receipt = await page.request.post("/api/v1/communications", { data: { customerId, channel: "email", subject: "Payment receipt", message: "Thank you for your payment." } });
    expect(receipt.status()).toBe(201); const receiptId = (await receipt.json()).item.id;
    await expect.poll(async () => {
      const items = (await (await page.request.get("/api/v1/communications")).json()).items as Array<{ id: string; status: string }>;
      return items.find((item) => item.id === receiptId)?.status;
    }, { timeout: 45_000 }).toBe("sent");
  } finally {
    if (ruleId) expect((await page.request.patch(`/api/v1/automations/${ruleId}`, { data: { status: "archived" } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/v1/connections/mock-communication/connect", { data: {} })).ok()).toBeTruthy();
  }
});

test("two independent PostgreSQL senders share limits and resume at the window boundary", async () => {
  const connection = process.env.DATABASE_URL!;
  const a = createDatabase(connection); const b = createDatabase(connection);
  let tenantId: string | undefined;
  const limits = { hourly: 3, daily: 3, firstWeekHourly: 1, firstWeekDaily: 1 };
  const now = new Date("2026-10-06T12:30:00Z");
  try {
    const [tenant] = await a.insert(tenants).values({ name: "Sender concurrency acceptance", slug: crypto.randomUUID(), status: "active", createdAt: now }).returning();
    tenantId = tenant!.id;
    const simultaneous = await Promise.all([reservePlatformEmail(a, tenantId, limits, now), reservePlatformEmail(b, tenantId, limits, now)]);
    expect(simultaneous.filter((result) => result.allowed)).toHaveLength(1);
    expect(simultaneous.filter((result) => !result.allowed)).toMatchObject([{ allowed: false, code: "email_daily_limit", nextSendAt: new Date("2026-10-07T00:00:00Z") }]);
    expect((await a.select().from(platformEmailUsage).where(eq(platformEmailUsage.tenantId, tenantId)))[0]).toMatchObject({ dailyCount: 1, hourlyCount: 1 });
    expect(await reservePlatformEmail(b, tenantId, limits, new Date("2026-10-07T00:00:00Z"))).toEqual({ allowed: true });
    await a.update(tenants).set({ createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(tenants.id, tenantId));
    const regular = await Promise.all([reservePlatformEmail(a, tenantId, limits, new Date("2026-10-08T00:00:00Z")), reservePlatformEmail(b, tenantId, limits, new Date("2026-10-08T00:00:00Z")), reservePlatformEmail(a, tenantId, limits, new Date("2026-10-08T00:00:00Z")), reservePlatformEmail(b, tenantId, limits, new Date("2026-10-08T00:00:00Z"))]);
    expect(regular.filter((result) => result.allowed)).toHaveLength(3);
    expect(regular.filter((result) => !result.allowed)).toHaveLength(1);
  } finally {
    if (tenantId) { await a.delete(platformEmailUsage).where(eq(platformEmailUsage.tenantId, tenantId)); await a.delete(tenants).where(eq(tenants.id, tenantId)); }
    await Promise.all([closeDatabase(a), closeDatabase(b)]);
  }
});

test("one owner address prompt leads to the affected branch without blocking service notices", async ({ page, browser }) => {
  await page.goto("/login"); await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!"); await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  const settings = `/api/v1/settings?locationId=${seedIds.northAugusta}`;
  const branchSettings = (await (await page.request.get(settings)).json()).item as { address: string; locationName: string };
  const original = branchSettings.address;
  expect((await page.request.patch(settings, { data: { address: "" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/v1/connections/mock-communication/disconnect", { data: {} })).ok()).toBeTruthy();
  try {
    const promotion = await page.request.post("/api/v1/communications", { data: { category: "marketing", channel: "email", customerId: seedIds.riverfront, subject: "Seasonal offer", message: "Ask about our seasonal offer." } });
    expect(promotion.status()).toBe(201); const id = (await promotion.json()).item.id;
    await expect.poll(async () => {
      const messages = (await (await page.request.get("/api/v1/communications")).json()).items as Array<{ id: string; failureCode: string }>;
      return messages.find((item) => item.id === id)?.failureCode;
    }, { timeout: 45_000 }).toBe("business_details_missing");
    const service = await page.request.post("/api/v1/communications", { data: { category: "service", channel: "email", customerId: seedIds.riverfront, subject: "Visit update", message: "Your service update." } });
    expect(service.status()).toBe(201); const serviceId = (await service.json()).item.id;
    await expect.poll(async () => {
      const messages = (await (await page.request.get("/api/v1/communications")).json()).items as Array<{ id: string; status: string }>;
      return messages.find((item) => item.id === serviceId)?.status;
    }, { timeout: 45_000 }).toBe("sent");
    await page.goto("/app/dashboard"); await expect(page.getByText("Add your business address", { exact: true })).toHaveCount(1);
    const prompt = page.locator(".action-item").filter({ hasText: "Add your business address" });
    const link = prompt.getByRole("link", { name: "Review", exact: true });
    await expect(link).toHaveAttribute("href", `/app/settings?locationId=${seedIds.northAugusta}`);
    const staff = await browser.newPage();
    try {
      await staff.goto("/login"); await staff.getByLabel("Email address").fill("manager@happyyards.test");
      await staff.getByLabel("Password").fill("Demo12345!"); await staff.getByRole("button", { name: /^Sign in$/ }).click();
      await expect(staff).toHaveURL(/\/app\/dashboard$/); await expect(staff.getByText("Business locations:", { exact: false })).toBeVisible();
      await expect(staff.getByText("Add your business address", { exact: true })).toHaveCount(0);
    } finally { await staff.close(); }
    await link.click(); await expect(page.getByLabel("Business address", { exact: true })).toHaveValue("");
    await expect(page.getByText(`Business address for ${branchSettings.locationName}`, { exact: true })).toBeVisible();
    await page.getByLabel("Business address", { exact: true }).fill(original); await page.getByRole("button", { name: "Save business profile" }).click();
    await expect(page.getByText("Business settings saved.", { exact: true })).toBeVisible();
    await page.goto("/app/dashboard"); await expect(page.getByText("Business locations:", { exact: false })).toBeVisible();
    await expect(page.getByText("Add your business address", { exact: true })).toHaveCount(0);
  } finally {
    expect((await page.request.patch(settings, { data: { address: original } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/v1/connections/mock-communication/connect", { data: {} })).ok()).toBeTruthy();
  }
});
