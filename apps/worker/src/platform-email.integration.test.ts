import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { automationRuns, communicationEvents, connectorInstallations, consentRecords, emailUnsubscribeTarget, emailUnsubscribeToken,
  loadEmailBusiness, organizationLocations, outboundMessages, readEmailUnsubscribeToken, schema, seedDevelopment, seedIds, unsubscribeEmail, type Database } from "@modular-crm/db";
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
it("uses platform mail without a connector and records acceptance; replay cannot duplicate a completed send", async () => {
  const row = await message();
  await expect(deliver(row.id, seedIds.cleanTenant)).resolves.toBe("skipped");
  await expect(deliver(row.id)).resolves.toBe("sent");
  await expect(deliver(row.id)).resolves.toBe("skipped");
  expect(sendMail).toHaveBeenCalledOnce();
  const sent = sendMail.mock.calls[0]![0];
  expect(sent).toMatchObject({ from: { name: "Happy Yards Pet Waste", address: "mail@platform.test" }, replyTo: "hello@happyyards.local",
    text: expect.stringContaining("125 Broad Street"), html: expect.stringContaining("Stop automated emails"), headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
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
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, row.id)))[0]).toMatchObject({ status: "failed", failureCode: "business_details_missing", failureMessage: "Choose a customer and add the business address before sending automated emails." });
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
  await expect(processOutboundMessage(db, registry, { tenantId: seedIds.cleanTenant, messageId: receipt.id }, new Date(), config)).resolves.toBe("sent");
  expect(provider).toHaveBeenCalledTimes(2); expect(sendMail).not.toHaveBeenCalled();
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
