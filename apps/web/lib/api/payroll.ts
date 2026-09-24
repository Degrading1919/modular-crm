import { and, asc, desc, eq, exists, gt, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  auditEvents, breaks, compensationProfiles, jobAssignments, jobs, mileageRecords, memberships, membershipLocationScopes,
  organizationLocations, organizations, payrollCalculations, payrollComponents, payrollPeriods, routePlans, shifts, tips, timeEntries, tenants, user,
} from "@modular-crm/db";
import { calculateGrossPay, DomainError, requirePermission } from "@modular-crm/domain";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized } from "./sql";

const DAY_MS = 86_400_000;
const METERS_PER_MILE = 1609.344;
const MAX_CALCULATION_MEMBERS = 500;

type IntervalInput = { id: string; shiftId: string | null; locationId: string | null; startsAt: Date | string; endsAt: Date | string };
type BreakInput = { id: string; shiftId: string; startedAt: Date | string; endedAt: Date | string | null };
type CompletedJobInput = { id: string; locationId: string | null; completedAt: Date | string; totalMinor: unknown };
type MileageInput = { id: string; locationId: string | null; occurredOn: string; distanceMeters: number; personalVehicle: boolean };
type TipInput = { id: string; locationId: string | null; createdAt: Date | string; amountMinor: unknown; currency: string };
type ComponentSnapshot = {
  componentType: string;
  description: string;
  amountMinor: number;
  quantity?: string;
  rateMinor?: number;
  sourceEntityType?: string;
  sourceEntityIds?: string[];
};
type ManualCorrection = { id: string; amountMinor: number; description: string; actorMembershipId: string; createdAt: string };
type CalculationSnapshot = {
  source: "payroll-v1";
  profileId: string;
  profile: Record<string, unknown>;
  period: { start: string; end: string };
  locationIds: string[];
  inputs: Record<string, unknown>;
  formula: Record<string, number>;
  baseGrossMinor: number;
  corrections: ManualCorrection[];
  components: ComponentSnapshot[];
};

export interface PayrollCalculationInput {
  periodStart: string;
  periodEnd: string;
  timeZone?: string;
  profile: {
    id: string;
    hourlyRateMinor: number | bigint | null;
    overtimeConfiguration: unknown;
    perJobConfiguration: unknown;
    commissionConfiguration: unknown;
    mileageRateMinorPerUnit: number | bigint | null;
    bonusConfiguration: unknown;
    currency: string;
  };
  timeEntries: readonly IntervalInput[];
  unpaidBreaks: readonly BreakInput[];
  completedJobs: readonly CompletedJobInput[];
  mileage: readonly MileageInput[];
  tips: readonly TipInput[];
  corrections?: readonly ManualCorrection[];
  locationScope?: { allLocations: boolean; locationIds: ReadonlySet<string> };
}

export interface PayrollCalculationResult {
  grossMinor: number;
  currency: string;
  snapshot: CalculationSnapshot;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberFrom(value: unknown, label: string, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new DomainError("VALIDATION_ERROR", `${label} must be a whole minor-unit amount.`, 422);
  return parsed;
}

function safeNonnegative(value: unknown, label: string, fallback = 0): number {
  const parsed = numberFrom(value, label, fallback);
  if (parsed < 0) throw new DomainError("VALIDATION_ERROR", `${label} cannot be negative.`, 422);
  return parsed;
}

function configAmount(configuration: unknown, keys: readonly string[], label: string): number {
  const config = record(configuration);
  for (const key of keys) {
    if (config[key] !== undefined && config[key] !== null) return safeNonnegative(config[key], label);
  }
  return 0;
}

function configRate(configuration: unknown, key: string, label: string): number | undefined {
  const value = record(configuration)[key];
  if (value === undefined || value === null) return undefined;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) throw new DomainError("VALIDATION_ERROR", `${label} must be greater than zero.`, 422);
  return rate;
}

function asMillis(value: Date | string): number {
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(millis)) throw new DomainError("CONFLICT", "A payroll input has an invalid timestamp.", 409);
  return millis;
}

function dateOnlyMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("VALIDATION_ERROR", "Choose a valid payroll date range.", 422);
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== value) {
    throw new DomainError("VALIDATION_ERROR", "Choose a valid payroll date range.", 422);
  }
  return millis;
}

function nextDate(value: string): string {
  const millis = dateOnlyMillis(value);
  return new Date(millis + DAY_MS).toISOString().slice(0, 10);
}

function validTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function dateAtTimeZone(value: Date | number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return `${String(part("year")).padStart(4, "0")}-${String(part("month")).padStart(2, "0")}-${String(part("day")).padStart(2, "0")}`;
}

/** Finds the first instant whose local calendar date is the requested date. This handles DST
 * days that are 23 or 25 hours long and zones whose clocks change at midnight. */
function zonedMidnight(value: string, timeZone: string): number {
  const target = dateOnlyMillis(value);
  const padding = 36 * 60 * 60 * 1000;
  let low = target - padding;
  let high = target + padding;
  if (dateAtTimeZone(low, timeZone) >= value || dateAtTimeZone(high, timeZone) < value) {
    throw new DomainError("VALIDATION_ERROR", "Choose a valid payroll date range.", 422);
  }
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (dateAtTimeZone(middle, timeZone) >= value) high = middle;
    else low = middle;
  }
  return high;
}

function dateRange(periodStart: string, periodEnd: string, timeZone = "UTC"): { startMs: number; endExclusiveMs: number; endExclusive: Date } {
  const startDate = dateOnlyMillis(periodStart);
  const lastDayDate = dateOnlyMillis(periodEnd);
  if (startDate > lastDayDate) {
    throw new DomainError("VALIDATION_ERROR", "Choose a valid payroll date range.", 422);
  }
  const zone = validTimeZone(timeZone);
  const startMs = zonedMidnight(periodStart, zone);
  const endExclusiveMs = zonedMidnight(nextDate(periodEnd), zone);
  return { startMs, endExclusiveMs, endExclusive: new Date(endExclusiveMs) };
}

function mergeIntervals(intervals: readonly { start: number; end: number }[]): Array<{ start: number; end: number }> {
  const sorted = intervals.filter((interval) => interval.end > interval.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of sorted) {
    const prior = merged.at(-1);
    if (!prior || interval.start > prior.end) merged.push({ ...interval });
    else prior.end = Math.max(prior.end, interval.end);
  }
  return merged;
}

function paidWorkSeconds(entries: readonly IntervalInput[], unpaidBreaks: readonly BreakInput[], range: { startMs: number; endExclusiveMs: number }): number {
  const work = mergeIntervals(entries.map((entry) => ({
    start: Math.max(range.startMs, asMillis(entry.startsAt)),
    end: Math.min(range.endExclusiveMs, asMillis(entry.endsAt)),
  })));
  const breaksMerged = mergeIntervals(unpaidBreaks.flatMap((item) => item.endedAt ? [{
    start: Math.max(range.startMs, asMillis(item.startedAt)),
    end: Math.min(range.endExclusiveMs, asMillis(item.endedAt)),
  }] : []));
  let workSeconds = 0;
  for (const interval of work) {
    let unpaidSeconds = 0;
    for (const pause of breaksMerged) {
      if (pause.end <= interval.start) continue;
      if (pause.start >= interval.end) break;
      unpaidSeconds += Math.max(0, Math.min(interval.end, pause.end) - Math.max(interval.start, pause.start)) / 1000;
    }
    workSeconds += Math.max(0, (interval.end - interval.start) / 1000 - unpaidSeconds);
  }
  return workSeconds;
}

export function payrollLocationAllowed(locationId: string | null | undefined, allLocations: boolean, locationIds: ReadonlySet<string>): boolean {
  return allLocations || (!!locationId && locationIds.has(locationId));
}

export function payrollSnapshotInLocationScope(snapshot: unknown, allLocations: boolean, locationIds: ReadonlySet<string>): boolean {
  if (allLocations) return true;
  const locations = Array.isArray(record(snapshot).locationIds) ? record(snapshot).locationIds as unknown[] : [];
  return locations.length > 0 && locations.every((id) => typeof id === "string" && locationIds.has(id));
}

