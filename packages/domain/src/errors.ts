export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "EXTERNAL_SERVICE_ERROR";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly status: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function assert(condition: unknown, code: DomainErrorCode, message: string, status = 400): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
