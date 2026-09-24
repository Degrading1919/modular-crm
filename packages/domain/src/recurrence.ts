import { DomainError } from "./errors.ts";

export type Frequency = "daily" | "weekly" | "biweekly" | "monthly";

export interface RecurrenceSchedule {
  planId: string;
  frequency: Frequency;
  interval?: number;
  startDate: string;
  endDate?: string | null;
  pauseStart?: string | null;
  pauseEnd?: string | null;
  weekdays?: number[];
  status: "active" | "paused" | "canceled" | "ended" | "draft";
}

function dateUTC(value: string): Date {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new DomainError("VALIDATION_ERROR", `Invalid calendar date: ${value}`, 422);
  }
  return date;
}

function addDays(value: string, days: number): string {
  const date = dateUTC(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(value: string, months: number): string {
  const date = dateUTC(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

export function occurrenceKey(planId: string, serviceDate: string): string {
  return `${planId}:${serviceDate}`;
}

export function generateOccurrences(schedule: RecurrenceSchedule, from: string, through: string): Array<{ serviceDate: string; key: string }> {
  dateUTC(from);
  dateUTC(through);
  if (schedule.status !== "active" || through < from) return [];
  const results: Array<{ serviceDate: string; key: string }> = [];
  const limit = schedule.endDate && schedule.endDate < through ? schedule.endDate : through;
  const interval = schedule.interval ?? (schedule.frequency === "biweekly" ? 2 : 1);
  if (!Number.isInteger(interval) || interval <= 0) throw new DomainError("VALIDATION_ERROR", "Recurrence interval must be positive.", 422);
  if (schedule.frequency === "monthly") {
    for (let n = 0; n < 1200; n++) {
      const current = addMonths(schedule.startDate, n * interval);
      if (current > limit) break;
      if (current >= from && !(schedule.pauseStart && current >= schedule.pauseStart && (!schedule.pauseEnd || current <= schedule.pauseEnd))) {
        results.push({ serviceDate: current, key: occurrenceKey(schedule.planId, current) });
      }
    }
    return results;
  }
  const start = dateUTC(schedule.startDate);
  const startWeekMonday = addDays(schedule.startDate, -((start.getUTCDay() + 6) % 7));
  const allowedDays = schedule.weekdays?.length ? schedule.weekdays : [start.getUTCDay()];
  let current = schedule.startDate;
  for (let n = 0; current <= limit && n < 3660; n++, current = addDays(schedule.startDate, n)) {
    const diffDays = Math.round((dateUTC(current).getTime() - start.getTime()) / 86_400_000);
    const currentWeekMonday = addDays(current, -((dateUTC(current).getUTCDay() + 6) % 7));
    const diffWeeks = Math.round((dateUTC(currentWeekMonday).getTime() - dateUTC(startWeekMonday).getTime()) / (7 * 86_400_000));
    const scheduled = schedule.frequency === "daily" ? diffDays % interval === 0 : diffWeeks % interval === 0 && allowedDays.includes(dateUTC(current).getUTCDay());
    if (current >= from && scheduled && !(schedule.pauseStart && current >= schedule.pauseStart && (!schedule.pauseEnd || current <= schedule.pauseEnd))) {
      results.push({ serviceDate: current, key: occurrenceKey(schedule.planId, current) });
    }
  }
  return results;
}
