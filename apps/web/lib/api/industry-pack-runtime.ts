import {
  getIndustryPack,
  getIndustryPackMaturity,
  resolveIndustryPack,
  validateIndustryPackCustomization,
  type IndustryPack,
  type IndustryPackCustomization,
  type ResolvedIndustryPack,
} from "@modular-crm/industry-packs";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function customizationFromSettings(settings: unknown, pack: IndustryPack): IndustryPackCustomization {
  const root = object(object(settings).industryPackCustomizations);
  try { return validateIndustryPackCustomization(pack, root[pack.key] ?? {}); }
  catch { return {}; }
}

export function resolveTenantIndustryPack(packKey: string | null | undefined, settings: unknown): ResolvedIndustryPack | undefined {
  const pack = packKey ? getIndustryPack(packKey) : undefined;
  return pack ? resolveIndustryPack(pack, customizationFromSettings(settings, pack)) : undefined;
}

/** Converts the runtime-safe RFC5545 subset used by service plans into the shared recurrence contract. */
export function recurrencePresetSchedule(resolved: ResolvedIndustryPack, key: string) {
  const preset = resolved.recurrencePresets.find((item) => item.key === key);
  if (!preset?.rrule) return undefined;
  const components = preset.rrule.split(";").map((part) => part.split("=", 2));
  if (components.some(([name, value]) => !name || !value) || new Set(components.map(([name]) => name)).size !== components.length) return undefined;
  const parts = new Map(components.map(([name, value]) => [name!, value!]));
  const frequency = parts.get("FREQ");
  if (!frequency || !["DAILY", "WEEKLY", "MONTHLY"].includes(frequency)) return undefined;
  const interval = Number(parts.get("INTERVAL") ?? "1");
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) return undefined;
  const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const dayTokens = parts.get("BYDAY")?.split(",") ?? [];
  if (dayTokens.some((day) => !(day in dayMap)) || new Set(dayTokens).size !== dayTokens.length) return undefined;
  if (dayTokens.length && frequency !== "WEEKLY") return undefined;
  const supported = new Set(["FREQ", "INTERVAL", "BYDAY"]);
  if ([...parts.keys()].some((part) => !supported.has(part))) return undefined;
  return { frequencyType: frequency.toLowerCase(), interval, daysOfWeek: dayTokens.length ? dayTokens.map((day) => dayMap[day]!) : null };
}

export { getIndustryPack, getIndustryPackMaturity, resolveIndustryPack, validateIndustryPackCustomization };
