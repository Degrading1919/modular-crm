import { afterEach, expect, it, vi } from "vitest";
import { requestContext } from "@modular-crm/config/observability";
import { observeJob } from "./observability.js";
import { enqueueOutboundMessage } from "./queues.js";
import type { PgBoss } from "pg-boss";
afterEach(() => { vi.restoreAllMocks(); });
const requestId = "11111111-1111-4111-8111-111111111111";
it("carries an owner's request ID into worker logs and downstream queue payloads", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const send = vi.fn(async () => "job");
  await observeJob("mcrm.domain-event", { requestId, tenantId: requestId }, async () => {
    expect(requestContext()?.requestId).toBe(requestId);
    await enqueueOutboundMessage({ send } as unknown as PgBoss, { tenantId: requestId, messageId: requestId });
  });
  expect(send.mock.calls[0]).toBeDefined();
  expect(JSON.stringify(send.mock.calls)).toContain(requestId);
  expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ requestId, tenantId: requestId, route: "mcrm.domain-event", status: 200 });
});
it("reports job failures safely and rethrows without changing retry behavior", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = new Error("Bearer private-password");
  await expect(observeJob("mcrm.domain-event", { requestId }, async () => { throw error; })).rejects.toBe(error);
  expect(log.mock.calls.filter(c => JSON.parse(c[0] as string).event === "error.reported")).toHaveLength(1);
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-password");
});
it("reports unsuccessful webhook attempts but not planned automation delays", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await observeJob("mcrm.automation-run", { requestId }, async () => "retry");
  expect(log.mock.calls.filter(c => JSON.parse(c[0] as string).event === "error.reported")).toHaveLength(0);
  log.mockClear();
  await observeJob("mcrm.webhook-delivery", { requestId }, async () => "retry");
  expect(log.mock.calls.filter(c => JSON.parse(c[0] as string).event === "error.reported")).toHaveLength(1);
});
