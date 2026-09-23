import { expect, it } from "vitest";
import { normalizeAutomationRule } from "./events-db.js";

it("normalizes the seeded message recipe to the versioned automation contract", () => {
  const row = { id: "rule", tenantId: "tenant", version: 1, name: "Completion", source: "industry_pack", status: "active", triggerConfig: { event: "job.completed" }, conditions: {}, actions: [{ type: "message.send", channel: "email", template: "completion" }] };
  const rule = normalizeAutomationRule(row as unknown as Parameters<typeof normalizeAutomationRule>[0]);
  expect(rule.actions).toEqual([{ actionType: "send_email", configuration: { templateKey: "completion" } }]);
  expect(rule.conditions).toBeUndefined();
});
