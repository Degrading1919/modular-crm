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
  authBaseUrl: string;
  appBaseUrl: string;
  localSmokeTest: boolean;
  workerHealthPort: number;
  smtp: Readonly<{ host: string; port: number; secure: boolean; user?: string; password?: string; from: string }>;
}>;

export const DEVELOPMENT_AUTH_SECRET = "dev-only-replace-before-deploying-0123456789";

function validEncryptionKey(value: string | undefined): boolean {
  if (!value) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "[::1]" || host === "::1"
    || (/^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) && host.split(".").every((part) => Number(part) <= 255));
}

/** Server-only startup settings; never serialize the returned object to a browser payload. */
export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const environment = env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
  const problems: string[] = [];
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const production = environment === "production";
  const localSmokeTest = env.LOCAL_SMOKE_TEST === "true";
  if (env.LOCAL_SMOKE_TEST && !["true", "false"].includes(env.LOCAL_SMOKE_TEST)) problems.push("LOCAL_SMOKE_TEST must be true or false");
  if (production && !databaseUrl) problems.push("DATABASE_URL is required");
  if (production && (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.trim().length < 32 || env.BETTER_AUTH_SECRET.trim() === DEVELOPMENT_AUTH_SECRET)) problems.push("BETTER_AUTH_SECRET must be a unique secret of at least 32 characters, not the development value");
  if (production) for (const key of ["WEBHOOK_SECRET_ENCRYPTION_KEY", "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY"] as const) {
    if (!validEncryptionKey(env[key])) problems.push(`${key} must be a base64url-encoded 32-byte key`);
  }
  const rawMock = env.MOCK_CONNECTORS;
  if (rawMock && rawMock !== "true" && rawMock !== "false") problems.push("MOCK_CONNECTORS must be true or false");
  const mockConnectors = rawMock ? rawMock === "true" : environment !== "production";
  if (production && mockConnectors) problems.push("MOCK_CONNECTORS must not be true in production");
  if (production && env.DOMAIN_VERIFICATION_MODE === "mock") problems.push("DOMAIN_VERIFICATION_MODE must not be mock in production");
  const baseUrl = (key: string): string => {
    const value = env[key]?.trim();
    if (production && !value) problems.push(`${key} is required`);
    const result = value || "http://localhost:3000";
    try {
      const url = new URL(result);
      const localHttp = localSmokeTest && url.protocol === "http:" && isLoopback(url.hostname);
      if (!url.hostname || url.username || url.password || !["http:", "https:"].includes(url.protocol) || (production && url.protocol !== "https:" && !localHttp)) problems.push(`${key} must be an HTTPS URL (local smoke tests may use loopback HTTP)`);
    } catch { problems.push(`${key} must be a valid HTTP${production ? "S" : ""} URL`); }
    return result;
  };
  const publicBaseUrl = baseUrl("PUBLIC_BASE_URL");
  const authBaseUrl = baseUrl("BETTER_AUTH_URL");
  const appBaseUrl = baseUrl("APP_BASE_URL");
  const host = env.SMTP_HOST?.trim() || env.MAILPIT_SMTP_HOST?.trim() || "localhost";
  const port = Number(env.SMTP_PORT || env.MAILPIT_SMTP_PORT || (production ? 587 : 1025));
  const secure = env.SMTP_SECURE === "true";
  const from = env.SMTP_FROM?.trim() || "Modular CRM <no-reply@localhost>";
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("SMTP_PORT must be a valid port");
  if (env.SMTP_SECURE && !["true", "false"].includes(env.SMTP_SECURE)) problems.push("SMTP_SECURE must be true or false");
  if (production && (!env.SMTP_HOST?.trim() || isLoopback(host.toLowerCase()) || /mailpit/i.test(host) || port === 1025)) problems.push("SMTP_HOST/SMTP_PORT must use a production mail service, not Mailpit");
  if (production && (!env.SMTP_FROM?.trim() || /@localhost\b/i.test(from))) problems.push("SMTP_FROM must be a production sender address");
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) problems.push("SMTP_USER and SMTP_PASSWORD must be supplied together");
  const workerHealthPort = Number(env.WORKER_HEALTH_PORT || 3001);
  if (!Number.isInteger(workerHealthPort) || workerHealthPort < 1 || workerHealthPort > 65535) problems.push("WORKER_HEALTH_PORT must be a valid port");
  if (problems.length) throw new Error(`Invalid server configuration: ${problems.join("; ")}.`);
  return Object.freeze({ environment, databaseUrl, mockConnectors, publicBaseUrl, authBaseUrl, appBaseUrl, localSmokeTest, workerHealthPort,
    smtp: Object.freeze({ host, port, secure, user: env.SMTP_USER, password: env.SMTP_PASSWORD, from }),
    storageEndpoint: env.STORAGE_ENDPOINT?.trim() || undefined, storageBucket: env.STORAGE_BUCKET?.trim() || "modular-crm" });
}
