import { expect, it, vi } from "vitest";
import type { PgBoss } from "pg-boss";
import { QUEUES, enqueueDomainEvent, enqueueOutboundMessage, enqueueRecurringGeneration, registerWorkerQueues } from "./queues.js";

it("registers durable queues and sends tenant-scoped payloads", async () => {
  const createQueue = vi.fn(async () => undefined);
  const send = vi.fn(async () => "queued-id");
  const boss = { createQueue, send } as unknown as PgBoss;
  await registerWorkerQueues(boss);
  expect(createQueue).toHaveBeenCalledTimes(Object.keys(QUEUES).length);
  await enqueueDomainEvent(boss, { tenantId: "tenant-a", eventId: "event-1" });
  expect(send).toHaveBeenCalledWith(QUEUES.domainEvent, { tenantId: "tenant-a", eventId: "event-1" });
  await enqueueOutboundMessage(boss, { tenantId: "tenant-a", messageId: "message-1" });
  await enqueueRecurringGeneration(boss, { tenantId: "tenant-a", planId: "plan-1" });
  expect(send).toHaveBeenCalledTimes(3);
});

it("prioritizes account and service sends over already queued promotions", async () => {
  const send = vi.fn<(queue: string, payload: unknown, options: { priority: number }) => Promise<string>>(async () => "queued"); const boss = { send } as unknown as PgBoss;
  for (const purpose of ["marketing", "service", "account"]) await enqueueOutboundMessage(boss, { tenantId: "tenant-a", messageId: purpose }, purpose);
  expect(send.mock.calls.map((call) => (call[2] as { priority: number }).priority)).toEqual([0, 10, 20]);
  expect(send.mock.calls.map((call) => call[1])).toEqual(["marketing", "service", "account"].map((messageId) => ({ tenantId: "tenant-a", messageId })));
});