/** Pure, version-friendly V1 gross-pay calculation. Payroll is an export input only. */
export function calculatePayrollBreakdown(input: PayrollCalculationInput): PayrollCalculationResult {
  const range = dateRange(input.periodStart, input.periodEnd, input.timeZone);
  const profile = input.profile;
  const currency = profile.currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new DomainError("VALIDATION_ERROR", "Choose a three-letter currency code for this compensation profile.", 422);
  const inRange = (value: Date | string) => {
    const millis = asMillis(value);
    return millis >= range.startMs && millis < range.endExclusiveMs;
  };
  const scope = input.locationScope ?? { allLocations: true, locationIds: new Set<string>() };
  const timeEntries = input.timeEntries.filter((entry) => asMillis(entry.startsAt) < range.endExclusiveMs && asMillis(entry.endsAt) > range.startMs && payrollLocationAllowed(entry.locationId, scope.allLocations, scope.locationIds));
  const eligibleShiftIds = new Set(timeEntries.flatMap((entry) => entry.shiftId ? [entry.shiftId] : []));
  const unpaidBreaks = input.unpaidBreaks.filter((item) => eligibleShiftIds.has(item.shiftId));
  const paidSeconds = paidWorkSeconds(timeEntries, unpaidBreaks, range);
  const approvedMinutes = Math.round(paidSeconds / 60);
  const jobs = new Map(input.completedJobs.filter((job) => inRange(job.completedAt) && payrollLocationAllowed(job.locationId, scope.allLocations, scope.locationIds)).map((job) => [job.id, job]));
  const completedJobIds = [...jobs.keys()].sort();
  const completedRevenueMinor = [...jobs.values()].reduce((sum, job) => sum + safeNonnegative(job.totalMinor, "Completed job value"), 0);
  const mileageRows = input.mileage.filter((item) => item.personalVehicle && item.occurredOn >= input.periodStart && item.occurredOn <= input.periodEnd && payrollLocationAllowed(item.locationId, scope.allLocations, scope.locationIds));
  const mileageTenths = mileageRows.reduce((sum, item) => sum + Math.round(safeNonnegative(item.distanceMeters, "Mileage distance") * 10 / METERS_PER_MILE), 0);
  if (!Number.isSafeInteger(mileageTenths)) throw new DomainError("VALIDATION_ERROR", "Mileage total is too large to calculate safely.", 422);
  const tipRows = input.tips.filter((item) => inRange(item.createdAt) && payrollLocationAllowed(item.locationId, scope.allLocations, scope.locationIds));
  if (tipRows.some((item) => item.currency.toUpperCase() !== currency)) {
    throw new DomainError("CONFLICT", "A tip uses a different currency from the staff compensation profile.", 409);
  }
  const tipsMinor = tipRows.reduce((sum, item) => sum + safeNonnegative(item.amountMinor, "Tip amount"), 0);

  const hourlyRateMinor = safeNonnegative(profile.hourlyRateMinor, "Hourly rate");
  const mileageRateMinor = safeNonnegative(profile.mileageRateMinorPerUnit, "Mileage rate");
  const overtime = record(profile.overtimeConfiguration);
  const afterMinutes = overtime.afterMinutes === undefined || overtime.afterMinutes === null ? approvedMinutes : safeNonnegative(overtime.afterMinutes, "Overtime threshold");
  const overtimeMultiplier = configRate(profile.overtimeConfiguration, "multiplier", "Overtime multiplier") ?? 1.5;
  const perJobRate = configAmount(profile.perJobConfiguration, ["amountMinor", "perJobMinor"], "Per-job rate");
  const bonusConfiguration = record(profile.bonusConfiguration);
  const bonusMinor = configAmount(profile.bonusConfiguration, ["amountMinor", "bonusMinor"], "Bonus")
    + configAmount(profile.bonusConfiguration, ["completionBonusMinor"], "Completion bonus") * completedJobIds.length;
  const commissionConfiguration = record(profile.commissionConfiguration);
  const fixedCommissionMinor = configAmount(profile.commissionConfiguration, ["amountMinor", "commissionMinor"], "Commission");
  const commissionRateBps = commissionConfiguration.rateBasisPoints === undefined ? 0 : safeNonnegative(commissionConfiguration.rateBasisPoints, "Commission rate");
  const commissionMinor = fixedCommissionMinor + Math.round(completedRevenueMinor * commissionRateBps / 10_000);
  const formula = calculateGrossPay({
    approvedMinutes, hourlyRateCents: hourlyRateMinor, overtimeAfterMinutes: afterMinutes,
    overtimeMultiplier, jobsCompleted: completedJobIds.length, perJobCents: perJobRate,
    bonusCents: bonusMinor, commissionCents: commissionMinor, tipsCents: tipsMinor,
    mileageTenths, mileageRateCentsPerMile: mileageRateMinor,
  });
  const sourceLocationIds = new Set<string>();
  for (const item of [...timeEntries, ...jobs.values(), ...mileageRows, ...tipRows]) if (item.locationId) sourceLocationIds.add(item.locationId);
  const components: ComponentSnapshot[] = [];
  const add = (componentType: string, description: string, amountMinor: number, extras: Partial<ComponentSnapshot> = {}) => {
    if (amountMinor === 0) return;
    components.push({ componentType, description, amountMinor, ...extras });
  };
  const timeEntryIds = timeEntries.map((row) => row.id).sort();
  const mileageIds = mileageRows.map((row) => row.id).sort();
  const tipIds = tipRows.map((row) => row.id).sort();
  add("hourly", `${(formula.regularMinutes / 60).toFixed(2)} regular hours`, formula.hourlyCents, { quantity: (formula.regularMinutes / 60).toFixed(2), rateMinor: hourlyRateMinor, sourceEntityType: "time_entry", sourceEntityIds: timeEntryIds });
  add("overtime", `${(formula.overtimeMinutes / 60).toFixed(2)} overtime hours`, formula.overtimeCents, { quantity: (formula.overtimeMinutes / 60).toFixed(2), rateMinor: Math.round(hourlyRateMinor * overtimeMultiplier), sourceEntityType: "time_entry", sourceEntityIds: timeEntryIds });
  add("per_job", `${completedJobIds.length} completed jobs`, formula.perJobCents, { quantity: String(completedJobIds.length), rateMinor: perJobRate, sourceEntityType: "job", sourceEntityIds: completedJobIds });
  add("bonus", "Configured bonus", formula.bonusCents, { sourceEntityType: "job", sourceEntityIds: completedJobIds });
  add("commission", "Configured commission", formula.commissionCents, { sourceEntityType: "job", sourceEntityIds: completedJobIds });
  add("mileage", `${(mileageTenths / 10).toFixed(1)} reimbursable miles`, formula.mileageCents, { quantity: (mileageTenths / 10).toFixed(1), rateMinor: mileageRateMinor, sourceEntityType: "mileage_record", sourceEntityIds: mileageIds });
  add("tip", `${tipRows.length} recorded tips`, formula.tipsCents, { sourceEntityType: "tip", sourceEntityIds: tipIds });
  const baseGrossMinor = formula.grossCents;
  const corrections = [...(input.corrections ?? [])];
  const correctionsTotal = corrections.reduce((sum, correction) => sum + correction.amountMinor, 0);
  for (const correction of corrections) add("correction", correction.description, correction.amountMinor, { sourceEntityType: "payroll_correction", sourceEntityIds: [correction.id] });
  const grossMinor = baseGrossMinor + correctionsTotal;
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0) throw new DomainError("VALIDATION_ERROR", "Corrections cannot reduce gross pay below zero.", 422);
  const snapshot: CalculationSnapshot = {
    source: "payroll-v1", profileId: profile.id,
    profile: {
      hourlyRateMinor, overtimeConfiguration: overtime, perJobConfiguration: record(profile.perJobConfiguration),
      commissionConfiguration, mileageRateMinorPerUnit: mileageRateMinor,
      bonusConfiguration, currency,
    },
    period: { start: input.periodStart, end: input.periodEnd },
    locationIds: [...sourceLocationIds].sort(),
    inputs: {
      approvedMinutes, paidSeconds: Math.round(paidSeconds), approvedTimeEntryIds: timeEntryIds,
      unpaidBreakIds: unpaidBreaks.map((item) => item.id).sort(),
      completedJobCount: completedJobIds.length, completedJobIds, completedRevenueMinor,
      mileageRecordIds: mileageIds, mileageMeters: mileageRows.reduce((sum, row) => sum + row.distanceMeters, 0), mileageTenths,
      tipIds, tipsMinor,
    },
    formula: {
      regularMinutes: formula.regularMinutes, overtimeMinutes: formula.overtimeMinutes,
      hourlyMinor: formula.hourlyCents, overtimeMinor: formula.overtimeCents, perJobMinor: formula.perJobCents,
      bonusMinor: formula.bonusCents, commissionMinor: formula.commissionCents,
      mileageMinor: formula.mileageCents, tipsMinor: formula.tipsCents,
    },
    baseGrossMinor, corrections, components,
  };
  return { grossMinor, currency, snapshot };
}

const moneyInput = z.number().int().safe().nonnegative();
const jsonConfig = z.record(z.string(), z.unknown()).optional();
const profileCreateSchema = z.object({
  membershipId: z.uuid(), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().nullable().optional(),
  hourlyRateMinor: moneyInput.nullable().optional(), overtimeConfiguration: jsonConfig,
  perJobConfiguration: jsonConfig, commissionConfiguration: jsonConfig,
  mileageRateMinorPerUnit: moneyInput.nullable().optional(), bonusConfiguration: jsonConfig,
  currency: z.string().regex(/^[A-Za-z]{3}$/).default("USD"),
});
const profilePatchSchema = profileCreateSchema.omit({ membershipId: true }).partial().refine((value) => Object.keys(value).length > 0, "Supply at least one profile change.");
const periodCreateSchema = z.object({ periodStart: z.iso.date(), periodEnd: z.iso.date(), organizationId: z.uuid().optional() })
  .refine((value) => value.periodStart <= value.periodEnd, { path: ["periodEnd"], message: "The end date must be on or after the start date." });
const periodActionSchema = z.object({ action: z.enum(["review", "approve", "reopen"]) });
const correctionSchema = z.object({ membershipId: z.uuid(), amountMinor: z.number().int().safe().refine((value) => value !== 0), description: z.string().trim().min(3).max(200) });

