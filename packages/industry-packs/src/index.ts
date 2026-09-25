import { PET_WASTE_REMOVAL_PACK } from "./pet-waste-removal.ts";
import { ADDITIONAL_INDUSTRY_PACKS } from "./packs/index.ts";

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
export type PackRecipe = Readonly<{ sourceKey: string; name: string; description: string; event: string; filters?: Readonly<{ field: string; operator: "equals"; value: string }>; actions: readonly { actionType: string; configuration: Record<string, unknown> }[]; enabledByDefault: boolean }>;
export type PackReport = Readonly<{ key: string; name: string; coreMetric: string; dimensions?: readonly string[] }>;
export type PackPricingTemplate = Readonly<{ key: string; name: string; stage: "base" | "quantity" | "zone" | "add_on" | "promotion" | "bounds"; inputFields: readonly string[]; effect: string; requiresTenantAmount: boolean }>;

/** Connector capabilities describe provider functions, not purchasable product features. */
export const CONNECTOR_CAPABILITY_KEYS = [
  "payments", "email", "sms", "accounting", "calendar", "routing", "geocoding", "storage", "payroll", "crm_import", "ai",
] as const;
export type ConnectorCapabilityKey = typeof CONNECTOR_CAPABILITY_KEYS[number];

export type RecommendationStatus = "normally_recommended" | "optional" | "usually_unnecessary" | "conditional";
export type ResolvedRecommendationStatus = Exclude<RecommendationStatus, "conditional">;
export type PackOnboardingQuestion = Readonly<{
  key: string;
  prompt: string;
  answerType: "boolean" | "number" | "enum";
  options?: readonly string[];
}>;
export type PackAnswerValue = string | number | boolean;
export type PackOnboardingAnswers = Readonly<Record<string, PackAnswerValue>>;
export type PackAnswerCondition =
  | Readonly<{ op: "equals"; answerKey: string; value: PackAnswerValue }>
  | Readonly<{ op: "greater_than"; answerKey: string; value: number }>
  | Readonly<{ op: "greater_than_or_equal"; answerKey: string; value: number }>
  | Readonly<{ op: "less_than"; answerKey: string; value: number }>
  | Readonly<{ op: "less_than_or_equal"; answerKey: string; value: number }>
  | Readonly<{ op: "all"; conditions: readonly PackAnswerCondition[] }>
  | Readonly<{ op: "any"; conditions: readonly PackAnswerCondition[] }>;
export type ProductCapabilityRecommendationRule = Readonly<{
  when: PackAnswerCondition;
  recommendation: ResolvedRecommendationStatus;
}>;
export type ProductCapabilityRecommendation = Readonly<{
  /** Stable functional key. It is not a marketed module name or an entitlement. */
  featureKey: string;
  recommendation: RecommendationStatus;
  rationale: string;
  rules?: readonly ProductCapabilityRecommendationRule[];
}>;
export type EvaluatedProductCapabilityRecommendation = Readonly<{
  featureKey: string;
  recommendation: RecommendationStatus;
  rationale: string;
  /** Missing answers that could change a conditional result. */
  pendingAnswers: readonly string[];
}>;

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
  recommendationQuestions: readonly PackOnboardingQuestion[];
  productCapabilityRecommendations: readonly ProductCapabilityRecommendation[];
  recommendedConnectorCapabilities: readonly ConnectorCapabilityKey[];
  inventoryDefaults: readonly { key: string; name: string; unit: string }[];
  website: Readonly<{ template: string; sections: readonly string[]; signupSteps: readonly string[]; heroHeadline: string; heroDescription: string; signupBehavior?: "review" | "activate_recurring" }>;
}>;

export type IndustryPackMaturity = "research_only" | "configured" | "runtime_integrated" | "validated";
export type PackFieldCustomization = Readonly<{ enabled?: boolean; required?: boolean; label?: string }>;
export type IndustryPackCustomization = Readonly<{
  locationFields?: Readonly<Record<string, PackFieldCustomization>>;
  assetFields?: Readonly<Record<string, Readonly<Record<string, PackFieldCustomization>>>>;
  checklist?: Readonly<Record<string, PackFieldCustomization>>;
  disabledRecurrencePresetKeys?: readonly string[];
}>;
export type ResolvedIndustryPack = Readonly<{
  pack: IndustryPack;
  locationFields: readonly PackField[];
  assets: readonly PackAsset[];
  jobChecklist: IndustryPack["jobChecklist"];
  noncompletionReasons: IndustryPack["noncompletionReasons"];
  recurrencePresets: readonly PackRecurrence[];
}>;

const VALIDATED_PACK_KEYS = new Set([
  "pet-waste-removal",
]);

/** Registry membership means configuration exists; validation is tracked separately from definition loading. */
export function getIndustryPackMaturity(key: string): IndustryPackMaturity {
  if (!PACKS.has(key)) return "research_only";
  return VALIDATED_PACK_KEYS.has(key) ? "validated" : "runtime_integrated";
}

