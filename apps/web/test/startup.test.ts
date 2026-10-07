import { afterEach, expect, it, vi } from "vitest";
import { register } from "../instrumentation.ts";

afterEach(() => {
  delete (globalThis as typeof globalThis & { modularServerConfig?: unknown }).modularServerConfig;
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules();
});

it("validates once at Node server startup and rejects all unsafe production settings", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("BETTER_AUTH_SECRET", undefined);
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("startup exit"); });
  await expect(register()).rejects.toThrow("startup exit");
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(log).toHaveBeenCalledTimes(1);
  expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ level: "error", event: "configuration.invalid", errorCode: "invalid_server_configuration", status: 500, configurationKeys: expect.arrayContaining(["DATABASE_URL", "BETTER_AUTH_SECRET"]) });
});
it("does not demand deployment-only settings during compilation", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", undefined);
  await expect(register()).resolves.toBeUndefined();
});
it("validates billing plans without opening the database at web startup", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  const platformBilling = { provider: "mock" };
  const validatePlans = vi.fn().mockResolvedValue(undefined);
  const createProvider = vi.fn(() => ({ validatePlans }));
  const databaseImport = vi.fn(() => { throw new Error("database schema is not migrated"); });
  vi.doMock("../lib/server-config", () => ({ getServerConfig: () => ({ platformBilling }) }));
  vi.doMock("@modular-crm/connectors", () => ({ createPlatformBillingProvider: createProvider }));
  vi.doMock("@modular-crm/db", databaseImport);
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("startup exit"); });
  try {
    await expect(register()).resolves.toBeUndefined();
    expect(createProvider).toHaveBeenCalledExactlyOnceWith(platformBilling);
    expect(validatePlans).toHaveBeenCalledExactlyOnceWith();
    expect(databaseImport).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    validatePlans.mockRejectedValueOnce(new Error("private-provider-secret"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(register()).rejects.toThrow("startup exit");
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-provider-secret");
  } finally {
    vi.doUnmock("../lib/server-config");
    vi.doUnmock("@modular-crm/connectors");
    vi.doUnmock("@modular-crm/db");
  }
});
it("caches the shared startup configuration for server consumers", async () => {
  vi.stubEnv("NODE_ENV", "test");
  const { getServerConfig } = await import("../lib/server-config.ts");
  const initial = getServerConfig();
  vi.stubEnv("MOCK_CONNECTORS", "malformed-after-startup");
  expect(getServerConfig()).toBe(initial);
});
it("never logs arbitrary startup exceptions or credential text", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  vi.doMock("../lib/server-config", () => ({ getServerConfig: () => { throw new Error("private-password customer@example.test"); } }));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("startup exit"); });
  try {
    await expect(register()).rejects.toThrow("startup exit");
    expect(log.mock.calls).toHaveLength(1);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ event: "configuration.invalid", configurationKeys: [] });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-password|customer@example/);
  } finally { vi.doUnmock("../lib/server-config"); }
});
