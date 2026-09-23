import { expect, it } from "vitest";
import { createMockConnectorRegistry } from "@modular-crm/connectors";
import { preferenceKeysForTemplate, sendThroughMessagingCapability, suppressReason } from "./messages-db.js";

it("honors channel preferences and SMS consent before an outbound send", () => {
  expect(suppressReason({ channel: "email" }, { emailEnabled: false, smsEnabled: true })).toBe("preference_disabled");
  expect(suppressReason({ channel: "sms" }, undefined, undefined)).toBe("sms_consent_missing");
  expect(suppressReason({ channel: "sms" }, { emailEnabled: true, smsEnabled: true }, { state: "opted_in" })).toBeUndefined();
  expect(suppressReason({ channel: "email" }, undefined, { state: "opted_out" })).toBe("customer_suppressed");
  expect(preferenceKeysForTemplate("cleanup-completed")).toContain("job_completed");
});

it("uses a tenant-bound mock, preserves idempotency and surfaces expired authorization", async () => {
  const registry = createMockConnectorRegistry();
  const request = { tenantId: "tenant-a", channel: "sms" as const, recipient: "+15555550100", body: "Service update", idempotencyKey: "message-1" };
  const sent = await sendThroughMessagingCapability(registry, request);
  expect((await sendThroughMessagingCapability(registry, request)).reference).toBe(sent.reference);
  registry.setScenario("tenant-a", "mock-communication", "authorization_expired");
  await expect(sendThroughMessagingCapability(registry, request)).rejects.toMatchObject({ code: "authorization_expired", retryable: false });
  await expect(sendThroughMessagingCapability(registry, { ...request, tenantId: "tenant-b" })).resolves.toMatchObject({ status: "sent" });
});
