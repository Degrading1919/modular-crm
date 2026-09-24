import { expect, it } from "vitest";
import { normalizeAutomationRule } from "./events-db.js";

function normalize(actions: unknown[], source: "industry_pack" | "tenant" = "tenant", sourceKey?: string) {
  const row = {
    id: "rule", tenantId: "tenant", version: 1, name: "Automation", source, sourceKey, status: "active",
    triggerConfig: { event: "job.completed" }, conditions: {}, actions,
  };
  return normalizeAutomationRule(row as unknown as Parameters<typeof normalizeAutomationRule>[0]);
}

it("normalizes the legacy message recipe to the versioned automation contract", () => {
  const rule = normalize([{ type: "message.send", channel: "email", template: "completion" }], "industry_pack");
  expect(rule.actions).toEqual([{ actionType: "send_email", configuration: { templateKey: "completion" } }]);
  expect(rule.conditions).toBeUndefined();
});

it("normalizes the flattened default recipe action shapes seeded at signup", () => {
  const rule = normalize([
    { type: "send_email", templateKey: "signup-confirmation" },
    { type: "notify_staff", when: "manual_review" },
    { type: "send_sms", templateKey: "cleanup-completed" },
    { type: "send_email", templateKey: "payment-failed" },
    { type: "notify_staff", reason: "payment_failed" },
    { type: "send_sms", templateKey: "service-day-reminder" },
  ], "industry_pack");

  expect(rule.actions).toEqual([
    { actionType: "send_email", configuration: { templateKey: "signup-confirmation" } },
    { actionType: "notify_staff", configuration: { body: "A new signup needs manual review." } },
    { actionType: "send_sms", configuration: { templateKey: "cleanup-completed" } },
    { actionType: "send_email", configuration: { templateKey: "payment-failed" } },
    { actionType: "notify_staff", configuration: { body: "A customer's payment failed." } },
    { actionType: "send_sms", configuration: { templateKey: "service-day-reminder" } },
  ]);
});

it("accepts the canonical action/configuration shapes for every default recipe", () => {
  const seededRecipes = [
    { sourceKey: "signup-confirmation", actions: [{ actionType: "send_email", configuration: { templateKey: "signup-confirmation" } }, { actionType: "notify_staff", configuration: { when: "manual_review" } }] },
    { sourceKey: "cleanup-completed", actions: [{ actionType: "send_sms", configuration: { templateKey: "cleanup-completed" } }] },
    { sourceKey: "payment-failed", actions: [{ actionType: "send_email", configuration: { templateKey: "payment-failed" } }, { actionType: "notify_staff", configuration: { reason: "payment_failed" } }] },
    { sourceKey: "pause-request", actions: [{ actionType: "create_ticket", configuration: { type: "plan_change_review" } }] },
    { sourceKey: "route-published", actions: [{ actionType: "send_sms", configuration: { templateKey: "service-day-reminder" } }] },
  ] as const;
  const normalized = seededRecipes.map((recipe) => normalize(recipe.actions as unknown as unknown[], "industry_pack", recipe.sourceKey));

  expect(normalized.map((rule) => rule.actions)).toEqual([
    [{ actionType: "send_email", configuration: { templateKey: "signup-confirmation" } }, { actionType: "notify_staff", configuration: { body: "A new signup needs manual review." } }],
    [{ actionType: "send_sms", configuration: { templateKey: "cleanup-completed" } }],
    [{ actionType: "send_email", configuration: { templateKey: "payment-failed" } }, { actionType: "notify_staff", configuration: { body: "A customer's payment failed." } }],
    [{ actionType: "create_ticket", configuration: { type: "plan_change_review" } }],
    [{ actionType: "send_sms", configuration: { templateKey: "service-day-reminder" } }],
  ]);
});

it("recovers the flattened ticket action whose configured type replaces the recipe type", () => {
  const rule = normalize([{ type: "plan_change_review" }], "industry_pack", "pause-request");
  expect(rule.actions).toEqual([{ actionType: "create_ticket", configuration: { type: "plan_change_review" } }]);
});

it("accepts canonical user-created action and execution metadata shapes", () => {
  const rule = normalize([
    { actionType: "send_sms", configuration: { templateKey: "cleanup-completed", customerId: "customer-1" }, delay: { afterEventMinutes: 15 }, continueOnError: true, dedupeKeyTemplate: "${event.eventId}" },
    { actionType: "add_note", configuration: { body: "Check the gate access." } },
    { actionType: "notify_staff", configuration: { title: "Review needed", body: "A customer update needs review." } },
    { actionType: "create_ticket", configuration: { type: "general", title: "Follow up", description: "Review this request." } },
  ]);
  expect(rule.actions).toEqual([
    { actionType: "send_sms", configuration: { templateKey: "cleanup-completed", customerId: "customer-1" }, delay: { afterEventMinutes: 15 }, continueOnError: true, dedupeKeyTemplate: "${event.eventId}" },
    { actionType: "add_note", configuration: { body: "Check the gate access." } },
    { actionType: "notify_staff", configuration: { title: "Review needed", body: "A customer update needs review." } },
    { actionType: "create_ticket", configuration: { type: "general", title: "Follow up", description: "Review this request." } },
  ]);
});

it("rejects actions that are unsupported by the worker or its configuration schemas", () => {
  expect(() => normalize([{ actionType: "update_ticket", configuration: {} }])).toThrow("not supported by the worker");
  expect(() => normalize([{ actionType: "send_email", configuration: { templateKey: "ok", arbitrary: "value" } }])).toThrow("does not support arbitrary");
  expect(() => normalize([{ actionType: "notify_staff", configuration: { reason: "payment_failed" } }])).toThrow("does not support reason");
  expect(() => normalize([{ type: "notify_staff", reason: "unknown_reason" }], "industry_pack")).toThrow("does not support reason");
});
