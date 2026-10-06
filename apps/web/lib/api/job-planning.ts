import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { domainEvents, jobAssignments, jobs, jobStatusEvents, memberships, roleTemplates, routePlans, routeStops } from "@modular-crm/db";
import { assertTransition, DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized, uuidArray } from "./sql";
import { recordJobReschedule, suppressJobReminders } from "./job-reschedule";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
const plannable = new Set(["draft", "unscheduled", "scheduled", "dispatched", "missed"]);

export async function assignableTechnician(tx: Pick<Tx, "select">, actor: SessionActor, job: typeof jobs.$inferSelect, technicianId: string) {
  const [technician] = await tx.select({ id: memberships.id }).from(memberships).innerJoin(roleTemplates, and(eq(roleTemplates.id, memberships.roleTemplateId), eq(roleTemplates.tenantId, memberships.tenantId)))
    .where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.id, technicianId), eq(memberships.organizationId, job.organizationId), sql`(${memberships.defaultLocationId} = ${job.organizationLocationId} or exists(select 1 from membership_location_scopes mls where mls.tenant_id=${actor.tenantId} and mls.membership_id=${memberships.id} and mls.location_id=${job.organizationLocationId}))`, eq(memberships.status, "active"), eq(roleTemplates.key, "technician")));
  if (!technician) throw new DomainError("NOT_FOUND", "Technician not found for this business location.", 404);
  return technician;
}

/** Lock route -> stops -> job in the same order as route publication. */
export async function lockJobForPlanning(tx: Tx, actor: SessionActor, id: string) {
  requireStaff(actor);
  const [accessible] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id,id), actor.allLocations ? sql`true` : sql`${jobs.organizationLocationId} = any(${uuidArray(actor.locationIds)})`));
  if (!accessible) throw new DomainError("NOT_FOUND", "Job not found.", 404);
  const stops = await tx.select({ routeId: routeStops.routePlanId }).from(routeStops)
    .where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.jobId, id))).orderBy(routeStops.routePlanId);
  for (const stop of stops) {
    await tx.select({ id: routePlans.id }).from(routePlans).where(and(eq(routePlans.tenantId, actor.tenantId), eq(routePlans.id, stop.routeId))).for("update");
    await tx.select({ id: routeStops.id }).from(routeStops).where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.routePlanId, stop.routeId))).for("update");
  }
  const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, id))).for("update");
  requireStaff(actor);
  if (!job || (!actor.allLocations && (!job.organizationLocationId || !actor.locationIds.has(job.organizationLocationId)))) throw new DomainError("NOT_FOUND", "Job not found.", 404);
  if (job.assignedRouteId && !stops.some((stop) => stop.routeId === job.assignedRouteId)) throw new DomainError("CONFLICT", "The route changed. Refresh this job and try again.", 409);
  return job;
}

/** Withdraw only unstarted work. Historical stops remain, but cannot dispatch again. */
export async function withdrawJobFromRoutes(tx: Tx, actor: SessionActor, job: typeof jobs.$inferSelect) {
  if (!plannable.has(job.status)) throw new DomainError("CONFLICT", "Only work that has not started can be rescheduled or reassigned.", 409);
  await tx.update(routeStops).set({ status: "removed", updatedAt: new Date() }).where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.jobId, job.id)));
  const status = ["dispatched", "missed"].includes(job.status) ? "scheduled" : job.status;
  if (status !== job.status) {
    assertTransition("job", job.status, status);
    await tx.insert(jobStatusEvents).values({ tenantId: actor.tenantId, jobId: job.id, fromStatus: job.status, toStatus: status, actorType: "staff", actorId: actor.userId, note: "Returned to scheduling after a planning change." });
  }
  return { status, assignedRouteId: null };
}

const actionSchema = z.object({ idempotencyKey: z.uuid(), expectedUpdatedAt: z.iso.datetime({ offset: true }), scheduledDate: z.iso.date().optional(), technicianId: z.uuid().optional(), reason: z.string().trim().min(1).max(500).optional() });

