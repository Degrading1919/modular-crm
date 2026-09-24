import { describe, expect, it } from "vitest";
import { evaluateConditions, readServerConfig, resolvePath } from "./index.ts";

describe("safe conditions", () => {
  it("combines nested conditions and references context values", () => {
    expect(evaluateConditions({ all: [{ field: "job.status", operator: "equals", value: "completed" }, { any: [{ field: "job.count", operator: "greater_than", value: 2 }, { field: "job.count", operator: "equals", value: { path: "minimum" } }] }] }, { current: { job: { status: "completed", count: 2 }, minimum: 2 } })).toBe(true);
  });
  it("rejects unsafe paths and detects changes", () => {
    expect(resolvePath({}, "__proto__.x")).toBeUndefined();
    expect(evaluateConditions({ field: "status", operator: "changed_to", value: "active" }, { current: { status: "active" }, previous: { status: "paused" } })).toBe(true);
    expect(evaluateConditions({ field: "details", operator: "changed" }, { current: { details: { visits: [1, 2] } }, previous: { details: { visits: [1, 2] } } })).toBe(false);
  });
  it("uses explicit time for date comparisons", () => {
    expect(evaluateConditions({ field: "due", operator: "within_days", value: 2 }, { current: { due: "2026-09-24T00:00:00Z" }, now: "2026-09-23T00:00:00Z" })).toBe(true);
  });
});

it("keeps mock defaults local and validates production database configuration", () => {
  expect(readServerConfig({}).mockConnectors).toBe(true);
  expect(() => readServerConfig({ NODE_ENV: "production" })).toThrow("DATABASE_URL");
});
