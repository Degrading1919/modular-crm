import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { domainEvents, schema, seedDevelopment, seedIds, type Database } from "@modular-crm/db";
import type { SessionActor } from "../lib/api/actor";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleFranchiseRoyalty } = await import("../lib/api/franchise-royalty.ts");
const { recordEvent } = await import("../lib/api/events.ts");

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

const actor: SessionActor = {
  kind: "staff", userId: "owner-franchise", tenantId: seedIds.happyTenant, tenantName: "Happy Yards",
  organizationId: seedIds.happyOrganization, membershipId: seedIds.oliviaMembership,
  role: "owner", permissions: new Set(["organization.franchise_manage"]),
  locationIds: new Set([seedIds.augusta]), allLocations: true,
  email: "owner@example.test", name: "Owner", packKey: null,
};

describe("franchise unit events and scoped locations", () => {
  it("attributes a parent's action at a child location to that location's organization", async () => {
    await recordEvent(actor, {
      type: "test.child_location", entityType: "organization_location", entityId: seedIds.franchiseEastLocation,
      locationId: seedIds.franchiseEastLocation, auditAction: "test.child_location",
    });
    const [event] = await db.select().from(domainEvents).where(and(
      eq(domainEvents.tenantId, seedIds.happyTenant), eq(domainEvents.eventType, "test.child_location"),
    ));
    expect(event).toMatchObject({
      actorId: actor.userId, organizationId: seedIds.franchiseEastOrganization,
      locationId: seedIds.franchiseEastLocation,
    });
  });

  it("records child-unit events with the child organization and matching location", async () => {
    const response = await handleFranchiseRoyalty(new Request("https://crm.example/api/v1/franchise/units", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Atomicity Test Unit", effectiveFrom: "2026-09-01",
        location: { name: "Atomicity Branch" },
      }),
    }), ["franchise", "units"], actor);

    expect(response).not.toBeNull();
    if (!response) throw new Error("Franchise unit route was not handled");
    expect(response.status).toBe(201);
    const payload = await response.json() as { item: { organization: { id: string }; location: { id: string } } };
    const { organization, location } = payload.item;
    const events = await db.select().from(domainEvents).where(and(
      eq(domainEvents.tenantId, seedIds.happyTenant),
      eq(domainEvents.organizationId, organization.id),
      eq(domainEvents.locationId, location.id),
    ));
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "franchise.unit.created", "franchise.agreement.created",
    ]));
  });
});
