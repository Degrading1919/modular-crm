import { DomainError } from "@modular-crm/domain";
import { ZodError, type ZodType } from "zod";

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function apiError(error: unknown): Response {
  if (error instanceof DomainError) return json({ error: { code: error.code, message: error.message, details: error.details } }, error.status);
  if (error instanceof ZodError) return json({ error: { code: "VALIDATION_ERROR", message: "Check the highlighted information.", details: error.flatten() } }, 422);
  if (error instanceof SyntaxError) return json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON request." } }, 400);
  const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
  const causeCode = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : undefined;
  console.error(JSON.stringify({ event: "api.error", name: error instanceof Error ? error.name : "UnknownError", causeCode }));
  return json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }, 500);
}

export async function readBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 2_000_000) throw new DomainError("VALIDATION_ERROR", "Request is too large.", 413);
  return schema.parse(await request.json());
}

export function requireMethod(request: Request, method: string): void {
  if (request.method !== method) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