function staffLocationPredicate(actor: SessionActor, locationExpression: SQLWrapper): ReturnType<typeof sql> {
  if (actor.kind !== "staff") throw new DomainError("FORBIDDEN", "Staff access is required.", 403);
  if (actor.allLocations) return sql`true`;
  const ids = [...actor.locationIds];
  return ids.length ? sql`${locationExpression} = any(${sql`array[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`})` : sql`false`;
}

function canReadCalculation(actor: SessionActor, snapshot: unknown): boolean {
  if (actor.kind !== "staff") return false;
  return payrollSnapshotInLocationScope(snapshot, actor.allLocations, actor.locationIds);
}

function assertPeriodOrganization(actor: SessionActor, organizationId: string): void {
  requireStaff(actor);
  if (organizationId !== actor.organizationId) throw new DomainError("NOT_FOUND", "Payroll period not found.", 404);
}

async function findPeriod(actor: SessionActor, id: string, writer = getDb()) {
  requireStaff(actor);
  const [period] = await writer.select().from(payrollPeriods)
    .where(and(eq(payrollPeriods.id, id), eq(payrollPeriods.tenantId, actor.tenantId), eq(payrollPeriods.organizationId, actor.organizationId!))).limit(1);
  if (!period) throw new DomainError("NOT_FOUND", "Payroll period not found.", 404);
  return period;
}

async function lockPeriod(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], actor: SessionActor, id: string) {
  const [period] = await tx.select().from(payrollPeriods)
    .where(and(eq(payrollPeriods.id, id), eq(payrollPeriods.tenantId, actor.tenantId), eq(payrollPeriods.organizationId, actor.organizationId!)))
    .for("update").limit(1);
  if (!period) throw new DomainError("NOT_FOUND", "Payroll period not found.", 404);
  return period;
}

type PayrollTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function organizationPayrollTimeZone(tx: PayrollTransaction, actor: SessionActor): Promise<string> {
  requireStaff(actor);
  const [row] = await tx.select({ timezone: organizations.timezone, defaultTimezone: tenants.defaultTimezone })
    .from(organizations)
    .innerJoin(tenants, eq(tenants.id, organizations.tenantId))
    .where(and(eq(organizations.id, actor.organizationId), eq(organizations.tenantId, actor.tenantId)))
    .limit(1);
  return validTimeZone(row?.timezone ?? row?.defaultTimezone);
}

/** Serializes field time/mileage writes against payroll approval, export, and reopen transitions. */
export async function lockPayrollSourceMutations(tx: PayrollTransaction, actor: SessionActor): Promise<void> {
  requireStaff(actor);
  const [organization] = await tx.select({ id: organizations.id }).from(organizations)
    .where(and(eq(organizations.id, actor.organizationId), eq(organizations.tenantId, actor.tenantId)))
    .for("update").limit(1);
  if (!organization) throw new DomainError("NOT_FOUND", "Organization not found.", 404);
}

export async function assertPayrollSourceEditable(
  tx: PayrollTransaction,
  actor: SessionActor,
  source: { startsAt?: Date | string; endsAt?: Date | string; occurredOn?: string },
): Promise<void> {
  requireStaff(actor);
  await lockPayrollSourceMutations(tx, actor);
  const timeZone = await organizationPayrollTimeZone(tx, actor);
  let firstDate: string;
  let lastDate: string;
  if (source.occurredOn !== undefined) {
    dateOnlyMillis(source.occurredOn);
    firstDate = source.occurredOn;
    lastDate = source.occurredOn;
  } else if (source.startsAt !== undefined) {
    const startMs = asMillis(source.startsAt);
    const endMs = source.endsAt === undefined ? startMs : asMillis(source.endsAt);
    if (endMs < startMs) throw new DomainError("VALIDATION_ERROR", "Choose a valid time range.", 422);
    firstDate = dateAtTimeZone(startMs, timeZone);
    lastDate = dateAtTimeZone(endMs > startMs ? endMs - 1 : endMs, timeZone);
  } else {
    throw new DomainError("VALIDATION_ERROR", "A time or mileage date is required.", 422);
  }

  const [lockedPeriod] = await tx.select({ id: payrollPeriods.id }).from(payrollPeriods)
    .where(and(
      eq(payrollPeriods.tenantId, actor.tenantId),
      eq(payrollPeriods.organizationId, actor.organizationId),
      inArray(payrollPeriods.status, ["approved", "exported"]),
      lte(payrollPeriods.periodStart, lastDate),
      gte(payrollPeriods.periodEnd, firstDate),
    )).limit(1);
  if (lockedPeriod) {
    throw new DomainError("CONFLICT", "Time and mileage in an approved or exported payroll period cannot be changed.", 409);
  }
}

function requireOpenPeriod(status: string): void {
  // A deliberate reopen restores the same editable behavior as an open period while keeping
  // the transition visible in the period history.
  if (status !== "open" && status !== "reopened") throw new DomainError("INVALID_TRANSITION", "Reopen this payroll period before changing its calculations.", 409);
}

function periodBounds(period: { periodStart: string; periodEnd: string }, timeZone: string) {
  const bounds = dateRange(period.periodStart, period.periodEnd, timeZone);
  return { start: new Date(bounds.startMs), end: bounds.endExclusive, endExclusive: bounds.endExclusiveMs };
}

function locationRule(actor: SessionActor, expression: SQLWrapper) {
  return staffLocationPredicate(actor, expression);
}

function outsideLocationScope(actor: SessionActor, expression: SQLWrapper) {
  const ids = [...actor.locationIds];
  return ids.length ? or(isNull(expression), notInArray(expression, ids)) : sql`true`;
}