export async function handleJobPlanning(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  const [resource, id, action] = path;
  if (resource !== "jobs" || !id || path.length !== 3 || !["reschedule", "reassign", "cancel"].includes(action ?? "") || request.method !== "POST") return null;
  requireStaff(actor);
  if (actor.role === "technician") throw new DomainError("FORBIDDEN", "Ask your office to change the schedule.", 403);
  requirePermission(actor, action === "cancel" ? "jobs.cancel" : "jobs.assign");
  const body = await readBody(request, actionSchema);
  if (action === "reschedule" && !body.scheduledDate || action === "reassign" && !body.technicianId || action === "cancel" && !body.reason) throw new DomainError("VALIDATION_ERROR", "Enter the information for this change.", 422);
  const requestHash = createHash("sha256").update(JSON.stringify({ id, action, ...body })).digest("hex");
  const bytes = createHash("sha256").update(`${actor.tenantId}:${actor.userId}:job-action:${body.idempotencyKey}`).digest("hex").slice(0, 32);
  const eventId = `${bytes.slice(0,8)}-${bytes.slice(8,12)}-${bytes.slice(12,16)}-${bytes.slice(16,20)}-${bytes.slice(20)}`;
  const result = await getDb().transaction(async (tx) => {
    // Actor/key serialization also protects against reuse on a different job.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${eventId}))`);
    const job = await lockJobForPlanning(tx, actor, id);
    const [prior] = await tx.select().from(domainEvents).where(and(eq(domainEvents.tenantId, actor.tenantId), eq(domainEvents.id, eventId)));
    if (prior) {
      if (prior.payload.requestHash !== requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "This retry key was used for a different change.", 409);
      return { item: prior.payload.result, duplicate: true };
    }
    if (job.updatedAt.toISOString() !== body.expectedUpdatedAt) throw new DomainError("CONFLICT", "This job changed. Refresh it before making this change.", 409);
    const now = new Date();
    let changes: Partial<typeof jobs.$inferInsert>;
    if (action === "cancel") {
      assertTransition("job", job.status, "canceled", { reason: body.reason });
      changes = { status: "canceled", cancelReasonCode: body.reason };
      await tx.update(routeStops).set({ status: "skipped", updatedAt: now }).where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.jobId, id), sql`${routeStops.status} <> 'removed'`));
      await suppressJobReminders(tx, actor, id, "visit_canceled");
      await tx.insert(jobStatusEvents).values({ tenantId: actor.tenantId, jobId: id, fromStatus: job.status, toStatus: "canceled", reasonCode: body.reason, actorType: "staff", actorId: actor.userId });
    } else {
      if (!plannable.has(job.status)) throw new DomainError("CONFLICT", "Only work that has not started can be rescheduled or reassigned.", 409);
      changes = await withdrawJobFromRoutes(tx, actor, job);
      if (action === "reschedule") {
        if (body.scheduledDate === job.scheduledDate) throw new DomainError("VALIDATION_ERROR", "Choose a different service date.", 422);
        changes = { ...changes, scheduledDate: body.scheduledDate, serviceWindowStart: null, serviceWindowEnd: null };
        await recordJobReschedule(tx, actor, job, body.scheduledDate!);
      } else {
        const technician = await assignableTechnician(tx, actor, job, body.technicianId!);
        const [currentAssignment] = await tx.select({ id: jobAssignments.id }).from(jobAssignments).where(and(eq(jobAssignments.tenantId,actor.tenantId),eq(jobAssignments.jobId,id),eq(jobAssignments.membershipId,technician.id),eq(jobAssignments.assignmentRole,"primary"),isNull(jobAssignments.removedAt)));
        if (currentAssignment) throw new DomainError("VALIDATION_ERROR","This job is already assigned to this technician. Choose a different technician.",422);
        await suppressJobReminders(tx, actor, id, "visit_rescheduled");
        await tx.update(jobAssignments).set({ removedAt: now }).where(and(eq(jobAssignments.tenantId, actor.tenantId), eq(jobAssignments.jobId, id), isNull(jobAssignments.removedAt)));
        await tx.insert(jobAssignments).values({ tenantId: actor.tenantId, jobId: id, membershipId: technician.id, assignmentRole: "primary" });
      }
    }
    const [saved] = await tx.update(jobs).set({ ...changes, updatedAt: now }).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, id))).returning();
    const item = normalized(saved) as Record<string, unknown>;
    await recordEvent(actor, { id: eventId, type: action === "reschedule" ? "job.schedule_changed" : action === "reassign" ? "job.assigned" : "job.canceled", entityType: "job", entityId: id, locationId: job.organizationLocationId, auditAction: `job.${action}`, before: normalized(job) as Record<string, unknown>, after: item, payload: { customerId: job.customerId, jobId: id, reason: body.reason, scheduledDate: saved!.scheduledDate, technicianId: body.technicianId, requestHash, result: item } }, tx);
    return { item, duplicate: false };
  });
  return json(result);
}
