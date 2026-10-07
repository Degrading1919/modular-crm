import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { automationRules, automationRuns, communicationEvents, connectorInstallations, consentRecords, emailUnsubscribeTarget, emailUnsubscribeToken, messageTemplates,
  loadEmailBusiness, organizationLocations, outboundMessages, platformEmailUsage, platformEmailPolicies, accountEmailUsage, reserveAccountEmail, jobs, readEmailUnsubscribeToken, reservePlatformEmail, schema, seedDevelopment, seedIds, unsubscribeEmail, tenants, sealAccountEmail, type Database } from "@modular-crm/db";
import { ConnectorRegistry, createConnectorRegistry } from "@modular-crm/connectors";
import { createGoogleWorkspaceConnector } from "../../../packages/connectors/src/providers/google-workspace.ts";
import { readServerConfig } from "@modular-crm/config";
import { sealSecret } from "@modular-crm/domain";
import { processOutboundMessage } from "./messages-db.js";
import { hydrateMessagingConnector } from "./messaging-connectors.js";
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", async (importOriginal) => {
  const original = await importOriginal<{ default: typeof import("nodemailer") }>();
  return { default: { createTransport: vi.fn((options: { streamTransport?: boolean }) => options.streamTransport ? original.default.createTransport({ streamTransport: true, buffer: true, newline: "windows" }) : { sendMail }) } };
});
let pglite: PGlite; let db: Database;
const secret = "platform-email-integration-secret-32-characters";
const config = readServerConfig({ NODE_ENV: "test", MOCK_CONNECTORS: "false", SMTP_HOST: "localhost", SMTP_FROM: "Platform <mail@platform.test>", APP_BASE_URL: "http://localhost:3000" });
beforeAll(async () => {
  pglite = new PGlite(); const database = drizzle(pglite, { schema });
  await migrate(database, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = database as unknown as Database; await seedDevelopment(db);
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubEnv("CONNECTOR_CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64url"));
  vi.stubEnv("GOOGLE_CLIENT_ID", "local-test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "local-test-secret");
}, 120_000);
afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await pglite?.close(); });
beforeEach(() => { sendMail.mockReset(); sendMail.mockResolvedValue({ accepted: ["carter@example.test"], rejected: [], messageId: "smtp-accepted" }); });
async function message(category = "automation", tenantId = seedIds.happyTenant, customerId = seedIds.carter) {
  return (await db.insert(outboundMessages).values({ tenantId, customerId, channel: "email", category, recipient: "carter@example.test",
    renderedSubject: "Your next visit", renderedBody: "We will see you soon.", status: "queued", idempotencyKey: crypto.randomUUID() }).returning())[0]!;
}
async function deliver(id: string, tenantId = seedIds.happyTenant) {
  return processOutboundMessage(db, createConnectorRegistry({ includePlannedProviders: true }), { tenantId, messageId: id }, new Date(), config);
}
it("reserves service headroom against a marketing burst and applies an operator override only to its tenant", async () => {
  const now = new Date("2026-10-06T09:00:00Z");
  const [tenant] = await db.insert(tenants).values({ name: "Burst", slug: crypto.randomUUID(), status: "active", createdAt: new Date("2026-01-01") }).returning();
  const limits = { hourly: 5, daily: 10, firstWeekHourly: 2, firstWeekDaily: 3 };
  for (let i=0; i<4; i++) expect(await reservePlatformEmail(db, tenant!.id, limits, now, "marketing")).toEqual({ allowed: true });
  expect(await reservePlatformEmail(db, tenant!.id, limits, now, "marketing")).toMatchObject({ allowed: false });
  expect(await reservePlatformEmail(db, tenant!.id, limits, now, "service")).toEqual({ allowed: true });
  expect(await reservePlatformEmail(db, tenant!.id, limits, now, "service")).toMatchObject({ allowed: false });
  await db.insert(platformEmailPolicies).values({ tenantId: tenant!.id, hourly: 10, daily: 20, firstWeekHourly: 5, firstWeekDaily: 10 });
  expect(await reservePlatformEmail(db, tenant!.id, limits, now, "service")).toEqual({ allowed: true });
});
it("account mail bypasses exhausted tenant caps but has a global case-insensitive recipient limit", async () => {
  const now = new Date("2026-10-06T12:30:00Z");
  await db.delete(platformEmailUsage).where(eq(platformEmailUsage.tenantId, seedIds.happyTenant));
  const limited = { ...config, platformEmailLimits: { hourly: 1, daily: 1, firstWeekHourly: 1, firstWeekDaily: 1 } };
  expect(await reservePlatformEmail(db, seedIds.happyTenant, limited.platformEmailLimits, now)).toEqual({ allowed: true });
  const [row] = await db.insert(outboundMessages).values({ tenantId: seedIds.happyTenant, category: "account", channel: "email", recipient: "account-limit@example.test", renderedBody: sealAccountEmail("Account link", secret), status: "queued", idempotencyKey: crypto.randomUUID() }).returning();
  expect(await processOutboundMessage(db, createConnectorRegistry(), { tenantId: row!.tenantId, messageId: row!.id }, now, limited)).toBe("sent");
  for (let i=0; i<4; i++) expect(await reserveAccountEmail(db, "ACCOUNT-LIMIT@example.test", now)).toEqual({ allowed: true });
  expect(await reserveAccountEmail(db, "account-limit@example.test", now)).toMatchObject({ allowed: false });
  expect(await reserveAccountEmail(db, "other-recipient@example.test", now)).toEqual({ allowed: true });
  expect(await reserveAccountEmail(db, "account-limit@example.test", new Date("2026-10-06T13:00:00Z"))).toEqual({ allowed: true });
  expect((await db.select().from(platformEmailUsage).where(eq(platformEmailUsage.tenantId, seedIds.happyTenant)))[0]).toMatchObject({ dailyCount: 1, hourlyCount: 1 });
  expect(JSON.stringify(await db.select().from(accountEmailUsage))).not.toContain("example.test");
  await db.delete(platformEmailUsage).where(eq(platformEmailUsage.tenantId, seedIds.happyTenant));
});
it("expires a delayed reminder before transport when the real visit deadline has passed", async () => {
  const [job] = await db.select().from(jobs).where(eq(jobs.tenantId, seedIds.happyTenant)).limit(1);
  const previous = { status: job!.status, serviceWindowStart: job!.serviceWindowStart };
  await db.update(jobs).set({ status: "dispatched", serviceWindowStart: new Date("2026-10-06T10:00:00Z") }).where(eq(jobs.id, job!.id));
  try {
    const [row] = await db.insert(outboundMessages).values({ tenantId: job!.tenantId, customerId: job!.customerId, jobId: job!.id, category: "service", templateKey: "appointment-reminder", channel: "email", recipient: "expiry@example.test", renderedBody: "Your visit", status: "queued", expiresAt: new Date("2026-10-06T10:00:00Z"), nextSendAt: new Date("2026-10-07T00:00:00Z"), idempotencyKey: crypto.randomUUID() }).returning();
    expect(await processOutboundMessage(db, createConnectorRegistry(), { tenantId: row!.tenantId, messageId: row!.id }, new Date("2026-10-06T10:01:00Z"), config)).toBe("suppressed");
    expect(sendMail).not.toHaveBeenCalled();
    expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, row!.id)))[0]).toMatchObject({ failureCode: "reminder_expired" });
  } finally { await db.update(jobs).set(previous).where(eq(jobs.id, job!.id)); }
});
it("uses platform mail without a connector and records acceptance; replay cannot duplicate a completed send", async () => {
  const row = await message();
  await expect(deliver(row.id, seedIds.cleanTenant)).resolves.toBe("skipped");
  await expect(deliver(row.id)).resolves.toBe("sent");
  await expect(deliver(row.id)).resolves.toBe("skipped");
  expect(sendMail).toHaveBeenCalledOnce();
  const sent = sendMail.mock.calls[0]![0];
  expect(sent).toMatchObject({ from: { name: "Happy Yards Pet Waste via Modular CRM", address: "mail@platform.test" }, replyTo: "hello@happyyards.local",
    text: expect.stringContaining("125 Broad Street"), html: expect.stringContaining("Stop promotional emails"), headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
  const [saved] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, row.id));
  expect(saved).toMatchObject({ status: "sent", connectorInstallationId: null, providerReference: "smtp-accepted" });
  const events = await db.select().from(communicationEvents).where(eq(communicationEvents.outboundMessageId, row.id));
  expect(events).toMatchObject([{ eventType: "sent", payload: { mode: "platform", environment: "test", acceptedByProvider: true } }]);
});
it("retries a transport failure, records a safe failure, and sends on the existing retry state", async () => {
  const row = await message("transactional");
  sendMail.mockRejectedValueOnce(new Error("smtp password private transport diagnostic"));
  await expect(deliver(row.id)).rejects.toMatchObject({ code: "provider_error", retryable: true });
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, row.id)))[0]).toMatchObject({ status: "retry", failureMessage: "We couldn’t send this message. We’ll try again." });
  expect((await db.select().from(communicationEvents).where(eq(communicationEvents.outboundMessageId, row.id)))[0]).toMatchObject({ eventType: "failed", payload: { retryable: true } });
  await expect(deliver(row.id)).resolves.toBe("sent");
});
it("verifies unsubscribe authority and persists an idempotent customer opt-out without suppressing receipts or other tenants", async () => {
  const row = await message(); const target = { tenantId: row.tenantId, customerId: row.customerId!, messageId: row.id };
  const token = emailUnsubscribeToken(target, secret);
  expect(readEmailUnsubscribeToken(token, "different-secret")).toBeUndefined();
  expect(readEmailUnsubscribeToken(`${token}x`, secret)).toBeUndefined();
  expect(await emailUnsubscribeTarget(db, emailUnsubscribeToken({ ...target, tenantId: seedIds.cleanTenant }, secret), secret)).toBeUndefined();
  expect(await emailUnsubscribeTarget(db, token, secret)).toEqual(target);
  expect(await db.select().from(consentRecords).where(and(eq(consentRecords.customerId, seedIds.carter), eq(consentRecords.category, "marketing")))).toHaveLength(0);
  expect(await unsubscribeEmail(db, token, secret)).toBe(true);
  expect(await unsubscribeEmail(db, token, secret)).toBe(true);
  expect(await db.select().from(consentRecords).where(and(eq(consentRecords.customerId, seedIds.carter), eq(consentRecords.category, "marketing")))).toMatchObject([{ state: "opted_out", source: "email_unsubscribe" }]);
  const next = await message(); await expect(deliver(next.id)).resolves.toBe("suppressed");
  expect(sendMail).not.toHaveBeenCalled();
  const receipt = await message("transactional"); await expect(deliver(receipt.id)).resolves.toBe("sent");
  expect(sendMail.mock.calls[0]![0].headers).toBeUndefined();
  expect(await unsubscribeEmail(db, emailUnsubscribeToken({ ...target, messageId: receipt.id }, secret), secret)).toBe(false);
  const other = await message("automation", seedIds.cleanTenant, seedIds.cleanCarter);
  await expect(deliver(other.id, seedIds.cleanTenant)).resolves.toBe("sent");
});
it("uses the actual branch, does not fabricate an address, and records unusable automated mail as failed", async () => {
  expect(await loadEmailBusiness(db, seedIds.happyTenant, { locationId: seedIds.franchiseEastLocation })).toMatchObject({ name: "Happy Yards East", replyTo: "east@happyyards.local", address: expect.stringContaining("220 Central Avenue") });
  expect(await loadEmailBusiness(db, seedIds.cleanTenant, { locationId: seedIds.franchiseEastLocation })).not.toHaveProperty("address");
  await db.update(organizationLocations).set({ addressLine1: null }).where(eq(organizationLocations.id, seedIds.northAugusta));
  const row = await message("automation", seedIds.happyTenant, seedIds.riverfront);
  await expect(deliver(row.id)).resolves.toBe("failed"); expect(sendMail).not.toHaveBeenCalled();
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, row.id)))[0]).toMatchObject({ status: "failed", failureCode: "business_details_missing", failureMessage: "Choose a customer and add the business address before sending promotional emails." });
});

