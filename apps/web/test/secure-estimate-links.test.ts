import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import {
  auditEvents, capabilityModules, domainEvents, estimateApprovals, estimateItems, estimateRevisions, estimates, jobs, leads,
  schema, secureEstimateTokens, seedDevelopment, seedIds, servicePlans, tenantCapabilitySettings, type Database,
} from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleV1 } = await import("../lib/api/handler.ts");
const { estimateAction } = await import("../lib/api/workflows.ts");

let pglite: PGlite;
let db: Database;

const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta, seedIds.northAugusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

async function createLeadEstimate(options: { tenantId?: string; expiresAt?: Date | null } = {}) {
  const tenantId = options.tenantId ?? seedIds.happyTenant;
  if (tenantId !== seedIds.happyTenant) throw new Error("This fixture helper requires a seeded tenant organization and branch.");
  const [lead] = await db.insert(leads).values({
    tenantId, organizationId: seedIds.happyOrganization, owningLocationId: seedIds.augusta, status: "new",
    firstName: "Avery", lastName: "Prospect", email: "avery@example.test", phone: "555-0180",
    address: { line1: "214 Oak Street", city: "Augusta", region: "GA", postalCode: "30901" },
  }).returning();
  if (!lead) throw new Error("Could not create test lead.");
  const [estimate] = await db.insert(estimates).values({
    tenantId, leadId: lead.id, organizationLocationId: seedIds.augusta, status: "draft", currentRevision: 1,
    totalMinor: 4800n, expiresAt: options.expiresAt ?? null, createdByMembershipId: seedIds.oliviaMembership,
  }).returning();
  if (!estimate) throw new Error("Could not create test estimate.");
  const [revision] = await db.insert(estimateRevisions).values({
    tenantId, estimateId: estimate.id, revisionNumber: 1, subtotalMinor: 4800n, totalMinor: 4800n,
    termsText: "Work will be completed at the listed address.", termsVersion: "terms-2026-1",
    snapshot: { title: "Weekly yard care", contactName: "Avery Prospect" },
  }).returning();
  if (!revision) throw new Error("Could not create test estimate revision.");
  await db.insert(estimateItems).values({
    tenantId, estimateRevisionId: revision.id, serviceId: seedIds.weeklyService, description: "Weekly yard care",
    quantity: "1", unitAmountMinor: 4800n, totalMinor: 4800n,
  });
  return { lead, estimate, revision };
}

async function sendEstimate(estimateId: string): Promise<{ token: string; actionUrl: string }> {
  const response = await estimateAction(new Request(`http://localhost/api/v1/estimates/${estimateId}/send`, { method: "POST" }), owner, estimateId, "send");
  if (response.status !== 200) throw new Error(`Estimate send failed (${response.status}): ${JSON.stringify(await response.json())}`);
  const payload = await response.json() as { actionUrl: string; item: { status: string } };
  const token = payload.actionUrl.split("/").at(-1);
  if (!token) throw new Error("Send did not return an estimate token.");
  expect(payload.item.status).toBe("sent");
  return { token, actionUrl: payload.actionUrl };
}

function linkRequest(token: string, action?: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const suffix = action ? `/${action}` : "";
  return new Request(`http://localhost/api/v1/public/estimate-links/${token}${suffix}`, {
    method: action ? "POST" : "GET",
    ...(action ? { headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) } : { headers }),
  });
}

async function visit(token: string, action?: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return handleV1(linkRequest(token, action, body, headers), ["public", "estimate-links", token, ...(action ? [action] : [])]);
}

