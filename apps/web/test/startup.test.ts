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
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("startup exit"); });
  await expect(register()).rejects.toThrow("startup exit");
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/DATABASE_URL.*BETTER_AUTH_SECRET/));
});
it("does not demand deployment-only settings during compilation", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", undefined);
  await expect(register()).resolves.toBeUndefined();
});
it("caches the shared startup configuration for server consumers", async () => {
  vi.stubEnv("NODE_ENV", "test");
  const { getServerConfig } = await import("../lib/server-config.ts");
  const initial = getServerConfig();
  vi.stubEnv("MOCK_CONNECTORS", "malformed-after-startup");
  expect(getServerConfig()).toBe(initial);
});