function applyFieldCustomization(fields: readonly PackField[], changes: IndustryPackCustomization["locationFields"]): PackField[] {
  return fields.flatMap((field) => {
    const change = changes?.[field.key];
    if (change?.enabled === false) return [];
    return [{ ...field, ...(change?.label ? { label: change.label } : {}), ...(change?.required !== undefined ? { required: change.required } : {}) }];
  });
}

/** Resolves editable tenant choices over immutable pack defaults without changing installed/history snapshots. */
export function resolveIndustryPack(pack: IndustryPack, customization: IndustryPackCustomization = {}): ResolvedIndustryPack {
  const assets = pack.assets.map((asset) => ({
    ...asset,
    fields: applyFieldCustomization(asset.fields, customization.assetFields?.[asset.key]),
  }));
  const jobChecklist = pack.jobChecklist.flatMap((item) => {
    const change = customization.checklist?.[item.key];
    if (change?.enabled === false) return [];
    return [{ ...item, ...(change?.label ? { label: change.label } : {}), ...(change?.required !== undefined ? { required: change.required } : {}) }];
  });
  const disabled = new Set(customization.disabledRecurrencePresetKeys ?? []);
  return {
    pack,
    locationFields: applyFieldCustomization(pack.locationFields, customization.locationFields),
    assets,
    jobChecklist,
    noncompletionReasons: pack.noncompletionReasons,
    recurrencePresets: pack.recurrencePresets.filter((item) => !disabled.has(item.key)),
  };
}

/** Validates declarative tenant edits against the selected pack; unknown field keys cannot become runtime behavior. */
export function validateIndustryPackCustomization(pack: IndustryPack, input: unknown): IndustryPackCustomization {
  requireRecord(input, "Industry Pack customization");
  exactKeys(input, ["locationFields", "assetFields", "checklist", "disabledRecurrencePresetKeys"], "Industry Pack customization");
  const result: {
    locationFields: Record<string, { enabled?: boolean; required?: boolean; label?: string }>;
    assetFields: Record<string, Record<string, { enabled?: boolean; required?: boolean; label?: string }>>;
    checklist: Record<string, { enabled?: boolean; required?: boolean; label?: string }>;
    disabledRecurrencePresetKeys: string[];
  } = { locationFields: {}, assetFields: {}, checklist: {}, disabledRecurrencePresetKeys: [] };
  const validateChanges = (raw: unknown, fields: readonly PackField[], path: string) => {
    requireRecord(raw, path);
    const known = new Map(fields.map((field) => [field.key, field]));
    for (const [key, value] of Object.entries(raw)) {
      if (!known.has(key)) throw new Error(`Unknown ${path} key: ${key}`);
      requireRecord(value, `${path}.${key}`);
      exactKeys(value, ["enabled", "required", "label"], `${path}.${key}`);
      for (const booleanKey of ["enabled", "required"] as const) {
        if (booleanKey in value && typeof value[booleanKey] !== "boolean") throw new Error(`${path}.${key}.${booleanKey} must be a boolean`);
      }
      if ("label" in value && (typeof value.label !== "string" || value.label.trim().length < 1 || value.label.length > 120)) throw new Error(`${path}.${key}.label must be 1 to 120 characters`);
    }
    return raw as Record<string, { enabled?: boolean; required?: boolean; label?: string }>;
  };
  if (input.locationFields !== undefined) result.locationFields = validateChanges(input.locationFields, pack.locationFields, "location field");
  if (input.assetFields !== undefined) {
    requireRecord(input.assetFields, "asset fields");
    const assets = new Map(pack.assets.map((asset) => [asset.key, asset]));
    for (const [assetKey, changes] of Object.entries(input.assetFields)) {
      const asset = assets.get(assetKey);
      if (!asset) throw new Error(`Unknown asset type: ${assetKey}`);
      result.assetFields[assetKey] = validateChanges(changes, asset.fields, `asset field ${assetKey}`);
    }
  }
  if (input.checklist !== undefined) {
    requireRecord(input.checklist, "job checklist");
    const keys = new Set(pack.jobChecklist.map((item) => item.key));
    for (const [key, value] of Object.entries(input.checklist)) {
      if (!keys.has(key)) throw new Error(`Unknown job checklist key: ${key}`);
      requireRecord(value, `job checklist.${key}`);
      exactKeys(value, ["enabled", "required", "label"], `job checklist.${key}`);
      for (const booleanKey of ["enabled", "required"] as const) if (booleanKey in value && typeof value[booleanKey] !== "boolean") throw new Error(`job checklist.${key}.${booleanKey} must be a boolean`);
      if ("label" in value && (typeof value.label !== "string" || value.label.trim().length < 1 || value.label.length > 120)) throw new Error(`job checklist.${key}.label must be 1 to 120 characters`);
    }
    result.checklist = input.checklist as typeof result.checklist;
  }
  if (input.disabledRecurrencePresetKeys !== undefined) {
    validateStringList(input.disabledRecurrencePresetKeys, "Disabled recurrence preset keys", { nonEmpty: false, unique: true });
    const known = new Set(pack.recurrencePresets.map((item) => item.key));
    for (const key of input.disabledRecurrencePresetKeys) if (!known.has(key)) throw new Error(`Unknown recurrence preset key: ${key}`);
    result.disabledRecurrencePresetKeys = [...input.disabledRecurrencePresetKeys];
  }
  return result;
}

