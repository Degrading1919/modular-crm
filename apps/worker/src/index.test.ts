import { expect, it } from "vitest";
import { sealSecret } from "@modular-crm/domain";
import { environmentSecretResolver, startWorker } from "./index.js";

it("refuses unsafe production settings before starting any database or job loop", async () => {
  await expect(startWorker({ NODE_ENV: "production" })).rejects.toThrow(/DATABASE_URL.*BETTER_AUTH_SECRET.*WEBHOOK_SECRET_ENCRYPTION_KEY.*CONNECTOR_CREDENTIAL_ENCRYPTION_KEY/);
});

it("resolves webhook secrets from server-only references", async () => {
  const resolve = environmentSecretResolver({ WEBHOOK_SECRETS_JSON: '{"subscription-1":"test-secret"}', WEBHOOK_TEST_SECRET: "local-secret" });
  expect(await resolve("subscription-1")).toBe("test-secret");
  expect(await resolve("local-test")).toBe("local-secret");
  expect(await resolve("missing")).toBeUndefined();
  expect(() => environmentSecretResolver({ WEBHOOK_SECRETS_JSON: "[]" })).toThrow("JSON object");
});

it("decrypts stored webhook signing envelopes and preserves legacy resolvers", async () => {
  const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const envelope = sealSecret("endpoint-signing-secret", key);
  const resolve = environmentSecretResolver({ WEBHOOK_SECRET_ENCRYPTION_KEY: key, WEBHOOK_TEST_SECRET: "local-secret" });
  await expect(resolve(envelope)).resolves.toBe("endpoint-signing-secret");
  await expect(resolve("local-test")).resolves.toBe("local-secret");
  await expect(environmentSecretResolver({})(envelope)).rejects.toThrow("WEBHOOK_SECRET_ENCRYPTION_KEY");
});
