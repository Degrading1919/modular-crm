import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { jobAssignments, jobs, schema, seedDevelopment, seedIds, tickets, type Database } from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { handleRecords } = await import("../lib/api/records.ts");
const { handleRoutesField } = await import("../lib/api/routes-field.ts");
const { apiError } = await import("../lib/api/http.ts");

let pglite: PGlite;
let db: Database;
const ticketTypeId = "00000000-0000-4000-8000-0000000001b8";
const openStatusId = "00000000-0000-4000-8000-0000000001bd";
let northJobId: string;

// Default technician permissions, as resolved for a role template without seeded overrides (for example a newly invited technician).
// Terry is scoped to the Augusta branch only.
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
  // A North Augusta job that is (mistakenly or historically) still assigned to Terry, outside his branch scope.
  const [northJob] = await db.insert(jobs).values({
    tenantId: seedIds.happyTenant, organizationId: seedIds.happyOrganization, organizationLocationId: seedIds.northAugusta,
    customerId: seedIds.riverfront, serviceLocationId: seedIds.riverfrontLocation, serviceId: seedIds.commercialService, status: "scheduled",
  }).returning();
  northJobId = northJob!.id;
  await db.insert(jobAssignments).values({ tenantId: seedIds.happyTenant, jobId: northJobId, membershipId: seedIds.terryMembership, assignmentRole: "primary", assignedAt: new Date() });
}, 120_000);

afterAll(async () => { await pglite?.close(); });

async function createTicket(title: string, values: Partial<typeof tickets.$inferInsert>) {
  const [ticket] = await db.insert(tickets).values({
    tenantId: seedIds.happyTenant, ticketTypeId, statusDefinitionId: openStatusId, title,
    description: "Internal office ticket", createdByActorType: "staff", createdByActorId: "demo-happy-manager", ...values,
  }).returning();
  return ticket!;
}

async function patchTicket(actor: SessionActor, id: string, body: Record<string, unknown>) {
  return (await handleRecords(new Request(`http://localhost/api/v1/tickets/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), ["tickets", id], actor).catch(apiError))!;
}

async function fieldTicketTitles(actor: SessionActor): Promise<string[]> {
  const response = (await handleRoutesField(new Request("http://localhost/api/v1/field/tickets"), ["field", "tickets"], actor))!;
  return ((await response.json()) as { items: { subject: string }[] }).items.map((item) => item.subject);
}

async function storedDescription(id: string) {
  const [stored] = await db.select({ description: tickets.description }).from(tickets).where(eq(tickets.id, id));
  return stored?.description;
}

describe("technician ticket scope", () => {
  it("rejects a technician updating a branch ticket unrelated to their work", async () => {
    const ticket = await createTicket("Office follow-up", { customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, assignedMembershipId: seedIds.morganMembership });
    expect((await patchTicket(terry, ticket.id, { subject: "Changed by technician" })).status).toBe(404);
    const [stored] = await db.select({ title: tickets.title }).from(tickets).where(eq(tickets.id, ticket.id));
    expect(stored?.title).toBe("Office follow-up");
  });

  it("allows a technician to update tickets assigned to them, created by them, or tied to their assigned job", async () => {
    const assigned = await createTicket("Assigned in branch", { customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, assignedMembershipId: seedIds.terryMembership });
    const created = await createTicket("Created from the field", { createdByActorId: terry.userId });
    const jobRelated = await createTicket("On Terry's job", { customerId: seedIds.carter, jobId: seedIds.completedJob, assignedMembershipId: seedIds.morganMembership });
    for (const ticket of [assigned, created, jobRelated]) {
      expect((await patchTicket(terry, ticket.id, { description: "Updated from the field" })).status).toBe(200);
    }
  });

  it.each([
    ["assigned to the technician", () => ({ customerId: seedIds.riverfront, serviceLocationId: seedIds.riverfrontLocation, assignedMembershipId: seedIds.terryMembership })],
    ["created by the technician", () => ({ customerId: seedIds.riverfront, serviceLocationId: seedIds.riverfrontLocation, createdByActorId: terry.userId })],
    ["on a job assigned to the technician", () => ({ customerId: seedIds.riverfront, jobId: northJobId })],
  ])("rejects updating an out-of-branch ticket %s and leaves it unchanged", async (_label, values) => {
    const ticket = await createTicket(`Out of branch ${_label}`, values());
    expect((await patchTicket(terry, ticket.id, { description: "Changed by technician" })).status).toBe(404);
    expect(await storedDescription(ticket.id)).toBe("Internal office ticket");
  });
});

describe("field ticket list", () => {
  it("shows exactly the tickets a technician may work on", async () => {
    await createTicket("List: assigned", { customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, assignedMembershipId: seedIds.terryMembership });
    await createTicket("List: created in the field", { createdByActorId: terry.userId, assignedMembershipId: seedIds.terryMembership });
    await createTicket("List: created by technician, unassigned", { createdByActorId: terry.userId });
    await createTicket("List: on assigned job", { customerId: seedIds.carter, jobId: seedIds.completedJob, assignedMembershipId: seedIds.morganMembership });
    await createTicket("List: unrelated", { customerId: seedIds.nguyen, serviceLocationId: seedIds.nguyenLocation, assignedMembershipId: seedIds.morganMembership });
    await createTicket("List: out of branch, assigned", { customerId: seedIds.riverfront, serviceLocationId: seedIds.riverfrontLocation, assignedMembershipId: seedIds.terryMembership });
    await createTicket("List: out of branch, on assigned job", { customerId: seedIds.riverfront, jobId: northJobId });

    const titles = (await fieldTicketTitles(terry)).filter((title) => title.startsWith("List: "));
    expect(titles.sort()).toEqual([
      "List: assigned", "List: created by technician, unassigned", "List: created in the field", "List: on assigned job",
    ]);
  });
});
