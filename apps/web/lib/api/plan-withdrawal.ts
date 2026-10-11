import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { jobs, jobStatusEvents, routePlans, routeStops, recurringGenerationLedger, type Database } from "@modular-crm/db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { suppressJobReminders } from "./job-reschedule";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Caller holds the plan lock. Keep started/financial history and withdraw only unstarted future work. */
export async function withdrawPlanVisits(tx: Tx, actor: SessionActor, planId: string, from: string, reason: string) {
  requireStaff(actor);
  const eligible = and(eq(jobs.tenantId, actor.tenantId), eq(jobs.servicePlanId, planId),
    gte(jobs.scheduledDate, from), inArray(jobs.status, ["draft", "unscheduled", "scheduled", "dispatched"]), isNull(jobs.actualStartedAt),
    sql`not exists(select 1 from invoice_items i where i.tenant_id=${jobs.tenantId} and i.job_id=${jobs.id}) and not exists(select 1 from job_invoice_links i where i.tenant_id=${jobs.tenantId} and i.job_id=${jobs.id})`);
  // Match route publication's route -> stops -> job lock order, across the whole batch.
  const routes = await tx.selectDistinct({ id: routeStops.routePlanId }).from(routeStops).innerJoin(jobs, and(eq(jobs.tenantId, routeStops.tenantId), eq(jobs.id, routeStops.jobId))).where(eligible).orderBy(routeStops.routePlanId);
  for (const route of routes) {
    await tx.select({ id: routePlans.id }).from(routePlans).where(and(eq(routePlans.tenantId, actor.tenantId), eq(routePlans.id, route.id))).for("update");
    await tx.select({ id: routeStops.id }).from(routeStops).where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.routePlanId, route.id))).for("update");
  }
  const visits = await tx.select().from(jobs).where(eligible).orderBy(jobs.id).for("update");
  for (const job of visits) {
    const now = new Date();
    await tx.update(routeStops).set({ status: "removed", updatedAt: now }).where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.jobId, job.id)));
    await tx.update(jobs).set({ status: "canceled", billable: false, assignedRouteId: null, cancelReasonCode: reason, updatedAt: now }).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, job.id)));
    await tx.update(recurringGenerationLedger).set({ status: "withdrawn", updatedAt: now }).where(and(eq(recurringGenerationLedger.tenantId, actor.tenantId), eq(recurringGenerationLedger.servicePlanId, planId), eq(recurringGenerationLedger.jobId, job.id)));
    await tx.insert(jobStatusEvents).values({ tenantId: actor.tenantId, jobId: job.id, fromStatus: job.status, toStatus: "canceled", reasonCode: reason, actorType: "staff", actorId: actor.userId });
    await suppressJobReminders(tx, actor, job.id, "visit_canceled");
    await recordEvent(actor, { type: "job.canceled", entityType: "job", entityId: job.id, locationId: job.organizationLocationId, auditAction: "job.plan_withdrawal", before: { status: job.status, billable: job.billable }, after: { status: "canceled", billable: false }, payload: { servicePlanId: planId, reason } }, tx);
  }
  return visits.length;
}