export type PackIntakeValues = Readonly<{
  location: Readonly<Record<string, unknown>>;
  assets: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  sensitive: Readonly<{ location: Readonly<Record<string, unknown>>; assets: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>> }>;
}>;

/** Parses only fields declared by the selected pack and separates sensitive values for encrypted storage. */
export function validatePackIntakeValues(packOrResolved: IndustryPack | ResolvedIndustryPack, input: unknown): PackIntakeValues {
  const resolved = "pack" in packOrResolved ? packOrResolved : resolveIndustryPack(packOrResolved);
  const pack = resolved.pack;
  requireRecord(input, "Industry intake");
  exactKeys(input, ["location", "assets"], "Industry intake");
  const parseFields = (fields: readonly PackField[], raw: unknown, path: string) => {
    requireRecord(raw, path);
    const known = new Map(fields.map((field) => [field.key, field]));
    const values: Record<string, unknown> = {};
    const sensitive: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) if (!known.has(key)) throw new Error(`Unknown ${path} field: ${key}`);
    for (const field of fields) {
      let value = raw[field.key];
      if ((value === undefined || value === "") && field.defaultValue !== undefined) value = field.defaultValue;
      if (value === undefined || value === "" || value === null) {
        if (field.required) throw new Error(`${field.label} is required`);
        continue;
      }
      if (field.type === "boolean") {
        if (typeof value !== "boolean") throw new Error(`${field.label} must be true or false`);
      } else if (field.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) throw new Error(`${field.label} must be a valid number`);
      } else {
        if (typeof value !== "string" || value.length > (field.type === "media" ? 1000 : 2000)) throw new Error(`${field.label} must be text`);
        if (field.type === "enum" && !field.options?.includes(value)) throw new Error(`Choose a valid ${field.label.toLowerCase()}`);
        if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field.label} must be a date`);
      }
      (field.sensitive ? sensitive : values)[field.key] = value;
    }
    return { values, sensitive };
  };
  const rawLocation = input.location ?? {};
  const location = parseFields(resolved.locationFields, rawLocation, "location");
  requireRecord(input.assets ?? {}, "assets");
  const knownAssets = new Map(resolved.assets.map((asset) => [asset.key, asset]));
  const assetValues: Record<string, Record<string, unknown>[]> = {};
  const sensitiveAssets: Record<string, Record<string, unknown>[]> = {};
  for (const asset of resolved.assets) {
    if (asset.fields.some((field) => field.required) && (!Array.isArray((input.assets as Record<string, unknown>)[asset.key]) || ((input.assets as Record<string, unknown>)[asset.key] as unknown[]).length === 0)) {
      throw new Error(`Add at least one ${asset.label.toLowerCase()}`);
    }
  }
  for (const [assetKey, rawRows] of Object.entries(input.assets ?? {})) {
    const asset = knownAssets.get(assetKey);
    if (!asset) throw new Error(`Unknown asset type: ${assetKey}`);
    requireArray(rawRows, `assets.${assetKey}`);
    if (rawRows.length > 20) throw new Error(`No more than 20 ${asset.pluralLabel.toLowerCase()} can be submitted`);
    const values: Record<string, unknown>[] = [];
    const sensitive: Record<string, unknown>[] = [];
    for (const [index, row] of rawRows.entries()) {
      const parsed = parseFields(asset.fields, row, `${asset.label} ${index + 1}`);
      if (Object.keys(parsed.values).length || Object.keys(parsed.sensitive).length) {
        values.push(parsed.values);
        sensitive.push(parsed.sensitive);
      }
    }
    if (values.length) assetValues[assetKey] = values;
    if (sensitive.some((item) => Object.keys(item).length)) sensitiveAssets[assetKey] = sensitive;
  }
  return { location: location.values, assets: assetValues, sensitive: { location: location.sensitive, assets: sensitiveAssets } };
}

export { PET_WASTE_REMOVAL_PACK };
const CONNECTOR_CAPABILITY_KEY_SET: ReadonlySet<string> = new Set(CONNECTOR_CAPABILITY_KEYS);
const KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const RECOMMENDATION_STATUSES = new Set<RecommendationStatus>(["normally_recommended", "optional", "usually_unnecessary", "conditional"]);
const RESOLVED_RECOMMENDATION_STATUSES = new Set<ResolvedRecommendationStatus>(["normally_recommended", "optional", "usually_unnecessary"]);
const UNSAFE_DATA_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DATA_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;
const PACK_AUTOMATION_ACTIONS = new Set(["send_email", "send_sms", "create_ticket", "notify_staff", "add_note"]);

function createPackRegistry(packs: readonly IndustryPack[]): ReadonlyMap<string, IndustryPack> {
  const registry = new Map<string, IndustryPack>();
  for (const pack of packs) {
    validateIndustryPack(pack);
    if (registry.has(pack.key)) throw new Error(`Duplicate registered Industry Pack key: ${pack.key}`);
    registry.set(pack.key, pack);
  }
  return registry;
}

const PACKS = createPackRegistry([PET_WASTE_REMOVAL_PACK, ...ADDITIONAL_INDUSTRY_PACKS]);

export function listIndustryPacks(): readonly IndustryPack[] { return Array.from(PACKS.values()); }
export function getIndustryPack(key: string): IndustryPack | undefined { return PACKS.get(key); }

type UnknownRecord = Record<string, unknown>;
type ConditionResult = Readonly<{ value: boolean | undefined; pendingAnswers: readonly string[] }>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): asserts value is UnknownRecord {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
}

function requireArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
}

function exactKeys(record: UnknownRecord, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) if (!allowedSet.has(key)) throw new Error(`Unsupported ${label} field: ${key}`);
}

function validateJsonData(value: unknown, path = "$", ancestors = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${path}`);
    return;
  }
  if (typeof value !== "object") throw new Error(`Pack must contain only JSON-compatible data (${path})`);
  if (ancestors.has(value)) throw new Error(`Pack data cannot contain cycles (${path})`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`Unsafe array at ${path}`);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error(`Sparse arrays are not allowed (${path})`);
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) throw new Error(`Accessors are not allowed in pack data (${path}[${index}])`);
      validateJsonData(descriptor.value, `${path}[${index}]`, ancestors);
    }
    const extraKeys = Reflect.ownKeys(value).filter((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)));
    if (extraKeys.length > 0) throw new Error(`Unsupported array property at ${path}`);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`Unsafe object at ${path}`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new Error(`Symbol keys are not allowed in pack data (${path})`);
      if (UNSAFE_DATA_KEYS.has(key)) throw new Error(`Unsafe data field at ${path}: ${key}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error(`Accessors and hidden fields are not allowed in pack data (${path}.${key})`);
      validateJsonData(descriptor.value, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} key`);
}