it("sends service reminders without an address after promotional opt-out, while marketing stays suppressed", async () => {
  await db.update(organizationLocations).set({ addressLine1: null }).where(eq(organizationLocations.id, seedIds.augusta));
  await db.insert(consentRecords).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter, channel: "email", category: "marketing", state: "opted_out", source: "test", actorType: "customer" });
  const reminder = await message("service"); await expect(deliver(reminder.id)).resolves.toBe("sent");
  expect(sendMail.mock.calls[0]![0]).toMatchObject({ text: "We will see you soon.\n\nHappy Yards Pet Waste", headers: undefined });
  const promotion = await message("marketing"); await expect(deliver(promotion.id)).resolves.toBe("suppressed");
  expect(sendMail).toHaveBeenCalledOnce();
  await db.update(organizationLocations).set({ addressLine1: "125 Broad Street" }).where(eq(organizationLocations.id, seedIds.augusta));
});

it("keeps capped mail queued, enforces both windows, and resumes using a fake clock without duplicating replay", async () => {
  await db.delete(platformEmailUsage).where(eq(platformEmailUsage.tenantId, seedIds.happyTenant));
  await db.update(tenants).set({ createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(tenants.id, seedIds.happyTenant));
  const limited = { ...config, platformEmailLimits: { hourly: 1, daily: 2, firstWeekHourly: 1, firstWeekDaily: 1 } };
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-06T10:30:00Z"));
    const a = await message("service"); const b = await message("service"); const c = await message("service");
    const send = (id: string) => processOutboundMessage(db, createConnectorRegistry(), { tenantId: seedIds.happyTenant, messageId: id }, new Date(), limited);
    expect(await send(a.id)).toBe("sent"); expect(await send(b.id)).toBe("queued");
    expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, b.id)))[0]).toMatchObject({ status: "queued", failureCode: "email_hourly_limit", nextSendAt: new Date("2026-10-06T11:00:00Z") });
    expect(await send(b.id)).toBe("skipped"); expect(sendMail).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date("2026-10-06T11:00:00Z")); expect(await send(b.id)).toBe("sent");
    expect(await send(c.id)).toBe("queued");
    expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, c.id)))[0]).toMatchObject({ status: "queued", failureCode: "email_daily_limit", failureMessage: "Daily email limit reached; this will send tomorrow.", nextSendAt: new Date("2026-10-07T00:00:00Z") });
    vi.setSystemTime(new Date("2026-10-07T00:00:00Z")); expect(await send(c.id)).toBe("sent"); expect(await send(c.id)).toBe("skipped");
    expect(sendMail).toHaveBeenCalledTimes(3);
  } finally { vi.useRealTimers(); await db.delete(platformEmailUsage).where(eq(platformEmailUsage.tenantId, seedIds.happyTenant)); }
});

