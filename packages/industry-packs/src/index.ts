import { PET_WASTE_REMOVAL_PACK } from "./pet-waste-removal.ts";

export type PackField = Readonly<{
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "date" | "enum" | "media" | "location";
  required?: boolean;
  sensitive?: boolean;
  customerVisible?: boolean;
  options?: readonly string[];
  defaultValue?: string | number | boolean;
  reportable?: boolean;
}>;
export type PackAsset = Readonly<{ key: string; label: string; pluralLabel: string; fields: readonly PackField[] }>;
export type PackService = Readonly<{ key: string; name: string; kind: "recurring" | "one_time" | "add_on" | "recovery"; estimatedMinutes?: number; defaultEnabled?: boolean }>;
export type PackRecurrence = Readonly<{ key: string; label: string; rrule?: string; custom?: boolean }>;
export type PackRecipe = Readonly<{ sourceKey: string; name: string; description: string; event: string; actions: readonly { actionType: string; configuration: Record<string, unknown> }[]; enabledByDefault: boolean }>;
export type PackReport = Readonly<{ key: string; name: string; coreMetric: string; dimensions?: readonly string[] }>;
export type PackPricingTemplate = Readonly<{ key: string; name: string; stage: "base" | "quantity" | "zone" | "add_on" | "promotion" | "bounds"; inputFields: readonly string[]; effect: string; requiresTenantAmount: boolean }>;
export type IndustryPack = Readonly<{
  key: string;
  version: string;
  displayName: string;
  customerTypes: readonly string[];
  terminology: Readonly<Record<string, string>>;
  locationFields: readonly PackField[];
  assets: readonly PackAsset[];
  services: readonly PackService[];
  recurrencePresets: readonly PackRecurrence[];
  formSteps: readonly { key: string; label: string; fields: readonly string[] }[];
  jobChecklist: readonly { key: string; label: string; required: boolean }[];
  noncompletionReasons: readonly { key: string; label: string; billableByDefault: boolean }[];
  workflows: Readonly<Record<string, readonly string[]>>;
  defaultAutomations: readonly PackRecipe[];
  reports: readonly PackReport[];
  pricingTemplates: readonly PackPricingTemplate[];
  recommendedCapabilities: readonly string[];
  inventoryDefaults: readonly { key: string; name: string; unit: string }[];
  website: Readonly<{ template: string; sections: readonly string[]; signupSteps: readonly string[]; heroHeadline: string; heroDescription: string }>;
}>;

export { PET_WASTE_REMOVAL_PACK };
const PACKS: ReadonlyMap<string, IndustryPack> = new Map([[PET_WASTE_REMOVAL_PACK.key, PET_WASTE_REMOVAL_PACK]]);

export function listIndustryPacks(): readonly IndustryPack[] { return Array.from(PACKS.values()); }
export function getIndustryPack(key: string): IndustryPack | undefined { return PACKS.get(key); }

export function validateIndustryPack(pack: IndustryPack): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pack.key) || !/^\d+\.\d+\.\d+$/.test(pack.version)) throw new Error("Invalid pack identity");
  const unique = (values: readonly string[], label: string) => { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} key`); };
  unique(pack.services.map((service) => service.key), "service");
  unique(pack.assets.map((asset) => asset.key), "asset");
  unique(pack.locationFields.map((field) => field.key), "location field");
  unique(pack.recurrencePresets.map((preset) => preset.key), "recurrence");
  unique(pack.defaultAutomations.map((recipe) => recipe.sourceKey), "recipe");
  unique(pack.pricingTemplates.map((template) => template.key), "price template");
  for (const asset of pack.assets) unique(asset.fields.map((field) => field.key), `${asset.key} field`);
  for (const field of [...pack.locationFields, ...pack.assets.flatMap((asset) => asset.fields)]) {
    if (field.type === "enum" && (!field.options || field.options.length === 0)) throw new Error(`Enum ${field.key} needs options`);
    if (field.sensitive && field.customerVisible) throw new Error(`Sensitive ${field.key} cannot be customer visible by default`);
  }
  // The loader accepts JSON-compatible data only. Executable tenant code is never installed.
  JSON.stringify(pack, (_key, value) => { if (typeof value === "function" || typeof value === "symbol") throw new Error("Pack must contain only data"); return value; });
}

/** Return a detached copy so tenant changes never mutate the versioned package. */
export function materializeIndustryPack(key: string): IndustryPack {
  const pack = getIndustryPack(key);
  if (!pack) throw new Error(`Unknown industry pack: ${key}`);
  validateIndustryPack(pack);
  return JSON.parse(JSON.stringify(pack)) as IndustryPack;
}
