export type ComparisonOperator =
  | "equals" | "not_equals" | "in" | "not_in" | "exists" | "not_exists"
  | "greater_than" | "greater_or_equal" | "less_than" | "less_or_equal"
  | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "before" | "after" | "within_days" | "changed" | "changed_from" | "changed_to";

export type Comparison = { field: string; operator: ComparisonOperator; value?: unknown };
export type Condition = Comparison | { all: Condition[] } | { any: Condition[] } | { not: Condition };
export type ConditionContext = { current: Record<string, unknown>; previous?: Record<string, unknown>; now?: string };

const SAFE_SEGMENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);

/** Resolve only own properties through a bounded, plain path. No expressions are evaluated. */
export function resolvePath(value: unknown, path: string): unknown {
  const segments = path.split(".");
  if (segments.length === 0 || segments.length > 12 || segments.some((part) => !SAFE_SEGMENT.test(part) || UNSAFE.has(part))) return undefined;
  let cursor: unknown = value;
  for (const part of segments) {
    if (cursor === null || typeof cursor !== "object" || !Object.prototype.hasOwnProperty.call(cursor, part)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function targetValue(value: unknown, context: ConditionContext): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as { path?: unknown }).path === "string") {
    return resolvePath(context.current, (value as { path: string }).path);
  }
  return value;
}

function equal(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (depth > 12) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => equal(item, b[index], depth + 1));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1));
  }
  return false;
}

function orderValue(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value;
  return undefined;
}

function dateValue(value: unknown): number | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : undefined;
}

export function evaluateConditions(condition: Condition | undefined, context: ConditionContext): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every((part) => evaluateConditions(part, context));
  if ("any" in condition) return condition.any.some((part) => evaluateConditions(part, context));
  if ("not" in condition) return !evaluateConditions(condition.not, context);
  const actual = resolvePath(context.current, condition.field);
  const target = targetValue(condition.value, context);
  const previous = context.previous ? resolvePath(context.previous, condition.field) : undefined;
  switch (condition.operator) {
    case "equals": return equal(actual, target);
    case "not_equals": return !equal(actual, target);
    case "in": return Array.isArray(target) && target.some((item) => equal(actual, item));
    case "not_in": return Array.isArray(target) && !target.some((item) => equal(actual, item));
    case "exists": return actual !== undefined && actual !== null;
    case "not_exists": return actual === undefined || actual === null;
    case "greater_than": case "greater_or_equal": case "less_than": case "less_or_equal": {
      const a = orderValue(actual);
      const b = orderValue(target);
      if (a === undefined || b === undefined || typeof a !== typeof b) return false;
      if (condition.operator === "greater_than") return a > b;
      if (condition.operator === "greater_or_equal") return a >= b;
      if (condition.operator === "less_than") return a < b;
      return a <= b;
    }
    case "contains": return (typeof actual === "string" && typeof target === "string" && actual.includes(target)) || (Array.isArray(actual) && actual.some((item) => equal(item, target)));
    case "not_contains": return (typeof actual === "string" && typeof target === "string" && !actual.includes(target)) || (Array.isArray(actual) && !actual.some((item) => equal(item, target)));
    case "starts_with": return typeof actual === "string" && typeof target === "string" && actual.startsWith(target);
    case "ends_with": return typeof actual === "string" && typeof target === "string" && actual.endsWith(target);
    case "before": { const a = dateValue(actual); const b = dateValue(target); return a !== undefined && b !== undefined && a < b; }
    case "after": { const a = dateValue(actual); const b = dateValue(target); return a !== undefined && b !== undefined && a > b; }
    case "within_days": {
      const a = dateValue(actual);
      const now = dateValue(context.now ?? new Date().toISOString());
      return a !== undefined && now !== undefined && typeof target === "number" && Number.isFinite(target) && Math.abs(a - now) <= target * 86400000;
    }
    case "changed": return context.previous !== undefined && !equal(actual, previous);
    case "changed_from": return context.previous !== undefined && equal(previous, target) && !equal(actual, previous);
    case "changed_to": return context.previous !== undefined && equal(actual, target) && !equal(actual, previous);
  }
}

export type ServerConfig = Readonly<{
  environment: "development" | "test" | "production";
  databaseUrl?: string;
  mockConnectors: boolean;
  storageEndpoint?: string;
  storageBucket: string;
  publicBaseUrl: string;
}>;

/** Server-only startup settings; never serialize the returned object to a browser payload. */
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const environment = env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  if (environment === "production" && !databaseUrl) throw new Error("DATABASE_URL is required in production");
  const rawMock = env.MOCK_CONNECTORS;
  if (rawMock && rawMock !== "true" && rawMock !== "false") throw new Error("MOCK_CONNECTORS must be true or false");
  const mockConnectors = rawMock ? rawMock === "true" : environment !== "production";
  const publicBaseUrl = env.PUBLIC_BASE_URL?.trim() || "http://localhost:3000";
  if (!/^https?:\/\//.test(publicBaseUrl)) throw new Error("PUBLIC_BASE_URL must be an HTTP URL");
  return Object.freeze({ environment, databaseUrl, mockConnectors, storageEndpoint: env.STORAGE_ENDPOINT?.trim() || undefined, storageBucket: env.STORAGE_BUCKET?.trim() || "modular-crm", publicBaseUrl });
}