it("delivers encrypted tenant account mail despite customer preferences and without exposing account links in stored bodies", async () => {
  const privateText = "Set your password: https://crm.test/reset-password/private-token";
  const [row] = await db.insert(outboundMessages).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter, category: "account", channel: "email",
    recipient: "carter@example.test", renderedBody: sealAccountEmail(privateText, secret), renderedSubject: "Account access", status: "queued", idempotencyKey: crypto.randomUUID() }).returning();
  expect(row!.renderedBody).not.toContain("private-token");
  await expect(deliver(row!.id)).resolves.toBe("sent"); expect(sendMail.mock.calls[0]![0].text).toContain(privateText);
  expect(sendMail.mock.calls[0]![0].headers).toBeUndefined();
});

it("uses the lower cap for exactly the first seven days, with tenant-isolated counters", async () => {
  const [tenant] = await db.insert(tenants).values({ name: "New business", slug: crypto.randomUUID(), status: "active", createdAt: new Date("2026-10-01T00:00:00Z") }).returning();
  const limits = { hourly: 3, daily: 10, firstWeekHourly: 1, firstWeekDaily: 2 };
  expect(await reservePlatformEmail(db, tenant!.id, limits, new Date("2026-10-07T23:30:00Z"))).toEqual({ allowed: true });
  expect(await reservePlatformEmail(db, tenant!.id, limits, new Date("2026-10-07T23:30:00Z"))).toMatchObject({ allowed: false, code: "email_hourly_limit" });
  for (let index=0; index<3; index++) expect(await reservePlatformEmail(db, tenant!.id, limits, new Date("2026-10-08T00:00:00Z"))).toEqual({ allowed: true });
  expect(await reservePlatformEmail(db, tenant!.id, limits, new Date("2026-10-08T00:00:00Z"))).toMatchObject({ allowed: false, code: "email_hourly_limit" });
});
it("prefers a tenant's connected email provider and fails closed for broken credentials; SMS still needs a connector", async () => {
  const key = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY!;
  const [installed] = await db.insert(connectorInstallations).values({ tenantId: seedIds.cleanTenant, connectorKey: "google-workspace", status: "connected", displayName: "Own email" }).returning();
  const credentials = sealSecret(JSON.stringify({ tenantId: seedIds.cleanTenant, installationId: installed!.id, connectorKey: "google-workspace",
    secret: JSON.stringify({ accessToken: "local-test-token", grantedScopes: ["https://www.googleapis.com/auth/gmail.send"] }) }), key);
  await db.update(connectorInstallations).set({ credentialReference: credentials }).where(eq(connectorInstallations.id, installed!.id));
  const provider = vi.fn(async () => new Response(JSON.stringify({ id: "gmail-accepted" }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", provider);
  const registry = new ConnectorRegistry();
  registry.register(createGoogleWorkspaceConnector({ clientId: "local-client", clientSecret: "local-secret", fetcher: provider }));
  expect(await hydrateMessagingConnector(db, registry, seedIds.cleanTenant, "email", false)).toEqual({ mode: "connected", installationId: installed!.id });
  await expect(registry.getCapability(seedIds.cleanTenant, "email")!.sendEmail({ to: "carter@example.test", subject: "Receipt", body: "Paid", idempotencyKey: "provider-receipt" })).resolves.toEqual({ status: "sent", reference: "gmail-accepted" });
  expect(provider).toHaveBeenCalledOnce(); expect(sendMail).not.toHaveBeenCalled();
  const receipt = await message("transactional", seedIds.cleanTenant, seedIds.cleanCarter);
  const usageBefore = await db.select().from(platformEmailUsage).where(eq(platformEmailUsage.tenantId, seedIds.cleanTenant));
  await expect(processOutboundMessage(db, registry, { tenantId: seedIds.cleanTenant, messageId: receipt.id }, new Date(), config)).resolves.toBe("sent");
  expect(provider).toHaveBeenCalledTimes(2); expect(sendMail).not.toHaveBeenCalled();
  expect(await db.select().from(platformEmailUsage).where(eq(platformEmailUsage.tenantId, seedIds.cleanTenant))).toEqual(usageBefore);
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, receipt.id)))[0]).toMatchObject({ connectorInstallationId: installed!.id, providerReference: "gmail-accepted" });
  await db.update(connectorInstallations).set({ credentialReference: null }).where(eq(connectorInstallations.id, installed!.id));
  await expect(hydrateMessagingConnector(db, registry, seedIds.cleanTenant, "email", false)).rejects.toMatchObject({ code: "authorization_expired" });
  await expect(hydrateMessagingConnector(db, createConnectorRegistry(), seedIds.cleanTenant, "sms", false)).rejects.toMatchObject({ code: "not_connected", message: "Connect a texting service" });
});
it("backfills only ledger-proven automation messages on upgrade, so queued work cannot bypass the new opt-out", async () => {
  const automation = await message("transactional"); const manual = await message("transactional");
  const otherTenant = await message("transactional", seedIds.cleanTenant, seedIds.cleanCarter);
  await db.update(outboundMessages).set({ idempotencyKey: automation.idempotencyKey }).where(eq(outboundMessages.id, otherTenant.id));
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.tenantId, seedIds.happyTenant)).limit(1);
  await db.update(automationRuns).set({ contextSnapshot: { event: { eventType: "job.completed" }, plan: { actions: [{ executionKey: automation.idempotencyKey }] } } }).where(eq(automationRuns.id, run!.id));
  const migration = readFileSync(new URL("../../../packages/db/drizzle/0011_famous_rafael_vega.sql", import.meta.url), "utf8");
  await db.execute(sql.raw(migration.split("--> statement-breakpoint")[1]!));
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, automation.id)))[0]?.category).toBe("automation");
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, manual.id)))[0]?.category).toBe("transactional");
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, otherTenant.id)))[0]?.category).toBe("transactional");
  await expect(deliver(automation.id)).resolves.toBe("suppressed"); expect(sendMail).not.toHaveBeenCalled();
  await db.update(outboundMessages).set({ category: "transactional", templateKey: "payment-receipt" }).where(eq(outboundMessages.id, automation.id));
  await db.update(automationRuns).set({ contextSnapshot: { event: { eventType: "payment.succeeded" }, plan: { actions: [{ executionKey: automation.idempotencyKey }] } } }).where(eq(automationRuns.id, run!.id));
  await db.execute(sql.raw(migration.split("--> statement-breakpoint")[1]!));
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, automation.id)))[0]?.category).toBe("transactional");
});

