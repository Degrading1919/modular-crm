import { beforeEach, describe, expect, it, vi } from "vitest";

const dbHarness = vi.hoisted(() => ({
  selectResults: [] as Array<Record<string, unknown> | Array<Record<string, unknown>>>,
  updateResults: [] as Array<Record<string, unknown>>,
  updateSets: [] as Array<Record<string, unknown>>,
  eventCalls: [] as Array<{ event: Record<string, unknown>; writer: unknown }>,
  transactionWriter: {} as Record<string, unknown>,
}));

vi.mock("../lib/db", () => ({
  getDb: () => ({
    select: () => {
      const query = {
        from() { return this; },
        innerJoin() { return this; },
        where() { return this; },
        orderBy() { return this; },
        limit: async () => {
          const result = dbHarness.selectResults.shift();
          return Array.isArray(result) ? result : result ? [result] : [];
        },
      };
      return query;
    },
    update: () => ({
      set(values: Record<string, unknown>) {
        dbHarness.updateSets.push(values);
        return { where: () => ({ returning: async () => dbHarness.updateResults.splice(0, 1) }) };
      },
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from() { return this; },
          innerJoin() { return this; },
          where() { return this; },
          orderBy() { return this; },
          limit: async () => {
            const result = dbHarness.selectResults.shift();
            return Array.isArray(result) ? result : result ? [result] : [];
          },
        }),
        update: () => ({
          set(values: Record<string, unknown>) {
            dbHarness.updateSets.push(values);
            return { where: () => ({ returning: async () => dbHarness.updateResults.splice(0, 1) }) };
          },
        }),
      };
      dbHarness.transactionWriter = tx;
      return callback(tx);
    },
  }),
}));
vi.mock("../lib/api/events", () => ({
  recordEvent: async (_actor: unknown, event: Record<string, unknown>, writer: unknown) => { dbHarness.eventCalls.push({ event, writer }); },
}));

// The API handler imports the shared auth configuration, which creates a lazy pg Pool at module load.
process.env.DATABASE_URL ??= "postgres://localhost:5432/modular_crm_test";
const { handleCapabilitySettings, normalizeAutomationRuleInput } = await import("../lib/api/capability-settings");
const owner = {
  kind: "staff" as const, userId: "user-a", tenantId: "tenant-a", role: "owner" as const,
  permissions: new Set(["automations.runs_read", "automations.runs_retry"] as const),
  locationIds: new Set<string>(), allLocations: true, membershipId: "member-a", organizationId: "org-a",
  email: "owner@example.test", name: "Owner", tenantName: "Tenant A", packKey: null,
};

beforeEach(() => {
  dbHarness.selectResults = [];
  dbHarness.updateResults = [];
  dbHarness.updateSets = [];
  dbHarness.eventCalls = [];
});

const identity = { tenantId: "tenant-a", id: "rule-a", version: 1 };

describe("capability settings automation input", () => {
  it("converts the compact BusinessApp form into the worker rule contract", () => {
    const rule = normalizeAutomationRuleInput({ name: "Send cleanup update", trigger: "job.completed", action: "send_sms" }, identity);

    expect(rule).toMatchObject({
      name: "Send cleanup update",
      status: "active",
      triggerConfig: { event: "job.completed" },
      conditions: {},
      actions: [{ actionType: "send_sms", configuration: {} }],
    });
  });

  it("normalizes documented filter arrays and preserves supported delay options", () => {
    const rule = normalizeAutomationRuleInput({
      name: "Follow up",
      triggerConfig: { event: "job.completed", filters: [{ field: "job.status", operator: "equals", value: "completed" }] },
      conditions: { all: [{ field: "customer.status", operator: "not_equals", value: "archived" }] },
      actions: [{ actionType: "send_email", configuration: { subject: "Done", body: "Your visit is complete." }, delay: { afterEventMinutes: 60 } }],
      status: "draft",
    }, identity);

    expect(rule.triggerConfig.filters).toEqual({ all: [{ field: "job.status", operator: "equals", value: "completed" }] });
    expect(rule.conditions).toEqual({ all: [{ field: "customer.status", operator: "not_equals", value: "archived" }] });
    expect(rule.actions[0]).toMatchObject({ actionType: "send_email", delay: { afterEventMinutes: 60 } });
    expect(rule.status).toBe("draft");
  });

  it("rejects worker-unsupported actions and unsafe field paths", () => {
    expect(() => normalizeAutomationRuleInput({ name: "Run code", trigger: "job.completed", action: "eval" }, identity)).toThrow(/safely/i);
    expect(() => normalizeAutomationRuleInput({
      name: "Unsafe filter", trigger: "job.completed", action: "send_email",
      conditions: { field: "customer.__proto__.email", operator: "exists" },
    }, identity)).toThrow(/field or operator/i);
  });

  it("blocks an unguarded ticket-created loop", () => {
    expect(() => normalizeAutomationRuleInput({
      name: "Ticket loop", trigger: "ticket.created", action: "create_ticket",
    }, identity)).toThrow(/trigger itself/i);
  });
});

