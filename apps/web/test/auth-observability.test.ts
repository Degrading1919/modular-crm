import { expect, it, vi } from "vitest";
const { options } = vi.hoisted(() => ({ options: vi.fn() }));
vi.mock("better-auth", () => ({ betterAuth: options }));
vi.mock("@better-auth/drizzle-adapter", () => ({ drizzleAdapter: () => ({}) }));
vi.mock("../lib/db", () => ({ getDb: () => ({}) }));
vi.mock("../lib/runtime-secret", () => ({ authSigningSecret: () => "test-only-auth-secret-at-least-32-characters" }));
await import("../lib/auth.ts");
it("replaces authentication-library free-text diagnostics with redacted JSON metadata", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const configured = options.mock.calls[0]![0] as { logger: { log: (level: string, message: string, ...args: unknown[]) => void } };
    configured.logger.log("error", "password=private", { email: "customer@example.test", token: "bearer-token" });
    expect(log.mock.calls).toHaveLength(1);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ event: "auth.library_event", component: "auth", level: "error", route: "startup", requestId: null, tenantId: null });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|customer@example|bearer-token/);
  } finally { log.mockRestore(); }
});