function validateKey(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !DATA_KEY_PATTERN.test(value)) throw new Error(`Invalid ${path} key`);
}

function validateStringList(value: unknown, path: string, options: { nonEmpty?: boolean; unique?: boolean } = {}): asserts value is string[] {
  requireArray(value, path);
  if ((options.nonEmpty ?? true) && value.length === 0) throw new Error(`${path} must not be empty`);
  if (value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) throw new Error(`${path} must contain non-empty strings`);
  if (options.unique) unique(value as string[], path);
}

function validateQuestion(question: unknown, path: string): asserts question is PackOnboardingQuestion {
  requireRecord(question, path);
  exactKeys(question, ["key", "prompt", "answerType", "options"], path);
  if (typeof question.key !== "string" || !KEY_PATTERN.test(question.key)) throw new Error(`Invalid ${path} key`);
  requireNonEmptyString(question.prompt, `${path} prompt`);
  if (question.answerType !== "boolean" && question.answerType !== "number" && question.answerType !== "enum") throw new Error(`Invalid ${path} answer type`);
  if (question.answerType === "enum") {
    requireArray(question.options, `${path} options`);
    if (question.options.length === 0 || question.options.some((option) => typeof option !== "string" || option.trim().length === 0)) throw new Error(`${path} enum needs non-empty options`);
    unique(question.options as string[], `${path} option`);
  } else if (question.options !== undefined) {
    throw new Error(`${path} options are only valid for enum questions`);
  }
}

function validateCondition(condition: unknown, questions: ReadonlyMap<string, PackOnboardingQuestion>, path: string): asserts condition is PackAnswerCondition {
  requireRecord(condition, path);
  if (condition.op === "all" || condition.op === "any") {
    exactKeys(condition, ["op", "conditions"], path);
    requireArray(condition.conditions, `${path} conditions`);
    if (condition.conditions.length === 0) throw new Error(`${path} needs at least one condition`);
    const serialized = new Set<string>();
    condition.conditions.forEach((child, index) => {
      validateCondition(child, questions, `${path} conditions[${index}]`);
      const identity = JSON.stringify(child);
      if (serialized.has(identity)) throw new Error(`Duplicate condition reference at ${path}`);
      serialized.add(identity);
    });
    return;
  }
  const operator = condition.op;
  if (operator !== "equals" && operator !== "greater_than" && operator !== "greater_than_or_equal" && operator !== "less_than" && operator !== "less_than_or_equal") throw new Error(`Invalid ${path} operator`);
  exactKeys(condition, operator === "equals" ? ["op", "answerKey", "value"] : ["op", "answerKey", "value"], path);
  if (typeof condition.answerKey !== "string" || !KEY_PATTERN.test(condition.answerKey)) throw new Error(`Invalid ${path} answer reference`);
  const question = questions.get(condition.answerKey);
  if (!question) throw new Error(`Unknown ${path} answer reference: ${condition.answerKey}`);
  if (operator === "equals") {
    const expectedType = question.answerType === "enum" ? "string" : question.answerType;
    if (typeof condition.value !== expectedType || (typeof condition.value === "number" && !Number.isFinite(condition.value))) throw new Error(`${path} comparison value does not match ${condition.answerKey}`);
    if (question.answerType === "enum" && !(question.options ?? []).includes(condition.value as string)) throw new Error(`${path} uses an unknown ${condition.answerKey} option`);
  } else {
    if (question.answerType !== "number" || typeof condition.value !== "number" || !Number.isFinite(condition.value)) throw new Error(`${path} numeric comparison requires a numeric answer`);
  }
}

