import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("Demo12345!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(email.startsWith("owner") ? /\/app\/dashboard$/ : /\/field\/today$/);
}

test("legal offline field chains drain independently of a real office conflict, with evidence-safe recovery", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ baseURL });
  const techContext = await browser.newContext({ baseURL });
  try {
    const owner = await ownerContext.newPage();
    const field = await techContext.newPage();
    await signIn(owner, "owner@happyyards.test");
    // Own the fixture: completing a seeded portal customer's visit would add a
    // feedback form to unrelated later tests using that shared customer.
    const customerResponse = await owner.request.post("/api/v1/customers", { data: { name: `Field contract ${Date.now()}`, address: "100 Test Lane" } });
    expect(customerResponse.status(), await customerResponse.text()).toBe(201);
    const customer = (await customerResponse.json()).item;
    expect(customer).toBeTruthy();
    const staffResponse = await owner.request.get("/api/v1/staff");
    expect(staffResponse.ok()).toBe(true);
    const technician = (await staffResponse.json()).items.find((item: { name: string }) => item.name === "Terry Tech");
    const date = "2026-10-20";
    async function createJob() {
      const response = await owner.request.post("/api/v1/jobs", { data: { customerId: customer.id, serviceName: "Yard cleanup", scheduledDate: date } });
      expect(response.status(), await response.text()).toBe(201);
      const id = (await response.json()).item.id as string;
      const assignment = await owner.request.post(`/api/v1/jobs/${id}/assign`, { data: { technicianId: technician.id, scheduledDate: date } });
      expect(assignment.ok(), await assignment.text()).toBe(true);
      return id;
    }
    const jobA = await createJob();
    const jobB = await createJob();
    const routeResponse = await owner.request.post("/api/v1/routes", { data: { date, technicianId: technician.id } });
    expect(routeResponse.status(), await routeResponse.text()).toBe(201);
    const routeId = (await routeResponse.json()).item.id;
    const published = await owner.request.post(`/api/v1/routes/${routeId}/publish`, { data: {} });
    expect(published.ok(), await published.text()).toBe(true);
    expect((await published.json()).item.stops.map((stop: { status: string }) => stop.status)).toEqual(["dispatched", "dispatched"]);
    const scheduledJob = await createJob();
    await signIn(field, "tech@happyyards.test");
    await field.goto(`/field/job/${scheduledJob}`);
    await expect(field.getByText(/^Scheduled$/i)).toBeVisible();
    await expect(field.getByRole("button", { name: /Start job|On my way|Pause job|Resume job|Complete job/ })).toHaveCount(0);
    const invalid = await field.request.post(`/api/v1/jobs/${scheduledJob}/transition`, { data: { status: "in_progress" } });
    expect(invalid.status(), await invalid.text()).toBe(409);
    expect((await invalid.json()).error.code).toBe("INVALID_TRANSITION");

    await field.goto(`/field/job/${jobA}`);
    await expect(field.getByText(/^Dispatched$/i)).toBeVisible();
    await expect.poll(() => field.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await techContext.setOffline(true);
    await field.getByRole("button", { name: "On my way" }).click();
    await expect(field.getByText(/^En route$/i)).toBeVisible();
    const evidence = `Offline evidence ${Date.now()}`;
    await field.getByLabel("What should the office know?").fill(evidence);
    await field.getByRole("button", { name: "Save note" }).click();
    await expect(field.getByLabel(/Queued update/)).toHaveCount(2);
    const canceled = await owner.request.post(`/api/v1/jobs/${jobA}/transition`, { data: { status: "canceled", reason: "Customer canceled while technician offline" } });
    expect(canceled.ok(), await canceled.text()).toBe(true);
    await techContext.setOffline(false);
    await field.getByRole("button", { name: "Try syncing now" }).click();
    await expect(field.getByLabel(/Queued update/).first()).toContainText("Current state: Canceled");
    await expect(field.getByLabel(/Queued update/).nth(1)).toContainText("Waiting for an earlier update for this work item");
    await expect(field.getByLabel(/Queued update/).nth(1).getByRole("button", { name: "Retry update" })).toBeDisabled();
    await field.getByLabel(/Queued update/).first().getByRole("link", { name: "Review current job" }).click();
    await expect(field.getByText(/^Canceled$/i)).toBeVisible();
    await expect(field.getByRole("button", { name: /Start job|On my way|Can’t complete|Complete job/ })).toHaveCount(0);

    await field.goto(`/field/job/${jobB}`);
    await expect(field.getByText(/^Dispatched$/i)).toBeVisible();
    await techContext.setOffline(true);
    for (const [action, state] of [["On my way", "En route"], ["Start job", "In progress"], ["Pause job", "Paused"], ["Resume job", "In progress"]]) {
      await field.getByRole("button", { name: action, exact: true }).click();
      await expect(field.getByText(new RegExp(`^${state}$`, "i"))).toBeVisible();
    }
    const completionEvidence = `Offline completion ${Date.now()}`;
    await field.getByLabel("What should the office know?").fill(completionEvidence);
    await field.getByLabel(/I confirmed the correct property/).check();
    await field.getByLabel(/I left gates and access points secure/).check();
    await field.getByRole("button", { name: /Complete job/ }).click();
    await expect(field.getByText(/^Completed$/i)).toBeVisible();
    const stored = await field.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith("modular-field-queue-v2:"))!) || "[]"));
    expect(stored.filter((item: { entityId: string }) => item.entityId === jobB).map((item: { expectedPriorState: string }) => item.expectedPriorState)).toEqual(["dispatched", "en_route", "in_progress", "paused", "in_progress"]);
    await techContext.setOffline(false);
    await field.getByRole("button", { name: "Try syncing now" }).click();
    await expect(field.getByLabel(/Queued update/)).toHaveCount(2);
    const completedJob = await owner.request.get(`/api/v1/jobs/${jobB}`);
    expect(completedJob.ok(), await completedJob.text()).toBe(true);
    expect((await completedJob.json()).item).toMatchObject({ status: "completed", customerSummary: completionEvidence });
    const completion = stored.find((item: { entityId: string; path: string }) => item.entityId === jobB && item.path.endsWith("/complete"));
    const replay = await field.request.post(`/api/v1/field/jobs/${jobB}/complete`, { data: { ...completion.payload, clientOperationId: completion.id, deviceTimestamp: completion.createdAt } });
    expect(replay.ok(), await replay.text()).toBe(true);
    expect((await replay.json()).duplicate).toBe(true);

    const first = field.getByLabel(/Queued update/).first();
    await first.getByRole("button", { name: "Retry after review" }).click();
    await expect(first).toContainText("Current state: Canceled");
    await expect(field.getByLabel(/Queued update/)).toHaveCount(2);
    await field.getByLabel(/Queued update/).nth(1).getByText("Review saved details and evidence").click();
    await expect(field.getByLabel(/Queued update/).nth(1)).toContainText(evidence);
    const downloadPromise = field.waitForEvent("download");
    await first.getByRole("button", { name: "Download saved details" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^field-updates-.*\.json$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(exported).toHaveLength(2);
    expect(exported[1].payload.text).toBe(evidence);
    const dismissed = field.waitForEvent("dialog").then((dialog) => dialog.dismiss());
    await first.getByRole("button", { name: "Discard saved update" }).click();
    await dismissed;
    await expect(field.getByLabel(/Queued update/)).toHaveCount(2);
    const accepted = field.waitForEvent("dialog").then((dialog) => { expect(dialog.message()).toContain("Discard 2 saved updates"); return dialog.accept(); });
    await first.getByRole("button", { name: "Discard saved update" }).click();
    await accepted;
    await expect(field.getByLabel(/Queued update/)).toHaveCount(0);
    await field.goto(`/field/job/${jobA}`);
    await expect(field.getByText(/^Canceled$/i)).toBeVisible();
    await expect(field.getByRole("button", { name: /Start job|On my way|Can’t complete|Complete job/ })).toHaveCount(0);
    await field.goto(`/field/job/${scheduledJob}`);
    await field.getByRole("button", { name: "Can’t complete" }).click();
    await field.getByLabel("Reason").selectOption("gate_locked");
    await field.getByRole("button", { name: "Record skip" }).click();
    await expect(field.getByText(/^Skipped$/i)).toBeVisible();
  } finally {
    await techContext.close();
    await ownerContext.close();
  }
});
