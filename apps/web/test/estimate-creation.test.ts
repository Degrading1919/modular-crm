import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { customers, estimateItems, estimateRevisions, estimates, leads, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records.ts");

const id = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;

let pglite: PGlite;
let db: Database;
let northBranchLeadId: string;

const owner: SessionActor = {
  kind: "staff", userId: "demo-happy-owner", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "owner@happyyards.test", name: "Olivia Owner", role: "owner",
  permissions: permissionsForRole("owner"), locationIds: new Set([seedIds.augusta, seedIds.northAugusta]), allLocations: true,
  membershipId: seedIds.oliviaMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};

const augustaOnly: SessionActor = { ...owner, allLocations: false, locationIds: new Set([seedIds.augusta]) };

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
  const [northLead] = await db.insert(leads).values({
    tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, owningLocationId: seedIds.northAugusta,
    status: "new", firstName: "North", lastName: "Branch Prospect", email: "north@example.test", phone: "555-0199",
  }).returning({ id: leads.id });
  if (!northLead) throw new Error("Could not create the out-of-scope test lead");
  northBranchLeadId = northLead.id;
}, 120_000);

afterAll(async () => { await pglite?.close(); });

function estimateRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/v1/estimates", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

async function createEstimate(actor: SessionActor, body: Record<string, unknown>) {
  const response = await handleRecords(estimateRequest(body), ["estimates"], actor);
  if (!response) throw new Error("Estimates endpoint did not handle the request");
  return response;
}

describe("estimate creation for leads and customers", () => {
  it("creates a draft estimate linked to a lead without converting it and preserves its contact snapshot", async () => {
    const leadId = id(150);
    const [before] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.tenantId, seedIds.happyTenant))).limit(1);
    expect(before).toBeDefined();

    const response = await createEstimate(owner, {
      leadId, serviceId: seedIds.weeklyService, title: "Initial yard cleanup", totalCents: 4_750, notes: "Review gate access",
    });

    expect(response.status).toBe(201);
    const { item } = await response.json() as { item: Record<string, unknown> };
    expect(item).toMatchObject({ leadId, customerId: null, status: "draft", leadName: "Jordan Johnson", totalCents: 4_750 });
    const [saved] = await db.select().from(estimates).where(eq(estimates.id, item.id as string)).limit(1);
    expect(saved).toMatchObject({ tenantId: seedIds.happyTenant, leadId, customerId: null, organizationLocationId: seedIds.augusta, status: "draft" });
    const [revision] = await db.select().from(estimateRevisions).where(and(eq(estimateRevisions.tenantId, seedIds.happyTenant), eq(estimateRevisions.estimateId, saved.id))).limit(1);
    expect(revision).toMatchObject({ revisionNumber: 1, notes: "Review gate access" });
    expect(revision.snapshot).toMatchObject({
      title: "Initial yard cleanup", leadName: "Jordan Johnson", contactName: "Jordan Johnson",
      contactEmail: "jordan@example.test", contactPhone: "555-0110", totalCents: 4_750,
    });
    const [line] = await db.select().from(estimateItems).where(and(eq(estimateItems.tenantId, seedIds.happyTenant), eq(estimateItems.estimateRevisionId, revision.id))).limit(1);
    expect(line).toMatchObject({ serviceId: seedIds.weeklyService, description: "Initial yard cleanup", quantity: "1.0000", unitAmountMinor: 4_750n, totalMinor: 4_750n });

    const [after] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    expect(after).toMatchObject({ status: before.status, customerId: null, convertedAt: null });
    const list = await handleRecords(new Request("http://localhost/api/v1/estimates"), ["estimates"], owner);
    expect(list).toBeDefined();
    const listBody = await list!.json() as { items: Array<{ id: string; customerName: string; leadName: string }> };
    expect(listBody.items.find((entry) => entry.id === saved.id)).toMatchObject({ customerName: "Jordan Johnson", leadName: "Jordan Johnson" });
  });

  it("preserves customer-linked estimate creation and pricing snapshot behavior", async () => {
    const response = await createEstimate(owner, {
      customerId: seedIds.carter, serviceId: seedIds.weeklyService, title: "Weekly cleanup", totalCents: 2_500,
    });
    expect(response.status).toBe(201);
    const { item } = await response.json() as { item: Record<string, unknown> };
    expect(item).toMatchObject({ customerId: seedIds.carter, leadId: null, status: "draft", customerName: "Carter Household", totalCents: 2_500 });
    const [savedRevision] = await db.select().from(estimateRevisions).where(eq(estimateRevisions.estimateId, item.id as string)).limit(1);
    expect(savedRevision.snapshot).toMatchObject({
      title: "Weekly cleanup", customerName: "Carter Household", contactName: "Carter Household", totalCents: 2_500,
    });
  });

  it("requires exactly one of customerId and leadId", async () => {
    const shared = { title: "Quote", totalCents: 1_000 };
    await expect(createEstimate(owner, shared)).rejects.toMatchObject({ name: "ZodError" });
    await expect(createEstimate(owner, { ...shared, customerId: seedIds.carter, leadId: id(150) })).rejects.toMatchObject({ name: "ZodError" });
    await expect(createEstimate(owner, { ...shared, leadId: "not-a-uuid" })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("hides cross-tenant leads, customers, and services", async () => {
    const requests = [
      createEstimate(owner, { leadId: id(151), title: "Quote", totalCents: 1_000 }),
      createEstimate(owner, { customerId: seedIds.cleanCarter, title: "Quote", totalCents: 1_000 }),
      createEstimate(owner, { customerId: seedIds.carter, serviceId: seedIds.cleanService, title: "Quote", totalCents: 1_000 }),
    ];
    for (const request of requests) await expect(request).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("denies leads and customers assigned to a location outside the actor's scope", async () => {
    await expect(createEstimate(augustaOnly, { leadId: northBranchLeadId, title: "Quote", totalCents: 1_000 }))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(createEstimate(augustaOnly, { customerId: seedIds.riverfront, title: "Quote", totalCents: 1_000 }))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