function validateRecommendation(recommendation: unknown, questions: ReadonlyMap<string, PackOnboardingQuestion>, path: string): asserts recommendation is ProductCapabilityRecommendation {
  requireRecord(recommendation, path);
  exactKeys(recommendation, ["featureKey", "recommendation", "rationale", "rules"], path);
  if (typeof recommendation.featureKey !== "string" || !KEY_PATTERN.test(recommendation.featureKey)) throw new Error(`Invalid ${path} feature key`);
  if (!RECOMMENDATION_STATUSES.has(recommendation.recommendation as RecommendationStatus)) throw new Error(`Invalid ${path} recommendation`);
  requireNonEmptyString(recommendation.rationale, `${path} rationale`);
  if (recommendation.recommendation === "conditional" && recommendation.rules === undefined) throw new Error(`${path} conditional recommendation needs rules`);
  if (recommendation.rules !== undefined) {
    requireArray(recommendation.rules, `${path} rules`);
    if (recommendation.rules.length === 0) throw new Error(`${path} rules cannot be empty`);
    const serializedConditions = new Set<string>();
    recommendation.rules.forEach((rule: unknown, index: number) => {
      const rulePath = `${path} rules[${index}]`;
      requireRecord(rule, rulePath);
      exactKeys(rule, ["when", "recommendation"], rulePath);
      validateCondition(rule.when, questions, `${rulePath} condition`);
      if (!RESOLVED_RECOMMENDATION_STATUSES.has(rule.recommendation as ResolvedRecommendationStatus)) throw new Error(`Invalid ${rulePath} recommendation`);
      const identity = JSON.stringify(rule.when);
      if (serializedConditions.has(identity)) throw new Error(`Duplicate condition reference in ${path}`);
      serializedConditions.add(identity);
    });
  }
}

function validateField(field: unknown, path: string): asserts field is PackField {
  requireRecord(field, path);
  const allowed = ["key", "label", "type", "required", "sensitive", "customerVisible", "options", "defaultValue", "reportable"];
  exactKeys(field, allowed, path);
  validateKey(field.key, path);
  requireNonEmptyString(field.label, `${path} label`);
  if (!["text", "number", "boolean", "date", "enum", "media", "location"].includes(field.type as string)) throw new Error(`Invalid ${path} type`);
  for (const flag of ["required", "sensitive", "customerVisible", "reportable"] as const) if (field[flag] !== undefined && typeof field[flag] !== "boolean") throw new Error(`Invalid ${path} ${flag}`);
  if (field.type === "enum") {
    requireArray(field.options, `${path} options`);
    if (field.options.length === 0 || field.options.some((option) => typeof option !== "string" || option.length === 0)) throw new Error(`Enum ${field.key} needs options`);
    unique(field.options as string[], `${path} option`);
  } else if (field.options !== undefined) {
    throw new Error(`${path} options are only valid for enum fields`);
  }
  if (field.defaultValue !== undefined) {
    const expectedDefaultType = field.type === "number" ? "number" : field.type === "boolean" ? "boolean" : "string";
    if (typeof field.defaultValue !== expectedDefaultType) throw new Error(`Invalid ${path} default value`);
    if (field.type === "enum" && !(field.options ?? []).includes(field.defaultValue as string)) throw new Error(`Unknown ${path} enum default`);
  }
  if (field.sensitive === true && field.customerVisible === true) throw new Error(`Sensitive ${field.key} cannot be customer visible by default`);
}

