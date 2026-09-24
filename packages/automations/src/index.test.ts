import { describe, expect, it, vi } from "vitest";
import { InMemoryAutomationLedger, evaluateAutomationRule, executeAutomationPlan, planAutomationRun, simulateAutomation, type AutomationRule, type DomainEvent } from "./index.ts";

const event: DomainEvent = { eventId: "e1", eventType: "job.completed", eventVersion: 1, occurredAt: "2026-09-23T12:00:00Z", tenantId: "tenant-a", entityType: "job", entityId: "j1", correlationId: "c1", payload: { job: { status: "completed", customerName: "Carter" } } };
const rule: AutomationRule = { id: "notify", tenantId: "tenant-a", version: 1, name: "Completion notice", source: "industry_pack", status: "active", trigger: { event: "job.completed" }, conditions: { field: "job.status", operator: "equals", value: "completed" }, actions: [{ actionType: "send_sms", configuration: { body: "Cleanup complete for ${job.customerName}" } }] };

describe("automation engine", () => {
  it("scopes triggers and renders a side-effect-free simulation", () => {
    expect(evaluateAutomationRule(rule, event).matched).toBe(true);
    expect(evaluateAutomationRule(rule, { ...event, tenantId: "tenant-b" }).matched).toBe(false);
    expect(simulateAutomation(rule, event).actions[0]?.configuration.body).toBe("Cleanup complete for Carter");
  });
  it("executes once with stable action idempotency keys", async () => {
    const plan = planAutomationRun(rule, event)!;
    const ledger = new InMemoryAutomationLedger();
    const execute = vi.fn(async () => undefined);
    expect((await executeAutomationPlan({ plan, rule, event, now: event.occurredAt, ledger, execute }))[0]?.status).toBe("succeeded");
    expect((await executeAutomationPlan({ plan, rule, event, now: event.occurredAt, ledger, execute }))[0]?.status).toBe("skipped");
    expect(execute).toHaveBeenCalledTimes(1);
    const deduped = planAutomationRun({ ...rule, actions: [{ ...rule.actions[0]!, dedupeKeyTemplate: "completed:${job.customerName}" }] }, event)!;
    expect(deduped.actions[0]?.executionKey).toContain("completed%3ACarter");
  });
  it("schedules bounded retries on transient failures", async () => {
    const plan = planAutomationRun(rule, event)!;
    const result = await executeAutomationPlan({ plan, rule, event, now: event.occurredAt, ledger: new InMemoryAutomationLedger(), execute: async () => { throw Object.assign(new Error("timeout"), { code: "timeout", retryable: true }); } });
    expect(result[0]?.status).toBe("retry_scheduled");
    expect(result[0]?.nextAttemptAt).toBe("2026-09-23T12:01:00.000Z");
  });
  it("rejects obvious self triggering and deep event chains", () => {
    expect(() => planAutomationRun({ ...rule, trigger: { event: "ticket.created" }, actions: [{ actionType: "create_ticket", configuration: {} }], conditions: undefined }, { ...event, eventType: "ticket.created" })).toThrow("trigger itself");
    expect(evaluateAutomationRule(rule, { ...event, chainDepth: 8 }).matched).toBe(false);
  });
});
