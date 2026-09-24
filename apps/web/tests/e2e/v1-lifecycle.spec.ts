import { expect, test, type Page } from "@playwright/test";

const password = "Demo12345!";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
}

async function augustaDate(page: Page) {
  return page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  });
}

test("V1 lifecycle: estimate approval through field work, billing, and feedback", async ({ page, browser }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const serviceName = `E2E One-Time Cleanup ${suffix}`;
  const estimateTitle = `E2E Estimate ${suffix}`;
  const invoiceDescription = `E2E completed cleanup ${suffix}`;
  const completionNote = `Completed lifecycle job ${suffix}.`;
  const feedbackComment = `Great service for lifecycle ${suffix}.`;

  await signIn(page, "owner@happyyards.test");
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  // The documented seed has recurring services only. Add a one-time catalog entry
  // so approval creates a schedulable job instead of waiting on the worker.
  await page.goto("/app/services");
  await page.getByRole("button", { name: "New service" }).click();
  await page.getByLabel("Service name").fill(serviceName);
  await page.getByLabel("Description").fill(`One-time service for lifecycle ${suffix}.`);
  await page.getByLabel("Starting price").fill("36");
  await page.getByLabel("Expected minutes").fill("30");
  await page.getByRole("button", { name: "Create service" }).click();
  await expect(page.getByText("Service created.")).toBeVisible();

  await page.goto("/app/estimates");
  await page.getByRole("button", { name: "New estimate" }).click();
  await page.getByLabel("Customer", { exact: true }).selectOption({ label: "Carter Household" });
  await page.getByLabel("Service", { exact: true }).selectOption({ label: serviceName });
  await page.getByLabel("What is included?").fill(estimateTitle);
  await page.getByLabel("Total price").fill("36");
  await page.getByLabel("Description").fill(`Approved estimate ${suffix}.`);
  const estimateCreatedResponse = page.waitForResponse((response) =>
    response.url().includes("/api/v1/estimates") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create estimate" }).click();
  const estimateCreated = await estimateCreatedResponse;
  expect(estimateCreated.status()).toBe(201);
  const estimateId = (await estimateCreated.json()).item.id as string;

  await page.goto(`/app/estimates/${estimateId}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Send estimate" }).click();
  await expect(page.getByText("Estimate sent. Copy the secure link to share it with your customer.")).toBeVisible();
  const secureLink = await page.getByLabel("Secure estimate link").inputValue();
  expect(secureLink).toMatch(/\/estimate\/[A-Za-z0-9_-]+$/);

  // Open the captured link in a separate browser context so approval is anonymous,
  // as the secure-link contract intends.
  const customer = await browser.newPage();
  const publicEstimateResponse = customer.waitForResponse((response) =>
    response.url().includes("/api/v1/public/estimate-links/") && response.request().method() === "GET",
  );
  await customer.goto(secureLink);
  const publicEstimate = await publicEstimateResponse;
  expect(publicEstimate.ok()).toBeTruthy();
  const publicEstimatePayload = await publicEstimate.json();
  expect(publicEstimatePayload.item.title).toBe(estimateTitle);
  expect(publicEstimatePayload.item).not.toHaveProperty("estimateId");
  expect(publicEstimatePayload.item).not.toHaveProperty("tenantId");
  await expect(customer.getByRole("heading", { name: estimateTitle })).toBeVisible();
  await customer.getByLabel("I have reviewed this estimate and agree to its terms.").check();
  await customer.getByRole("button", { name: "Approve estimate" }).click();
  await expect(customer.getByRole("status")).toHaveText("Thank you. Your estimate is approved.");
  await customer.close();

  // Approval should create the one-time job from the estimate. Check the office
  // UI and use its tenant-scoped list only to identify that unique record.
  await page.goto("/app/jobs");
  await page.getByRole("textbox", { name: "Search jobs" }).fill(serviceName);
  const createdJobLink = page.getByRole("link", { name: /Carter Household/ }).filter({ hasText: serviceName }).first();
  await expect(createdJobLink).toBeVisible();
  const jobHref = await createdJobLink.getAttribute("href");
  expect(jobHref).toMatch(/^\/app\/jobs\/[0-9a-f-]+$/i);
  const jobId = jobHref!.split("/").at(-1)!;
  await createdJobLink.click();
  await expect(page.getByRole("heading", { name: "Details" }).locator("..").getByText("Unscheduled", { exact: true })).toBeVisible();
  await expect(page.getByText(serviceName, { exact: true })).toBeVisible();

  const scheduledDate = await augustaDate(page);
  const jobsResponse = await page.request.get("/api/v1/jobs");
  expect(jobsResponse.ok()).toBeTruthy();
  const allJobs = (await jobsResponse.json()).items as Array<Record<string, unknown>>;
  const targetJob = allJobs.find((job) => job.id === jobId);
  expect(targetJob).toMatchObject({ customerName: "Carter Household", serviceName, status: "unscheduled" });
  const assignable = allJobs.filter((job) => !job.technicianId && !job.technicianName && !["completed", "skipped", "canceled"].includes(String(job.status)));
  expect(assignable.some((job) => job.id === jobId)).toBe(true);

  await page.goto("/app/schedule");
  await page.getByLabel("Schedule date").fill(scheduledDate);
  await page.getByRole("button", { name: `Assign ${serviceName} for Carter Household` }).click();
  await page.getByLabel("Technician").selectOption({ label: "Terry Tech" });
  await page.getByLabel("Service day").fill(scheduledDate);
  await page.getByRole("button", { name: "Assign job" }).click();
  await expect(page.getByText("Job assigned. The route planner can now include it.")).toBeVisible();
  const assignedResponse = await page.request.get(`/api/v1/jobs/${jobId}`);
  expect(assignedResponse.ok()).toBeTruthy();
  expect((await assignedResponse.json()).item).toMatchObject({ status: "scheduled", serviceName });

  await page.goto("/app/routes");
  await page.getByRole("button", { name: "Create route" }).click();
  await page.getByLabel("Service day").fill(scheduledDate);
  await page.getByLabel("Technician").selectOption({ label: "Terry Tech" });
  const routeCreatedResponse = page.waitForResponse((response) =>
    response.url().includes("/api/v1/routes") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create route" }).last().click();
  const routeCreated = await routeCreatedResponse;
  expect(routeCreated.status()).toBe(201);
  const routeId = (await routeCreated.json()).item.id as string;
  await expect(page.getByText("Route created. Optimize it before publishing.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await expect(page.getByText("Route published to the technician.")).toBeVisible();
  const routeResponse = await page.request.get(`/api/v1/routes/${routeId}`);
  expect(routeResponse.ok()).toBeTruthy();
  expect((await routeResponse.json()).item.status).toBe("published");

  const technician = await browser.newPage();
  await signIn(technician, "tech@happyyards.test");
  await expect(technician).toHaveURL(/\/field\/today$/);
  const technicianToday = await technician.request.get("/api/v1/field/today");
  expect(technicianToday.ok()).toBeTruthy();
  const fieldJobs = (await technicianToday.json()).item.jobs as Array<{ id: string; serviceName: string }>;
  expect(fieldJobs.some((job) => job.id === jobId && job.serviceName === serviceName)).toBe(true);
  await technician.goto(`/field/job/${jobId}`);
  await expect(technician.getByRole("heading", { name: "Carter Household" })).toBeVisible();
  await expect(technician.getByRole("definition").filter({ hasText: serviceName })).toBeVisible();
  await technician.getByRole("button", { name: "Start job" }).click();
  await technician.getByLabel("What should the office know?").fill(completionNote);
  await technician.getByLabel("I confirmed the correct property and completed the service.").check();
  await technician.getByLabel("I left gates and access points secure.").check();
  await technician.getByRole("button", { name: "Complete job" }).click();
  await expect(technician.getByText(/^completed$/i)).toBeVisible();
  const completedJob = await technician.request.get(`/api/v1/field/jobs/${jobId}`);
  expect(completedJob.ok()).toBeTruthy();
  expect((await completedJob.json()).item.status).toBe("completed");
  await technician.close();

  // This one-time estimate creates a standalone job without a service plan or
  // billing preference, so it remains eligible for the office's manual invoice flow.
  await page.goto("/app/invoices");
  await page.getByRole("button", { name: "New invoice" }).click();
  await page.getByLabel("Customer", { exact: true }).selectOption({ label: "Carter Household" });
  await page.getByLabel("Description").fill(invoiceDescription);
  await page.getByLabel("Amount").fill("36");
  const invoiceCreatedResponse = page.waitForResponse((response) =>
    response.url().includes("/api/v1/invoices") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create invoice" }).click();
  const invoiceCreated = await invoiceCreatedResponse;
  expect(invoiceCreated.status()).toBe(201);
  const invoice = (await invoiceCreated.json()).item as { id: string; number: string };
  await page.goto(`/app/invoices/${invoice.id}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByText("Issue invoice completed.")).toBeVisible();

  // Carter's seeded portal identity can see this issued invoice. Feedback for a
  // stand-alone one-time job has no portal form, so exercise its customer-auth
  // endpoint directly and verify the accepted rating.
  const portalCustomer = await browser.newPage();
  await signIn(portalCustomer, "customer@happyyards.test");
  await expect(portalCustomer).toHaveURL(/\/portal\/home$/);
  await portalCustomer.getByRole("navigation", { name: "Customer account" }).getByRole("link", { name: "Billing" }).click();
  await expect(portalCustomer.getByRole("heading", { name: `Invoice ${invoice.number}` })).toBeVisible();
  await expect(portalCustomer.getByText(/^issued$/i).first()).toBeVisible();
  await portalCustomer.getByRole("navigation", { name: "Customer account" }).getByRole("link", { name: "Documents" }).click();
  await expect(portalCustomer.getByRole("heading", { name: "Documents" })).toBeVisible();
  await portalCustomer.getByRole("link", { name: "View account statement" }).click();
  await expect(portalCustomer.getByRole("heading", { name: "Account statement" })).toBeVisible();
  await expect(portalCustomer.getByText("Statement month")).toBeVisible();
  const feedback = await portalCustomer.request.post(`/api/v1/portal/feedback/${jobId}`, {
    data: { rating: 5, comment: feedbackComment },
  });
  expect([200, 201]).toContain(feedback.status());
  expect((await feedback.json()).item).toMatchObject({ jobId, rating: 5, comment: feedbackComment });
  await portalCustomer.close();
});
