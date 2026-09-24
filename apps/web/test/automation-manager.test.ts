import { describe, expect, it } from "vitest";
import { automationTriggerLabel, isAutomationRunRetryable } from "../components/AutomationManager";

describe("automation manager labels and retry safety", () => {
  it("shows retry only for a worker-scheduled run explicitly marked retryable by the API", () => {
    expect(isAutomationRunRetryable({ status: "retry", retryable: true })).toBe(true);
    expect(isAutomationRunRetryable({ status: "retry", retryable: false })).toBe(false);
    expect(isAutomationRunRetryable({ status: "retry" })).toBe(false);
    expect(isAutomationRunRetryable({ status: "failed", retryable: true })).toBe(false);
  });

  it("uses business wording for known event types and a readable fallback", () => {
    expect(automationTriggerLabel("job.completed")).toBe("A service visit is completed");
    expect(automationTriggerLabel("new_event_type")).toBe("New Event Type");
    expect(automationTriggerLabel(undefined)).toBe("Business activity");
  });
});
