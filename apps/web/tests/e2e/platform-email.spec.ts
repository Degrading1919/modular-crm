import { expect, test, type Page } from "@playwright/test";
const mailpitUrl = process.env.MAILPIT_API_URL ?? "http://localhost:8025";
type Mail = { ID: string; From: { Name: string; Address: string }; ReplyTo?: Array<{ Address: string }>; Text: string; HTML: string };
async function mailFor(page: Page, address: string): Promise<Mail | undefined> {
  const list = await (await page.request.get(`${mailpitUrl}/api/v1/messages`)).json() as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
  const item = list.messages.find((entry) => entry.To.some((to) => to.Address === address));
  return item ? (await (await page.request.get(`${mailpitUrl}/api/v1/message/${item.ID}`)).json()) as Mail : undefined;
}
test("platform email works without a connector, and unsubscribe suppresses later automation, not receipts", async ({ page }) => {
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
      actions: [{ actionType: "send_email", configuration: { customerId, subject: "Your invoice", body: "Your invoice is ready. Please contact us with any questions." } }],
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
    expect(mail!.From.Name).toBe("Happy Yards Pet Waste");
    const expectedFrom = (process.env.SMTP_FROM ?? "no-reply@localhost").match(/<([^<>]+)>/)?.[1] ?? process.env.SMTP_FROM ?? "no-reply@localhost";
    expect(mail!.From.Address).toBe(expectedFrom);
    expect(mail!.ReplyTo).toContainEqual(expect.objectContaining({ Address: "hello@happyyards.local" }));
    expect(mail!.Text).toContain("125 Broad Street"); expect(mail!.Text).toContain("Happy Yards Pet Waste");
    expect(mail!.HTML).toContain("125 Broad Street"); expect(mail!.HTML).toContain("Stop automated emails");
    const raw = await (await page.request.get(`${mailpitUrl}/api/v1/message/${mail!.ID}/raw`)).text();
    expect(raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    const link = mail!.Text.match(/http[^\s]+\/email\/unsubscribe\?token=[^\s]+/)?.[0]; expect(link).toBeTruthy();
    expect(raw.replace(/\r?\n\s+/g, " ")).toContain(`List-Unsubscribe: <${link}>`);
    await page.goto(link!); await expect(page.getByRole("heading", { name: "Email preferences" })).toBeVisible();
    const before = await page.request.get("/api/v1/communications");
    expect((await before.json()).items.filter((item: { recipient: string; status: string }) => item.recipient === email)).toMatchObject([{ status: "sent", mode: "platform" }]);
    await page.getByRole("button", { name: "Stop automated emails", exact: true }).click();
    await expect(page.getByText("You’ve stopped automated emails from this business.", { exact: false })).toBeVisible();
    await issue();
    await expect.poll(async () => {
      const items = (await (await page.request.get("/api/v1/communications")).json()).items as Array<{ recipient: string; status: string; failureCode: string }>;
      return items.filter((item) => item.recipient === email && item.status === "suppressed" && item.failureCode === "customer_unsubscribed").length;
    }, { timeout: 45_000 }).toBe(1);
    const list = await (await page.request.get(`${mailpitUrl}/api/v1/messages`)).json() as { messages: Array<{ To: Array<{ Address: string }> }> };
    expect(list.messages.filter((item) => item.To.some((to) => to.Address === email))).toHaveLength(1);
    await page.goto("/app/communications");
    await page.getByRole("textbox", { name: "Search communications" }).fill(email);
    await expect(page.getByRole("columnheader", { name: "Delivery note" })).toBeVisible();
    await expect(page.getByText("This customer has stopped automated emails.", { exact: true })).toBeVisible();
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
