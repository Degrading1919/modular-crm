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
  website: Readonly<{ template: string; sections: readonly string[]; signupSteps: readonly string[]; heroHeadline: string; heroDescription: string }>;
}>;

export { PET_WASTE_REMOVAL_PACK };
const PACKS: ReadonlyMap<string, IndustryPack> = new Map([[PET_WASTE_REMOVAL_PACK.key, PET_WASTE_REMOVAL_PACK]]);
const CONNECTOR_CAPABILITY_KEY_SET: ReadonlySet<string> = new Set(CONNECTOR_CAPABILITY_KEYS);
const KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const RECOMMENDATION_STATUSES = new Set<RecommendationStatus>(["normally_recommended", "optional", "usually_unnecessary", "conditional"]);
const RESOLVED_RECOMMENDATION_STATUSES = new Set<ResolvedRecommendationStatus>(["normally_recommended", "optional", "usually_unnecessary"]);
const UNSAFE_DATA_KEYS = new Set(["__proto__", "prototype", "constructor"]);

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
  requireNonEmptyString(field.key, `${path} key`);
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
  if (field.defaultValue !== undefined && typeof field.defaultValue !== "string" && typeof field.defaultValue !== "number" && typeof field.defaultValue !== "boolean") throw new Error(`Invalid ${path} default value`);
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

  for (const property of ["services", "assets", "locationFields", "recurrencePresets", "defaultAutomations", "pricingTemplates", "recommendationQuestions", "productCapabilityRecommendations", "recommendedConnectorCapabilities"] as const) requireArray(pack[property], `Pack ${property}`);
  unique(pack.services.map((service) => service.key), "service");
  unique(pack.assets.map((asset) => asset.key), "asset");
  unique(pack.locationFields.map((field) => field.key), "location field");
  unique(pack.recurrencePresets.map((preset) => preset.key), "recurrence");
  unique(pack.defaultAutomations.map((recipe) => recipe.sourceKey), "recipe");
  unique(pack.pricingTemplates.map((template) => template.key), "price template");
  unique(pack.recommendationQuestions.map((question) => question.key), "recommendation question");
  unique(pack.productCapabilityRecommendations.map((recommendation) => recommendation.featureKey), "product feature recommendation");
  unique(pack.recommendedConnectorCapabilities, "connector capability recommendation");

  for (const asset of pack.assets) {
    requireArray(asset.fields, `Asset ${asset.key} fields`);
    unique(asset.fields.map((field) => field.key), `${asset.key} field`);
  }
  for (const [index, field] of [...pack.locationFields, ...pack.assets.flatMap((asset) => asset.fields)].entries()) validateField(field, `Pack field ${index}`);

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
