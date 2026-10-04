import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { schema, seedDevelopment, seedIds, tickets, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records.ts");

let pglite: PGlite;
let db: Database;
const ticketTypeId = "00000000-0000-4000-8000-0000000001b8";
const openStatusId = "00000000-0000-4000-8000-0000000001bd";

// Default technician permissions, as resolved for a role template without seeded overrides (for example a newly invited technician).
const terry: SessionActor = {
  kind: "staff", userId: "demo-happy-tech", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "tech@happyyards.test", name: "Terry Tech", role: "technician",
  permissions: permissionsForRole("technician"), locationIds: new Set([seedIds.augusta]), allLocations: false,
  membershipId: seedIds.terryMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
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

async function createTicket(values: Partial<typeof tickets.$inferInsert>) {
  const [ticket] = await db.insert(tickets).values({
    tenantId: seedIds.happyTenant, ticketTypeId, statusDefinitionId: openStatusId, title: "Office follow-up",
    description: "Internal office ticket", createdByActorType: "staff", createdByActorId: "demo-happy-manager", ...values,
  }).returning();
  return ticket!;
}

function patchTicket(actor: SessionActor, id: string, body: Record<string, unknown>) {
  return handleRecords(new Request(`http://localhost/api/v1/tickets/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), ["tickets", id], actor);
}

describe("technician ticket update scope", () => {
  it("rejects a technician updating a branch ticket unrelated to their work", async () => {
    const ticket = await createTicket({ customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, assignedMembershipId: seedIds.morganMembership });
    await expect(patchTicket(terry, ticket.id, { subject: "Changed by technician" })).rejects.toMatchObject({ status: 404 });
    const [stored] = await db.select({ title: tickets.title }).from(tickets).where(eq(tickets.id, ticket.id));
    expect(stored?.title).toBe("Office follow-up");
  });

  it("allows a technician to update tickets assigned to them, created by them, or tied to their assigned job", async () => {
    const assigned = await createTicket({ customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, assignedMembershipId: seedIds.terryMembership });
    const created = await createTicket({ createdByActorId: terry.userId });
    const jobRelated = await createTicket({ customerId: seedIds.carter, jobId: seedIds.completedJob, assignedMembershipId: seedIds.morganMembership });
    for (const ticket of [assigned, created, jobRelated]) {
      const response = await patchTicket(terry, ticket.id, { description: "Updated from the field" });
      expect(response?.status).toBe(200);
    }
  });
});
