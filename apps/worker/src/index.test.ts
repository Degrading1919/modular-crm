import { expect, it, vi } from "vitest";
import type { Database } from "@modular-crm/db";
import type { PgBoss } from "pg-boss";
import { sealSecret } from "@modular-crm/domain";
import { environmentSecretResolver, registerWorkerHandlers, startWorker } from "./index.js";
import { processDomainEvent } from "./events-db.js";
import { QUEUES, type DomainEventJob } from "./queues.js";

vi.mock("./events-db.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./events-db.js")>(), processDomainEvent: vi.fn(),
}));

it("dispatches bounded domain-event batches in order without concurrent effects", async () => {
  type Handler = (jobs: Array<{ data: DomainEventJob }>) => Promise<void>;
  let handler: Handler | undefined;
  const work = vi.fn(async (name: string, optionsOrHandler: unknown, callback?: Handler) => {
    if (name === QUEUES.domainEvent) {
      expect(optionsOrHandler).toEqual({ batchSize: 10 }); handler = callback;
    }
    return "worker-id";
  });
  await registerWorkerHandlers({} as Database, { work } as unknown as PgBoss, async () => undefined);
  expect(handler).toBeTypeOf("function");
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const process = vi.mocked(processDomainEvent).mockImplementation(async (_db, _boss, input) => {
    if (input.eventId === "first") { firstStarted(); await gate; }
    return { automationRuns: 0, webhookDeliveries: 0 };
  });
  const first = { tenantId: "tenant", eventId: "first" };
  const second = { tenantId: "tenant", eventId: "second" };
  const draining = handler!([{ data: first }, { data: second }]);
  await started;
  expect(process).toHaveBeenCalledTimes(1);
  releaseFirst(); await draining;
  expect(process.mock.calls.map((call) => call[2])).toEqual([first, second]);
  process.mockReset();
});

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
