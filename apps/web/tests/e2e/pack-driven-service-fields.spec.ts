import { expect, test, type Page } from "@playwright/test";
import { chooseStaffRecord } from "./staff-picker";
import { seedIds } from "@modular-crm/db";

async function signIn(page: Page, email: string, password = "Demo12345!") {
  await page.goto("/login"); await page.getByLabel("Email address").fill(email); await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
}
async function invitationLink(page: Page, email: string) {
  const mailpit = process.env.MAILPIT_API_URL ?? "http://localhost:8025";
  const response = await page.request.get(`${mailpit}/api/v1/messages`);
  if (!response.ok()) return "";
  const list = await response.json() as { messages?: { ID: string; To: { Address: string }[] }[] };
  for (const message of list.messages ?? []) {
    if (!message.To.some(to => to.Address === email)) continue;
    const read = await page.request.get(`${mailpit}/api/v1/message/${message.ID}`);
    if (!read.ok()) continue;
    const content = await read.json();
    const links = `${content.Text ?? ""}\n${content.HTML ?? ""}`.match(/https?:\/\/[^\s<>"']+/g) ?? [];
    const link = links.find((url: string) => new URL(url).pathname.includes("/reset-password/"));
    if (link) return link.replace(/[),.;]+$/, "");
  }
  return "";
}

test("legacy recorded warning is prominent in staff and field views without invented details", async ({ page, browser }) => {
  await signIn(page, "owner@happyyards.test"); await expect(page).toHaveURL(/\/app\/dashboard$/);
  await page.goto(`/app/customers/${seedIds.nguyen}`);
  await expect(page.locator(".field-warning").filter({ hasText: "Reactive near gate" })).toBeVisible();
  await expect(page.getByText("Active at this address", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Size", { exact: true })).toHaveCount(0);
  const created = await page.request.post("/api/v1/jobs", { data: { customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, serviceId: seedIds.weeklyService, scheduledDate: new Date().toISOString().slice(0, 10) } });
  expect(created.ok(), await created.text()).toBeTruthy(); const job = (await created.json()).item;
  const assigned = await page.request.post(`/api/v1/jobs/${job.id}/assign`, { data: { technicianId: seedIds.terryMembership, scheduledDate: new Date().toISOString().slice(0, 10) } }); expect(assigned.ok(), await assigned.text()).toBeTruthy();
  const dispatch = await page.request.post(`/api/v1/jobs/${job.id}/transition`, { data: { status: "dispatched" } }); expect(dispatch.ok(), await dispatch.text()).toBeTruthy();
  const techPage = await browser.newPage();
  try {
    await signIn(techPage, "tech@happyyards.test"); await expect(techPage).toHaveURL(/\/field\/today$/);
    await techPage.goto(`/field/job/${job.id}`);
    await expect(techPage.locator(".field-warning").filter({ hasText: "Reactive near gate" })).toBeVisible();
    await expect(techPage.getByText("Active at this address", { exact: true })).toHaveCount(0);
    await expect(techPage.getByText("Size", { exact: true })).toHaveCount(0);
    await expect(techPage.getByText("Max", { exact: true })).toBeVisible();
  } finally { await techPage.close(); }
});

test("second-pack signup, quote, customer detail, portal edit and technician completion", async ({ page, browser }) => {
  const unique = Date.now(); const name = `House customer ${unique}`; const email = `house-${unique}@example.test`;
  const privateNote = `Use entry ${unique}`; const roomName = `Kitchen ${unique}`;
  await page.goto("/site/tidy-home/signup");
  await page.getByLabel("Street address").fill(`${unique.toString().slice(-5)} Birch Street`); await page.getByLabel("ZIP code").fill("30909");
  await page.getByRole("button", { name: /Check availability/i }).click();
  await page.getByLabel("Full name").fill(name); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Phone").fill(`555${unique.toString().slice(-7)}`);
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByLabel("Service", { exact: true }).selectOption({ label: "Recurring Cleaning" });
  await page.getByLabel("Room 1 name").fill(roomName); await page.getByLabel("Room 1 Floor surface").selectOption("tile");
  await page.getByLabel("Room 1 Care notes").fill("Use a soft cloth"); await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByLabel("Rooms to clean").fill("3"); await page.getByLabel("Home type").selectOption("apartment"); await page.getByLabel("I provide cleaning supplies").check();
  await page.getByLabel("Preferred first visit").fill("2026-10-08"); await page.getByLabel("Entry instructions").fill(privateNote);
  const quotePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/public/quote");
  await page.getByRole("button", { name: /See my price/i }).click(); const quote = await quotePromise;
  expect(quote.ok(), await quote.text()).toBeTruthy(); expect((await quote.json()).item).toMatchObject({ amountCents: 7500, quoteRequired: false });
  await expect(page.getByText("$75.00", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /accept the service terms/i }).check();
  const signupPromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/public/signup");
  await page.getByRole("button", { name: /Send service request/i }).click(); const signup = await signupPromise;
  expect(signup.status(), await signup.text()).toBe(201); const created = (await signup.json()).item; expect(created.kind).toBe("customer");
  await expect(page.getByRole("heading", { name: "You’re all set!" })).toBeVisible();

  await signIn(page, "owner@tidyhome.test"); await expect(page).toHaveURL(/\/app\/dashboard$/);
  await page.goto(`/app/customers/${created.id}`); await expect(page.getByText(roomName, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rooms", exact: true })).toBeVisible();
  const detailResponse = await page.request.get(`/api/v1/customers/${created.id}`); expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()).item; expect(detail.locations[0].fieldValues).toMatchObject({ room_count: 3, supplies_provided: true, home_type: "apartment" });
  expect(JSON.stringify(detail)).not.toContain(privateNote);
  await page.getByLabel("Customer email").fill(email); await page.getByRole("button", { name: "Invite to customer portal" }).click();
  await expect(page.getByText("Portal invitation sent. The customer will activate access by email.")).toBeVisible();
  let link = ""; await expect.poll(async () => { link = await invitationLink(page, email); return link; }, { timeout: 20_000 }).not.toBe("");
  const customerPage = await browser.newPage(); const password = `House-${unique}!A`;
  try {
    await customerPage.goto(link); await customerPage.getByLabel("New password").fill(password); await customerPage.getByLabel("Confirm password").fill(password);
    await customerPage.getByRole("button", { name: "Set password" }).click(); await expect(customerPage.getByRole("heading", { name: "Your portal is ready" })).toBeVisible();
    await signIn(customerPage, email, password); await expect(customerPage).toHaveURL(/\/portal\/home$/);
    await customerPage.goto("/portal/profile"); await expect(customerPage.getByLabel("Room name")).toHaveValue(roomName);
    await expect(customerPage.getByLabel("Entry instructions")).toHaveCount(0); await expect(customerPage.getByLabel("Rooms to clean")).toHaveCount(0);
    await customerPage.getByLabel("Room Care notes").fill(`Updated care ${unique}`);
    await customerPage.getByRole("button", { name: "Save profile" }).click(); await expect(customerPage.getByText("Profile saved.")).toBeVisible();

    await page.goto("/app/jobs"); await page.getByRole("button", { name: /^New job$/i }).click();
    await chooseStaffRecord(page, "Customer", name); await chooseStaffRecord(page, "Service", "Recurring Cleaning");
    await page.getByLabel("Service day").fill(new Date().toISOString().slice(0, 10));
    const jobPromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/jobs" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create job", exact: true }).click(); const jobResponse = await jobPromise; expect(jobResponse.ok(), await jobResponse.text()).toBeTruthy(); const job = (await jobResponse.json()).item;
    const staff = await page.request.get("/api/v1/staff"); expect(staff.ok()).toBeTruthy(); const cleaner = (await staff.json()).items.find((item: { name: string }) => item.name === "Dana Cleaner"); expect(cleaner).toBeTruthy();
    const assigned = await page.request.post(`/api/v1/jobs/${job.id}/assign`, { data: { technicianId: cleaner.id, scheduledDate: new Date().toISOString().slice(0, 10) } }); expect(assigned.ok(), await assigned.text()).toBeTruthy();
    const dispatch = await page.request.post(`/api/v1/jobs/${job.id}/transition`, { data: { status: "dispatched" } }); expect(dispatch.ok(), await dispatch.text()).toBeTruthy();
    const techPage = await browser.newPage();
    try {
      await signIn(techPage, "tech@tidyhome.test"); await expect(techPage).toHaveURL(/\/field\/today$/);
      await techPage.goto(`/field/job/${job.id}`); await expect(techPage.getByText(roomName, { exact: true })).toBeVisible();
      await expect(techPage.getByText(`Updated care ${unique}`, { exact: true })).toBeVisible(); await expect(techPage.getByText(privateNote, { exact: false })).toBeVisible();
      await techPage.getByRole("button", { name: "Start job" }).click(); await expect(techPage.getByText(/^In progress$/i)).toBeVisible();
      await techPage.getByLabel("Confirmed the correct property").check(); await techPage.getByLabel("Cleaned the agreed rooms").check(); await techPage.getByLabel("Left the property secure").check();
      await techPage.getByRole("button", { name: /Complete job/ }).click(); await expect(techPage.getByText(/^Completed$/i)).toBeVisible();
    } finally { await techPage.close(); }

  } finally { await customerPage.close(); }
});

test("second-pack import maps typed fields and redacts private preview values", async ({ page }) => {
  const unique = Date.now();
  await signIn(page, "owner@tidyhome.test"); await expect(page).toHaveURL(/\/app\/dashboard$/);
  await page.goto("/app/import"); await page.getByLabel("Customer file").setInputFiles({ name: "house-customers.csv", mimeType: "text/csv", buffer: Buffer.from(`Name,Email,Address,Room Name,Floor Surface,Room Count,Entry Instructions\nImport House ${unique},import-house-${unique}@example.test,8 Cedar Lane,Office,tile,2,private-import-${unique}`) });
  await page.getByRole("button", { name: "Review import" }).click(); await expect(page.getByLabel("Room Name", { exact: true })).toHaveValue("asset.room.name");
  await expect(page.getByLabel("Entry Instructions", { exact: true })).toHaveValue("location.entry_instructions"); await expect(page.getByText(`private-import-${unique}`)).toHaveCount(0);
  await page.getByRole("button", { name: "Import reviewed customers" }).click(); await expect(page.getByText("Import complete: 1 added, 0 skipped.")).toBeVisible();
});
