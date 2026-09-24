import { occurrenceKey } from "@modular-crm/domain";

export type RecurringPlan = Readonly<{
  id: string;
  tenantId: string;
  status: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  pauseFrom?: string | null;
  pauseUntil?: string | null;
  frequencyType: string;
  interval: number;
  daysOfWeek?: readonly number[] | null;
  dayOfMonth?: number | null;
  timezone: string;
  scheduleVersions?: readonly RecurrenceVersion[];
  pricingSnapshot?: Record<string, unknown> | null;
}>;
export type PlannedOccurrence = Readonly<{ planId: string; tenantId: string; serviceDate: string; key: string }>;
export type RecurrenceVersion = Readonly<{
  effectiveFrom: string;
  /** Cadence anchor; differs from effectiveFrom for price-only changes. */
  anchorDate?: string;
  frequencyType: string;
  interval: number;
  daysOfWeek?: readonly number[] | null;
  dayOfMonth?: number | null;
}>;

function dateUTC(value: string): Date {
  const date = new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid calendar date: ${value}`);
  return date;
}
export function addCalendarDays(value: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new Error("Day count must be an integer");
  const date = dateUTC(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number { return Math.round((dateUTC(b).getTime() - dateUTC(a).getTime()) / 86400000); }
function mondayOf(value: string): string { const day = dateUTC(value).getUTCDay(); return addCalendarDays(value, -(day === 0 ? 6 : day - 1)); }

function normalizedSchedule(value: RecurrenceVersion): RecurrenceVersion {
  const frequency = value.frequencyType.trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  let frequencyType = frequency;
  let interval = value.interval;
  let daysOfWeek = value.daysOfWeek ?? null;
  switch (frequency) {
    case "biweekly": case "every-two-weeks":
      frequencyType = "weekly"; interval = Math.max(interval, 2); break;
    case "every-four-weeks":
      frequencyType = "weekly"; interval = Math.max(interval, 4); break;
    case "twice-weekly":
      frequencyType = "weekly"; daysOfWeek = daysOfWeek?.length ? daysOfWeek : [1, 4]; break;
  }
  return { ...value, frequencyType, interval, daysOfWeek };
}

/** Use the plan's local calendar day; UTC date boundaries may otherwise shift a route day. */
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const item = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${item("year")}-${item("month")}-${item("day")}`;
}

