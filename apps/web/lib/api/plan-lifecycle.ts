import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  customers, jobStatusEvents, jobs, priceRules, recurrenceRules, recurringGenerationLedger,
  serviceLocations, servicePlans, services, taxRules, tenants,
} from "@modular-crm/db";
import { evaluateConditions, type Condition } from "@modular-crm/config";
import { DomainError, normalizeRecurrenceFrequency, requirePermission } from "@modular-crm/domain";
import { evaluatePrice, snapshotPriceResult, type PriceRule, type PricingEffect } from "@modular-crm/pricing";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type ServicePlanPriceInput = {
  tenantId: string;
  organizationId: string;
  organizationLocationId: string | null;
  serviceId: string;
  customerType?: string | null;
  serviceZoneId?: string | null;
  frequency: string;
  quantity?: number;
  fields?: Record<string, unknown>;
  at: string;
  override?: { amountMinor: number; reason: string; actorId: string; at: string };
};

function valueObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function conditionForPricing(raw: unknown): Condition | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.field === "string" && typeof value.operator === "string") return raw as Condition;
  if (Array.isArray(value.all) || Array.isArray(value.any) || value.not) return raw as Condition;
  const comparisons = Object.entries(value).map(([field, target]) => ({ field, operator: "equals" as const, value: target }));
  if (comparisons.length === 0) return undefined;
  return comparisons.length === 1 ? comparisons[0] : { all: comparisons };
}

function toPriceRule(rule: typeof priceRules.$inferSelect): PriceRule | null {
  const rawEffect = valueObject(rule.effects);
  const effect = typeof rawEffect.type === "string" ? rawEffect as unknown as PricingEffect
    : Number.isSafeInteger(rawEffect.baseMinor) && Number(rawEffect.baseMinor) >= 0
      ? { type: "set_base_amount", amountMinor: Number(rawEffect.baseMinor) } as const : null;
  if (!effect) return null;
  const source = rule.source === "core" || rule.source === "industry_pack" ? rule.source : "tenant";
  const conditions = conditionForPricing(rule.conditions);
  return {
    id: rule.id, name: rule.name, priority: rule.priority, active: rule.active, source, effect,
    ...(conditions ? { conditions } : {}),
    ...(rule.effectiveFrom ? { effectiveFrom: rule.effectiveFrom } : {}),
    ...(rule.effectiveTo ? { effectiveTo: rule.effectiveTo } : {}),
  };
}

/** Price a plan through the shared rules engine and return a billing-compatible immutable snapshot. */
export async function calculateServicePlanPrice(tx: DbTransaction, input: ServicePlanPriceInput): Promise<Record<string, unknown>> {
  const [tenant] = await tx.select({ currency: tenants.defaultCurrency }).from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
  if (!tenant) throw new DomainError("NOT_FOUND", "Business not found.", 404);
  const [service] = await tx.select({ taxable: services.taxable, serviceKey: services.key }).from(services)
    .where(and(eq(services.id, input.serviceId), eq(services.tenantId, input.tenantId))).limit(1);
  if (!service) throw new DomainError("NOT_FOUND", "Service not found.", 404);
  const currency = tenant.currency ?? "USD";
  const context = {
    tenantId: input.tenantId, currency, at: input.at, serviceId: input.serviceId, serviceKey: service.serviceKey, frequency: input.frequency,
    customerType: input.customerType ?? undefined, quantity: input.quantity ?? 1, zoneId: input.serviceZoneId ?? undefined,
    fields: input.fields ?? {},
  };
  const dbRules = await tx.select().from(priceRules).where(and(
    eq(priceRules.tenantId, input.tenantId), eq(priceRules.organizationId, input.organizationId), eq(priceRules.active, true),
  ));
  const rules = dbRules.map(toPriceRule).filter((rule): rule is PriceRule => !!rule);
  const applicableTaxes = service.taxable
    ? await tx.select().from(taxRules).where(and(eq(taxRules.tenantId, input.tenantId), eq(taxRules.active, true)))
    : [];
  const rateBasisPoints = applicableTaxes.filter((rule) => {
    if (rule.organizationLocationId && rule.organizationLocationId !== input.organizationLocationId) return false;
    return evaluateConditions(conditionForPricing(rule.conditions), { current: context, now: input.at });
  }).sort((a, b) => b.priority - a.priority)[0]?.rateBasisPoints ?? 0;
  let result;
  try {
    result = evaluatePrice({ context, rules, tax: { rateBps: rateBasisPoints }, ...(input.override ? { override: input.override } : {}) });
  } catch {
    throw new DomainError("VALIDATION_ERROR", "The configured service price could not be calculated.", 422);
  }
  if (result.quoteRequired) throw new DomainError("VALIDATION_ERROR", "This service needs a confirmed price before a plan can be activated.", 422);
  const pricedAt = new Date().toISOString();
  return {
    ...snapshotPriceResult(result, pricedAt),
    amountMinor: result.totalMinor,
    totalMinor: result.totalMinor,
    currency: result.currency,
    serviceId: input.serviceId,
    frequency: input.frequency,
    quantity: context.quantity,
  };
}