describe("automation run retry API", () => {
  const retryRun = {
    id: "run-a", status: "retry", attempts: 2, nextRetryAt: new Date("2026-09-24T14:00:00Z"),
    tenantId: "tenant-a", automationRuleId: "rule-a", triggeringEventId: "event-a",
    startedAt: null, completedAt: null, errorCode: null, createdAt: new Date("2026-09-24T12:00:00Z"),
  };

  it("exposes worker retry state and makes a scoped retry due without replacing its snapshot", async () => {
    dbHarness.selectResults = [{ run: retryRun }];
    dbHarness.updateResults = [{ ...retryRun, nextRetryAt: null }];
    const response = await handleCapabilitySettings(
      new Request("https://crm.example/api/v1/automations/runs/run-a/retry", { method: "POST" }),
      ["automations", "runs", "run-a", "retry"], owner,
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ item: { id: "run-a", status: "retry", retryable: true, nextRetryAt: null } });
    expect(dbHarness.updateSets).toHaveLength(1);
    expect(dbHarness.updateSets[0]).toMatchObject({ nextRetryAt: null });
    expect(dbHarness.updateSets[0]).not.toHaveProperty("contextSnapshot");
    expect(dbHarness.eventCalls).toHaveLength(1);
    expect(dbHarness.eventCalls[0]?.event).toMatchObject({ type: "automation_run.retry_requested", auditAction: "automation.run_retry" });
    expect(dbHarness.eventCalls[0]?.writer).toBe(dbHarness.transactionWriter);
  });

  it("does not mark or update terminal failures as retryable", async () => {
    dbHarness.selectResults = [{ run: { ...retryRun, status: "failed", nextRetryAt: null } }];
    const response = await handleCapabilitySettings(
      new Request("https://crm.example/api/v1/automations/runs/run-a/retry", { method: "POST" }),
      ["automations", "runs", "run-a", "retry"], owner,
    ).catch((error: unknown) => error);

    expect(response).toMatchObject({ status: 409, code: "CONFLICT" });
    expect(dbHarness.updateSets).toHaveLength(0);
  });

  it("sets retryable only for runs the worker has already placed in retry state", async () => {
    dbHarness.selectResults = [[
      { run: retryRun, eventType: "job.completed", eventOccurredAt: new Date("2026-09-24T13:00:00Z"), entityType: "job", entityId: "job-a" },
      { run: { ...retryRun, id: "run-b", status: "failed" }, eventType: "job.completed", eventOccurredAt: new Date("2026-09-24T12:00:00Z"), entityType: "job", entityId: "job-b" },
    ]];
    const response = await handleCapabilitySettings(
      new Request("https://crm.example/api/v1/automations/runs?limit=2"), ["automations", "runs"], owner,
    );

    expect(await response?.json()).toMatchObject({ items: [{ id: "run-a", retryable: true }, { id: "run-b", retryable: false }] });
  });
});