async function assertPeriodLocationScope(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], actor: SessionActor, period: { periodStart: string; periodEnd: string }, timeZone: string): Promise<void> {
  requireStaff(actor);
  if (actor.allLocations) return;
  const bounds = periodBounds(period, timeZone);
  const shiftLocations = alias(organizationLocations, "payroll_scope_shift_locations");
  const defaultLocations = alias(organizationLocations, "payroll_scope_default_locations");
  const timeLocation = sql<string | null>`coalesce(${shiftLocations.id}, ${jobs.organizationLocationId}, ${defaultLocations.id})`;
  const [timeRow] = await tx.select({ id: timeEntries.id }).from(timeEntries)
    .innerJoin(memberships, and(eq(memberships.id, timeEntries.membershipId), eq(memberships.tenantId, timeEntries.tenantId), eq(memberships.organizationId, actor.organizationId!)))
    .leftJoin(shifts, and(eq(shifts.id, timeEntries.shiftId), eq(shifts.tenantId, timeEntries.tenantId), eq(shifts.membershipId, timeEntries.membershipId)))
    .leftJoin(shiftLocations, and(eq(shiftLocations.id, shifts.organizationLocationId), eq(shiftLocations.tenantId, timeEntries.tenantId), eq(shiftLocations.organizationId, actor.organizationId!)))
    .leftJoin(jobs, and(eq(jobs.id, timeEntries.jobId), eq(jobs.tenantId, timeEntries.tenantId), eq(jobs.organizationId, actor.organizationId!)))
    .leftJoin(defaultLocations, and(eq(defaultLocations.id, memberships.defaultLocationId), eq(defaultLocations.tenantId, timeEntries.tenantId), eq(defaultLocations.organizationId, actor.organizationId!)))
    .where(and(eq(timeEntries.tenantId, actor.tenantId), eq(timeEntries.approvalStatus, "approved"), lt(timeEntries.startsAt, bounds.end), gt(timeEntries.endsAt, bounds.start),
      or(and(isNotNull(timeEntries.shiftId), isNotNull(shifts.id), or(isNull(shifts.organizationLocationId), isNotNull(shiftLocations.id))), and(isNotNull(timeEntries.jobId), isNotNull(jobs.id)), and(isNull(timeEntries.shiftId), isNull(timeEntries.jobId))),
      or(isNull(timeEntries.shiftId), and(isNotNull(shifts.id), or(isNull(shifts.organizationLocationId), isNotNull(shiftLocations.id)))),
      or(isNull(timeEntries.jobId), isNotNull(jobs.id)),
      or(isNull(timeEntries.shiftId), isNull(timeEntries.jobId), exists(tx.select({ id: jobAssignments.id }).from(jobAssignments).where(and(eq(jobAssignments.tenantId, timeEntries.tenantId), eq(jobAssignments.jobId, timeEntries.jobId!), eq(jobAssignments.membershipId, timeEntries.membershipId))))),
      outsideLocationScope(actor, timeLocation))).limit(1);
  if (timeRow) throw new DomainError("FORBIDDEN", "This payroll period contains time from a location outside your access.", 403);

  const mileageShiftLocations = alias(organizationLocations, "payroll_scope_mileage_shift_locations");
  const mileageRouteLocations = alias(organizationLocations, "payroll_scope_mileage_route_locations");
  const mileageLocation = sql<string | null>`coalesce(${mileageShiftLocations.id}, ${jobs.organizationLocationId}, ${mileageRouteLocations.id})`;
  const [mileageRow] = await tx.select({ id: mileageRecords.id }).from(mileageRecords)
    .innerJoin(memberships, and(eq(memberships.id, mileageRecords.membershipId), eq(memberships.tenantId, mileageRecords.tenantId), eq(memberships.organizationId, actor.organizationId!)))
    .leftJoin(shifts, and(eq(shifts.id, mileageRecords.shiftId), eq(shifts.tenantId, mileageRecords.tenantId), eq(shifts.membershipId, mileageRecords.membershipId)))
    .leftJoin(mileageShiftLocations, and(eq(mileageShiftLocations.id, shifts.organizationLocationId), eq(mileageShiftLocations.tenantId, mileageRecords.tenantId), eq(mileageShiftLocations.organizationId, actor.organizationId!)))
    .leftJoin(jobs, and(eq(jobs.id, mileageRecords.jobId), eq(jobs.tenantId, mileageRecords.tenantId), eq(jobs.organizationId, actor.organizationId!)))
    .leftJoin(routePlans, and(eq(routePlans.id, mileageRecords.routePlanId), eq(routePlans.tenantId, mileageRecords.tenantId), eq(routePlans.membershipId, mileageRecords.membershipId)))
    .leftJoin(mileageRouteLocations, and(eq(mileageRouteLocations.id, routePlans.organizationLocationId), eq(mileageRouteLocations.tenantId, mileageRecords.tenantId), eq(mileageRouteLocations.organizationId, actor.organizationId!)))
    .where(and(eq(mileageRecords.tenantId, actor.tenantId), gte(mileageRecords.occurredOn, period.periodStart), lte(mileageRecords.occurredOn, period.periodEnd),
      or(and(isNotNull(mileageRecords.shiftId), isNotNull(shifts.id), or(isNull(shifts.organizationLocationId), isNotNull(mileageShiftLocations.id))),
        and(isNotNull(mileageRecords.jobId), isNotNull(jobs.id)), and(isNotNull(mileageRecords.routePlanId), isNotNull(routePlans.id))),
      or(isNull(mileageRecords.shiftId), and(isNotNull(shifts.id), or(isNull(shifts.organizationLocationId), isNotNull(mileageShiftLocations.id)))),
      or(isNull(mileageRecords.jobId), isNotNull(jobs.id)),
      or(isNull(mileageRecords.routePlanId), and(isNotNull(routePlans.id), or(isNull(routePlans.organizationLocationId), isNotNull(mileageRouteLocations.id)))),
      outsideLocationScope(actor, mileageLocation))).limit(1);
  if (mileageRow) throw new DomainError("FORBIDDEN", "This payroll period contains mileage from a location outside your access.", 403);

  const tipLocation = jobs.organizationLocationId;
  const [tipRow] = await tx.select({ id: tips.id }).from(tips)
    .innerJoin(memberships, and(eq(memberships.id, tips.membershipId), eq(memberships.tenantId, tips.tenantId), eq(memberships.organizationId, actor.organizationId!)))
    .leftJoin(jobs, and(eq(jobs.id, tips.jobId), eq(jobs.tenantId, tips.tenantId), eq(jobs.organizationId, actor.organizationId!)))
    .where(and(eq(tips.tenantId, actor.tenantId), gte(tips.createdAt, bounds.start), lt(tips.createdAt, bounds.end),
      or(isNull(tips.jobId), isNotNull(jobs.id)), outsideLocationScope(actor, tipLocation))).limit(1);
  if (tipRow) throw new DomainError("FORBIDDEN", "This payroll period contains tips from a location outside your access.", 403);

  const [jobRow] = await tx.select({ id: jobs.id }).from(jobs)
    .innerJoin(jobAssignments, and(eq(jobAssignments.jobId, jobs.id), eq(jobAssignments.tenantId, jobs.tenantId)))
    .innerJoin(memberships, and(eq(memberships.id, jobAssignments.membershipId), eq(memberships.tenantId, jobs.tenantId), eq(memberships.organizationId, actor.organizationId!)))
    .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.organizationId, actor.organizationId!), eq(jobs.status, "completed"), isNotNull(jobs.actualCompletedAt), gte(jobs.actualCompletedAt, bounds.start), lt(jobs.actualCompletedAt, bounds.end),
      outsideLocationScope(actor, jobs.organizationLocationId))).limit(1);
  if (jobRow) throw new DomainError("FORBIDDEN", "This payroll period contains completed work from a location outside your access.", 403);
}

type PayrollInputSets = {
  timeEntries: IntervalInput[];
  breaks: BreakInput[];
  jobs: CompletedJobInput[];
  mileage: MileageInput[];
  tips: TipInput[];
};

