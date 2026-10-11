import { and, eq, ne, sql } from "drizzle-orm";
import {
  type Database, customers, domainEvents, fieldWorkerSql, memberships, roleTemplates, jobAssignments, hasUsableFeature, jobStatusEvents, jobs, loadTenantCapabilities,
  recurrenceRules, recurringGenerationLedger, servicePlans, services, platformSubscription,
} from "@modular-crm/db";
import { addCalendarDays, localDate, planRecurringOccurrences, priceSnapshotForDate, type RecurrenceVersion, type RecurringPlan } from "./recurrence.js";

export type RecurringGenerationRequest = { tenantId?: string; planId?: string; through?: string; horizonDays?: number; now?: Date };

/** Ledger insert, job insert, status history and domain event commit as one transaction. */
export async function generateRecurringJobs(db: Database, request: RecurringGenerationRequest = {}): Promise<{ created: number; existing: number; invalid: Array<{ planId: string; reason: string }> }> {
  const now = request.now ?? new Date();
  const horizonDays = request.horizonDays ?? 28;
  if (!Number.isSafeInteger(horizonDays) || horizonDays < 0 || horizonDays > 366) throw new Error("Recurring horizon must be 0–366 days");
  const filters = [eq(servicePlans.status, "active")];
  if (request.tenantId) filters.push(eq(servicePlans.tenantId, request.tenantId));
  if (request.planId) filters.push(eq(servicePlans.id, request.planId));
  const rows = await db.select({ plan: servicePlans, recurrence: recurrenceRules, organizationId: customers.organizationId, defaultDurationMinutes: services.defaultDurationMinutes })
    .from(servicePlans)
    .innerJoin(recurrenceRules, and(eq(servicePlans.recurrenceRuleId, recurrenceRules.id), eq(servicePlans.tenantId, recurrenceRules.tenantId)))
    .innerJoin(customers, and(eq(servicePlans.customerId, customers.id), eq(servicePlans.tenantId, customers.tenantId)))
    .leftJoin(services, and(eq(servicePlans.serviceId, services.id), eq(servicePlans.tenantId, services.tenantId)))
    .where(and(...filters));
  let created = 0;
  let existing = 0;
  const invalid: Array<{ planId: string; reason: string }> = [];
  const usableByTenant = new Map<string, boolean>();
  for (const row of rows) {
    let usable = usableByTenant.get(row.plan.tenantId);
    if (usable === undefined) {
      const subscription = await platformSubscription(db, row.plan.tenantId);
      usable = !subscription || !["read_only", "canceled"].includes(subscription.status);
      if (usable) usable = hasUsableFeature(await loadTenantCapabilities(db, row.plan.tenantId, now), "recurring_service_management");
      usableByTenant.set(row.plan.tenantId, usable);
    }
    if (!usable) continue;
    const configuration = row.recurrence.configuration && typeof row.recurrence.configuration === "object" && !Array.isArray(row.recurrence.configuration)
      ? row.recurrence.configuration as Record<string, unknown> : {};
    const scheduleVersions = Array.isArray(configuration.scheduleVersions)
      ? configuration.scheduleVersions as RecurrenceVersion[]
      : undefined;
    const plan: RecurringPlan = {
      id: row.plan.id, tenantId: row.plan.tenantId, status: row.plan.status, effectiveFrom: row.plan.effectiveFrom,
      effectiveTo: row.plan.effectiveTo, pauseFrom: row.plan.pauseFrom, pauseUntil: row.plan.pauseUntil,
      frequencyType: row.recurrence.frequencyType, interval: row.recurrence.interval, daysOfWeek: row.recurrence.daysOfWeek,
      dayOfMonth: row.recurrence.dayOfMonth, timezone: row.recurrence.timezone, scheduleVersions,
      pricingSnapshot: row.plan.pricingSnapshot,
    };
    let occurrences;
    try {
      const from = localDate(now, row.recurrence.timezone);
      const through = request.through ?? addCalendarDays(from, horizonDays);
      occurrences = planRecurringOccurrences(plan, from, through);
    } catch (error) {
      invalid.push({ planId: row.plan.id, reason: error instanceof Error ? error.message : "Invalid recurrence configuration" });
      continue;
    }
    for (const occurrence of occurrences) {
      const outcome = await db.transaction(async (tx) => {
        // Serialize generation against pause/cancel and recheck the live commitment.
        const [current] = await tx.select().from(servicePlans).where(and(eq(servicePlans.tenantId, row.plan.tenantId), eq(servicePlans.id, row.plan.id))).for("update");
        if (!current || current.status !== "active" || current.updatedAt.getTime() !== row.plan.updatedAt.getTime()) return "withdrawn" as const;
        let [claim] = await tx.insert(recurringGenerationLedger).values({ tenantId: row.plan.tenantId, servicePlanId: row.plan.id, occurrenceKey: occurrence.key, intendedDate: occurrence.serviceDate, status: "pending" })
          .onConflictDoNothing({ target: [recurringGenerationLedger.servicePlanId, recurringGenerationLedger.occurrenceKey] }).returning({ id: recurringGenerationLedger.id });
        if (!claim) {
          // Resuming a plan creates a new visit, never reactivates canceled route/history.
          [claim] = await tx.update(recurringGenerationLedger).set({ status: "pending", jobId: null, generatedAt: null, updatedAt: now }).where(and(eq(recurringGenerationLedger.tenantId, row.plan.tenantId), eq(recurringGenerationLedger.servicePlanId, row.plan.id), eq(recurringGenerationLedger.occurrenceKey, occurrence.key), eq(recurringGenerationLedger.status, "withdrawn"))).returning({ id: recurringGenerationLedger.id });
          if (!claim) return "existing" as const;
        }
        const [prior] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.tenantId, row.plan.tenantId), eq(jobs.servicePlanId, row.plan.id), eq(jobs.scheduledDate, occurrence.serviceDate), ne(jobs.status, "canceled"))).limit(1);
        let jobId = prior?.id;
        if (!jobId) {
          const [job] = await tx.insert(jobs).values({
            tenantId: row.plan.tenantId, organizationId: row.organizationId, organizationLocationId: row.plan.organizationLocationId,
            customerId: row.plan.customerId, serviceLocationId: row.plan.serviceLocationId, servicePlanId: row.plan.id,
            serviceId: row.plan.serviceId, status: "scheduled", scheduledDate: occurrence.serviceDate,
            estimatedDurationMinutes: row.defaultDurationMinutes, priceSnapshot: priceSnapshotForDate(row.plan.pricingSnapshot, occurrence.serviceDate),
          }).returning({ id: jobs.id });
          if (!job) throw new Error("Job insertion did not return an ID");
          jobId = job.id;
          const preferredId = current.preferredAssignment?.membershipId;
          if (typeof preferredId === "string") {
            const [member] = await tx.select({ id: memberships.id }).from(memberships).innerJoin(roleTemplates, and(eq(roleTemplates.id, memberships.roleTemplateId), eq(roleTemplates.tenantId, memberships.tenantId))).where(and(eq(memberships.tenantId, row.plan.tenantId), eq(memberships.organizationId, row.organizationId), eq(memberships.id, preferredId), eq(memberships.status, "active"), fieldWorkerSql(roleTemplates.id, roleTemplates.key), sql`(${roleTemplates.key}=\'owner\' or ${memberships.defaultLocationId}=${row.plan.organizationLocationId} or exists(select 1 from membership_location_scopes s where s.tenant_id=${memberships.tenantId} and s.membership_id=${memberships.id} and s.location_id=${row.plan.organizationLocationId}))`)).limit(1);
            if (member) await tx.insert(jobAssignments).values({ tenantId: row.plan.tenantId, jobId, membershipId: member.id, assignmentRole: "primary" });
          }
          await tx.insert(jobStatusEvents).values({ tenantId: row.plan.tenantId, jobId, fromStatus: null, toStatus: "scheduled", actorType: "system", occurredAt: now });
          await tx.insert(domainEvents).values({ tenantId: row.plan.tenantId, eventType: "job.created", eventVersion: 1, occurredAt: now, actorType: "system", entityType: "job", entityId: jobId, organizationId: row.organizationId, locationId: row.plan.organizationLocationId, payload: { customerId: row.plan.customerId, servicePlanId: row.plan.id, serviceDate: occurrence.serviceDate } });
        }
        await tx.update(recurringGenerationLedger).set({ jobId, status: "generated", generatedAt: now, updatedAt: now }).where(eq(recurringGenerationLedger.id, claim.id));
        return prior ? "existing" as const : "created" as const;
      });
      if (outcome === "created") created++;
      else if (outcome === "existing") existing++;
    }
  }
  return { created, existing, invalid };
}