export function validateIndustryPack(pack: IndustryPack): void {
  validateJsonData(pack);
  requireRecord(pack, "Pack");
  exactKeys(pack, [
    "key", "version", "displayName", "customerTypes", "terminology", "locationFields", "assets", "services", "recurrencePresets",
    "formSteps", "jobChecklist", "noncompletionReasons", "workflows", "defaultAutomations", "reports", "pricingTemplates",
    "recommendationQuestions", "productCapabilityRecommendations", "recommendedConnectorCapabilities", "inventoryDefaults", "website",
  ], "pack");
  if (typeof pack.key !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pack.key) || typeof pack.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pack.version)) throw new Error("Invalid pack identity");
  requireNonEmptyString(pack.displayName, "Pack display name");

  validateStringList(pack.customerTypes, "Customer types", { unique: true });
  requireRecord(pack.terminology, "Pack terminology");
  for (const [term, label] of Object.entries(pack.terminology)) {
    if (!/^[a-z][A-Za-z0-9_-]*$/.test(term)) throw new Error(`Invalid terminology key: ${term}`);
    requireNonEmptyString(label, `Terminology ${term}`);
  }
  for (const property of ["services", "assets", "locationFields", "recurrencePresets", "formSteps", "jobChecklist", "noncompletionReasons", "defaultAutomations", "reports", "pricingTemplates", "recommendationQuestions", "productCapabilityRecommendations", "recommendedConnectorCapabilities", "inventoryDefaults"] as const) requireArray(pack[property], `Pack ${property}`);

  const assetKeys: string[] = [];
  for (const [index, asset] of pack.assets.entries()) {
    const path = `Asset ${index}`;
    requireRecord(asset, path);
    exactKeys(asset, ["key", "label", "pluralLabel", "fields"], path);
    validateKey(asset.key, path);
    requireNonEmptyString(asset.label, `${path} label`);
    requireNonEmptyString(asset.pluralLabel, `${path} plural label`);
    requireArray(asset.fields, `${path} fields`);
    const keys = (asset.fields as PackField[]).map((field) => field.key);
    unique(keys, `${asset.key} field`);
    assetKeys.push(asset.key);
  }
  unique(assetKeys, "asset");
  for (const [index, field] of [...pack.locationFields, ...pack.assets.flatMap((asset) => asset.fields)].entries()) validateField(field, `Pack field ${index}`);
  unique(pack.locationFields.map((field) => field.key), "location field");

  for (const [index, service] of pack.services.entries()) {
    const path = `Service ${index}`;
    requireRecord(service, path);
    exactKeys(service, ["key", "name", "kind", "estimatedMinutes", "defaultEnabled"], path);
    validateKey(service.key, path);
    requireNonEmptyString(service.name, `${path} name`);
    if (!["recurring", "one_time", "add_on", "recovery"].includes(service.kind)) throw new Error(`Invalid ${path} kind`);
    if (service.estimatedMinutes !== undefined && (!Number.isInteger(service.estimatedMinutes) || service.estimatedMinutes <= 0)) throw new Error(`Invalid ${path} estimated minutes`);
    if (service.defaultEnabled !== undefined && typeof service.defaultEnabled !== "boolean") throw new Error(`Invalid ${path} default state`);
  }
  unique(pack.services.map((service) => service.key), "service");

  for (const [index, recurrence] of pack.recurrencePresets.entries()) {
    const path = `Recurrence ${index}`;
    requireRecord(recurrence, path);
    exactKeys(recurrence, ["key", "label", "rrule", "custom"], path);
    validateKey(recurrence.key, path);
    requireNonEmptyString(recurrence.label, `${path} label`);
    if (recurrence.rrule !== undefined) requireNonEmptyString(recurrence.rrule, `${path} rule`);
    if (recurrence.custom !== undefined && typeof recurrence.custom !== "boolean") throw new Error(`Invalid ${path} custom flag`);
    if (recurrence.rrule === undefined && recurrence.custom !== true) throw new Error(`${path} needs a rule or a custom marker`);
  }
  unique(pack.recurrencePresets.map((preset) => preset.key), "recurrence");

  for (const [index, form] of pack.formSteps.entries()) {
    const path = `Form step ${index}`;
    requireRecord(form, path);
    exactKeys(form, ["key", "label", "fields"], path);
    validateKey(form.key, path);
    requireNonEmptyString(form.label, `${path} label`);
    validateStringList(form.fields, `${path} fields`, { nonEmpty: false, unique: true });
  }
  unique(pack.formSteps.map((form) => form.key), "form step");

  for (const [index, item] of pack.jobChecklist.entries()) {
    const path = `Checklist item ${index}`;
    requireRecord(item, path);
    exactKeys(item, ["key", "label", "required"], path);
    validateKey(item.key, path);
    requireNonEmptyString(item.label, `${path} label`);
    if (typeof item.required !== "boolean") throw new Error(`Invalid ${path} required flag`);
  }
  unique(pack.jobChecklist.map((item) => item.key), "checklist");

  for (const [index, reason] of pack.noncompletionReasons.entries()) {
    const path = `Noncompletion reason ${index}`;
    requireRecord(reason, path);
    exactKeys(reason, ["key", "label", "billableByDefault"], path);
    validateKey(reason.key, path);
    requireNonEmptyString(reason.label, `${path} label`);
    if (typeof reason.billableByDefault !== "boolean") throw new Error(`Invalid ${path} billable default`);
  }
  unique(pack.noncompletionReasons.map((reason) => reason.key), "noncompletion reason");

  requireRecord(pack.workflows, "Pack workflows");
  for (const [workflowKey, stages] of Object.entries(pack.workflows)) {
    if (!/^[a-z][A-Za-z0-9_-]*$/.test(workflowKey)) throw new Error(`Invalid workflow key: ${workflowKey}`);
    validateStringList(stages, `Workflow ${workflowKey} stages`, { unique: true });
  }

  for (const [index, recipe] of pack.defaultAutomations.entries()) {
    const path = `Automation ${index}`;
    requireRecord(recipe, path);
    exactKeys(recipe, ["sourceKey", "name", "description", "event", "filters", "actions", "enabledByDefault"], path);
    validateKey(recipe.sourceKey, path);
    requireNonEmptyString(recipe.name, `${path} name`);
    requireNonEmptyString(recipe.description, `${path} description`);
    requireNonEmptyString(recipe.event, `${path} event`);
    if (recipe.enabledByDefault !== undefined && typeof recipe.enabledByDefault !== "boolean") throw new Error(`Invalid ${path} enabled state`);
    if (recipe.filters !== undefined) {
      requireRecord(recipe.filters, `${path} filter`);
      exactKeys(recipe.filters, ["field", "operator", "value"], `${path} filter`);
      requireNonEmptyString(recipe.filters.field, `${path} filter field`);
      if (recipe.filters.operator !== "equals") throw new Error(`Unsupported ${path} filter operator`);
      if (typeof recipe.filters.value !== "string" || recipe.filters.value.length === 0) throw new Error(`Invalid ${path} filter value`);
    }
    requireArray(recipe.actions, `${path} actions`);
    if (recipe.actions.length === 0) throw new Error(`${path} needs at least one action`);
    for (const [actionIndex, action] of recipe.actions.entries()) {
      const actionPath = `${path} action ${actionIndex}`;
      requireRecord(action, actionPath);
      exactKeys(action, ["actionType", "configuration"], actionPath);
      if (typeof action.actionType !== "string" || !PACK_AUTOMATION_ACTIONS.has(action.actionType)) throw new Error(`Unsupported ${actionPath} type`);
      requireRecord(action.configuration, `${actionPath} configuration`);
      if (action.actionType === "create_ticket") requireNonEmptyString(action.configuration.type, `${actionPath} ticket type`);
      if ((action.actionType === "send_email" || action.actionType === "send_sms") && !("templateKey" in action.configuration) && !("body" in action.configuration)) throw new Error(`${actionPath} needs a template or message body`);
      if (action.actionType === "notify_staff" && !("body" in action.configuration) && !("title" in action.configuration)
        && action.configuration.when !== "manual_review" && action.configuration.reason !== "payment_failed") throw new Error(`${actionPath} needs a supported staff notice`);
      if (action.actionType === "add_note") requireNonEmptyString(action.configuration.body, `${actionPath} body`);
    }
  }
  unique(pack.defaultAutomations.map((recipe) => recipe.sourceKey), "recipe");

  for (const [index, report] of pack.reports.entries()) {
    const path = `Report ${index}`;
    requireRecord(report, path);
    exactKeys(report, ["key", "name", "coreMetric", "dimensions"], path);
    validateKey(report.key, path);
    requireNonEmptyString(report.name, `${path} name`);
    requireNonEmptyString(report.coreMetric, `${path} core metric`);
    if (report.dimensions !== undefined) validateStringList(report.dimensions, `${path} dimensions`, { nonEmpty: false, unique: true });
  }
  unique(pack.reports.map((report) => report.key), "report");

  for (const [index, template] of pack.pricingTemplates.entries()) {
    const path = `Pricing template ${index}`;
    requireRecord(template, path);
    exactKeys(template, ["key", "name", "stage", "inputFields", "effect", "requiresTenantAmount"], path);
    validateKey(template.key, path);
    requireNonEmptyString(template.name, `${path} name`);
    if (!["base", "quantity", "zone", "add_on", "promotion", "bounds"].includes(template.stage)) throw new Error(`Invalid ${path} stage`);
    validateStringList(template.inputFields, `${path} inputs`, { unique: true });
    requireNonEmptyString(template.effect, `${path} effect`);
    if (typeof template.requiresTenantAmount !== "boolean") throw new Error(`Invalid ${path} tenant amount flag`);
  }
  unique(pack.pricingTemplates.map((template) => template.key), "price template");
  unique(pack.recommendationQuestions.map((question) => question.key), "recommendation question");
  unique(pack.productCapabilityRecommendations.map((recommendation) => recommendation.featureKey), "product feature recommendation");
  unique(pack.recommendedConnectorCapabilities, "connector capability recommendation");

  for (const [index, item] of pack.inventoryDefaults.entries()) {
    const path = `Inventory default ${index}`;
    requireRecord(item, path);
    exactKeys(item, ["key", "name", "unit"], path);
    validateKey(item.key, path);
    requireNonEmptyString(item.name, `${path} name`);
    requireNonEmptyString(item.unit, `${path} unit`);
  }
  unique(pack.inventoryDefaults.map((item) => item.key), "inventory default");

  const questions = new Map<string, PackOnboardingQuestion>();
  pack.recommendationQuestions.forEach((question, index) => {
    validateQuestion(question, `Recommendation question ${index}`);
    questions.set(question.key, question);
  });
  pack.productCapabilityRecommendations.forEach((recommendation, index) => {
    validateRecommendation(recommendation, questions, `Product recommendation ${index}`);
    if (CONNECTOR_CAPABILITY_KEY_SET.has(recommendation.featureKey)) throw new Error(`Connector capability ${recommendation.featureKey} cannot be a product feature recommendation`);
  });
  for (const capability of pack.recommendedConnectorCapabilities) if (!CONNECTOR_CAPABILITY_KEY_SET.has(capability)) throw new Error(`Unknown connector capability recommendation: ${capability}`);

  requireRecord(pack.website, "Pack website");
  exactKeys(pack.website, ["template", "sections", "signupSteps", "heroHeadline", "heroDescription", "signupBehavior"], "Pack website");
  if (typeof pack.website.template !== "string" || !["fresh", "classic", "route-service"].includes(pack.website.template)) throw new Error("Unsupported pack website template");
  validateStringList(pack.website.sections, "Website sections", { unique: true });
  validateStringList(pack.website.signupSteps, "Website signup steps", { unique: true });
  requireNonEmptyString(pack.website.heroHeadline, "Website hero headline");
  requireNonEmptyString(pack.website.heroDescription, "Website hero description");
  if (pack.website.signupBehavior !== undefined && !["review", "activate_recurring"].includes(pack.website.signupBehavior)) throw new Error("Unsupported pack signup behavior");
}

