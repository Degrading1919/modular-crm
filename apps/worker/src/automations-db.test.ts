import { expect, it } from "vitest";
import { deterministicUuid, renderMessageFallback } from "./automations-db.js";

it("derives stable action IDs for replay-safe database effects", () => {
  const first = deterministicUuid("tenant:rule:event:action:0");
  expect(first).toBe(deterministicUuid("tenant:rule:event:action:0"));
  expect(first).not.toBe(deterministicUuid("tenant:rule:event:action:1"));
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});
it("uses an industry-neutral fallback message", () => {
  expect(renderMessageFallback("job.completed", "sms").body).toContain("Service complete");
});
