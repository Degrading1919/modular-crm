import { describe, expect, it } from "vitest";
import { readObjectStorageConfig } from "./object-storage.ts";
describe("object storage runtime configuration", () => {
  const base = { NODE_ENV: "production", OBJECT_STORAGE_ENDPOINT: "https://s3.example.test", OBJECT_STORAGE_BUCKET: "files" };
  it("accepts production task credentials without static keys", () => {
    expect(readObjectStorageConfig({ ...base, OBJECT_STORAGE_CREDENTIAL_MODE: "task-role" })).toMatchObject({ credentialMode: "task-role" });
  });
  it("preserves static credentials and session token", () => {
    expect(readObjectStorageConfig({ ...base, OBJECT_STORAGE_ACCESS_KEY: "fixture", OBJECT_STORAGE_SECRET_KEY: "fixture", OBJECT_STORAGE_SESSION_TOKEN: "token" })).toMatchObject({ credentialMode: "static", sessionToken: "token" });
  });
  it("rejects partial static, mixed task keys and unknown modes", () => {
    expect(() => readObjectStorageConfig(base)).toThrow("incomplete");
    expect(() => readObjectStorageConfig({ ...base, OBJECT_STORAGE_CREDENTIAL_MODE: "task-role", OBJECT_STORAGE_ACCESS_KEY: "key" })).toThrow("must not include");
    expect(() => readObjectStorageConfig({ ...base, OBJECT_STORAGE_CREDENTIAL_MODE: "other" })).toThrow("must be static or task-role");
    expect(readObjectStorageConfig({})).toBeUndefined();
  });
});
