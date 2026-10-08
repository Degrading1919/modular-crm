import { DomainError } from "@modular-crm/domain";

/** Production can never opt into mocks, even through saved tenant settings. */
export function mocksAllowed(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && env.MOCK_CONNECTORS !== "false";
}
export function requireMocks() {
  if (!mocksAllowed()) throw new DomainError("FORBIDDEN", "Test services and payments are not available here.", 403);
}
