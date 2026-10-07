import { expect,test,type Page } from "@playwright/test";
import { chooseStaffRecord } from "./staff-picker";
async function signIn(page:Page,email:string,destination:RegExp){await page.goto("/login");await page.getByLabel("Email address").fill(email);await page.getByLabel("Password").fill("Demo12345!");await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL(destination);}

test("three-line taxed quote → customer declines add-on → immutable invoice → hosted payment → partial refund",async({page,browser},testInfo)=>{
  test.setTimeout(120_000);
  const customer=await browser.newPage();const title=`Itemized quote ${crypto.randomUUID()}`;
  await signIn(page,"owner@happyyards.test",/\/app\/dashboard$/);
  const settings=(await (await page.request.get("/api/v1/settings")).json()).item;
  const serviceName=`Catalog addon ${crypto.randomUUID()}`;
  expect((await page.request.post("/api/v1/services",{data:{name:serviceName,basePriceCents:2500}})).status()).toBe(201);
  try {
    await page.goto("/app/settings");await page.getByLabel("Default tax rate (%)").fill("7.5");
    const taxSaved=page.waitForResponse(response=>response.url().endsWith("/api/v1/settings")&&response.request().method()==="PATCH");await page.getByRole("button",{name:"Save business profile"}).click();expect((await taxSaved).status()).toBe(200);
    await page.setViewportSize({width:390,height:844});await page.goto("/app/estimates?new=1");
    const dialog=page.getByRole("dialog",{name:"New estimate"});await chooseStaffRecord(page,"Customer","Carter Household");await dialog.getByLabel("What is included?").fill(title);
    const first=dialog.getByRole("group",{name:"Line 1",exact:true});await first.getByLabel("Line description").fill("Cleanup");await first.getByLabel("Quantity").fill("2");await first.getByLabel("Unit price").fill("10");await first.getByLabel("Line discount").fill("1");await first.getByRole("checkbox",{name:"Taxable",exact:true}).check();
    await dialog.getByRole("button",{name:"Add a line",exact:true}).click();const second=dialog.getByRole("group",{name:"Line 2",exact:true});await second.getByLabel("Line description").fill("Supplies");await second.getByLabel("Unit price").fill("5");
    await dialog.getByRole("button",{name:"Add a line",exact:true}).click();const third=dialog.getByRole("group",{name:"Line 3",exact:true});
    await third.getByRole("combobox",{name:"Catalog service 3",exact:true}).fill(serviceName);await third.getByRole("option",{name:new RegExp(`^${serviceName} ·`)}).click();await expect(third.getByLabel("Line description")).toHaveValue(serviceName);await expect(third.getByLabel("Unit price")).toHaveValue("25");
    await third.getByLabel("Line description").fill("Optional upgrade");await third.getByLabel("Unit price").fill("10");await third.getByRole("checkbox",{name:"Taxable",exact:true}).check();await third.getByRole("checkbox",{name:"Optional add-on",exact:true}).check();
    await dialog.getByRole("button",{name:"Add a line",exact:true}).click();await dialog.getByRole("group",{name:"Line 4",exact:true}).getByRole("button",{name:"Remove line",exact:true}).click();
    await second.getByRole("button",{name:"Move up",exact:true}).click();await expect(first.getByLabel("Line description")).toHaveValue("Supplies");await first.getByRole("button",{name:"Move down",exact:true}).click();await expect(first.getByLabel("Line description")).toHaveValue("Cleanup");
    await expect(dialog.getByLabel("Tax rate (%)")).toHaveValue("7.5");await dialog.getByLabel("Document discount",{exact:true}).selectOption("percent");await dialog.getByLabel("Discount (%)",{exact:true}).fill("10");
    await expect(dialog.getByRole("definition").last()).toHaveText("$32.56");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath("quote-editor-phone.png"),fullPage:true});
    const created=page.waitForResponse(response=>response.url().endsWith("/api/v1/estimates")&&response.request().method()==="POST");await dialog.getByRole("button",{name:"Create estimate",exact:true}).click();const response=await created;expect(response.status(),await response.text()).toBe(201);const id=(await response.json()).item.id;
    await page.goto(`/app/estimates/${id}`);page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Send estimate",exact:true}).click();await expect(page.getByText("Estimate sent. Copy the secure link to share it with your customer.")).toBeVisible();
    await signIn(customer,"customer@happyyards.test",/\/portal\/home$/);await customer.goto("/portal/estimates");const quote=customer.getByRole("region",{name:title,exact:true});const addon=quote.getByRole("checkbox",{name:"Optional add-on: Optional upgrade",exact:true});await addon.check();await expect(quote).toContainText("$32.56");await addon.uncheck();await expect(quote).toContainText("$22.88");
    customer.once("dialog",dialog=>dialog.accept());const approval=customer.waitForResponse(response=>response.url().endsWith(`/estimates/${id}/approve`));await quote.getByRole("button",{name:"Approve estimate",exact:true}).click();expect((await approval).status()).toBe(200);await expect(quote).toContainText("Approved");
    await page.reload();const converted=page.waitForResponse(response=>response.url().endsWith(`/estimates/${id}/invoice`));page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Create invoice",exact:true}).click();const conversion=await converted;expect(conversion.status()).toBe(201);const invoiceId=(await conversion.json()).item.id;
    await expect(page).toHaveURL(new RegExp(`/app/invoices/${invoiceId}$`));await expect(page.getByRole("region",{name:"Invoice lines",exact:true})).not.toContainText("Optional upgrade");await expect(page.getByRole("region",{name:"Invoice lines",exact:true})).toContainText("Cleanup");await expect(page.getByRole("region",{name:"Price breakdown",exact:true})).toContainText("$22.88");
    await page.getByRole("button",{name:"Issue invoice",exact:true}).click();await expect(page.getByRole("button",{name:"Edit invoice",exact:true})).toHaveCount(0);
    const endpoint="/api/v1/connections/mock-payments/online-payments";expect((await page.request.post(endpoint,{data:{}})).ok()).toBe(true);expect((await page.request.get(endpoint)).ok()).toBe(true);
    const invoice=(await (await page.request.get(`/api/v1/invoices/${invoiceId}`)).json()).item;
    await customer.goto(`/portal/documents/invoice/${invoiceId}`);await expect(customer.getByText("$22.88",{exact:true}).first()).toBeVisible();await expect(customer.getByText("Optional upgrade",{exact:true})).toHaveCount(0);
    await customer.goto(`/portal/billing/${invoiceId}`);const pay=customer.getByRole("dialog",{name:`Pay invoice ${invoice.number}`});await expect(pay).toBeVisible();await pay.getByRole("button",{name:"Pay $22.88",exact:true}).click();await expect(customer).toHaveURL(/\/test-checkout\/mock_session_/);await customer.getByRole("button",{name:"Complete test payment",exact:true}).click();await expect(customer.getByRole("heading",{name:"Payment receipt",exact:true})).toBeVisible();
    await page.reload();const refund=page.getByRole("form",{name:"Refund invoice payment"});await refund.getByLabel("Refund amount (USD)").fill("1.11");await refund.getByRole("button",{name:"Refund payment",exact:true}).click();await expect(page.getByText("Refunded $1.11",{exact:true})).toBeVisible();
    const final=(await (await page.request.get(`/api/v1/invoices/${invoiceId}`)).json()).item;expect(Number(final.totalCents)).toBe(2288);expect(Number(final.balanceCents)).toBe(111);
  }finally{
    await page.request.delete("/api/v1/connections/mock-payments/online-payments");
    expect((await page.request.patch("/api/v1/settings",{data:{defaultTaxRateBasisPoints:settings.defaultTaxRateBasisPoints??0}})).ok()).toBe(true);await customer.close();
  }
});