const planChangeSchema = z.object({
  effectiveDate: z.iso.date(),
  frequency: z.string().trim().min(1).max(40).optional(),
  interval: z.number().int().min(1).max(52).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  priceOverride: z.object({ amountMinor: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(500) }).optional(),
  futureJobPolicy: z.enum(["keep", "cancel_unstarted"]).default("keep"),
}).refine((value) => value.frequency !== undefined || value.interval !== undefined || value.daysOfWeek !== undefined || value.dayOfMonth !== undefined || value.priceOverride !== undefined, {
  message: "Change the service frequency or price.",
});

export type PlanScheduleVersion = {
  effectiveFrom: string;
  anchorDate: string;
  frequencyType: string;
  interval: number;
  daysOfWeek: number[] | null;
  dayOfMonth: number | null;
};

function validDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const field = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}

function scheduleVersions(configuration: Record<string, unknown>, initial: Omit<PlanScheduleVersion, "anchorDate"> & { anchorDate?: string }): PlanScheduleVersion[] {
  if ("scheduleVersions" in configuration && !Array.isArray(configuration.scheduleVersions)) {
    throw new DomainError("VALIDATION_ERROR", "The current service schedule needs correction before it can be changed.", 422);
  }
  const rawVersions = Array.isArray(configuration.scheduleVersions) ? configuration.scheduleVersions : null;
  if (!rawVersions?.length) return [{ ...initial, anchorDate: initial.anchorDate ?? initial.effectiveFrom }];
  const result = rawVersions.map((item): PlanScheduleVersion => {
    const value = valueObject(item);
    const effectiveFrom = typeof value.effectiveFrom === "string" ? value.effectiveFrom : "";
    const anchorDate = typeof value.anchorDate === "string" ? value.anchorDate : effectiveFrom;
    if (!validDate(effectiveFrom) || !validDate(anchorDate) || typeof value.frequencyType !== "string") {
      throw new DomainError("VALIDATION_ERROR", "The current service schedule needs correction before it can be changed.", 422);
    }
    if (value.interval !== undefined && typeof value.interval !== "number") throw new DomainError("VALIDATION_ERROR", "The current service schedule needs correction before it can be changed.", 422);
    if (value.daysOfWeek !== undefined && value.daysOfWeek !== null && !Array.isArray(value.daysOfWeek)) throw new DomainError("VALIDATION_ERROR", "The current service schedule needs correction before it can be changed.", 422);
    if (value.dayOfMonth !== undefined && value.dayOfMonth !== null && typeof value.dayOfMonth !== "number") throw new DomainError("VALIDATION_ERROR", "The current service schedule needs correction before it can be changed.", 422);
    try {
      const normalized = normalizeRecurrenceFrequency(value.frequencyType, {
        interval: typeof value.interval === "number" ? value.interval : undefined,
        daysOfWeek: Array.isArray(value.daysOfWeek) ? value.daysOfWeek as number[] : value.daysOfWeek === null ? null : undefined,
        dayOfMonth: typeof value.dayOfMonth === "number" ? value.dayOfMonth : value.dayOfMonth === null ? null : undefined,
      });
      return { effectiveFrom, anchorDate, ...normalized };
    } catch {
      throw new DomainError("VALIDATION_ERROR", "The current service schedule needs correction before it can be changed.", 422);
    }
  });
  return result.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

export function servicePlanFrequencyKey(version: PlanScheduleVersion): string {
  if (version.frequencyType === "daily" || version.frequencyType === "monthly") return version.frequencyType;
  if ((version.daysOfWeek?.length ?? 0) > 1) return "twice_weekly";
  if (version.interval === 2) return "every_two_weeks";
  if (version.interval === 4) return "every_four_weeks";
  return "weekly";
}

function currentPriceVersions(snapshot: Record<string, unknown> | null, initialDate: string) {
  const raw = Array.isArray(snapshot?.priceVersions) ? snapshot.priceVersions : [];
  const versions = raw.filter((item): item is { effectiveFrom: string; snapshot: Record<string, unknown> } =>
    !!item && typeof item === "object" && typeof (item as Record<string, unknown>).effectiveFrom === "string"
      && !!(item as Record<string, unknown>).snapshot && typeof (item as Record<string, unknown>).snapshot === "object");
  if (versions.length) return versions;
  if (!snapshot) return [];
  const { priceVersions: _ignored, ...prior } = snapshot;
  return [{ effectiveFrom: initialDate, snapshot: prior }];
}

function withEffectivePrice(snapshot: Record<string, unknown>, versions: Array<{ effectiveFrom: string; snapshot: Record<string, unknown> }>): Record<string, unknown> {
  const latest = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1)?.snapshot ?? snapshot;
  return { ...latest, priceVersions: [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)) };
}

