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
