import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createDatabase, closeDatabase, consumeRateLimit, resetRateLimit, domainEvents } from "@modular-crm/db";
import { eq } from "drizzle-orm";

test("wrong passwords remain bounded when every sign-in spoofs a different forwarded address", async ({ request }) => {
  const email = `guess-${randomUUID()}@example.test`;
  for (let i = 0; i < 20; i++) {
    const response = await request.post(i % 2 ? "/api/v1/auth/login" : "/api/auth/sign-in/email", {
      headers: { "x-forwarded-for": `198.51.100.${i + 1}` }, data: { email, password: "wrong-password" },
    });
    if (i < 5) expect(response.status()).toBe(401);
    if (i >= 10) { expect(response.status()).toBe(429); expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0); }
  }
});

test("two independent PostgreSQL clients share a single atomic request budget", async () => {
  const first = createDatabase(process.env.DATABASE_URL!), second = createDatabase(process.env.DATABASE_URL!);
  const key = `integration:${randomUUID()}`;
  try {
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => consumeRateLimit(i % 2 ? first : second, key, 10, 60_000)));
    expect(results.filter(r => r.allowed)).toHaveLength(10);
    expect(results.filter(r => !r.allowed).every(r => r.retryAfter >= 1 && r.retryAfter <= 60)).toBe(true);
  } finally { await resetRateLimit(first, key); await closeDatabase(first); await closeDatabase(second); }
});

test("independent visitors share form limits and receive safe request IDs and Retry-After", async ({ playwright, baseURL }) => {
  const headers = { "x-forwarded-for": `198.51.100.${Date.now()}` };
  const first = await playwright.request.newContext({ baseURL, extraHTTPHeaders: headers });
  const second = await playwright.request.newContext({ baseURL, extraHTTPHeaders: headers });
  try {
    const data = { slug: "missing-pilot-site", address: "123 Main Street", zip: "30901" };
    for (let i = 0; i < 40; i++) expect((await (i % 2 ? first : second).post("/api/v1/public/eligibility", { data })).status()).toBe(404);
    const response = await first.post("/api/v1/public/eligibility", { data });
    expect(response.status()).toBe(429); expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
    expect(response.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect((await response.json()).error.message).toContain("try again");
  } finally { await first.dispose(); await second.dispose(); }
});

test("an owner action persists its request ID in the domain event and active-rule editor explains its cutoff", async ({ page }) => {
  const login = await page.request.post("/api/v1/auth/login", { data: { email: "owner@happyyards.test", password: "Demo12345!" } });
  expect(login.ok()).toBe(true);
  const id = randomUUID();
  const response = await page.request.post("/api/v1/leads", { headers: { "x-request-id": id }, data: { name: "Pilot trace inquiry", email: `pilot-${id}@example.test` } });
  expect(response.status()).toBe(201); expect(response.headers()["x-request-id"]).toBe(id);
  const db = createDatabase(process.env.DATABASE_URL!);
  try { expect((await db.select().from(domainEvents).where(eq(domainEvents.requestId, id))).some(e => e.eventType === "lead.created")).toBe(true); }
  finally { await closeDatabase(db); }
  await page.goto("/app/automations");
  const quoteRecipe = page.locator("article").filter({ has: page.getByText("Follow up on unanswered quotes", { exact: true }) });
  await expect(quoteRecipe).toBeVisible();
  await expect(quoteRecipe.getByText("Draft", { exact: true })).toBeVisible();
  await quoteRecipe.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Wait this many days")).toHaveValue("7");
  await expect(page.getByRole("combobox", { name: "When this happens", exact: true })).toHaveValue("estimate.sent");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator("article").filter({ has: page.getByText("Completion thank-you", { exact: true }) }).getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByText("Changes apply to new activity from now on.", { exact: true })).toBeVisible();
});