function evaluateCondition(condition: PackAnswerCondition, answers: PackOnboardingAnswers): ConditionResult {
  if (condition.op === "all" || condition.op === "any") {
    const results = condition.conditions.map((child) => evaluateCondition(child, answers));
    if (condition.op === "all") {
      if (results.some((result) => result.value === false)) return { value: false, pendingAnswers: [] };
      const pendingAnswers = [...new Set(results.flatMap((result) => result.pendingAnswers))];
      return pendingAnswers.length > 0 ? { value: undefined, pendingAnswers } : { value: true, pendingAnswers: [] };
    }
    if (results.some((result) => result.value === true)) return { value: true, pendingAnswers: [] };
    const pendingAnswers = [...new Set(results.flatMap((result) => result.pendingAnswers))];
    return pendingAnswers.length > 0 ? { value: undefined, pendingAnswers } : { value: false, pendingAnswers: [] };
  }

  const answer = answers[condition.answerKey];
  if (answer === undefined) return { value: undefined, pendingAnswers: [condition.answerKey] };
  if (condition.op === "equals") return { value: answer === condition.value, pendingAnswers: [] };
  if (typeof answer !== "number") throw new Error(`Numeric condition received a non-numeric answer: ${condition.answerKey}`);
  if (condition.op === "greater_than") return { value: answer > condition.value, pendingAnswers: [] };
  if (condition.op === "greater_than_or_equal") return { value: answer >= condition.value, pendingAnswers: [] };
  if (condition.op === "less_than") return { value: answer < condition.value, pendingAnswers: [] };
  return { value: answer <= condition.value, pendingAnswers: [] };
}