async function loadPayrollInputs(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], actor: SessionActor, period: { periodStart: string; periodEnd: string }, timeZone: string): Promise<Map<string, PayrollInputSets>> {
  const bounds = periodBounds(period, timeZone);
  const buckets = new Map<string, PayrollInputSets>();
  const bucketFor = (membershipId: string) => {
    let bucket = buckets.get(membershipId);
    if (!bucket) {
      bucket = { timeEntries: [], breaks: [], jobs: [], mileage: [], tips: [] };
      buckets.set(membershipId, bucket);
    }
    return bucket;
  };
  const shiftLocations = alias(organizationLocations, "payroll_time_shift_locations");
  const defaultLocations = alias(organizationLocations, "payroll_time_default_locations");
  const timeLocation = sql<string | null>`coalesce(${shiftLocations.id}, ${jobs.organizationLocationId}, ${defaultLocations.id})`;
  const assignmentExists = exists(tx.select({ id: jobAssignments.id }).from(jobAssignments).where(and(
    eq(jobAssignments.tenantId, timeEntries.tenantId), eq(jobAssignments.jobId, timeEntries.jobId!), eq(jobAssignments.membershipId, timeEntries.membershipId),
  )));
  const entryRows = await tx.select({
    id: timeEntries.id, membershipId: timeEntries.membershipId, shiftId: timeEntries.shiftId, jobId: timeEntries.jobId,
    startsAt: timeEntries.startsAt, endsAt: timeEntries.endsAt, durationSeconds: timeEntries.durationSeconds, locationId: timeLocation,
  }).from(timeEntries)
    .innerJoin(memberships, and(eq(memberships.id, timeEntries.membershipId), eq(memberships.tenantId, timeEntries.tenantId), eq(memberships.organizationId, actor.organizationId!)))
    .leftJoin(shifts, and(eq(shifts.id, timeEntries.shiftId), eq(shifts.tenantId, timeEntries.tenantId), eq(shifts.membershipId, timeEntries.membershipId)))
    .leftJoin(shiftLocations, and(eq(shiftLocations.id, shifts.organizationLocationId), eq(shiftLocations.tenantId, timeEntries.tenantId), eq(shiftLocations.organizationId, actor.organizationId!)))
    .leftJoin(jobs, and(eq(jobs.id, timeEntries.jobId), eq(jobs.tenantId, timeEntries.tenantId), eq(jobs.organizationId, actor.organizationId!)))
    .leftJoin(defaultLocations, and(eq(defaultLocations.id, memberships.defaultLocationId), eq(defaultLocations.tenantId, timeEntries.tenantId), eq(defaultLocations.organizationId, actor.organizationId!)))
    .where(and(eq(timeEntries.tenantId, actor.tenantId), eq(timeEntries.approvalStatus, "approved"), lt(timeEntries.startsAt, bounds.end), gt(timeEntries.endsAt, bounds.start),
      or(and(isNotNull(timeEntries.shiftId), isNotNull(shifts.id), or(isNull(shifts.organizationLocationId), isNotNull(shiftLocations.id))), and(isNotNull(timeEntries.jobId), isNotNull(jobs.id)), and(isNull(timeEntries.shiftId), isNull(timeEntries.jobId))),
      or(isNull(timeEntries.shiftId), and(isNotNull(shifts.id), or(isNull(shifts.organizationLocationId), isNotNull(shiftLocations.id)))),
      or(isNull(timeEntries.jobId), isNotNull(jobs.id)),
      or(isNull(timeEntries.jobId), assignmentExists), locationRule(actor, timeLocation)));
  const shiftIds = new Set<string>();
  for (const row of entryRows) {
    bucketFor(row.membershipId).timeEntries.push(row);
    if (row.shiftId) shiftIds.add(row.shiftId);
  }
  if (shiftIds.size) {
    const breakShiftLocations = alias(organizationLocations, "payroll_break_shift_locations");
    const breakDefaultLocations = alias(organizationLocations, "payroll_break_default_locations");
    const breakLocation = sql<string | null>`coalesce(${breakShiftLocations.id}, ${breakDefaultLocations.id})`;
    const breakRows = await tx.select({
      id: breaks.id, shiftId: breaks.shiftId, startedAt: breaks.startedAt, endedAt: breaks.endedAt, membershipId: shifts.membershipId,
    }).from(breaks)
      .innerJoin(shifts, and(eq(shifts.id, breaks.shiftId), eq(shifts.tenantId, breaks.tenantId)))
      .innerJoin(memberships, and(eq(memberships.id, shifts.membershipId), eq(memberships.tenantId, shifts.tenantId), eq(memberships.organizationId, actor.organizationId!)))
      .leftJoin(breakShiftLocations, and(eq(breakShiftLocations.id, shifts.organizationLocationId), eq(breakShiftLocations.tenantId, shifts.tenantId), eq(breakShiftLocations.organizationId, actor.organizationId!)))
      .leftJoin(breakDefaultLocations, and(eq(breakDefaultLocations.id, memberships.defaultLocationId), eq(breakDefaultLocations.tenantId, shifts.tenantId), eq(breakDefaultLocations.organizationId, actor.organizationId!)))
      .where(and(eq(breaks.tenantId, actor.tenantId), eq(breaks.paid, false), inArray(breaks.shiftId, [...shiftIds]), lt(breaks.startedAt, bounds.end), or(isNull(breaks.endedAt), gt(breaks.endedAt, bounds.start)), locationRule(actor, breakLocation)));
    for (const row of breakRows) bucketFor(row.membershipId).breaks.push(row);
  }

  const mileageShiftLocations = alias(organizationLocations, "payroll_mileage_shift_locations");
  const mileageRouteLocations = alias(organizationLocations, "payroll_mileage_route_locations");
  const mileageLocation = sql<string | null>`coalesce(${mileageShiftLocations.id}, ${jobs.organizationLocationId}, ${mileageRouteLocations.id})`;
  const mileageRows = await tx.select({
    id: mileageRecords.id, membershipId: mileageRecords.membershipId, shiftId: mileageRecords.shiftId, jobId: mileageRecords.jobId,
    occurredOn: mileageRecords.occurredOn, distanceMeters: mileageRecords.distanceMeters, personalVehicle: mileageRecords.personalVehicle, locationId: mileageLocation,
  }).from(mileageRecords)
    .innerJoin(memberships, and(eq(memberships.id, mileageRecords.membershipId), eq(memberships.tenantId, mileageRecords.tenantId), eq(memberships.organizationId, actor.organizationId!)))
    .leftJoin(shifts, and(eq(shifts.id, mileageRecords.shiftId), eq(shifts.tenantId, mileageRecords.tenantId), eq(shifts.membershipId, mileageRecords.membershipId)))
    .leftJoin(mileageShiftLocations, and(eq(mileageShiftLocations.id, shifts.organizationLocationId), eq(mileageShiftLocations.tenantId, mileageRecords.tenantId), eq(mileageShiftLocations.organizationId, actor.organizationId!)))
    .leftJoin(jobs, and(eq(jobs.id, mileageRecords.jobId), eq(jobs.tenantId, mileageRecords.tenantId), eq(jobs.organizationId, actor.organizationId!)))
    .leftJoin(routePlans, and(eq(routePlans.id, mileageRecords.routePlanId), eq(routePlans.tenantId, mileageRecords.tenantId), eq(routePlans.membershipId, mileageRecords.membershipId)))
    .leftJoin(mileageRouteLocations, and(eq(mileageRouteLocations.id, routePlans.organizationLocationId), eq(mileageRouteLocations.tenantId, mileageRecords.tenantId), eq(mileageRouteLocations.organizationId, actor.organizationId!)))
    .where(and(eq(mileageRecords.tenantId, actor.tenantId), gte(mileageRecords.occurredOn, period.periodStart), lte(mileageRecords.occurredOn, period.periodEnd),
      or(and(isNotNull(mileageRecords.shiftId), isNotNull(shifts.id), or(isNull(shifts.organizationLocationId), isNotNull(mileageShiftLocations.id))),
        and(isNotNull(mileageRecords.jobId), isNotNull(jobs.id)), and(isNotNull(mileageRecords.routePlanId), isNotNull(routePlans.id))),
      or(isNull(mileageRecords.shiftId), and(isNotNull(shifts.id), or(isNull(shifts.organizationLocationId), isNotNull(mileageShiftLocations.id)))),
      or(isNull(mileageRecords.jobId), isNotNull(jobs.id)),
      or(isNull(mileageRecords.routePlanId), and(isNotNull(routePlans.id), or(isNull(routePlans.organizationLocationId), isNotNull(mileageRouteLocations.id)))),
      locationRule(actor, mileageLocation)));
  for (const row of mileageRows) bucketFor(row.membershipId).mileage.push(row);

  const tipLocation = jobs.organizationLocationId;
  const tipRows = await tx.select({ id: tips.id, membershipId: memberships.id, createdAt: tips.createdAt, amountMinor: tips.amountMinor, currency: tips.currency, locationId: tipLocation })
    .from(tips)
    .innerJoin(memberships, and(eq(memberships.id, tips.membershipId), eq(memberships.tenantId, tips.tenantId), eq(memberships.organizationId, actor.organizationId!)))
    .leftJoin(jobs, and(eq(jobs.id, tips.jobId), eq(jobs.tenantId, tips.tenantId), eq(jobs.organizationId, actor.organizationId!)))
    .where(and(eq(tips.tenantId, actor.tenantId), gte(tips.createdAt, bounds.start), lt(tips.createdAt, bounds.end), or(isNull(tips.jobId), isNotNull(jobs.id)), locationRule(actor, tipLocation)));
  for (const row of tipRows) bucketFor(row.membershipId).tips.push(row);

  const completedRows = await tx.selectDistinct({ id: jobs.id, membershipId: jobAssignments.membershipId, locationId: jobs.organizationLocationId, completedAt: jobs.actualCompletedAt, priceSnapshot: jobs.priceSnapshot })
    .from(jobs)
    .innerJoin(jobAssignments, and(eq(jobAssignments.jobId, jobs.id), eq(jobAssignments.tenantId, jobs.tenantId), lte(jobAssignments.assignedAt, jobs.actualCompletedAt!)))
    .innerJoin(memberships, and(eq(memberships.id, jobAssignments.membershipId), eq(memberships.tenantId, jobs.tenantId), eq(memberships.organizationId, actor.organizationId!)))
    .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.organizationId, actor.organizationId!), eq(jobs.status, "completed"), isNotNull(jobs.actualCompletedAt), gte(jobs.actualCompletedAt, bounds.start), lt(jobs.actualCompletedAt, bounds.end),
      or(isNull(jobAssignments.removedAt), gte(jobAssignments.removedAt, jobs.actualCompletedAt!)), locationRule(actor, jobs.organizationLocationId)));
  for (const row of completedRows) {
    const snapshot = record(row.priceSnapshot);
    bucketFor(row.membershipId).jobs.push({ id: row.id, locationId: row.locationId, completedAt: row.completedAt!, totalMinor: snapshot.totalMinor ?? 0 });
  }
  return buckets;
}

async function applicableProfiles(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], actor: SessionActor, period: { periodStart: string; periodEnd: string }) {
  return tx.select({ profile: compensationProfiles, membership: memberships })
    .from(compensationProfiles)
    .innerJoin(memberships, and(eq(memberships.id, compensationProfiles.membershipId), eq(memberships.tenantId, compensationProfiles.tenantId), eq(memberships.organizationId, actor.organizationId!)))
    .where(and(eq(compensationProfiles.tenantId, actor.tenantId), lte(compensationProfiles.effectiveFrom, period.periodStart),
      or(isNull(compensationProfiles.effectiveTo), gte(compensationProfiles.effectiveTo, period.periodEnd))))
    .orderBy(asc(compensationProfiles.effectiveFrom), asc(compensationProfiles.createdAt));
}

function latestProfiles<T extends { profile: { membershipId: string; effectiveFrom: string }; membership: { id: string } }>(rows: readonly T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const prior = result.get(row.membership.id);
    if (!prior || row.profile.effectiveFrom >= prior.profile.effectiveFrom) result.set(row.membership.id, row);
  }
  return result;
}

function snapshotComponents(snapshot: CalculationSnapshot): ComponentSnapshot[] {
  return snapshot.components.map((component) => ({ ...component }));
}

async function latestCalculation(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], actor: SessionActor, periodId: string, membershipId: string) {
  const [item] = await tx.select().from(payrollCalculations)
    .where(and(eq(payrollCalculations.tenantId, actor.tenantId), eq(payrollCalculations.payrollPeriodId, periodId), eq(payrollCalculations.membershipId, membershipId)))
    .orderBy(desc(payrollCalculations.version)).limit(1);
  return item;
}

async function insertCalculation(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], actor: SessionActor, periodId: string, membershipId: string, result: PayrollCalculationResult, version: number) {
  const [calculation] = await tx.insert(payrollCalculations).values({
    tenantId: actor.tenantId, payrollPeriodId: periodId, membershipId, version,
    grossAmountMinor: BigInt(result.grossMinor), currency: result.currency, calculationSnapshot: result.snapshot,
  }).returning();
  if (!calculation) throw new DomainError("CONFLICT", "Could not save the payroll calculation.", 409);
  const values = snapshotComponents(result.snapshot).map((component) => ({
    tenantId: actor.tenantId, payrollCalculationId: calculation.id,
    componentType: component.componentType, sourceEntityType: component.sourceEntityType ?? null,
    sourceEntityId: component.sourceEntityIds?.length === 1 ? component.sourceEntityIds[0] : null,
    description: component.description, quantity: component.quantity ?? null,
    rateMinor: component.rateMinor === undefined ? null : BigInt(component.rateMinor), amountMinor: BigInt(component.amountMinor),
    metadata: { sourceEntityIds: component.sourceEntityIds ?? [] },
  }));
  if (values.length) await tx.insert(payrollComponents).values(values);
  return calculation;
}

