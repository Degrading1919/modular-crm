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
}>;
export type PlannedOccurrence = Readonly<{ planId: string; tenantId: string; serviceDate: string; key: string }>;

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

/** Use the plan's local calendar day; UTC date boundaries may otherwise shift a route day. */
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const item = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${item("year")}-${item("month")}-${item("day")}`;
}

export function planRecurringOccurrences(plan: RecurringPlan, from: string, through: string): PlannedOccurrence[] {
  dateUTC(from); dateUTC(through); dateUTC(plan.effectiveFrom);
  if (through < from || plan.status !== "active") return [];
  if (!Number.isSafeInteger(plan.interval) || plan.interval < 1) throw new Error(`Invalid recurrence interval for ${plan.id}`);
  const start = plan.effectiveFrom > from ? plan.effectiveFrom : from;
  const end = plan.effectiveTo && plan.effectiveTo < through ? plan.effectiveTo : through;
  if (end < start) return [];
  if (daysBetween(start, end) > 366) throw new Error("Recurring generation horizon must be at most 366 days");
  const anchor = dateUTC(plan.effectiveFrom);
  const anchorWeek = mondayOf(plan.effectiveFrom);
  const days = plan.daysOfWeek?.length ? plan.daysOfWeek : [anchor.getUTCDay()];
  if (days.some((day) => !Number.isSafeInteger(day) || day < 0 || day > 6)) throw new Error("Weekdays must be 0–6");
  const planned: PlannedOccurrence[] = [];
  for (let offset = 0; offset <= daysBetween(start, end); offset++) {
    const date = addCalendarDays(start, offset);
    if (plan.pauseFrom && date >= plan.pauseFrom && (!plan.pauseUntil || date <= plan.pauseUntil)) continue;
    const candidate = dateUTC(date);
    let matches = false;
    switch (plan.frequencyType) {
      case "daily": matches = daysBetween(plan.effectiveFrom, date) % plan.interval === 0; break;
      case "weekly": case "twice_weekly": {
        const weeks = daysBetween(anchorWeek, mondayOf(date)) / 7;
        matches = weeks % plan.interval === 0 && days.includes(candidate.getUTCDay());
        break;
      }
      case "monthly": {
        const months = (candidate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + candidate.getUTCMonth() - anchor.getUTCMonth();
        const lastDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
        matches = months % plan.interval === 0 && candidate.getUTCDate() === Math.min(plan.dayOfMonth ?? anchor.getUTCDate(), lastDay);
        break;
      }
      default: throw new Error(`Unsupported recurrence type: ${plan.frequencyType}`);
    }
    if (matches) planned.push({ planId: plan.id, tenantId: plan.tenantId, serviceDate: date, key: occurrenceKey(plan.id, date) });
  }
  return planned;
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