export function planRecurringOccurrences(plan: RecurringPlan, from: string, through: string): PlannedOccurrence[] {
  dateUTC(from); dateUTC(through); dateUTC(plan.effectiveFrom);
  if (plan.effectiveTo) dateUTC(plan.effectiveTo);
  if (plan.pauseFrom) dateUTC(plan.pauseFrom);
  if (plan.pauseUntil) dateUTC(plan.pauseUntil);
  if (through < from || plan.status !== "active") return [];
  const start = plan.effectiveFrom > from ? plan.effectiveFrom : from;
  const end = plan.effectiveTo && plan.effectiveTo < through ? plan.effectiveTo : through;
  if (end < start) return [];
  if (daysBetween(start, end) > 366) throw new Error("Recurring generation horizon must be at most 366 days");
  const planned: PlannedOccurrence[] = [];
  const versions = plan.scheduleVersions?.length ? [...plan.scheduleVersions] : [{
    effectiveFrom: plan.effectiveFrom, frequencyType: plan.frequencyType, interval: plan.interval,
    daysOfWeek: plan.daysOfWeek, dayOfMonth: plan.dayOfMonth,
  }];
  versions.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  if (versions[0]?.effectiveFrom !== plan.effectiveFrom) throw new Error(`Missing initial recurrence version for ${plan.id}`);
  for (let index = 0; index < versions.length; index++) {
    const rawVersion = versions[index]!;
    dateUTC(rawVersion.effectiveFrom);
    if (rawVersion.effectiveFrom < plan.effectiveFrom) throw new Error(`Recurrence version predates plan start for ${plan.id}`);
    if (index > 0 && rawVersion.effectiveFrom === versions[index - 1]!.effectiveFrom) throw new Error("Recurrence schedule versions must have unique effective dates");
    const version = normalizedSchedule(rawVersion);
    if (!Number.isSafeInteger(version.interval) || version.interval < 1) throw new Error(`Invalid recurrence interval for ${plan.id}`);
    const versionStart = version.effectiveFrom > start ? version.effectiveFrom : start;
    const nextStart = versions[index + 1]?.effectiveFrom;
    const versionEnd = nextStart ? addCalendarDays(nextStart, -1) : end;
    const segmentEnd = versionEnd < end ? versionEnd : end;
    if (segmentEnd < versionStart) continue;
    if (daysBetween(versionStart, segmentEnd) > 366) throw new Error("Recurring generation horizon must be at most 366 days");
    const anchorDate = version.anchorDate ?? version.effectiveFrom;
    dateUTC(anchorDate);
    const anchor = dateUTC(anchorDate);
    const anchorWeek = mondayOf(anchorDate);
    const days = version.daysOfWeek?.length ? version.daysOfWeek : [anchor.getUTCDay()];
    if (days.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 6)) throw new Error("Weekdays must be 0–6");
    for (let offset = 0; offset <= daysBetween(versionStart, segmentEnd); offset++) {
      const date = addCalendarDays(versionStart, offset);
      if (plan.pauseFrom && date >= plan.pauseFrom && (!plan.pauseUntil || date <= plan.pauseUntil)) continue;
      const candidate = dateUTC(date);
      let matches = false;
      switch (version.frequencyType) {
        case "daily": matches = daysBetween(anchorDate, date) % version.interval === 0; break;
        case "weekly": {
          const weeks = daysBetween(anchorWeek, mondayOf(date)) / 7;
          matches = weeks % version.interval === 0 && days.includes(candidate.getUTCDay());
          break;
        }
        case "monthly": {
          const months = (candidate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + candidate.getUTCMonth() - anchor.getUTCMonth();
          const lastDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
          matches = months % version.interval === 0 && candidate.getUTCDate() === Math.min(version.dayOfMonth ?? anchor.getUTCDate(), lastDay);
          break;
        }
        default: throw new Error(`Unsupported recurrence type: ${version.frequencyType}`);
      }
      if (matches) {
        const key = version.effectiveFrom === plan.effectiveFrom ? occurrenceKey(plan.id, date) : `${occurrenceKey(plan.id, date)}:${version.effectiveFrom}`;
        planned.push({ planId: plan.id, tenantId: plan.tenantId, serviceDate: date, key });
      }
    }
  }
  return planned.sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
}

/** Select the immutable plan price that was effective on an occurrence date. */
export function priceSnapshotForDate(snapshot: Record<string, unknown> | null | undefined, serviceDate: string): Record<string, unknown> | null {
  if (!snapshot) return null;
  const versions = Array.isArray(snapshot.priceVersions) ? snapshot.priceVersions.filter((value): value is { effectiveFrom: string; snapshot: Record<string, unknown> } =>
    !!value && typeof value === "object" && typeof (value as Record<string, unknown>).effectiveFrom === "string"
      && !!(value as Record<string, unknown>).snapshot && typeof (value as Record<string, unknown>).snapshot === "object") : [];
  const applicable = versions.filter((version) => version.effectiveFrom <= serviceDate).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
  if (versions.length) return applicable?.snapshot ?? null;
  const { priceVersions: _versions, ...current } = snapshot;
  return current;
}

export async function generateForPlans(plans: readonly RecurringPlan[], from: string, through: string, persist: (occurrence: PlannedOccurrence) => Promise<"created" | "existing">): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;
  for (const plan of plans) for (const occurrence of planRecurringOccurrences(plan, from, through)) {
    const outcome = await persist(occurrence);
    if (outcome === "created") created++;
    else existing++;
  }
  return { created, existing };
}