function withCorrections(result: PayrollCalculationResult, corrections: readonly ManualCorrection[]): PayrollCalculationResult {
  if (corrections.length === 0) return result;
  const correctionTotal = corrections.reduce((sum, correction) => sum + correction.amountMinor, 0);
  const correctionComponents = corrections.map((correction) => ({
    componentType: "correction", description: correction.description, amountMinor: correction.amountMinor,
    sourceEntityType: "payroll_correction", sourceEntityIds: [correction.id],
  }));
  const components = [...result.snapshot.components.filter((component) => component.componentType !== "correction"), ...correctionComponents];
  const grossMinor = result.snapshot.baseGrossMinor + correctionTotal;
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0) throw new DomainError("VALIDATION_ERROR", "Corrections cannot reduce gross pay below zero.", 422);
  return { ...result, grossMinor, snapshot: { ...result.snapshot, corrections: [...corrections], components } };
}

async function calculatePeriod(actor: SessionActor, periodId: string) {
  requirePermission(actor, "payroll.calculate");
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockPayrollSourceMutations(tx, actor);
    const period = await lockPeriod(tx, actor, periodId);
    requireOpenPeriod(period.status);
    const timeZone = await organizationPayrollTimeZone(tx, actor);
    await assertPeriodLocationScope(tx, actor, period, timeZone);
    const sources = await loadPayrollInputs(tx, actor, period, timeZone);
    const profileRows = await applicableProfiles(tx, actor, period);
    const profiles = latestProfiles(profileRows);
    const sourceMemberships = new Set(sources.keys());
    const candidates = new Set<string>(sourceMemberships);
    for (const [membershipId, item] of profiles) {
      const bonus = record(item.profile.bonusConfiguration);
      const commission = record(item.profile.commissionConfiguration);
      const hasPeriodFixedPay = Number(bonus.amountMinor ?? bonus.bonusMinor ?? 0) > 0
        || Number(commission.amountMinor ?? commission.commissionMinor ?? 0) > 0;
      if (actor.allLocations && hasPeriodFixedPay) candidates.add(membershipId);
    }
    if (candidates.size > MAX_CALCULATION_MEMBERS) throw new DomainError("VALIDATION_ERROR", "This period has too many staff records to calculate in one request.", 422);
    const missingProfile = [...sourceMemberships].some((id) => !profiles.has(id));
    if (missingProfile) throw new DomainError("CONFLICT", "Every staff member with approved payroll inputs needs a compensation profile that covers the full period.", 409);

    const items: Array<{ calculationId: string; membershipId: string; version: number; grossMinor: number }> = [];
    for (const membershipId of [...candidates].sort()) {
      const profile = profiles.get(membershipId)?.profile;
      if (!profile) continue;
      const bucket = sources.get(membershipId) ?? { timeEntries: [], breaks: [], jobs: [], mileage: [], tips: [] };
      const prior = await latestCalculation(tx, actor, period.id, membershipId);
      const priorSnapshot = prior?.calculationSnapshot as CalculationSnapshot | null;
      const corrections = Array.isArray(priorSnapshot?.corrections) ? priorSnapshot.corrections : [];
      const result = calculatePayrollBreakdown({
        periodStart: period.periodStart, periodEnd: period.periodEnd, timeZone,
        profile: {
          id: profile.id, hourlyRateMinor: profile.hourlyRateMinor, overtimeConfiguration: profile.overtimeConfiguration,
          perJobConfiguration: profile.perJobConfiguration, commissionConfiguration: profile.commissionConfiguration,
          mileageRateMinorPerUnit: profile.mileageRateMinorPerUnit, bonusConfiguration: profile.bonusConfiguration, currency: profile.currency,
        },
        timeEntries: bucket.timeEntries, unpaidBreaks: bucket.breaks, completedJobs: bucket.jobs,
        mileage: bucket.mileage, tips: bucket.tips, corrections,
      });
      const saved = await insertCalculation(tx, actor, period.id, membershipId, result, (prior?.version ?? 0) + 1);
      items.push({ calculationId: saved.id, membershipId, version: saved.version, grossMinor: result.grossMinor });
    }
    await recordEvent(actor, {
      type: "payroll.calculated", entityType: "payroll_period", entityId: period.id,
      payload: { calculations: items.length, versions: items.map(({ membershipId, version }) => ({ membershipId, version })) },
      auditAction: "payroll.calculate", before: { status: period.status },
      after: { status: period.status, calculations: items.map(({ membershipId, version, grossMinor }) => ({ membershipId, version, grossMinor })) },
    }, tx);
    return { period, items };
  });
}

async function periodDetail(actor: SessionActor, periodId: string) {
  requirePermission(actor, "payroll.read");
  const db = getDb();
  const period = await findPeriod(actor, periodId);
  const calculationRows = await db.select().from(payrollCalculations)
    .where(and(eq(payrollCalculations.tenantId, actor.tenantId), eq(payrollCalculations.payrollPeriodId, period.id)))
    .orderBy(asc(payrollCalculations.membershipId), asc(payrollCalculations.version));
  const visible = calculationRows.filter((calculation) => canReadCalculation(actor, calculation.calculationSnapshot));
  const calculations = await Promise.all(visible.map(async (calculation) => {
    const [member] = await db.select({ name: user.name, email: user.email }).from(payrollCalculations)
      .innerJoin(memberships, and(eq(memberships.id, payrollCalculations.membershipId), eq(memberships.tenantId, payrollCalculations.tenantId), eq(memberships.organizationId, actor.organizationId!)))
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(payrollCalculations.id, calculation.id), eq(payrollCalculations.tenantId, actor.tenantId))).limit(1);
    const components = await db.select().from(payrollComponents)
      .where(and(eq(payrollComponents.tenantId, actor.tenantId), eq(payrollComponents.payrollCalculationId, calculation.id)))
      .orderBy(asc(payrollComponents.createdAt));
    return { ...normalized(calculation) as Record<string, unknown>, staff: member ?? null, components: normalized(components) };
  }));
  return { period: normalized(period), calculations };
}

async function periodList(actor: SessionActor) {
  requireStaff(actor);
  requirePermission(actor, "payroll.read");
  const items = await getDb().select().from(payrollPeriods)
    .where(and(eq(payrollPeriods.tenantId, actor.tenantId), eq(payrollPeriods.organizationId, actor.organizationId!)))
    .orderBy(desc(payrollPeriods.periodStart)).limit(100);
  return json({ items: normalized(items) });
}

async function createPeriod(request: Request, actor: SessionActor) {
  requireStaff(actor);
  requirePermission(actor, "payroll.calculate");
  const body = await readBody(request, periodCreateSchema);
  const organizationId = body.organizationId ?? actor.organizationId;
  if (!organizationId) throw new DomainError("FORBIDDEN", "A business workspace is required.", 403);
  assertPeriodOrganization(actor, organizationId);
  const db = getDb();
  const prior = await db.select({ id: payrollPeriods.id }).from(payrollPeriods)
    .where(and(eq(payrollPeriods.tenantId, actor.tenantId), eq(payrollPeriods.organizationId, organizationId), eq(payrollPeriods.periodStart, body.periodStart), eq(payrollPeriods.periodEnd, body.periodEnd))).limit(1);
  if (prior.length) throw new DomainError("CONFLICT", "A payroll period already exists for those dates.", 409);
  const period = await db.transaction(async (tx) => {
    const [created] = await tx.insert(payrollPeriods).values({
      tenantId: actor.tenantId, organizationId, periodStart: body.periodStart, periodEnd: body.periodEnd, status: "open",
    }).returning();
    if (!created) throw new DomainError("CONFLICT", "Could not create the payroll period.", 409);
    await recordEvent(actor, { type: "payroll.period_created", entityType: "payroll_period", entityId: created.id,
      auditAction: "payroll.period_create", after: { periodStart: created.periodStart, periodEnd: created.periodEnd, status: created.status } }, tx);
    return created;
  });
  return json({ item: normalized(period) }, 201);
}

async function transitionPeriod(request: Request, actor: SessionActor, periodId: string) {
  const body = await readBody(request, periodActionSchema);
  const db = getDb();
  const period = await db.transaction(async (tx) => {
    await lockPayrollSourceMutations(tx, actor);
    const current = await lockPeriod(tx, actor, periodId);
    const timeZone = await organizationPayrollTimeZone(tx, actor);
    await assertPeriodLocationScope(tx, actor, current, timeZone);
    let nextStatus: string;
    let permission: "payroll.review" | "payroll.approve";
    let patch: Partial<typeof current>;
    if (body.action === "review") {
      permission = "payroll.review";
      if (current.status !== "open" && current.status !== "reopened") throw new DomainError("INVALID_TRANSITION", "Only an open payroll period can be sent for review.", 409);
      const existing = await tx.select({ id: payrollCalculations.id }).from(payrollCalculations)
        .where(and(eq(payrollCalculations.tenantId, actor.tenantId), eq(payrollCalculations.payrollPeriodId, current.id))).limit(1);
      if (existing.length === 0) throw new DomainError("CONFLICT", "Calculate payroll before reviewing this period.", 409);
      nextStatus = "reviewed"; patch = { status: nextStatus, reviewedAt: new Date(), updatedAt: new Date() };
    } else if (body.action === "approve") {
      permission = "payroll.approve";
      if (current.status !== "reviewed") throw new DomainError("INVALID_TRANSITION", "Review the payroll period before approving it.", 409);
      nextStatus = "approved"; patch = { status: nextStatus, approvedAt: new Date(), approvedByMembershipId: actor.membershipId, updatedAt: new Date() };
    } else {
      permission = "payroll.review";
      if (current.status !== "approved" && current.status !== "reviewed") throw new DomainError("INVALID_TRANSITION", "Only a reviewed or approved payroll period can be reopened.", 409);
      nextStatus = "reopened"; patch = { status: nextStatus, approvedAt: null, approvedByMembershipId: null, updatedAt: new Date() };
    }
    requirePermission(actor, permission);
    const [updated] = await tx.update(payrollPeriods).set(patch).where(and(eq(payrollPeriods.id, current.id), eq(payrollPeriods.tenantId, actor.tenantId))).returning();
    if (!updated) throw new DomainError("CONFLICT", "Could not update the payroll period.", 409);
    await recordEvent(actor, { type: `payroll.period_${body.action}`, entityType: "payroll_period", entityId: updated.id,
      auditAction: `payroll.period_${body.action}`, before: { status: current.status }, after: { status: updated.status } }, tx);
    return updated;
  });
  return json({ item: normalized(period) });
}

