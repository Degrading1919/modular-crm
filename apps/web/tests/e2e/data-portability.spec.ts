import { expect, test } from "@playwright/test";

test("owner previews, imports once, and exports tenant data", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `import-${suffix}@example.test`;
  const phone = `555${Date.now().toString().slice(-7)}`;
  const address = `${Math.floor(Math.random() * 100_000)} ${suffix} Example Lane`;
  const csv = `Customer Name,Email,Phone,Street Address\nImport ${suffix},${email},${phone},${address}\n`;
  const preview = await page.request.post("/api/v1/imports", { data: { csv, preview: true } });
  expect(preview.status()).toBe(200);
  const previewItem = (await preview.json()).item;
  expect(previewItem.rowCount).toBe(1);
  expect(previewItem.mapping["Customer Name"]).toBe("name");
  expect(previewItem.mapping.Email).toBe("email");
  expect(previewItem.duplicates).toEqual([]);

  const data = { csv, confirmed: true, mapping: previewItem.mapping, idempotencyKey: `e2e-import-${suffix}` };
  const first = await page.request.post("/api/v1/imports", { data });
  expect(first.status()).toBe(200);
  const firstItem = (await first.json()).item;
  expect(firstItem.imported).toBe(1);
  expect(firstItem.idempotent).toBe(false);

  const retry = await page.request.post("/api/v1/imports", { data });
  expect(retry.status()).toBe(200);
  const retryItem = (await retry.json()).item;
  expect(retryItem.batchId).toBe(firstItem.batchId);
  expect(retryItem.idempotent).toBe(true);

  const duplicate = await page.request.post("/api/v1/imports", { data: { csv, preview: true } });
  expect(duplicate.status()).toBe(200);
  expect((await duplicate.json()).item.duplicates).toHaveLength(1);

  const exportCsv = await page.request.get("/api/v1/exports/customers");
  expect(exportCsv.status()).toBe(200);
  expect(await exportCsv.text()).toContain(email);

  const fullExport = await page.request.get("/api/v1/exports/business-data");
  expect(fullExport.status()).toBe(200);
  const business = await fullExport.json();
  expect(business.data.customers.some((customer: { billingEmail: string }) => customer.billingEmail === email)).toBe(true);
  expect(JSON.stringify(business)).not.toContain("Demo12345!");
});

test("owner confirms an ambiguous column and sees failed rows in the import summary", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@happyyards.test");
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await page.goto("/app/import");

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const csv = `Name,Contact Email\nBad address ${suffix},not-an-email\nGood address ${suffix},valid-${suffix}@example.test\n`;
  await page.getByLabel("Customer file").setInputFiles({
    name: "ambiguous-customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Review import" }).click();

  await expect(page.getByTestId("mapping-confidence-Contact Email")).toContainText("Please confirm");
  await page.getByLabel("Contact Email").selectOption("email");
  await page.getByRole("button", { name: "Import reviewed customers" }).click();

  const summary = page.getByLabel("Import summary");
  await expect(summary).toContainText("1 added · 1 skipped");
  await expect(summary).toContainText("Row 2: Email address is not valid.");
});
