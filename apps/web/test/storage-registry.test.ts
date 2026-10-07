import { afterEach, expect, it, vi } from "vitest";

const original = {
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
  bucket: process.env.OBJECT_STORAGE_BUCKET,
  accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY,
  secretKey: process.env.OBJECT_STORAGE_SECRET_KEY,
  authSecret: process.env.BETTER_AUTH_SECRET,
  mode: process.env.OBJECT_STORAGE_CREDENTIAL_MODE,
  token: process.env.OBJECT_STORAGE_SESSION_TOKEN,
};
const globals = globalThis as typeof globalThis & { modularRegistry?: unknown };

afterEach(() => {
  for (const [name, value] of Object.entries({
    OBJECT_STORAGE_ENDPOINT: original.endpoint,
    OBJECT_STORAGE_BUCKET: original.bucket,
    OBJECT_STORAGE_ACCESS_KEY: original.accessKey,
    OBJECT_STORAGE_SECRET_KEY: original.secretKey,
    BETTER_AUTH_SECRET: original.authSecret,
    OBJECT_STORAGE_CREDENTIAL_MODE: original.mode,
    OBJECT_STORAGE_SESSION_TOKEN: original.token,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  delete globals.modularRegistry;
  vi.resetModules();
});

it("registers production task-role storage without static keys", async () => {
  process.env.OBJECT_STORAGE_ENDPOINT = "https://s3.us-east-1.amazonaws.com";
  process.env.OBJECT_STORAGE_BUCKET = "test-private-files";
  process.env.OBJECT_STORAGE_CREDENTIAL_MODE = "task-role";
  delete process.env.OBJECT_STORAGE_ACCESS_KEY;
  delete process.env.OBJECT_STORAGE_SECRET_KEY;
  delete process.env.OBJECT_STORAGE_SESSION_TOKEN;
  process.env.BETTER_AUTH_SECRET = "local-test-secret-with-at-least-32-characters";
  const { getRegistry } = await import("../lib/connectors");
  expect(getRegistry().getDefinition("s3-compatible")).toBeDefined();
  expect(getRegistry().getDefinition("local-storage")).toBeDefined();
});

it("keeps seeded local file installations available when S3 is configured", async () => {
  process.env.OBJECT_STORAGE_ENDPOINT = "http://localhost:9000";
  process.env.OBJECT_STORAGE_BUCKET = "modular-crm";
  process.env.OBJECT_STORAGE_ACCESS_KEY = "test-access";
  process.env.OBJECT_STORAGE_SECRET_KEY = "test-secret";
  process.env.BETTER_AUTH_SECRET = "local-test-secret-with-at-least-32-characters";
  delete globals.modularRegistry;
  vi.resetModules();

  const { getRegistry } = await import("../lib/connectors");
  const registry = getRegistry();
  expect(registry.getDefinition("local-storage")).toBeDefined();
  expect(registry.getDefinition("s3-compatible")).toBeDefined();
  expect(registry.connectLocal("tenant-a", "local-storage").state).toBe("connected");
});
