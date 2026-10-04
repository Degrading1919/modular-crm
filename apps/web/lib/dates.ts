const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when a value is a date on a calendar, rather than an instant in time. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

/** Formats a date-only value without allowing a viewer's timezone to move it. */
export function formatCalendarDate(value: string, options: Intl.DateTimeFormatOptions = {}, locale = "en-US"): string {
  const [, year, month, day] = CALENDAR_DATE.exec(value)!;
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

/** Formats either an exact instant or a date-only value according to its semantics. */
export function formatDateValue(value: string, options: Intl.DateTimeFormatOptions = {}, locale = "en-US"): string {
  if (isCalendarDate(value)) return formatCalendarDate(value, options, locale);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, options).format(date);
}

/** Returns the calendar date for an instant in the supplied business timezone. */
export function businessDate(value: Date | number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
