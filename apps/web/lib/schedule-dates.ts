import { businessDate, isCalendarDate } from "./dates";

export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function weekStart(value: string, startsOn = 1): string {
  return addDays(value, -((new Date(`${value}T12:00:00Z`).getUTCDay() - startsOn + 7) % 7));
}
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Calendar wall time is interpreted in the visit's branch, never the browser's zone.
 * Reject nonexistent/ambiguous DST times instead of moving the promised window silently. */
export function arrivalInstant(day: string, time: string, zone: string): Date {
  if (!isCalendarDate(day) || !timePattern.test(time)) throw new Error("Choose a valid arrival time.");
  const nominal = Date.parse(`${day}T${time}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const wall = (ms: number) => { const parts = formatter.formatToParts(ms); const get = (type: string) => parts.find(part => part.type === type)!.value; return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00Z`; };
  const offsets = new Set([-86400000, 0, 86400000].map(delta => Date.parse(wall(nominal + delta)) - (nominal + delta)));
  const matches = [...offsets].map(offset => nominal - offset).filter(ms => wall(ms) === `${day}T${time}:00Z` && businessDate(ms, zone) === day);
  if (matches.length !== 1) throw new Error("This arrival time changes with daylight saving. Choose another time.");
  return new Date(matches[0]!);
}
