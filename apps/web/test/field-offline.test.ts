import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import {
  completionProofs, fieldOperationReceipts, fileLinks, files, jobStatusEvents, jobs, notes, schema, seedDevelopment, seedIds, shifts, timeEntries,
  type Database,
} from "@modular-crm/db";
import { permissionsForRole } from "@modular-crm/domain";
import type { SessionActor } from "../lib/api/actor.ts";

const { getDbMock, storagePutMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), storagePutMock: vi.fn(async () => ({ key: "field-photo", size: 5 })) }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
vi.mock("../lib/connectors.ts", () => ({ getCapability: vi.fn(async () => ({ putObject: storagePutMock })) }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_field_offline_test";
const { handleRoutesField } = await import("../lib/api/routes-field.ts");
const { transitionJob } = await import("../lib/api/workflows.ts");

const id = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
const technician: SessionActor = {
  kind: "staff", userId: "demo-happy-tech", tenantId: seedIds.happyTenant, tenantName: "Happy Yards Pet Waste",
  packKey: "pet-waste-removal", email: "tech@happyyards.test", name: "Terry Tech", role: "technician",
  permissions: permissionsForRole("technician"), locationIds: new Set([seedIds.augusta]), allLocations: false,
  membershipId: seedIds.terryMembership, organizationId: seedIds.happyOrganization, defaultLocationId: seedIds.augusta,
};
const cleanTechnician: SessionActor = {
  ...technician, userId: "demo-clean-tech", tenantId: seedIds.cleanTenant, tenantName: "CleanPaws Route Service",
  email: "tech@cleanpaws.test", membershipId: seedIds.cleanTechMembership, organizationId: seedIds.cleanOrganization,
  locationIds: new Set([seedIds.cleanBranch]), defaultLocationId: seedIds.cleanBranch,
};

let pglite: PGlite;
let db: Database;

async function postFieldTime(actor: SessionActor, body: Record<string, unknown>) {
  const response = await handleRoutesField(new Request("http://localhost/api/v1/field/time", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), ["field", "time"], actor);
  if (!response) throw new Error("Field time endpoint did not handle the request.");
  return response;
}

async function postFieldJob(actor: SessionActor, jobId: string, action: string, body: Record<string, unknown>) {
  const response = await handleRoutesField(new Request(`http://localhost/api/v1/field/jobs/${jobId}/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), ["field", "jobs", jobId, action], actor);
  if (!response) throw new Error("Field job endpoint did not handle the request.");
  return response;
}

beforeAll(async () => {
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  await seedDevelopment(db);
}, 120_000);

afterAll(async () => { await pglite?.close(); });

describe("field offline mutation receipts", () => {
  it("replays a job transition once and rejects reuse of its operation ID with a different payload", async () => {
    await db.update(jobs).set({ status: "dispatched" }).where(eq(jobs.id, seedIds.recleanJob));
    const clientOperationId = id(950);
    const payload = { status: "en_route", expectedPriorState: "dispatched", clientOperationId };
    const operation = { action: "job.transition.en_route", target: seedIds.recleanJob, clientOperationId, payload };

    const first = await transitionJob(technician, seedIds.recleanJob, "en_route", { expectedPriorState: "dispatched", fieldOperation: operation });
    const second = await transitionJob(technician, seedIds.recleanJob, "en_route", { expectedPriorState: "dispatched", fieldOperation: operation });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ item: { id: seedIds.recleanJob, status: "en_route" }, duplicate: true });
    expect(await db.select().from(jobStatusEvents).where(and(eq(jobStatusEvents.tenantId, seedIds.happyTenant), eq(jobStatusEvents.jobId, seedIds.recleanJob)))).toHaveLength(1);

    await expect(transitionJob(technician, seedIds.recleanJob, "en_route", {
      expectedPriorState: "dispatched",
      fieldOperation: { ...operation, payload: { ...payload, note: "different content" } },
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    expect(await db.select().from(fieldOperationReceipts).where(and(eq(fieldOperationReceipts.tenantId, seedIds.happyTenant), eq(fieldOperationReceipts.clientOperationId, clientOperationId)))).toHaveLength(1);
  });

  it("serializes concurrent retries so only one transition and event are written", async () => {
    await db.update(jobs).set({ status: "dispatched" }).where(eq(jobs.id, seedIds.upcomingJob));
    const clientOperationId = id(951);
    const payload = { status: "en_route", expectedPriorState: "dispatched", clientOperationId };
    const input = { action: "job.transition.en_route", target: seedIds.upcomingJob, clientOperationId, payload };
    const [first, second] = await Promise.all([
      transitionJob(technician, seedIds.upcomingJob, "en_route", { expectedPriorState: "dispatched", fieldOperation: input }),
      transitionJob(technician, seedIds.upcomingJob, "en_route", { expectedPriorState: "dispatched", fieldOperation: input }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await db.select().from(jobStatusEvents).where(and(eq(jobStatusEvents.tenantId, seedIds.happyTenant), eq(jobStatusEvents.jobId, seedIds.upcomingJob)))).toHaveLength(1);
    expect((await db.select().from(jobs).where(eq(jobs.id, seedIds.upcomingJob)))[0]?.status).toBe("en_route");
  });

  it("returns a stale-state conflict without changing an office-canceled job", async () => {
    await db.update(jobs).set({ status: "canceled" }).where(and(eq(jobs.tenantId, seedIds.happyTenant), eq(jobs.id, seedIds.recleanJob)));
    const clientOperationId = id(952);
    await expect(transitionJob(technician, seedIds.recleanJob, "completed", {
      completedChecklist: true,
      expectedPriorState: "in_progress",
      fieldOperation: { action: "job.transition.completed", target: seedIds.recleanJob, clientOperationId, payload: { status: "completed", expectedPriorState: "in_progress", clientOperationId } },
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409, details: { expectedPriorState: "in_progress", currentState: "canceled" } });
    expect((await db.select().from(jobs).where(eq(jobs.id, seedIds.recleanJob)))[0]?.status).toBe("canceled");
    expect(await db.select().from(fieldOperationReceipts).where(eq(fieldOperationReceipts.clientOperationId, clientOperationId))).toHaveLength(0);
  });

  it("uses device time for a valid offline clock-in and separately records receipt time and anomaly", async () => {
    const deviceTimestamp = new Date(Date.now() - 30 * 60_000);
    const clientOperationId = id(953);
    const body = { action: "clock_in", clientOperationId, deviceTimestamp: deviceTimestamp.toISOString() };
    const before = new Date();
    const first = await postFieldTime(cleanTechnician, body);
    const after = new Date();
    const retry = await postFieldTime(cleanTechnician, body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(await db.select().from(shifts).where(and(eq(shifts.tenantId, seedIds.cleanTenant), eq(shifts.membershipId, seedIds.cleanTechMembership)))).toHaveLength(1);
    const [shift] = await db.select().from(shifts).where(and(eq(shifts.tenantId, seedIds.cleanTenant), eq(shifts.membershipId, seedIds.cleanTechMembership))).limit(1);
    expect(shift?.clockInAt.toISOString()).toBe(deviceTimestamp.toISOString());
    const [receipt] = await db.select().from(fieldOperationReceipts).where(and(eq(fieldOperationReceipts.tenantId, seedIds.cleanTenant), eq(fieldOperationReceipts.clientOperationId, clientOperationId))).limit(1);
    expect(receipt?.deviceTimestamp?.toISOString()).toBe(deviceTimestamp.toISOString());
    expect(receipt?.serverReceivedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(receipt?.serverReceivedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(receipt).toMatchObject({ source: "field_app", anomalyClass: "offline_delay", action: "field.time.clock_in" });

    await expect(postFieldTime(cleanTechnician, { ...body, deviceTimestamp: new Date(deviceTimestamp.getTime() + 60_000).toISOString() }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    expect(await db.select().from(shifts).where(and(eq(shifts.tenantId, seedIds.cleanTenant), eq(shifts.membershipId, seedIds.cleanTechMembership)))).toHaveLength(1);
  });

  it("keeps online field time behavior and idempotently saves a field note", async () => {
    expect((await postFieldTime(cleanTechnician, { action: "clock_out" })).status).toBe(200);
    const clockIn = await postFieldTime(cleanTechnician, { action: "clock_in" });
    expect(clockIn.status).toBe(201);
    expect(await postFieldTime(cleanTechnician, { action: "clock_out" })).toMatchObject({ status: 200 });
    expect(await db.select().from(timeEntries).where(and(eq(timeEntries.tenantId, seedIds.cleanTenant), eq(timeEntries.membershipId, seedIds.cleanTechMembership)))).toHaveLength(2);

    await db.update(jobs).set({ status: "scheduled" }).where(and(eq(jobs.tenantId, seedIds.happyTenant), eq(jobs.id, seedIds.recleanJob)));
    const noteId = id(954);
    const noteBody = { text: "Offline visit detail", photoDataUrl: "data:image/png;base64,aGVsbG8=", photoName: "proof.png", clientOperationId: noteId, expectedPriorState: "scheduled" };
    const first = await postFieldJob(technician, seedIds.recleanJob, "note", noteBody);
    const retry = await postFieldJob(technician, seedIds.recleanJob, "note", noteBody);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    const firstItem = (await first.json() as { item: { id: string; fileId: string } }).item;
    const retryItem = (await retry.json() as { item: { id: string; fileId: string } }).item;
    expect(retryItem).toMatchObject({ id: firstItem.id, fileId: firstItem.fileId });
    expect(await db.select().from(notes).where(and(eq(notes.tenantId, seedIds.happyTenant), eq(notes.entityId, seedIds.recleanJob), eq(notes.body, "Offline visit detail")))).toHaveLength(1);
    expect(await db.select().from(files).where(and(eq(files.tenantId, seedIds.happyTenant), eq(files.id, firstItem.fileId)))).toHaveLength(1);
    expect(await db.select().from(fileLinks).where(and(eq(fileLinks.tenantId, seedIds.happyTenant), eq(fileLinks.fileId, firstItem.fileId)))).toHaveLength(1);
    expect(storagePutMock).toHaveBeenCalledTimes(1);
    await expect(postFieldJob(technician, seedIds.recleanJob, "note", { ...noteBody, text: "Changed detail" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  });

  it("enforces the selected Industry Pack checklist on the server and snapshots it with completion proof", async () => {
    await db.update(jobs).set({ status: "in_progress" }).where(and(eq(jobs.tenantId, seedIds.happyTenant), eq(jobs.id, seedIds.recleanJob)));
    await expect(postFieldJob(technician, seedIds.recleanJob, "complete", {
      checklist: { confirm_property: true }, expectedPriorState: "in_progress", clientOperationId: id(955),
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(await db.select().from(completionProofs).where(and(eq(completionProofs.tenantId, seedIds.happyTenant), eq(completionProofs.jobId, seedIds.recleanJob)))).toHaveLength(0);

    const response = await postFieldJob(technician, seedIds.recleanJob, "complete", {
      checklist: { confirm_property: true, review_safety: true, perform_cleanup: true },
      expectedPriorState: "in_progress", clientOperationId: id(956),
    });
    expect(response.status).toBe(200);
    const [proof] = await db.select().from(completionProofs).where(and(eq(completionProofs.tenantId, seedIds.happyTenant), eq(completionProofs.jobId, seedIds.recleanJob))).limit(1);
    const definition = (proof?.snapshot as Record<string, any>).checklistDefinition;
    expect(definition).toMatchObject({ packKey: "pet-waste-removal", packVersion: "1.1.0" });
    expect(definition.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "confirm_property", label: "Confirm the service address", complete: true }),
      expect.objectContaining({ key: "review_safety", label: "Review access and safety notes", complete: true }),
      expect.objectContaining({ key: "perform_cleanup", label: "Complete the cleanup", complete: true }),
    ]));
  });
});