function validateAnswers(pack: IndustryPack, answers: PackOnboardingAnswers): void {
  validateJsonData(answers, "Onboarding answers");
  if (!isRecord(answers)) throw new Error("Onboarding answers must be an object");
  const questions = new Map(pack.recommendationQuestions.map((question) => [question.key, question]));
  for (const [answerKey, value] of Object.entries(answers)) {
    const question = questions.get(answerKey);
    if (!question) throw new Error(`Unknown onboarding answer: ${answerKey}`);
    if (question.answerType === "boolean" && typeof value !== "boolean") throw new Error(`Answer ${answerKey} must be true or false`);
    if (question.answerType === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(`Answer ${answerKey} must be a finite number`);
    if (question.answerType === "enum" && (typeof value !== "string" || !(question.options ?? []).includes(value))) throw new Error(`Answer ${answerKey} must match a listed option`);
  }
}

/** Evaluate pack recommendations from plain business answers; the result never grants access. */
export function evaluateProductCapabilityRecommendations(
  pack: IndustryPack,
  answers: PackOnboardingAnswers = {},
): readonly EvaluatedProductCapabilityRecommendation[] {
  validateIndustryPack(pack);
  validateAnswers(pack, answers);
  return pack.productCapabilityRecommendations.map((recommendation) => {
    let pendingAnswers: string[] = [];
    for (const rule of recommendation.rules ?? []) {
      const result = evaluateCondition(rule.when, answers);
      if (result.value === true) {
        if (pendingAnswers.length > 0) return { featureKey: recommendation.featureKey, recommendation: "conditional", rationale: recommendation.rationale, pendingAnswers: [...new Set(pendingAnswers)] };
        return { featureKey: recommendation.featureKey, recommendation: rule.recommendation, rationale: recommendation.rationale, pendingAnswers: [] };
      }
      if (result.value === undefined) pendingAnswers = [...new Set([...pendingAnswers, ...result.pendingAnswers])];
    }
    if (pendingAnswers.length > 0) return { featureKey: recommendation.featureKey, recommendation: "conditional", rationale: recommendation.rationale, pendingAnswers };
    return { featureKey: recommendation.featureKey, recommendation: recommendation.recommendation, rationale: recommendation.rationale, pendingAnswers: [] };
  });
}

/** Return a detached copy so tenant changes never mutate the versioned package. */
export function materializeIndustryPack(key: string): IndustryPack {
  const pack = getIndustryPack(key);
  if (!pack) throw new Error(`Unknown industry pack: ${key}`);
  validateIndustryPack(pack);
  return JSON.parse(JSON.stringify(pack)) as IndustryPack;
}