async function correctCalculation(request: Request, actor: SessionActor, periodId: string) {
  requireStaff(actor);
  requirePermission(actor, "payroll.review");
  const body = await readBody(request, correctionSchema);
  const db = getDb();
  const created = await db.transaction(async (tx) => {
    const period = await lockPeriod(tx, actor, periodId);
    requireOpenPeriod(period.status);
    const timeZone = await organizationPayrollTimeZone(tx, actor);
    await assertPeriodLocationScope(tx, actor, period, timeZone);
    const member = await findMember(actor, body.membershipId, tx);
    if (!member) throw new DomainError("NOT_FOUND", "Staff member not found.", 404);
    const previous = await latestCalculation(tx, actor, period.id, member.id);
    if (!previous) throw new DomainError("CONFLICT", "Calculate this staff member before adding a correction.", 409);
    if (!canReadCalculation(actor, previous.calculationSnapshot)) throw new DomainError("NOT_FOUND", "Payroll calculation not found.", 404);
    const snapshot = previous.calculationSnapshot as CalculationSnapshot;
    const correction: ManualCorrection = { id: crypto.randomUUID(), amountMinor: body.amountMinor, description: body.description, actorMembershipId: actor.membershipId!, createdAt: new Date().toISOString() };
    const corrections = [...(Array.isArray(snapshot.corrections) ? snapshot.corrections : []), correction];
    const updatedSnapshot = { ...snapshot, corrections };
    const correctionComponents = corrections.map((item) => ({
      componentType: "correction", description: item.description, amountMinor: item.amountMinor,
      sourceEntityType: "payroll_correction", sourceEntityIds: [item.id],
    }));
    const components = [...snapshot.components.filter((item) => item.componentType !== "correction"), ...correctionComponents];
    const result = withCorrections({ grossMinor: snapshot.baseGrossMinor, currency: previous.currency, snapshot: { ...updatedSnapshot, components } }, corrections);
    const next = await insertCalculation(tx, actor, period.id, member.id, result, previous.version + 1);
    await recordEvent(actor, { type: "payroll.calculation_corrected", entityType: "payroll_calculation", entityId: next.id,
      payload: { payrollPeriodId: period.id, membershipId: member.id, amountMinor: correction.amountMinor, description: correction.description },
      auditAction: "payroll.calculation_correct", before: { version: previous.version, grossMinor: Number(previous.grossAmountMinor) },
      after: { version: next.version, grossMinor: result.grossMinor, correction: { amountMinor: correction.amountMinor, description: correction.description } } }, tx);
    return next;
  });
  return json({ item: normalized(created) }, 201);
}

async function findMember(actor: SessionActor, membershipId: string, writer = getDb()) {
  requireStaff(actor);
  const [member] = await writer.select().from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, actor.tenantId), eq(memberships.organizationId, actor.organizationId!))).limit(1);
  if (!member) return null;
  if (!actor.allLocations) {
    const locations = await writer.select({ locationId: membershipLocationScopes.locationId }).from(membershipLocationScopes)
      .where(and(eq(membershipLocationScopes.tenantId, actor.tenantId), eq(membershipLocationScopes.membershipId, member.id)));
    const allowed = member.defaultLocationId ? actor.locationIds.has(member.defaultLocationId) : false;
    if (!allowed && !locations.some((row) => actor.locationIds.has(row.locationId))) return null;
  }
  return member;
}

async function createCalculations(request: Request, actor: SessionActor, periodId: string) {
  if (request.method !== "POST") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  const body = await readBody(request, z.object({}).strict());
  void body;
  const result = await calculatePeriod(actor, periodId);
  return json({ period: normalized(result.period), calculations: result.items }, 201);
}

async function profilesRoute(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  const db = getDb();
  if (path.length === 1 && request.method === "GET") {
    requireStaff(actor); requirePermission(actor, "compensation.read");
    const members = await visibleMemberIds(actor);
    if (!actor.allLocations && members.length === 0) return json({ items: [] });
    const conditions = [eq(compensationProfiles.tenantId, actor.tenantId), eq(memberships.organizationId, actor.organizationId!)];
    if (!actor.allLocations) conditions.push(inArray(compensationProfiles.membershipId, members));
    const items = await db.select({ profile: compensationProfiles, staffName: user.name, staffEmail: user.email })
      .from(compensationProfiles)
      .innerJoin(memberships, and(eq(memberships.id, compensationProfiles.membershipId), eq(memberships.tenantId, compensationProfiles.tenantId)))
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(...conditions)).orderBy(asc(compensationProfiles.membershipId), desc(compensationProfiles.effectiveFrom)).limit(500);
    return json({ items: normalized(items.map((item) => ({ ...item.profile, staff: { name: item.staffName, email: item.staffEmail } }))) });
  }
  if (path.length === 1 && request.method === "POST") {
    requireStaff(actor); requirePermission(actor, "compensation.manage");
    const body = await readBody(request, profileCreateSchema);
    if (body.effectiveTo && body.effectiveTo < body.effectiveFrom) throw new DomainError("VALIDATION_ERROR", "The effective end date must be on or after the start date.", 422);
    const member = await findMember(actor, body.membershipId);
    if (!member) throw new DomainError("NOT_FOUND", "Staff member not found.", 404);
    await ensureProfileRangeAvailable(actor, body.membershipId, body.effectiveFrom, body.effectiveTo ?? null);
    const profile = await db.transaction(async (tx) => {
      const [created] = await tx.insert(compensationProfiles).values({
        tenantId: actor.tenantId, membershipId: body.membershipId, effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null, hourlyRateMinor: body.hourlyRateMinor === undefined || body.hourlyRateMinor === null ? null : BigInt(body.hourlyRateMinor),
        overtimeConfiguration: body.overtimeConfiguration ?? {}, perJobConfiguration: body.perJobConfiguration ?? {},
        commissionConfiguration: body.commissionConfiguration ?? {}, mileageRateMinorPerUnit: body.mileageRateMinorPerUnit === undefined || body.mileageRateMinorPerUnit === null ? null : BigInt(body.mileageRateMinorPerUnit),
        bonusConfiguration: body.bonusConfiguration ?? {}, currency: body.currency.toUpperCase(),
      }).returning();
      if (!created) throw new DomainError("CONFLICT", "Could not create the compensation profile.", 409);
      await recordEvent(actor, { type: "compensation.profile_created", entityType: "compensation_profile", entityId: created.id,
        auditAction: "compensation.profile_create", after: profileAuditData(created) }, tx);
      return created;
    });
    return json({ item: normalized(profile) }, 201);
  }
  if (path.length === 2 && request.method === "PATCH") {
    requireStaff(actor); requirePermission(actor, "compensation.manage");
    const body = await readBody(request, profilePatchSchema);
    const [current] = await db.select().from(compensationProfiles).where(and(eq(compensationProfiles.id, path[1]!), eq(compensationProfiles.tenantId, actor.tenantId))).limit(1);
    if (!current || !(await findMember(actor, current.membershipId))) throw new DomainError("NOT_FOUND", "Compensation profile not found.", 404);
    const effectiveFrom = body.effectiveFrom ?? current.effectiveFrom;
    const effectiveTo = body.effectiveTo === undefined ? current.effectiveTo : body.effectiveTo;
    if (effectiveTo && effectiveTo < effectiveFrom) throw new DomainError("VALIDATION_ERROR", "The effective end date must be on or after the start date.", 422);
    await ensureProfileRangeAvailable(actor, current.membershipId, effectiveFrom, effectiveTo, current.id);
    const patch = {
      effectiveFrom: body.effectiveFrom, effectiveTo: body.effectiveTo,
      hourlyRateMinor: body.hourlyRateMinor === undefined ? undefined : body.hourlyRateMinor === null ? null : BigInt(body.hourlyRateMinor),
      overtimeConfiguration: body.overtimeConfiguration, perJobConfiguration: body.perJobConfiguration,
      commissionConfiguration: body.commissionConfiguration,
      mileageRateMinorPerUnit: body.mileageRateMinorPerUnit === undefined ? undefined : body.mileageRateMinorPerUnit === null ? null : BigInt(body.mileageRateMinorPerUnit),
      bonusConfiguration: body.bonusConfiguration, currency: body.currency?.toUpperCase(), updatedAt: new Date(),
    };
    const updated = await db.transaction(async (tx) => {
      const [item] = await tx.update(compensationProfiles).set(patch)
        .where(and(eq(compensationProfiles.id, current.id), eq(compensationProfiles.tenantId, actor.tenantId))).returning();
      if (!item) throw new DomainError("CONFLICT", "Could not update the compensation profile.", 409);
      await recordEvent(actor, { type: "compensation.profile_updated", entityType: "compensation_profile", entityId: item.id,
        auditAction: "compensation.profile_update", before: profileAuditData(current), after: profileAuditData(item) }, tx);
      return item;
    });
    return json({ item: normalized(updated) });
  }
  return null;
}

