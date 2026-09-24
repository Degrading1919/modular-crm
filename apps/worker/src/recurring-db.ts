import { and, eq } from "drizzle-orm";
import {
  type Database, customers, domainEvents, hasUsableFeature, jobStatusEvents, jobs, loadTenantCapabilities,
  recurrenceRules, recurringGenerationLedger, servicePlans, services,
} from "@modular-crm/db";
import { addCalendarDays, localDate, planRecurringOccurrences, type RecurringPlan } from "./recurrence.js";

export type RecurringGenerationRequest = { tenantId?: string; planId?: string; through?: string; horizonDays?: number; now?: Date };

/** Ledger insert, job insert, status history and domain event commit as one transaction. */
export async function generateRecurringJobs(db: Database, request: RecurringGenerationRequest = {}): Promise<{ created: number; existing: number }> {
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
  const usableByTenant = new Map<string, boolean>();
  for (const row of rows) {
    let usable = usableByTenant.get(row.plan.tenantId);
    if (usable === undefined) {
      usable = hasUsableFeature(await loadTenantCapabilities(db, row.plan.tenantId, now), "recurring_service_management");
      usableByTenant.set(row.plan.tenantId, usable);
    }
    if (!usable) continue;
    const from = localDate(now, row.recurrence.timezone);
    const through = request.through ?? addCalendarDays(from, horizonDays);
    const plan: RecurringPlan = {
      id: row.plan.id, tenantId: row.plan.tenantId, status: row.plan.status, effectiveFrom: row.plan.effectiveFrom,
      effectiveTo: row.plan.effectiveTo, pauseFrom: row.plan.pauseFrom, pauseUntil: row.plan.pauseUntil,
      frequencyType: row.recurrence.frequencyType, interval: row.recurrence.interval, daysOfWeek: row.recurrence.daysOfWeek,
      dayOfMonth: row.recurrence.dayOfMonth, timezone: row.recurrence.timezone,
    };
    for (const occurrence of planRecurringOccurrences(plan, from, through)) {
      const outcome = await db.transaction(async (tx) => {
        const [claim] = await tx.insert(recurringGenerationLedger).values({ tenantId: row.plan.tenantId, servicePlanId: row.plan.id, occurrenceKey: occurrence.key, intendedDate: occurrence.serviceDate, status: "pending" })
          .onConflictDoNothing({ target: [recurringGenerationLedger.servicePlanId, recurringGenerationLedger.occurrenceKey] }).returning({ id: recurringGenerationLedger.id });
        if (!claim) return "existing" as const;
        const [prior] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.tenantId, row.plan.tenantId), eq(jobs.servicePlanId, row.plan.id), eq(jobs.scheduledDate, occurrence.serviceDate))).limit(1);
        let jobId = prior?.id;
        if (!jobId) {
          const [job] = await tx.insert(jobs).values({
            tenantId: row.plan.tenantId, organizationId: row.organizationId, organizationLocationId: row.plan.organizationLocationId,
            customerId: row.plan.customerId, serviceLocationId: row.plan.serviceLocationId, servicePlanId: row.plan.id,
            serviceId: row.plan.serviceId, status: "scheduled", scheduledDate: occurrence.serviceDate,
            estimatedDurationMinutes: row.defaultDurationMinutes, priceSnapshot: row.plan.pricingSnapshot,
          }).returning({ id: jobs.id });
          if (!job) throw new Error("Job insertion did not return an ID");
          jobId = job.id;
          await tx.insert(jobStatusEvents).values({ tenantId: row.plan.tenantId, jobId, fromStatus: null, toStatus: "scheduled", actorType: "system", occurredAt: now });
          await tx.insert(domainEvents).values({ tenantId: row.plan.tenantId, eventType: "job.created", eventVersion: 1, occurredAt: now, actorType: "system", entityType: "job", entityId: jobId, organizationId: row.organizationId, locationId: row.plan.organizationLocationId, payload: { customerId: row.plan.customerId, servicePlanId: row.plan.id, serviceDate: occurrence.serviceDate } });
        }
        await tx.update(recurringGenerationLedger).set({ jobId, status: "generated", generatedAt: now, updatedAt: now }).where(eq(recurringGenerationLedger.id, claim.id));
        return prior ? "existing" as const : "created" as const;
      });
      if (outcome === "created") created++;
      else existing++;
    }
  }
  return { created, existing };
}
