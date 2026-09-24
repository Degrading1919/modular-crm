import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, asc, eq } from "drizzle-orm";
import {
  auditEvents, domainEvents, estimateItems, estimateRevisions, estimates, schema, secureEstimateTokens,
  seedDevelopment, seedIds, type Database,
} from "@modular-crm/db";
import { permissionsForRole, type Permission } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records.ts");
const { handleWorkflow } = await import("../lib/api/workflows.ts");
const { handleSecureEstimateLink } = await import("../lib/api/secure-estimate-links.ts");

let pglite: PGlite;
let db: Database;

const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta, seedIds.northAugusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};
const office: SessionActor = {
  ...owner, role: "office", permissions: permissionsForRole("office"), allLocations: false,
  locationIds: new Set([seedIds.augusta]),
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

async function postEstimate(body: Record<string, unknown>, actor = owner) {
  return handleRecords(new Request("http://localhost/api/v1/estimates", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), ["estimates"], actor);
}

async function revise(estimateId: string, body: Record<string, unknown>, actor = owner) {
  return handleRecords(new Request(`http://localhost/api/v1/estimates/${estimateId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), ["estimates", estimateId], actor);
}

async function createEstimate(title = "Initial yard cleanup") {
  const response = await postEstimate({ customerId: seedIds.carter, serviceId: seedIds.weeklyService, title, totalCents: 4_750, notes: "Initial scope" });
  if (!response) throw new Error("Estimate endpoint did not handle the request.");
  const payload = await response.json() as { item: { id: string } };
  return payload.item.id;
}

describe("estimate revisions", () => {
  it("creates an immutable incrementing revision with a pricing snapshot and audit history", async () => {
    const estimateId = await createEstimate();
    const firstRevision = (await db.select().from(estimateRevisions).where(eq(estimateRevisions.estimateId, estimateId)).limit(1))[0]!;
    const [firstItem] = await db.select().from(estimateItems).where(eq(estimateItems.estimateRevisionId, firstRevision.id)).limit(1);

    const response = await revise(estimateId, { title: "Spring cleanup", totalCents: 6_250, notes: "Includes both side yards" }, office);
    expect(response?.status).toBe(200);
    const payload = await response!.json() as { item: Record<string, unknown> };
    expect(payload.item).toMatchObject({ status: "draft", currentRevision: 2, totalMinor: 6250 });

    const history = await db.select().from(estimateRevisions).where(and(
      eq(estimateRevisions.tenantId, seedIds.happyTenant), eq(estimateRevisions.estimateId, estimateId),
    )).orderBy(asc(estimateRevisions.revisionNumber));
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ id: firstRevision.id, revisionNumber: 1, totalMinor: 4750n, notes: "Initial scope" });
    expect(history[0]?.snapshot).toMatchObject({ title: "Initial yard cleanup", pricingSnapshot: { subtotalMinor: 4750, totalMinor: 4750 } });
    expect(history[1]).toMatchObject({ revisionNumber: 2, subtotalMinor: 6250n, discountMinor: 0n, taxMinor: 0n, totalMinor: 6250n, notes: "Includes both side yards" });
    expect(history[1]?.snapshot).toMatchObject({ title: "Spring cleanup", serviceId: seedIds.weeklyService, serviceName: "Yard cleanup", totalCents: 6250, pricingSnapshot: { currency: "USD", totalMinor: 6250 } });

    const secondItems = await db.select().from(estimateItems).where(and(
      eq(estimateItems.tenantId, seedIds.happyTenant), eq(estimateItems.estimateRevisionId, history[1]!.id),
    ));
    expect(secondItems).toMatchObject([{ serviceId: seedIds.weeklyService, description: "Spring cleanup", quantity: "1.0000", unitAmountMinor: 6250n, totalMinor: 6250n }]);
    const [savedFirstItem] = await db.select().from(estimateItems).where(eq(estimateItems.estimateRevisionId, firstRevision.id)).limit(1);
    expect(savedFirstItem).toMatchObject({ id: firstItem!.id, description: "Initial yard cleanup", totalMinor: 4750n });

    const detail = await handleRecords(new Request(`http://localhost/api/v1/estimates/${estimateId}`), ["estimates", estimateId], owner);
    const detailPayload = await detail!.json() as { item: Record<string, any> };
    expect(detailPayload.item.currentRevisionData).toMatchObject({ revisionNumber: 2, title: "Spring cleanup", totalCents: 6250, notes: "Includes both side yards" });
    expect(detailPayload.item.revisionHistory).toHaveLength(2);
    expect(await db.select().from(domainEvents).where(and(eq(domainEvents.entityId, estimateId), eq(domainEvents.eventType, "estimate.revised")))).toHaveLength(1);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, estimateId), eq(auditEvents.action, "estimate.revise")))).toHaveLength(1);
  });

  it("allows draft, declined, and expired revisions, and blocks other statuses and unauthorized scope", async () => {
    for (const status of ["draft", "declined", "expired"] as const) {
      const estimateId = await createEstimate(`Estimate ${status}`);
      if (status !== "draft") await db.update(estimates).set({ status }).where(eq(estimates.id, estimateId));
      const response = await revise(estimateId, { title: `Revised ${status}`, totalCents: 5_000 });
      expect(response?.status).toBe(200);
      const [updated] = await db.select().from(estimates).where(eq(estimates.id, estimateId)).limit(1);
      expect(updated).toMatchObject({ status: "draft", currentRevision: 2, totalMinor: 5000n, expiresAt: null, declinedAt: null });
    }

    const approvedId = await createEstimate("Approved quote");
    await db.update(estimates).set({ status: "approved" }).where(eq(estimates.id, approvedId));
    await expect(revise(approvedId, { title: "Changed after approval", totalCents: 7_500 })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(estimateRevisions).where(eq(estimateRevisions.estimateId, approvedId))).toHaveLength(1);

    const locationEstimateId = await createEstimate("North branch estimate");
    await db.update(estimates).set({ organizationLocationId: seedIds.northAugusta }).where(eq(estimates.id, locationEstimateId));
    const limitedActor = { ...owner, allLocations: false, locationIds: new Set([seedIds.augusta]) };
    await expect(revise(locationEstimateId, { title: "Out of scope", totalCents: 5_000 }, limitedActor)).rejects.toMatchObject({ status: 404 });
    const noPermissionActor = { ...owner, permissions: new Set<Permission>() };
    await expect(revise(locationEstimateId, { title: "No permission", totalCents: 5_000 }, noPermissionActor)).rejects.toMatchObject({ status: 403 });
  });

  it("revokes stale pending links and sends the new revision under a fresh revision-bound token", async () => {
    const estimateId = await createEstimate("Sent version");
    const sent = await handleWorkflow(new Request(`http://localhost/api/v1/estimates/${estimateId}/send`, { method: "POST" }), ["estimates", estimateId, "send"], owner);
    const firstPayload = await sent!.json() as { actionUrl: string };
    const firstToken = firstPayload.actionUrl.split("/").at(-1)!;
    const [firstTokenRow] = await db.select().from(secureEstimateTokens).where(eq(secureEstimateTokens.estimateId, estimateId)).limit(1);
    expect(firstTokenRow).toBeDefined();

    await db.update(estimates).set({ status: "declined" }).where(eq(estimates.id, estimateId));
    await revise(estimateId, { title: "Replacement version", totalCents: 8_000 });
    const [revokedToken] = await db.select().from(secureEstimateTokens).where(eq(secureEstimateTokens.id, firstTokenRow!.id)).limit(1);
    expect(revokedToken?.revokedAt).toBeInstanceOf(Date);
    await expect(handleSecureEstimateLink(new Request(`http://localhost/api/v1/public/estimate-links/${firstToken}`), ["public", "estimate-links", firstToken])).rejects.toMatchObject({ status: 409 });

    const resent = await handleWorkflow(new Request(`http://localhost/api/v1/estimates/${estimateId}/send`, { method: "POST" }), ["estimates", estimateId, "send"], owner);
    const secondPayload = await resent!.json() as { actionUrl: string };
    const secondToken = secondPayload.actionUrl.split("/").at(-1)!;
    const [currentEstimate] = await db.select().from(estimates).where(eq(estimates.id, estimateId)).limit(1);
    const [currentRevision] = await db.select().from(estimateRevisions).where(and(
      eq(estimateRevisions.estimateId, estimateId), eq(estimateRevisions.revisionNumber, 2),
    )).limit(1);
    const [secondTokenRow] = await db.select().from(secureEstimateTokens).where(eq(secureEstimateTokens.tokenHash, createHash("sha256").update(secondToken).digest("hex"))).limit(1);
    expect(currentEstimate?.status).toBe("sent");
    expect(secondTokenRow).toMatchObject({ estimateRevisionId: currentRevision!.id, revokedAt: null });
    const publicView = await handleSecureEstimateLink(new Request(`http://localhost/api/v1/public/estimate-links/${secondToken}`), ["public", "estimate-links", secondToken]);
    expect(publicView?.status).toBe(200);
    expect(await publicView!.json()).toMatchObject({ item: { title: "Replacement version", totalMinor: 8_000 } });
  });

  it("revokes a pending token through the same estimate-level lock before link reads", async () => {
    const estimateId = await createEstimate("Pending old token");
    const rawToken = randomBytes(32).toString("base64url");
    const [revision] = await db.select().from(estimateRevisions).where(eq(estimateRevisions.estimateId, estimateId)).limit(1);
    await db.insert(secureEstimateTokens).values({
      tenantId: seedIds.happyTenant, estimateId, estimateRevisionId: revision!.id,
      tokenHash: createHash("sha256").update(rawToken).digest("hex"), expiresAt: new Date(Date.now() + 60_000),
    });
    await db.update(estimates).set({ status: "expired" }).where(eq(estimates.id, estimateId));
    await revise(estimateId, { title: "Fresh draft", totalCents: 4_900 });
    const [savedToken] = await db.select().from(secureEstimateTokens).where(eq(secureEstimateTokens.estimateId, estimateId)).limit(1);
    expect(savedToken?.revokedAt).toBeInstanceOf(Date);
    await expect(handleSecureEstimateLink(new Request(`http://localhost/api/v1/public/estimate-links/${rawToken}`), ["public", "estimate-links", rawToken])).rejects.toMatchObject({ status: 409 });
  });
});