function profileAuditData(profile: typeof compensationProfiles.$inferSelect): Record<string, unknown> {
  return {
    membershipId: profile.membershipId, effectiveFrom: profile.effectiveFrom, effectiveTo: profile.effectiveTo,
    hourlyRateMinor: Number(profile.hourlyRateMinor ?? 0), overtimeConfiguration: profile.overtimeConfiguration,
    perJobConfiguration: profile.perJobConfiguration, commissionConfiguration: profile.commissionConfiguration,
    mileageRateMinorPerUnit: Number(profile.mileageRateMinorPerUnit ?? 0), bonusConfiguration: profile.bonusConfiguration, currency: profile.currency,
  };
}

async function ensureProfileRangeAvailable(actor: SessionActor, membershipId: string, start: string, end: string | null, omitId?: string) {
  const rows = await getDb().select({ id: compensationProfiles.id, effectiveFrom: compensationProfiles.effectiveFrom, effectiveTo: compensationProfiles.effectiveTo })
    .from(compensationProfiles).where(and(eq(compensationProfiles.tenantId, actor.tenantId), eq(compensationProfiles.membershipId, membershipId)));
  const upper = end ?? "9999-12-31";
  if (rows.some((row) => row.id !== omitId && start <= (row.effectiveTo ?? "9999-12-31") && row.effectiveFrom <= upper)) {
    throw new DomainError("CONFLICT", "This staff member already has a compensation profile for part of those dates.", 409);
  }
}

async function visibleMemberIds(actor: SessionActor): Promise<string[]> {
  requireStaff(actor);
  const members = await getDb().select({ id: memberships.id, defaultLocationId: memberships.defaultLocationId }).from(memberships)
    .where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.organizationId, actor.organizationId!)));
  if (actor.allLocations) return members.map((member) => member.id);
  const scoped = members.filter((member) => member.defaultLocationId && actor.locationIds.has(member.defaultLocationId));
  const scopes = actor.locationIds.size ? await getDb().select({ membershipId: membershipLocationScopes.membershipId }).from(membershipLocationScopes)
    .where(and(eq(membershipLocationScopes.tenantId, actor.tenantId), inArray(membershipLocationScopes.locationId, [...actor.locationIds]))) : [];
  return [...new Set([...scoped.map((member) => member.id), ...scopes.map((scope) => scope.membershipId)])];
}

export function payrollCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[\s\u0000-\u001F\u007F\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportApprovedPeriod(actor: SessionActor, periodId: string) {
  requireStaff(actor); requirePermission(actor, "payroll.export");
  const db = getDb();
  const output = await db.transaction(async (tx) => {
    await lockPayrollSourceMutations(tx, actor);
    const period = await lockPeriod(tx, actor, periodId);
    if (period.status !== "approved" && period.status !== "exported") throw new DomainError("INVALID_TRANSITION", "Approve this payroll period before exporting it.", 409);
    const timeZone = await organizationPayrollTimeZone(tx, actor);
    await assertPeriodLocationScope(tx, actor, period, timeZone);
    const calculationRows = await tx.select({ calculation: payrollCalculations, staffName: user.name, staffEmail: user.email })
      .from(payrollCalculations)
      .innerJoin(memberships, and(eq(memberships.id, payrollCalculations.membershipId), eq(memberships.tenantId, payrollCalculations.tenantId), eq(memberships.organizationId, actor.organizationId!)))
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(payrollCalculations.tenantId, actor.tenantId), eq(payrollCalculations.payrollPeriodId, period.id)))
      .orderBy(asc(payrollCalculations.membershipId), desc(payrollCalculations.version));
    const latest = new Map<string, typeof calculationRows[number]>();
    for (const row of calculationRows) if (!latest.has(row.calculation.membershipId)) latest.set(row.calculation.membershipId, row);
    const visible = [...latest.values()].filter((row) => canReadCalculation(actor, row.calculation.calculationSnapshot));
    const header = ["period_start", "period_end", "staff_membership_id", "staff_name", "staff_email", "currency", "regular_minutes", "overtime_minutes", "hourly_minor", "overtime_minor", "per_job_minor", "bonus_minor", "commission_minor", "tips_minor", "mileage_minor", "corrections_minor", "gross_minor", "calculation_version"];
    const lines = visible.map(({ calculation, staffName, staffEmail }) => {
      const snapshot = calculation.calculationSnapshot as CalculationSnapshot;
      const formula = snapshot.formula ?? {};
      const correctionMinor = (snapshot.corrections ?? []).reduce((sum, item) => sum + item.amountMinor, 0);
      return [period.periodStart, period.periodEnd, calculation.membershipId, staffName, staffEmail, calculation.currency,
        formula.regularMinutes ?? 0, formula.overtimeMinutes ?? 0, formula.hourlyMinor ?? 0, formula.overtimeMinor ?? 0,
        formula.perJobMinor ?? 0, formula.bonusMinor ?? 0, formula.commissionMinor ?? 0, formula.tipsMinor ?? 0,
        formula.mileageMinor ?? 0, correctionMinor, calculation.grossAmountMinor, calculation.version].map(payrollCsvCell).join(",");
    });
    const content = `\uFEFF${[header.map(payrollCsvCell).join(","), ...lines].join("\r\n")}\r\n`;
    if (period.status !== "exported") {
      await tx.update(payrollPeriods).set({ status: "exported", exportedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(payrollPeriods.id, period.id), eq(payrollPeriods.tenantId, actor.tenantId)));
      await recordEvent(actor, { type: "payroll.period_exported", entityType: "payroll_period", entityId: period.id,
        payload: { rowCount: visible.length, format: "csv" }, auditAction: "payroll.export",
        before: { status: period.status }, after: { status: "exported", rowCount: visible.length, format: "csv" } }, tx);
    }
    return { content, filename: `payroll-${period.periodStart}-${period.periodEnd}.csv` };
  });
  return new Response(output.content, { status: 200, headers: {
    "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${output.filename}"`, "cache-control": "no-store",
  } });
}

async function ownStatements(actor: SessionActor) {
  requireStaff(actor);
  requirePermission(actor, "time.own_read");
  const db = getDb();
  const items = await db.select({ calculation: payrollCalculations, period: payrollPeriods })
    .from(payrollCalculations)
    .innerJoin(payrollPeriods, and(eq(payrollPeriods.id, payrollCalculations.payrollPeriodId), eq(payrollPeriods.tenantId, payrollCalculations.tenantId)))
    .where(and(eq(payrollCalculations.tenantId, actor.tenantId), eq(payrollCalculations.membershipId, actor.membershipId!), eq(payrollPeriods.organizationId, actor.organizationId!), inArray(payrollPeriods.status, ["approved", "exported"])))
    .orderBy(desc(payrollPeriods.periodEnd), desc(payrollCalculations.version)).limit(100);
  const latest = new Map<string, typeof items[number]>();
  for (const row of items) if (!latest.has(row.period.id)) latest.set(row.period.id, row);
  const results = await Promise.all([...latest.values()].map(async ({ calculation, period }) => {
    const components = await db.select().from(payrollComponents).where(and(eq(payrollComponents.tenantId, actor.tenantId), eq(payrollComponents.payrollCalculationId, calculation.id))).orderBy(asc(payrollComponents.createdAt));
    return { period: normalized(period), calculation: normalized(calculation), components: normalized(components) };
  }));
  return json({ items: results });
}

export async function handlePayroll(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "payroll") return null;
  requireStaff(actor);
  if (path[1] === "periods") {
    if (path.length === 2 && request.method === "GET") return periodList(actor);
    if (path.length === 2 && request.method === "POST") return createPeriod(request, actor);
    if (path.length === 3 && request.method === "GET") return json({ item: await periodDetail(actor, path[2]!) });
    if (path.length === 3 && request.method === "PATCH") return transitionPeriod(request, actor, path[2]!);
    if (path.length === 4 && path[3] === "calculate" && request.method === "POST") return createCalculations(request, actor, path[2]!);
    if (path.length === 4 && path[3] === "corrections" && request.method === "POST") return correctCalculation(request, actor, path[2]!);
    if (path.length === 4 && path[3] === "export" && request.method === "POST") return exportApprovedPeriod(actor, path[2]!);
  }
  if (path[1] === "profiles") return profilesRoute(request, path.slice(1), actor);
  if (path[1] === "statements" && path.length === 2 && request.method === "GET") return ownStatements(actor);
  return null;
}
