import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string, password = "Demo12345!") {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
}

test("owner can manage scoped staff, locations, stock movements, and partial purchase receipts", async ({ page, browser }) => {
  await signIn(page, "owner@happyyards.test");
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  const branchResponse = await page.request.post("/api/v1/organization", { data: { name: `E2E Branch ${Date.now()}`, address: "12 Test Road", city: "Augusta", region: "GA" } });
  expect(branchResponse.status()).toBe(201);
  const branch = (await branchResponse.json()).item;
  expect((await (await page.request.get(`/api/v1/organization/${branch.id}`)).json()).item.id).toBe(branch.id);

  const existingAccountInvite = await page.request.post("/api/v1/staff", {
    data: { name: "Existing Manager", email: "manager@happyyards.test", role: "technician" },
  });
  expect(existingAccountInvite.status()).toBe(409);

  const inviteResponse = await page.request.post("/api/v1/staff", {
    data: { name: "E2E Technician", email: `admin-ops-${Date.now()}@example.test`, role: "technician" },
  });
  expect(inviteResponse.status()).toBe(201);
  const invitation = await inviteResponse.json();
  expect(invitation.item.role).toBe("technician");
  expect(invitation.invite.temporaryPassword).toBeTruthy();
  expect((await (await page.request.get("/api/v1/staff")).json()).items.some((member: { id: string }) => member.id === invitation.item.id)).toBe(true);

  const itemResponse = await page.request.post("/api/v1/inventory", {
    data: { name: `E2E Bags ${Date.now()}`, sku: `E2E-${Date.now()}`, unit: "rolls", quantity: 10, reorderThreshold: 2 },
  });
  expect(itemResponse.status()).toBe(201);
  const item = (await itemResponse.json()).item;
  expect(item.quantity).toBe("10");

  const receiveResponse = await page.request.post(`/api/v1/inventory/${item.id}/receive`, { data: { quantity: 4, reason: "Test restock" } });
  expect(receiveResponse.status()).toBe(201);
  expect((await receiveResponse.json()).item.quantity).toBe("14");

  const transferResponse = await page.request.post(`/api/v1/inventory/${item.id}/transfer`, {
    data: { quantity: 3, toMembershipId: invitation.item.id, reason: "Load technician stock" },
  });
  expect(transferResponse.status()).toBe(201);
  const transfer = await transferResponse.json();
  expect(transfer.movement.destinationId).toBeTruthy();
  expect(transfer.item.quantity).toBe("14");

  const jobs = (await (await page.request.get("/api/v1/jobs")).json()).items;
  expect(jobs.length).toBeGreaterThan(0);
  const consumeResponse = await page.request.post(`/api/v1/inventory/${item.id}/consume`, {
    data: { quantity: 1, inventoryLocationId: transfer.movement.destinationId, jobId: jobs[0].id, reason: "Used during service" },
  });
  expect(consumeResponse.status()).toBe(201);
  expect((await consumeResponse.json()).item.quantity).toBe("13");

  const vendorResponse = await page.request.post("/api/v1/vendors", { data: { name: `E2E Supplier ${Date.now()}` } });
  expect(vendorResponse.status()).toBe(201);
  const vendor = (await vendorResponse.json()).item;
  const orderResponse = await page.request.post("/api/v1/purchase-orders", {
    data: { vendorId: vendor.id, locationId: branch.id, lines: [{ inventoryItemId: item.id, quantity: 5, unitCostMinor: 125 }] },
  });
  expect(orderResponse.status()).toBe(201);
  const order = (await orderResponse.json()).item;
  expect(order.status).toBe("ordered");
  const lineId = order.items[0].id;

  const partial = await page.request.post(`/api/v1/purchase-orders/${order.id}/receive`, { data: { lines: [{ purchaseOrderItemId: lineId, quantity: 2 }] } });
  expect(partial.status()).toBe(200);
  expect((await partial.json()).item.status).toBe("partially_received");
  const final = await page.request.post(`/api/v1/purchase-orders/${order.id}/receive`, { data: { lines: [{ purchaseOrderItemId: lineId, quantity: 3 }] } });
  expect(final.status()).toBe(200);
  expect((await final.json()).item.status).toBe("received");
  const excess = await page.request.post(`/api/v1/purchase-orders/${order.id}/receive`, { data: { lines: [{ purchaseOrderItemId: lineId, quantity: 1 }] } });
  expect(excess.status()).toBe(409);

  const technicianPage = await browser.newPage();
  await signIn(technicianPage, invitation.item.email, invitation.invite.temporaryPassword);
  await expect(technicianPage).toHaveURL(/\/field\/today$/);
  const me = await technicianPage.request.get("/api/v1/auth/me");
  expect((await me.json()).user.role).toBe("technician");
  await technicianPage.close();

  const officePage = await browser.newPage();
  await signIn(officePage, "manager@happyyards.test");
  await expect(officePage).toHaveURL(/\/app\/dashboard$/);
  const outsideScope = await officePage.request.get(`/api/v1/organization/${branch.id}`);
  expect(outsideScope.status()).toBe(403);
  const managerItemResponse = await officePage.request.get(`/api/v1/inventory/${item.id}`);
  expect(managerItemResponse.status()).toBe(200);
  const managerItem = (await managerItemResponse.json()).item;
  expect(managerItem.quantity).toBe("13");
  expect(managerItem.locations.some((location: { locationName: string }) => location.locationName.includes(branch.name))).toBe(false);
  await officePage.close();

  const inventory = await page.request.get("/api/v1/inventory");
  const createdItem = (await inventory.json()).items.find((row: { id: string }) => row.id === item.id);
  expect(createdItem.quantity).toBe("18");
});
