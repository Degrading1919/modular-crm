import { describe, expect, it } from "vitest";
import { buildAutomationRulePayload } from "../components/AutomationRuleBuilder";

const base = {
  name: "  Follow up after a visit  ", description: "  Thank the customer  ", trigger: "job.completed",
  conditions: [{ field: "job.status", operator: "equals", value: "completed" }, { field: "job.service_id", operator: "exists", value: "" }],
  action: "send_email" as const, subject: " Visit complete ", message: " Thanks for choosing us. ",
  ticketTitle: "Review request", ticketDescription: "Please review", status: "draft" as const,
};

describe("plain-language automation builder payload", () => {
  it("creates a declarative rule contract with grouped conditions and a saved draft", () => {
    expect(buildAutomationRulePayload(base)).toEqual({
      name: "Follow up after a visit", description: "Thank the customer", triggerConfig: { event: "job.completed" },
      conditions: { all: [
        { field: "job.status", operator: "equals", value: "completed" },
        { field: "job.service_id", operator: "exists" },
      ] },
      actions: [{ actionType: "send_email", configuration: { subject: "Visit complete", body: "Thanks for choosing us." } }], status: "draft",
    });
  });

  it("provides required configuration for texts and office follow-ups", () => {
    expect(buildAutomationRulePayload({ ...base, conditions: [], action: "send_sms", status: "active" }).actions[0]).toEqual({
      actionType: "send_sms", configuration: { body: "Thanks for choosing us." },
    });
    expect(buildAutomationRulePayload({ ...base, conditions: [], action: "create_ticket" }).actions[0]).toEqual({
      actionType: "create_ticket", configuration: { type: "general", title: "Review request", description: "Please review" },
    });
  });

  it("omits empty optional condition values instead of emitting an invalid comparison", () => {
    expect(buildAutomationRulePayload({ ...base, conditions: [{ field: "job.status", operator: "equals", value: " " }] }).conditions).toEqual({});
  });

  it("keeps numeric event values numeric for comparisons", () => {
    expect(buildAutomationRulePayload({ ...base, trigger: "payment.failed", conditions: [{ field: "payment.amountMinor", operator: "greater_than", value: "2500" }] }).conditions).toEqual({
      all: [{ field: "payment.amountMinor", operator: "greater_than", value: 2500 }],
    });
  });
});
