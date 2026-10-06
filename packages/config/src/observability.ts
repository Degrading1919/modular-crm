import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { SERVER_CONFIGURATION_KEYS } from "./index.ts";

export type RequestContext = { requestId: string; tenantId?: string; route: string };
const context = new AsyncLocalStorage<RequestContext & { failure?: unknown }>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const requestContext = () => context.getStore();
export function requestId(value?: string | null): string { return value && uuid.test(value) ? value.toLowerCase() : randomUUID(); }
export function withRequestContext<T>(value: RequestContext, work: () => T): T { return context.run({ ...value, requestId: requestId(value.requestId), tenantId: value.tenantId && uuid.test(value.tenantId) ? value.tenantId : undefined }, work); }
export function identifyTenant(tenantId: string): void { const current = context.getStore(); if (current && uuid.test(tenantId)) current.tenantId = tenantId; }
export function captureUnhandledError(error: unknown): void { const current = context.getStore(); if (current) current.failure = error; }

const classPattern = /^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/;
const driverCodePattern = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{1,47})$/;
const framePattern = /^[A-Za-z_$<>][A-Za-z0-9_.$<>]{0,119}@[A-Za-z0-9_.-]{1,100}\.(?:[cm]?js|tsx?):[1-9][0-9]{0,8}$/;
/** Extract structural diagnostics only: no messages, SQL, values or directory paths. */
export function errorDiagnostics(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return {};
  const name = error.constructor.name;
  const result: Record<string, unknown> = { errorClass: classPattern.test(name) ? name : "Error" };
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const code = "code" in current ? current.code : undefined;
    if (typeof code === "string" && driverCodePattern.test(code)) { result.causeCode = code; break; }
    current = "cause" in current ? current.cause : undefined;
  }
  const frames: string[] = [];
  for (const line of (error.stack ?? "").split("\n").slice(1, 20)) {
    const match = line.trim().match(/^at (?:async |new )?([^\s(]+) \((.+):([0-9]+):[0-9]+\)$/)
      ?? line.trim().match(/^at (.+):([0-9]+):[0-9]+$/);
    if (!match) continue;
    const named = match.length === 4;
    const fn = named ? match[1] : "anonymous";
    const path = named ? match[2] : match[1];
    const frame = `${fn}@${path!.split(/[\\/]/).pop()}:${named ? match[3] : match[2]}`;
    if (framePattern.test(frame)) frames.push(frame);
    if (frames.length === 5) break;
  }
  if (frames.length) result.stackFrames = frames;
  return result;
}

type LogLevel = "info" | "warn" | "error";
// Allowlist, not a blacklist: even harmless-looking arbitrary text can contain credentials or PII.
export function safeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (typeof fields.errorClass === "string" && classPattern.test(fields.errorClass)) safe.errorClass = fields.errorClass;
  if (typeof fields.causeCode === "string" && driverCodePattern.test(fields.causeCode)) safe.causeCode = fields.causeCode;
  if (Array.isArray(fields.stackFrames)) safe.stackFrames = fields.stackFrames.filter((frame): frame is string => typeof frame === "string" && framePattern.test(frame)).slice(0, 5);
  if (Array.isArray(fields.configurationKeys)) safe.configurationKeys = fields.configurationKeys.filter((key): key is string => typeof key === "string" && SERVER_CONFIGURATION_KEYS.has(key)).slice(0, 100);
  for (const key of ["requestId", "tenantId", "invoiceId", "sessionId"] as const) if (typeof fields[key] === "string" && uuid.test(fields[key] as string)) safe[key] = fields[key];
  for (const key of ["event", "component", "route", "errorCode"] as const) {
    const value = fields[key];
    if (typeof value === "string" && /^[a-zA-Z0-9_.:/{}-]{1,160}$/.test(value)) safe[key] = value;
  }
  for (const [key, value] of Object.entries(fields)) if ((["status", "durationMs", "count", "events", "messages", "automations", "webhooks", "reminders", "port"] .includes(key)) && typeof value === "number" && Number.isFinite(value)) safe[key] = value;
  return safe;
}
export function logJson(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), requestId: requestContext()?.requestId ?? null, tenantId: requestContext()?.tenantId ?? null,
    route: requestContext()?.route ?? "startup", status: null, durationMs: 0, ...safeLogFields({ event, ...fields }) });
  console.log(line);
}
export type ErrorReport = { errorCode: "unhandled_api_error" | "worker_job_failed"; status: number; durationMs: number };
export interface ErrorReporter { report(error: unknown, report: ErrorReport): Promise<void> }
export class ConsoleErrorReporter implements ErrorReporter {
  async report(error: unknown, report: ErrorReport): Promise<void> { logJson("error", "error.reported", { ...report, ...errorDiagnostics(error) }); }
}
export class NoopErrorReporter implements ErrorReporter { async report(): Promise<void> {} }
export class OtlpErrorReporter implements ErrorReporter {
  constructor(private readonly endpoint: string, private readonly send: typeof fetch = fetch) {}
  async report(error: unknown, report: ErrorReport): Promise<void> {
    const attributes = Object.entries(safeLogFields({ ...requestContext(), ...report, ...errorDiagnostics(error) })).map(([key, value]) => ({ key, value: Array.isArray(value) ? { arrayValue: { values: value.map(frame => ({ stringValue: frame })) } } : typeof value === "number" ? { intValue: String(Math.round(value)) } : { stringValue: String(value) } }));
    // OTLP/HTTP JSON uses lowerCamelCase fields and string-encoded 64-bit timestamps.
    const response = await this.send(this.endpoint, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(2000), redirect: "error",
      body: JSON.stringify({ resourceLogs: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "modular-crm" } }] }, scopeLogs: [{ scope: { name: "modular-crm.errors" }, logRecords: [{ timeUnixNano: String(BigInt(Date.now()) * 1_000_000n), severityNumber: 17, severityText: "ERROR", body: { stringValue: report.errorCode }, attributes }] }] }] }) });
    if (!response.ok) throw new Error("Error reporting unavailable");
  }
}
export function configuredErrorReporter(env: Record<string, string | undefined> = process.env): ErrorReporter {
  const endpoint = env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim();
  return endpoint ? new OtlpErrorReporter(endpoint) : new ConsoleErrorReporter();
}
export async function reportFailure(error: unknown, report: ErrorReport, reporter = configuredErrorReporter()): Promise<void> {
  try { await reporter.report(error, report); }
  catch { logJson("warn", "error.reporter_unavailable", report); }
}

/** Errors become responses inside work; neither URLs nor raw request/response data enter logs. */
export async function observeRequest(request: Request, route: string, work: () => Promise<Response>): Promise<Response> {
  return withRequestContext({ requestId: requestId(request.headers.get("x-request-id")), route }, async () => {
    const started = performance.now();
    let response: Response;
    let reported = false;
    try { response = await work(); }
    catch (error) {
      await reportFailure(error, { errorCode: "unhandled_api_error", status: 500, durationMs: performance.now() - started });
      reported = true;
      response = Response.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }, { status: 500 });
    }
    if (response.status >= 500 && !reported) await reportFailure(context.getStore()?.failure, { errorCode: "unhandled_api_error", status: response.status, durationMs: performance.now() - started });
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestContext()!.requestId);
    const result = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    logJson(result.status >= 500 ? "error" : "info", "request.completed", { status: result.status, durationMs: performance.now() - started });
    return result;
  });
}