/** Apply a future-dated schedule/price change; handler.ts should route PATCH /api/records/service-plans/:id here. */
export async function changeServicePlan(request: Request, planId: string, actor: SessionActor): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "service_plans.update");
  const body = await readBody(request, planChangeSchema);
  if (body.priceOverride) requirePermission(actor, "pricing.manage");
  const db = getDb();
  const changedAt = new Date();
  const response = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from service_plans where tenant_id=${actor.tenantId} and id=${planId} for update`);
    const [row] = await tx.select({ plan: servicePlans, recurrence: recurrenceRules, customer: customers, location: serviceLocations })
      .from(servicePlans)
      .innerJoin(recurrenceRules, and(eq(recurrenceRules.id, servicePlans.recurrenceRuleId), eq(recurrenceRules.tenantId, servicePlans.tenantId)))
      .innerJoin(customers, and(eq(customers.id, servicePlans.customerId), eq(customers.tenantId, servicePlans.tenantId)))
      .innerJoin(serviceLocations, and(eq(serviceLocations.id, servicePlans.serviceLocationId), eq(serviceLocations.tenantId, servicePlans.tenantId)))
      .where(and(eq(servicePlans.id, planId), eq(servicePlans.tenantId, actor.tenantId))).limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "Service plan not found.", 404);
    if (!actor.allLocations && (!row.plan.organizationLocationId || !actor.locationIds.has(row.plan.organizationLocationId))) throw new DomainError("NOT_FOUND", "Service plan not found.", 404);
    if (!["active", "paused"].includes(row.plan.status)) throw new DomainError("INVALID_TRANSITION", "Only active or paused service plans can be changed.", 409);
    if (!validDate(body.effectiveDate) || body.effectiveDate < row.plan.effectiveFrom) throw new DomainError("VALIDATION_ERROR", "The effective date must be on or after the plan start date.", 422);
    const configuration = valueObject(row.recurrence.configuration);
    const versions = scheduleVersions(configuration, {
      effectiveFrom: row.plan.effectiveFrom, frequencyType: row.recurrence.frequencyType, interval: row.recurrence.interval,
      daysOfWeek: row.recurrence.daysOfWeek, dayOfMonth: row.recurrence.dayOfMonth,
    });
    if (versions.some((version) => version.effectiveFrom === body.effectiveDate)) throw new DomainError("CONFLICT", "A plan change already exists for this effective date.", 409);
    const [tenant] = await tx.select({ timezone: tenants.defaultTimezone }).from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
    const timezone = row.recurrence.timezone || tenant?.timezone || "America/New_York";
    const today = localDate(changedAt, timezone);
    if (body.effectiveDate < today) throw new DomainError("VALIDATION_ERROR", "Plan changes must take effect today or later.", 422);

    const oldActive = [...versions].filter((version) => version.effectiveFrom <= body.effectiveDate).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1) ?? versions[0]!;
    const recurrenceChanged = body.frequency !== undefined || body.interval !== undefined || body.daysOfWeek !== undefined || body.dayOfMonth !== undefined;
    const configured = recurrenceChanged
      ? normalizeRecurrenceFrequency(body.frequency ?? servicePlanFrequencyKey(oldActive), {
        interval: body.interval ?? (body.frequency ? undefined : oldActive.interval),
        daysOfWeek: body.daysOfWeek ?? (body.frequency ? undefined : oldActive.daysOfWeek),
        dayOfMonth: body.dayOfMonth ?? (body.frequency ? undefined : oldActive.dayOfMonth),
      })
      : null;
    const nextVersion: PlanScheduleVersion = configured
      ? { effectiveFrom: body.effectiveDate, anchorDate: body.effectiveDate, ...configured }
      : { ...oldActive, effectiveFrom: body.effectiveDate };
    const nextVersions = [...versions, nextVersion].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

    let pricingSnapshot = row.plan.pricingSnapshot;
    if (body.priceOverride) {
      const selectedFrequency = servicePlanFrequencyKey(nextVersion);
      const newPrice = await calculateServicePlanPrice(tx, {
        tenantId: actor.tenantId, organizationId: actor.organizationId, organizationLocationId: row.plan.organizationLocationId,
        serviceId: row.plan.serviceId, customerType: row.customer.customerType, serviceZoneId: row.location.serviceZoneId,
        frequency: selectedFrequency, fields: valueObject(row.location.customFields), at: `${body.effectiveDate}T12:00:00.000Z`,
        override: { amountMinor: body.priceOverride.amountMinor, reason: body.priceOverride.reason, actorId: actor.userId, at: changedAt.toISOString() },
      });
      const priceVersions = currentPriceVersions(row.plan.pricingSnapshot, row.plan.effectiveFrom);
      if (priceVersions.some((version) => version.effectiveFrom === body.effectiveDate)) throw new DomainError("CONFLICT", "A price change already exists for this effective date.", 409);
      pricingSnapshot = withEffectivePrice(newPrice, [...priceVersions, { effectiveFrom: body.effectiveDate, snapshot: newPrice }]);
    }

    const ruleValues = {
      tenantId: actor.tenantId, frequencyType: versions[0]!.frequencyType, interval: versions[0]!.interval,
      daysOfWeek: versions[0]!.daysOfWeek, dayOfMonth: versions[0]!.dayOfMonth, timezone,
      configuration: { ...configuration, scheduleVersions: nextVersions },
    };
    const [rule] = await tx.insert(recurrenceRules).values(ruleValues).returning({ id: recurrenceRules.id });
    if (!rule) throw new Error("Could not save the effective service schedule.");
    const [updated] = await tx.update(servicePlans).set({ recurrenceRuleId: rule.id, pricingSnapshot, updatedAt: changedAt })
      .where(and(eq(servicePlans.id, planId), eq(servicePlans.tenantId, actor.tenantId))).returning();
    if (!updated) throw new Error("Could not save the service plan.");

    let canceledJobs = 0;
    if (body.futureJobPolicy === "cancel_unstarted") {
      const pending = await tx.select({ job: jobs }).from(recurringGenerationLedger)
        .innerJoin(jobs, and(eq(jobs.id, recurringGenerationLedger.jobId), eq(jobs.tenantId, recurringGenerationLedger.tenantId)))
        .where(and(eq(recurringGenerationLedger.tenantId, actor.tenantId), eq(recurringGenerationLedger.servicePlanId, planId), eq(recurringGenerationLedger.status, "generated"),
          inArray(jobs.status, ["draft", "unscheduled", "scheduled"]), sql`${jobs.scheduledDate} >= ${body.effectiveDate}`));
      for (const { job } of pending) {
        const [canceled] = await tx.update(jobs).set({ status: "canceled", cancelReasonCode: "service_plan_changed", updatedAt: changedAt })
          .where(and(eq(jobs.id, job.id), eq(jobs.tenantId, actor.tenantId), inArray(jobs.status, ["draft", "unscheduled", "scheduled"]))).returning({ id: jobs.id });
        if (!canceled) continue;
        canceledJobs++;
        await tx.insert(jobStatusEvents).values({ tenantId: actor.tenantId, jobId: job.id, fromStatus: job.status, toStatus: "canceled", reasonCode: "service_plan_changed", actorType: "staff", actorId: actor.userId, occurredAt: changedAt });
      }
    }
    await recordEvent(actor, {
      type: "service_plan.updated", entityType: "service_plan", entityId: planId,
      payload: { effectiveDate: body.effectiveDate, frequencyChanged: !!configured, priceChanged: !!body.priceOverride, canceledFutureJobs: canceledJobs },
      auditAction: "service_plan.change", before: { recurrence: oldActive, pricingSnapshot: row.plan.pricingSnapshot },
      after: { recurrence: nextVersion, pricingSnapshot, futureJobPolicy: body.futureJobPolicy, canceledFutureJobs: canceledJobs },
      locationId: row.plan.organizationLocationId,
    }, tx);
    return { item: { ...updated, frequency: servicePlanFrequencyKey(nextVersion), effectiveDate: body.effectiveDate, futureJobPolicy: body.futureJobPolicy, canceledFutureJobs: canceledJobs } };
  });
  return json(response);
}
