import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { createHmac, hkdfSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { consentRecords, emailUnsubscribeToken, readEmailUnsubscribeToken, outboundMessages, portalAccess, schema, seedDevelopment, seedIds, seedUserIds, openAccountEmail, loadEmailBusiness, organizationLocations, type Database } from "@modular-crm/db";
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../lib/db", () => ({ getDb }));
import { GET, POST } from "../app/email/unsubscribe/route.ts";
import { passwordSetupBusiness, sendPlatformEmail } from "../lib/mail.ts";
import { handleCapabilitySettings } from "../lib/api/capability-settings.ts";
import type { SessionActor } from "../lib/api/actor.ts";
let pglite: PGlite; let db: Database; const secret = "unsubscribe-web-fixture-secret-32-characters";
beforeAll(async () => {
  pglite = new PGlite(); const database = drizzle(pglite, { schema });
  await migrate(database, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = database as unknown as Database; getDb.mockReturnValue(db); await seedDevelopment(db); vi.stubEnv("BETTER_AUTH_SECRET", secret);
}, 120_000);
afterAll(async () => { vi.unstubAllEnvs(); await pglite?.close(); });
it("GET is scanner-safe and a cookie-free signed one-click POST opts out only automated mail", async () => {
  const [row] = await db.insert(outboundMessages).values({ tenantId: seedIds.happyTenant, customerId: seedIds.carter, category: "automation", channel: "email",
    recipient: "carter@example.test", renderedBody: "Reminder", status: "sent", idempotencyKey: crypto.randomUUID() }).returning();
  const token = emailUnsubscribeToken({ tenantId: row!.tenantId, customerId: row!.customerId!, messageId: row!.id }, secret);
  const url = `http://localhost/email/unsubscribe?token=${token}`;
  const get = await GET(new Request(url)); expect(get.status).toBe(200); expect(await get.text()).toContain('method="post"');
  expect(get.headers.get("referrer-policy")).toBe("no-referrer");
  expect(await db.select().from(consentRecords).where(and(eq(consentRecords.customerId, seedIds.carter), eq(consentRecords.category, "marketing")))).toHaveLength(0);
  const post = () => POST(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
  expect((await post()).status).toBe(200); expect((await post()).status).toBe(200);
  expect(await db.select().from(consentRecords).where(and(eq(consentRecords.customerId, seedIds.carter), eq(consentRecords.category, "marketing")))).toMatchObject([{ state: "opted_out", source: "email_unsubscribe" }]);
  expect((await GET(new Request(`${url}x`))).status).toBe(400);
  expect((await POST(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=Wrong" }))).status).toBe(400);
});
it("brands password setup only for a pending same-origin invitation bound to that user", async () => {
  const [access] = await db.update(portalAccess).set({ status: "invited" }).where(and(eq(portalAccess.tenantId, seedIds.happyTenant), eq(portalAccess.userId, seedUserIds.happyCustomer))).returning();
  const url = (callback: string) => `http://localhost/reset-password/token?callbackURL=${encodeURIComponent(callback)}`;
  const callback = `/portal/activate?accessId=${access!.id}`;
  expect(await passwordSetupBusiness(db, seedUserIds.happyCustomer, url(callback))).toMatchObject({ name: "Happy Yards Pet Waste", replyTo: "hello@happyyards.local", address: expect.stringContaining("125 Broad Street") });
  expect(await passwordSetupBusiness(db, seedUserIds.cleanCustomer, url(callback))).toBeUndefined();
  expect(await passwordSetupBusiness(db, seedUserIds.happyCustomer, url(`https://attacker.test${callback}`))).toBeUndefined();
  expect(await passwordSetupBusiness(db, seedUserIds.happyCustomer, "http://localhost/reset-password/token")).toBeUndefined();
});
it("classifies manual marketing explicitly, requires a customer, and exposes safe suppression feedback", async () => {
  const actor: SessionActor = { kind: "staff", userId: seedUserIds.happyOwner, tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste", packKey: "pet-waste-removal",
    email: "owner@happyyards.test", name: "Owner", role: "owner", permissions: new Set(["communications.send", "communications.read"]),
    locationIds: new Set([seedIds.augusta]), allLocations: true, membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization };
  const request = (body: Record<string, unknown>) => new Request("http://localhost/api/v1/communications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await expect(handleCapabilitySettings(request({ category: "marketing", channel: "email", recipient: "customer@example.test", message: "Offer" }), ["communications"], actor)).rejects.toMatchObject({ status: 422 });
  const response = await handleCapabilitySettings(request({ category: "marketing", channel: "email", customerId: seedIds.carter, message: "Offer" }), ["communications"], actor);
  expect(response!.status).toBe(201); const id = (await response!.json()).item.id as string;
  expect((await db.select().from(outboundMessages).where(eq(outboundMessages.id, id)))[0]?.category).toBe("marketing");
  await db.update(outboundMessages).set({ status: "suppressed", failureCode: "customer_unsubscribed", failureMessage: "unsafe legacy internal details" }).where(eq(outboundMessages.id, id));
  const listed = await handleCapabilitySettings(new Request("http://localhost/api/v1/communications"), ["communications"], actor);
  expect((await listed!.json()).items.find((item: { id: string }) => item.id === id)).toMatchObject({ category: "marketing", mode: "not_sent", environment: null, errorMessage: "This customer has stopped promotional emails." });
});

it("queues encrypted account mail from the web and excludes access links from operational message history", async () => {
  const prior = process.env.NODE_ENV; vi.stubEnv("NODE_ENV", "development");
  try {
    await sendPlatformEmail("secure@example.test", "Portal access", "Activate: https://crm.test/private-link", await loadEmailBusiness(db, seedIds.happyTenant, { customerId: seedIds.carter }));
    const [message] = await db.select().from(outboundMessages).where(eq(outboundMessages.recipient, "secure@example.test"));
    expect(message).toMatchObject({ category: "account", status: "queued" }); expect(message!.renderedBody).not.toContain("private-link");
    expect(openAccountEmail(message!.renderedBody, secret)).toBe("Activate: https://crm.test/private-link");
    const actor: SessionActor = { kind: "staff", userId: seedUserIds.happyOwner, tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: null,
      email: "owner@example.test", name: "Owner", role: "owner", permissions: new Set(["communications.read"]), locationIds: new Set(), allLocations: true, membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization };
    const listed = await handleCapabilitySettings(new Request("http://localhost/api/v1/communications"), ["communications"], actor);
    expect((await listed!.json()).items.some((item: { id: string }) => item.id === message!.id)).toBe(false);
  } finally { vi.stubEnv("NODE_ENV", prior); }
});

it("edits the address selected by the prompt without crossing tenant, business or staff-location scope", async () => {
  const actor: SessionActor = { kind: "staff", userId: seedUserIds.happyOwner, tenantId: seedIds.happyTenant, tenantName: "Happy Yards", packKey: null,
    email: "owner@example.test", name: "Owner", role: "owner", permissions: new Set(["tenant.read", "tenant.update"]), locationIds: new Set(), allLocations: true, membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization };
  const url = `http://localhost/api/v1/settings?locationId=${seedIds.northAugusta}`;
  const result = await handleCapabilitySettings(new Request(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "456 Actual Branch Street" }) }), ["settings"], actor);
  expect(result!.status).toBe(200);
  expect((await db.select().from(organizationLocations).where(eq(organizationLocations.id, seedIds.northAugusta)))[0]!.addressLine1).toBe("456 Actual Branch Street");
  expect((await db.select().from(organizationLocations).where(eq(organizationLocations.id, seedIds.augusta)))[0]!.addressLine1).toBe("125 Broad Street");
  for (const denied of [seedIds.cleanBranch, seedIds.franchiseEastLocation, "not-a-location"]) await expect(handleCapabilitySettings(new Request(`http://localhost/api/v1/settings?locationId=${denied}`), ["settings"], actor)).rejects.toMatchObject({ status: 404 });
  await expect(handleCapabilitySettings(new Request(url), ["settings"], { ...actor, role: "office", allLocations: false, locationIds: new Set([seedIds.augusta]) })).rejects.toMatchObject({ status: 404 });
});

it("signs with an HKDF-separated key, accepts old links for one release and rejects root-secret rotation", () => {
  const target = { tenantId: seedIds.happyTenant, customerId: seedIds.carter, messageId: crypto.randomUUID() };
  const token = emailUnsubscribeToken(target, secret); const payload = token.split(".")[0]!;
  const derived = Buffer.from(hkdfSync("sha256", secret, "modular-crm", "email-unsubscribe-signing-v1", 32));
  expect(token.split(".")[1]).toBe(createHmac("sha256", derived).update(`email-unsubscribe:${payload}`).digest("base64url"));
  const legacy = `${payload}.${createHmac("sha256", secret).update(`email-unsubscribe:${payload}`).digest("base64url")}`;
  expect(legacy).not.toBe(token); expect(readEmailUnsubscribeToken(legacy, secret)).toEqual(target);
  expect(readEmailUnsubscribeToken(token, "rotated-root-secret")).toBeUndefined();
  expect(readEmailUnsubscribeToken(legacy, "rotated-root-secret")).toBeUndefined();
});