describe("secure estimate decision links", () => {
  it("does not create downstream recurring work when that capability is disabled", async () => {
    const { lead, estimate } = await createLeadEstimate();
    const { token } = await sendEstimate(estimate.id);
    const plansBefore = (await db.select().from(servicePlans).where(eq(servicePlans.tenantId, seedIds.happyTenant))).length;
    const [module] = await db.select({ id: capabilityModules.id }).from(capabilityModules)
      .where(eq(capabilityModules.key, "scheduling-and-recurring")).limit(1);
    await db.insert(tenantCapabilitySettings).values({ tenantId: seedIds.happyTenant, moduleId: module!.id, enabled: false })
      .onConflictDoUpdate({ target: [tenantCapabilitySettings.tenantId, tenantCapabilitySettings.moduleId], set: { enabled: false } });
    try {
      const response = await visit(token, "approve");
      expect(response.status).toBe(403);
      expect((await db.select().from(estimates).where(eq(estimates.id, estimate.id)))[0]?.status).toBe("sent");
      expect((await db.select().from(leads).where(eq(leads.id, lead.id)))[0]?.customerId).toBeNull();
      expect(await db.select().from(servicePlans).where(eq(servicePlans.tenantId, seedIds.happyTenant))).toHaveLength(plansBefore);
    } finally {
      await db.update(tenantCapabilitySettings).set({ enabled: true }).where(and(
        eq(tenantCapabilitySettings.tenantId, seedIds.happyTenant), eq(tenantCapabilitySettings.moduleId, module!.id),
      ));
    }
  });

  it("sends a one-time raw link and serves a scoped estimate view without exposing its token hash", async () => {
    const { estimate } = await createLeadEstimate();
    const { token, actionUrl } = await sendEstimate(estimate.id);
    expect(actionUrl).toBe(`/estimate/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [storedToken] = await db.select().from(secureEstimateTokens).where(eq(secureEstimateTokens.estimateId, estimate.id)).limit(1);
    expect(storedToken?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(storedToken?.tokenHash).not.toBe(token);
    expect(storedToken?.allowedActions).toEqual(["approve", "decline"]);

    const headers = { "user-agent": "Estimate Viewer/1.0", "x-forwarded-for": "203.0.113.11" };
    const view = await visit(token, undefined, {}, headers);
    expect(view.status).toBe(200);
    const payload = await view.json() as { item: Record<string, unknown> };
    expect(payload.item).toMatchObject({ title: "Weekly yard care", contactName: "Avery Prospect", totalMinor: 4800, termsText: "Work will be completed at the listed address." });
    expect(payload.item).not.toHaveProperty("tenantId");
    expect(payload.item).not.toHaveProperty("estimateId");
    expect(payload.item).not.toHaveProperty("tokenHash");
    expect(payload.item).not.toHaveProperty("email");
    const [viewedEstimate] = await db.select().from(estimates).where(eq(estimates.id, estimate.id)).limit(1);
    expect(viewedEstimate?.status).toBe("viewed");
    const [viewEvent] = await db.select().from(domainEvents).where(and(eq(domainEvents.entityType, "estimate"), eq(domainEvents.entityId, estimate.id), eq(domainEvents.eventType, "estimate.viewed"))).limit(1);
    expect(viewEvent).toMatchObject({ actorType: "secure_estimate_link", payload: { status: "viewed" } });
    const [viewAudit] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "estimate"), eq(auditEvents.entityId, estimate.id), eq(auditEvents.action, "estimate.viewed"))).limit(1);
    expect(viewAudit).toMatchObject({ actorType: "secure_estimate_link", ipAddress: "203.0.113.11", userAgent: headers["user-agent"] });
    expect((await visit(token, undefined, {}, headers)).status).toBe(200);
    expect(await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, estimate.id), eq(domainEvents.eventType, "estimate.viewed")))).toHaveLength(1);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, estimate.id), eq(auditEvents.action, "estimate.viewed")))).toHaveLength(1);
  });

  it("approves once, converts a lead and creates the recurring service plan atomically, then accepts a retry", async () => {
    const { lead, estimate } = await createLeadEstimate();
    const { token } = await sendEstimate(estimate.id);
    const headers = { "user-agent": "Estimate Link Test/1.0", "x-forwarded-for": "203.0.113.10" };
    const concurrentAttempts = await Promise.all([
      visit(token, "approve", {}, headers),
      visit(token, "approve", {}, headers),
    ]);
    expect(concurrentAttempts.map((response) => response.status)).toEqual([200, 200]);
    const decisionPayloads = await Promise.all(concurrentAttempts.map(async (response) => response.json() as Promise<{ item: { status: string; [key: string]: unknown }; duplicate: boolean }>));
    expect(decisionPayloads.map((payload) => payload.duplicate).sort()).toEqual([false, true]);
    const approvedPayload = decisionPayloads.find((payload) => !payload.duplicate)!;
    expect(approvedPayload).toMatchObject({ item: { status: "approved" }, duplicate: false });
    expect(approvedPayload.item).not.toHaveProperty("tenantId");
    expect(approvedPayload.item).not.toHaveProperty("estimateId");
    expect(approvedPayload.item).not.toHaveProperty("customerId");

    const [savedEstimate] = await db.select().from(estimates).where(eq(estimates.id, estimate.id)).limit(1);
    const [savedLead] = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
    expect(savedEstimate?.customerId).toBeTruthy();
    expect(savedLead).toMatchObject({ status: "converted", customerId: savedEstimate?.customerId });
    const planRows = await db.select().from(servicePlans).where(and(eq(servicePlans.tenantId, seedIds.happyTenant), eq(servicePlans.customerId, savedEstimate!.customerId!)));
    expect(planRows).toHaveLength(1);
    expect(planRows[0]?.serviceId).toBe(seedIds.weeklyService);
    expect(await db.select().from(jobs).where(eq(jobs.customerId, savedEstimate!.customerId!))).toHaveLength(0);

    const [approval] = await db.select().from(estimateApprovals).where(and(eq(estimateApprovals.estimateId, estimate.id), eq(estimateApprovals.tenantId, seedIds.happyTenant))).limit(1);
    const [tokenRow] = await db.select().from(secureEstimateTokens).where(eq(secureEstimateTokens.estimateId, estimate.id)).limit(1);
    expect(approval).toMatchObject({ decision: "approved", actorType: "secure_estimate_link", secureTokenId: tokenRow?.id, termsVersion: "terms-2026-1", userAgent: headers["user-agent"], ipAddress: "203.0.113.10" });
    expect(tokenRow).toMatchObject({ consumedAction: "approve" });
    expect(tokenRow?.consumedAt).toBeInstanceOf(Date);
    expect(await db.select().from(domainEvents).where(and(eq(domainEvents.entityType, "estimate"), eq(domainEvents.entityId, estimate.id), eq(domainEvents.eventType, "estimate.approved")))).toHaveLength(1);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "estimate"), eq(auditEvents.entityId, estimate.id), eq(auditEvents.action, "estimate.approved")))).toHaveLength(1);

    const retry = await visit(token, "approve", {}, headers);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ item: { status: "approved" }, duplicate: true });
    expect(await db.select().from(estimateApprovals).where(eq(estimateApprovals.estimateId, estimate.id))).toHaveLength(1);
    expect(await db.select().from(servicePlans).where(eq(servicePlans.customerId, savedEstimate!.customerId!))).toHaveLength(1);
  });

  it("records decline without converting the lead or creating downstream work", async () => {
    const { lead, estimate } = await createLeadEstimate();
    const { token } = await sendEstimate(estimate.id);
    const plansBefore = await db.select().from(servicePlans).where(eq(servicePlans.tenantId, seedIds.happyTenant));
    const response = await visit(token, "decline", { comment: "We have chosen another option." });
    expect(response.status).toBe(200);
    const decision = await response.json() as { item: { status: string; [key: string]: unknown }; duplicate: boolean };
    expect(decision).toMatchObject({ item: { status: "declined" }, duplicate: false });
    expect(decision.item).not.toHaveProperty("tenantId");
    expect(decision.item).not.toHaveProperty("customerId");
    const [savedLead] = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
    expect(savedLead).toMatchObject({ status: "new", customerId: null, convertedAt: null });
    const [approval] = await db.select().from(estimateApprovals).where(eq(estimateApprovals.estimateId, estimate.id)).limit(1);
    expect(approval).toMatchObject({ decision: "declined", comment: "We have chosen another option." });
    expect(await db.select().from(servicePlans).where(eq(servicePlans.tenantId, seedIds.happyTenant))).toHaveLength(plansBefore.length);
  });

  it("commits an idempotent expiry transition before rejecting expired links, and rejects superseded links", async () => {
    const expired = await createLeadEstimate();
    const expiredLink = await sendEstimate(expired.estimate.id);
    await db.update(secureEstimateTokens).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(secureEstimateTokens.estimateId, expired.estimate.id));
    expect((await visit(expiredLink.token)).status).toBe(404);
    const [expiredEstimate] = await db.select().from(estimates).where(eq(estimates.id, expired.estimate.id)).limit(1);
    expect(expiredEstimate?.status).toBe("expired");
    expect(await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, expired.estimate.id), eq(domainEvents.eventType, "estimate.expired")))).toHaveLength(1);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, expired.estimate.id), eq(auditEvents.action, "estimate.expired")))).toHaveLength(1);
    expect((await visit(expiredLink.token, "approve")).status).toBe(404);
    expect((await visit(expiredLink.token)).status).toBe(404);
    expect(await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, expired.estimate.id), eq(domainEvents.eventType, "estimate.expired")))).toHaveLength(1);

    const viewedThenExpired = await createLeadEstimate();
    const viewedLink = await sendEstimate(viewedThenExpired.estimate.id);
    expect((await visit(viewedLink.token)).status).toBe(200);
    await db.update(estimates).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(estimates.id, viewedThenExpired.estimate.id));
    expect((await visit(viewedLink.token, "approve")).status).toBe(404);
    const [savedViewedEstimate] = await db.select().from(estimates).where(eq(estimates.id, viewedThenExpired.estimate.id)).limit(1);
    expect(savedViewedEstimate?.status).toBe("expired");
    expect(await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, viewedThenExpired.estimate.id), eq(domainEvents.eventType, "estimate.expired")))).toHaveLength(1);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, viewedThenExpired.estimate.id), eq(auditEvents.action, "estimate.expired")))).toHaveLength(1);
    expect((await visit(viewedLink.token)).status).toBe(404);
    expect(await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, viewedThenExpired.estimate.id), eq(domainEvents.eventType, "estimate.expired")))).toHaveLength(1);

    const superseded = await createLeadEstimate();
    const oldLink = await sendEstimate(superseded.estimate.id);
    await db.insert(estimateRevisions).values({
      tenantId: seedIds.happyTenant, estimateId: superseded.estimate.id, revisionNumber: 2,
      subtotalMinor: 5200n, totalMinor: 5200n, snapshot: { title: "Revised yard care" },
    });
    await db.update(estimates).set({ currentRevision: 2 }).where(eq(estimates.id, superseded.estimate.id));
    expect((await visit(oldLink.token)).status).toBe(409);
    expect((await visit(oldLink.token, "approve")).status).toBe(409);
    const [saved] = await db.select().from(estimates).where(eq(estimates.id, superseded.estimate.id)).limit(1);
    expect(saved).toMatchObject({ status: "sent", customerId: null, currentRevision: 2 });
  });

  it("does not accept client tenant or estimate substitution", async () => {
    const { estimate } = await createLeadEstimate();
    const { token } = await sendEstimate(estimate.id);
    const substituted = await visit(token, "approve", { tenantId: seedIds.cleanTenant, estimateId: estimate.id });
    expect(substituted.status).toBe(422);
    expect(await substituted.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    const queryOverride = await handleV1(
      new Request(`http://localhost/api/v1/public/estimate-links/${token}?tenantId=${seedIds.cleanTenant}`),
      ["public", "estimate-links", token],
    );
    expect(queryOverride.status).toBe(422);
    expect((await visit(token)).status).toBe(200);
  });
});
