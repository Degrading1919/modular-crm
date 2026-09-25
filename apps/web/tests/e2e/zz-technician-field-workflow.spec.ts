import { expect, test, type Page } from "@playwright/test";

const password = "Demo12345!";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
}

function businessDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

test("owner publishes an ordered route and technician completes the field workday", async ({ browser }) => {
  test.setTimeout(90_000);

  // Keep owner setup and technician execution in separate auth sessions.
  const ownerContext = await browser.newContext({ baseURL });
  const fieldContext = await browser.newContext({ baseURL });
  try {
    const owner = await ownerContext.newPage();
    await signIn(owner, "owner@happyyards.test");
    await expect(owner).toHaveURL(/\/app\/dashboard$/);

    const today = businessDate();
    const unique = Date.now();
    const jobs: Array<{ id: string; instruction: string }> = [];
    for (const customer of ["Carter Household", "Nguyen Household"]) {
      const instruction = `Field access note ${unique} ${customer}`;
      await owner.goto("/app/jobs");
      await owner.getByRole("button", { name: /^New job$/i }).click();
      await owner.getByLabel("Customer", { exact: true }).selectOption({ label: customer });
      await owner.getByLabel("Service", { exact: true }).selectOption({ label: "Yard cleanup" });
      await owner.getByLabel("Service day").fill(today);
      await owner.getByLabel("Job instructions").fill(instruction);
      const createdResponse = owner.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/v1/jobs" && response.request().method() === "POST",
      );
      await owner.getByRole("button", { name: "Create job", exact: true }).click();
      const response = await createdResponse;
      expect(response.ok(), await response.text()).toBeTruthy();
      jobs.push({ id: (await response.json()).item.id as string, instruction });
    }

    const staffResponse = await owner.request.get("/api/v1/staff");
    expect(staffResponse.ok()).toBeTruthy();
    const staff = (await staffResponse.json()).items as Array<{ id: string; name: string; role?: string }>;
    const technician = staff.find((person) => person.name === "Terry Tech");
    expect(technician, "the seeded Terry Tech membership is available to the owner").toBeTruthy();

    for (const job of jobs) {
      const response = await owner.request.post(`/api/v1/jobs/${job.id}/assign`, {
        data: { technicianId: technician!.id, scheduledDate: today },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    }

    const routeResponse = await owner.request.post("/api/v1/routes", {
      data: { date: today, technicianId: technician!.id },
    });
    expect(routeResponse.status(), await routeResponse.text()).toBe(201);
    const route = (await routeResponse.json()).item as {
      id: string;
      status: string;
      stops: Array<{ jobId: string; sequence: number }>;
    };
    expect(route.status).toBe("draft");
    expect(route.stops).toHaveLength(2);
    expect(route.stops.map((stop) => stop.sequence)).toEqual([1, 2]);
    const orderedJobIds = route.stops.map((stop) => stop.jobId);

    const publishResponse = await owner.request.post(`/api/v1/routes/${route.id}/publish`, { data: {} });
    expect(publishResponse.ok(), await publishResponse.text()).toBeTruthy();
    expect((await publishResponse.json()).item.status).toBe("published");

    const field = await fieldContext.newPage();
    await signIn(field, "tech@happyyards.test");
    await expect(field).toHaveURL(/\/field\/today$/);
    const profileResponse = await field.request.get("/api/v1/field/profile");
    expect(profileResponse.ok()).toBeTruthy();
    expect((await profileResponse.json()).item.id).toBe(technician!.id);
    const priorTimeResponse = await field.request.get("/api/v1/field/time");
    expect(priorTimeResponse.ok()).toBeTruthy();
    const priorShiftStatus = (await priorTimeResponse.json()).item.shift.status as string;
    if (priorShiftStatus === "on_break") {
      const endedBreak = await field.request.post("/api/v1/field/time", { data: { action: "break_end" } });
      expect(endedBreak.ok(), await endedBreak.text()).toBeTruthy();
    }
    if (["clocked_in", "on_break"].includes(priorShiftStatus)) {
      const clockedOut = await field.request.post("/api/v1/field/time", { data: { action: "clock_out" } });
      expect(clockedOut.ok(), await clockedOut.text()).toBeTruthy();
    }
    const fieldRouteResponse = await field.request.get("/api/v1/field/route");
    expect(fieldRouteResponse.ok()).toBeTruthy();
    const fieldRoute = (await fieldRouteResponse.json()).item;
    expect(fieldRoute.route.status).toBe("published");
    expect(fieldRoute.jobs.map((job: { id: string }) => job.id)).toEqual(orderedJobIds);

    await field.getByRole("navigation", { name: "Field navigation" }).getByRole("link", { name: "Time" }).click();
    await field.getByRole("button", { name: "Clock in" }).click();
    await expect(field.getByText(/^Clocked in$/i)).toBeVisible();

    await field.getByRole("navigation", { name: "Field navigation" }).getByRole("link", { name: "Route" }).click();
    const openJobs = field.getByRole("link", { name: /Open job/i });
    await expect(openJobs).toHaveCount(2);
    const visibleOrder = await openJobs.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(visibleOrder).toEqual(orderedJobIds.map((id) => `/field/job/${id}`));

    await openJobs.first().click();
    await expect(field.getByText("Before you begin")).toBeVisible();
    await expect(field.getByText("Expected time", { exact: true })).toBeVisible();
    await expect(field.getByText(jobs.find((job) => job.id === orderedJobIds[0])!.instruction)).toBeVisible();
    await field.getByRole("button", { name: "Start job" }).click();
    await expect(field.getByText(/^In progress$/i)).toBeVisible();
    const completionNote = `Completed field checklist ${unique}`;
    await field.getByLabel("What should the office know?").fill(completionNote);
    await field.getByLabel(/Confirm the service address/).check();
    await field.getByLabel(/Review access and safety notes/).check();
    await field.getByLabel(/Complete the cleanup/).check();
    await field.getByRole("button", { name: /Complete job/ }).click();
    await expect(field.getByText(/^Completed$/i)).toBeVisible();

    await field.goto(`/field/job/${orderedJobIds[1]}`);
    await expect(field.getByText("Before you begin")).toBeVisible();
    await expect(field.getByText(jobs.find((job) => job.id === orderedJobIds[1])!.instruction)).toBeVisible();
    await field.getByRole("button", { name: "Can’t complete" }).click();
    await field.getByLabel("Reason").selectOption("gate_locked");
    await field.getByLabel("More details (optional)").fill(`Route stop unavailable ${unique}`);
    await field.getByRole("button", { name: "Record skip" }).click();
    await expect(field.getByText(/^Skipped$/i)).toBeVisible();

    await field.getByRole("navigation", { name: "Field navigation" }).getByRole("link", { name: "Time" }).click();
    await field.getByRole("button", { name: "Start break" }).click();
    await expect(field.getByText(/^On break$/i)).toBeVisible();
    await field.getByRole("button", { name: "End break" }).click();
    await expect(field.getByText(/^Clocked in$/i)).toBeVisible();
    await field.getByLabel("Miles").fill("2.5");
    await field.getByRole("button", { name: "Save mileage" }).click();
    await expect(field.getByText("2.5 mi", { exact: true })).toBeVisible();
    await field.getByRole("button", { name: "Clock out" }).click();
    await expect(field.getByText(/^Clocked out$/i)).toBeVisible();
  } finally {
    await fieldContext.close();
    await ownerContext.close();
  }
});
