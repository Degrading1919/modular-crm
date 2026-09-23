import { expect, it } from "vitest";
import { environmentSecretResolver } from "./index.js";

it("resolves webhook secrets from server-only references", async () => {
  const resolve = environmentSecretResolver({ WEBHOOK_SECRETS_JSON: '{"subscription-1":"test-secret"}', WEBHOOK_TEST_SECRET: "local-secret" });
  expect(await resolve("subscription-1")).toBe("test-secret");
  expect(await resolve("local-test")).toBe("local-secret");
  expect(await resolve("missing")).toBeUndefined();
  expect(() => environmentSecretResolver({ WEBHOOK_SECRETS_JSON: "[]" })).toThrow("JSON object");
});
