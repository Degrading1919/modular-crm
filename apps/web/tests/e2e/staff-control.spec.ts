import { test, expect } from "@playwright/test";
import { seedIds } from "@modular-crm/db";

test("owner invites an existing account, changes scoped access, and revokes/restores the same live session", async ({ page, browser }) => {
  const email = `staff-control-${crypto.randomUUID()}@example.test`, password = "StaffControl12345!";
  const staffContext = await browser.newContext(); const staff = await staffContext.newPage();
  try {
    const registered = await staff.request.post("/api/v1/auth/register", { data: { name: "Staff Control Person", email, password, businessName: "Existing account business" } });
    expect(registered.status()).toBe(200);
    await page.goto("/login"); await page.getByLabel("Email address").fill("owner@happyyards.test"); await page.getByLabel("Password").fill("Demo12345!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/app\/dashboard$/);
    await page.goto("/app/staff"); await page.getByRole("button", { name: "Invite team member", exact: true }).click();
    const inviteDialog = page.getByRole("dialog", { name: "Invite team member" });
    await inviteDialog.getByLabel("Name", { exact: true }).fill("Staff Control Person"); await inviteDialog.getByLabel("Email", { exact: true }).fill(email);
    await inviteDialog.getByLabel("Role", { exact: true }).selectOption("office");
    await inviteDialog.getByLabel("Augusta Branch", { exact: true }).check();
    const invited = page.waitForResponse(r => r.url().endsWith("/api/v1/staff") && r.request().method() === "POST");
    await inviteDialog.getByRole("button", { name: "Send invitation" }).click(); const response = await invited; expect(response.status()).toBe(201);
    const { item, invite } = await response.json(); expect(item.status).toBe("invited");
    // Before acceptance the account stays in its original business.
    const before = await staff.request.get("/api/v1/auth/me"); expect((await before.json()).tenant.id).not.toBe(seedIds.happyTenant);
    await staff.goto(invite.invitationUrl); await staff.getByLabel("Email address").fill(email); await staff.getByLabel("Password").fill(password);
    await staff.getByRole("button", { name: "Accept invitation" }).click(); await expect(staff).toHaveURL(/\/app\/dashboard$/);
    const identity = await staff.request.get("/api/v1/auth/me"); expect(await identity.json()).toMatchObject({ tenant: { id: seedIds.happyTenant }, user: { role: "office" } });
    await staff.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(staff).toHaveURL(/\/login$/);
    // The redirect commits before the new document finishes loading. Do not
    // fill server-rendered controlled inputs before that navigation completes.
    await staff.waitForLoadState("load");
    await staff.getByLabel("Email address").fill(email); await staff.getByLabel("Password").fill(password);
    await staff.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(staff).toHaveURL(/\/app\/dashboard$/);
    expect(await (await staff.request.get("/api/v1/auth/me")).json()).toMatchObject({ tenant: { id: seedIds.happyTenant } });
    await staff.getByRole("button", { name: "Switch business", exact: true }).click();
    await staff.getByRole("dialog", { name: "Switch business" }).getByRole("button", { name: /Existing account business/ }).click();
    await expect(staff).toHaveURL(/\/app\/dashboard$/);
    await expect(staff.locator(".location-chip")).toHaveText("Existing account business");
    expect((await (await staff.request.get("/api/v1/auth/me")).json()).tenant.id).toBe((await before.json()).tenant.id);
    await staff.getByRole("button", { name: "Switch business", exact: true }).click();
    await staff.getByRole("dialog", { name: "Switch business" }).getByRole("button", { name: /Happy Yards/ }).click();
    await expect(staff).toHaveURL(/\/app\/dashboard$/);
    await expect(staff.locator(".location-chip")).toContainText("Happy Yards");
    expect(await (await staff.request.get("/api/v1/auth/me")).json()).toMatchObject({ tenant: { id: seedIds.happyTenant }, user: { role: "office" } });
    await page.reload(); const card = page.getByRole("region", { name: "Staff Control Person", exact: true });
    await card.getByRole("button", { name: "Edit access" }).click(); const edit = page.getByRole("dialog", { name: "Edit access for Staff Control Person" });
    await edit.getByLabel("Role", { exact: true }).selectOption("technician"); await edit.getByLabel("Augusta Branch", { exact: true }).uncheck(); await edit.getByLabel("North Augusta Branch", { exact: true }).check();
    await edit.getByRole("button", { name: "Save access" }).click(); await expect(edit).toHaveCount(0);
    expect(await (await staff.request.get("/api/v1/auth/me")).json()).toMatchObject({ user: { role: "technician" } });
    expect((await staff.request.get("/api/v1/staff")).status()).toBe(403);
    await staff.goto("/field/profile"); await staff.getByRole("button", { name: "Switch business", exact: true }).click();
    await staff.getByRole("dialog", { name: "Switch business" }).getByRole("button", { name: /Existing account business/ }).click();
    await expect(staff.locator(".location-chip")).toHaveText("Existing account business");
    await staff.getByRole("button", { name: "Switch business", exact: true }).click();
    await staff.getByRole("dialog", { name: "Switch business" }).getByRole("button", { name: /Happy Yards/ }).click();
    await expect(staff).toHaveURL(/\/field\/today$/);
    expect(await (await staff.request.get("/api/v1/auth/me")).json()).toMatchObject({ tenant: { id: seedIds.happyTenant }, user: { role: "technician" } });
    page.once("dialog", dialog => dialog.accept()); await card.getByRole("button", { name: "Deactivate", exact: true }).click(); await expect(card).toContainText(/inactive/i);
    expect((await staff.request.get("/api/v1/auth/me")).status()).toBe(401);
    page.once("dialog", dialog => dialog.accept()); await card.getByRole("button", { name: "Reactivate", exact: true }).click(); await expect(card.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
    expect(await (await staff.request.get("/api/v1/auth/me")).json()).toMatchObject({ tenant: { id: seedIds.happyTenant }, user: { role: "technician" } });
    // Account switching must not retain the accepted membership selection.
    expect((await staff.request.post("/api/v1/auth/logout")).ok()).toBe(true);
    expect((await staff.request.post("/api/v1/auth/login", { data: { email: "customer@happyyards.test", password: "Demo12345!" } })).ok()).toBe(true);
    expect(await (await staff.request.get("/api/v1/auth/me")).json()).toMatchObject({ user: { role: "customer" } });
  } finally { await staffContext.close(); }
});
