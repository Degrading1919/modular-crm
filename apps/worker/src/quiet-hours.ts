/** Promotional mail waits overnight in the business timezone (default 8pm–8am).
 * Scan actual UTC minutes so DST gaps/overlaps do not invent a local timestamp. */
export function nextOutsideQuietHours(now: Date, timezone: string, settings?: unknown): Date | null {
  const configured = settings && typeof settings === "object" ? settings as { start?: unknown; end?: unknown } : {};
  const minutes = (value: unknown, fallback: number) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0,2)) * 60 + Number(value.slice(3)) : fallback;
  const start = minutes(configured.start, 20 * 60), end = minutes(configured.end, 8 * 60);
  if (start === end) return null;
  let format: Intl.DateTimeFormat;
  try { format = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  catch { format = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  const quiet = (at: Date) => {
    const parts = format.formatToParts(at);
    const local = Number(parts.find(p => p.type === "hour")?.value) * 60 + Number(parts.find(p => p.type === "minute")?.value);
    return start < end ? local >= start && local < end : local >= start || local < end;
  };
  if (!quiet(now)) return null;
  for (let i = 1; i <= 26 * 60; i++) {
    const at = new Date(Math.floor(now.getTime() / 60_000) * 60_000 + i * 60_000);
    if (!quiet(at)) return at;
  }
  throw new Error("Cannot determine the next sending time");
}