it("upgrades templates, built-in rules, queued snapshots and automation mail without reclassifying unknown tenant rules", async () => {
  const [template] = await db.insert(messageTemplates).values({ key: "appointment-reminder", channel: "email", name: "Appointment", bodyTemplate: "Visit tomorrow" }).returning();
  const [promo] = await db.insert(messageTemplates).values({ key: "quote-followup", channel: "email", name: "Quote follow-up", bodyTemplate: "Ready to book?" }).returning();
  const [rule] = await db.select().from(automationRules).where(eq(automationRules.tenantId, seedIds.happyTenant)).limit(1);
  const serviceAction = { actionType: "send_email", configuration: { templateKey: "completion" } };
  await db.update(automationRules).set({ actions: [serviceAction] }).where(eq(automationRules.id, rule!.id));
  const [custom] = await db.insert(automationRules).values({ tenantId: seedIds.cleanTenant, name: "Unknown custom reminder", source: "tenant", sourceKey: "completion-thank-you", status: "active", version: 1, triggerConfig: { event: "job.completed" }, actions: [serviceAction] }).returning();
  const row = await message("automation"); const unknown = await message("automation");
  await db.update(outboundMessages).set({ templateKey: "appointment-reminder" }).where(eq(outboundMessages.id, row.id));
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.automationRuleId, rule!.id)).limit(1);
  await db.update(automationRuns).set({ contextSnapshot: { rule: { source: "industry_pack", actions: [serviceAction] }, plan: { actions: [{ executionKey: row.idempotencyKey, scheduledAt: "2026-10-05T00:00:00Z", action: serviceAction }] } } }).where(eq(automationRuns.id, run!.id));
  const migration = readFileSync(new URL("../../../packages/db/drizzle/0012_strange_mysterio.sql", import.meta.url), "utf8");
  for (const statement of migration.slice(migration.indexOf("-- Conservative upgrade:")).split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
  expect((await db.select().from(messageTemplates).where(eq(messageTemplates.id, template!.id)))[0]!.purpose).toBe("service");
  expect((await db.select().from(messageTemplates).where(eq(messageTemplates.id, promo!.id)))[0]!.purpose).toBe("marketing");
  expect((await db.select().from(automationRules).where(eq(automationRules.id, rule!.id)))[0]!.actions).toEqual([{ ...serviceAction, purpose: "service" }]);
  expect((await db.select().from(automationRules).where(eq(automationRules.id, custom!.id)))[0]!.actions).toEqual([{ ...serviceAction, purpose: "marketing" }]);
  expect((await db.select().from(automationRuns).where(eq(automationRuns.id, run!.id)))[0]!.contextSnapshot).toMatchObject({ rule: { actions: [{ purpose: "service" }] }, plan: { actions: [{ executionKey: row.idempotencyKey, scheduledAt: "2026-10-05T00:00:00Z", action: { purpose: "service" } }] } });
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, row.id)))[0]!.category).toBe("service");
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, unknown.id)))[0]!.category).toBe("marketing");
});
