import { expect, it } from "vitest";
import { generateForPlans, localDate, planRecurringOccurrences, type RecurringPlan } from "./recurrence.js";

const weekly: RecurringPlan = { id: "plan-a", tenantId: "tenant-a", status: "active", effectiveFrom: "2026-09-01", frequencyType: "weekly", interval: 1, daysOfWeek: [2, 5], timezone: "America/New_York" };

it("generates both weekly route days, skips pauses and uses a stable occurrence key", () => {
  const dates = planRecurringOccurrences({ ...weekly, pauseFrom: "2026-09-08", pauseUntil: "2026-09-11" }, "2026-09-01", "2026-09-18");
  expect(dates.map((item) => item.serviceDate)).toEqual(["2026-09-01", "2026-09-04", "2026-09-15", "2026-09-18"]);
  expect(dates[0]?.key).toBe("plan-a:2026-09-01");
});
it("uses interval weeks and end-of-month clamping", () => {
  expect(planRecurringOccurrences({ ...weekly, interval: 2, daysOfWeek: [2] }, "2026-09-01", "2026-09-30").map((item) => item.serviceDate)).toEqual(["2026-09-01", "2026-09-15", "2026-09-29"]);
  expect(planRecurringOccurrences({ ...weekly, effectiveFrom: "2026-01-31", frequencyType: "monthly", daysOfWeek: null }, "2026-01-31", "2026-03-31").map((item) => item.serviceDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
});
it("does not generate paused or inactive plans and uses local calendar dates", () => {
  expect(planRecurringOccurrences({ ...weekly, status: "paused" }, "2026-09-01", "2026-09-30")).toEqual([]);
  expect(localDate(new Date("2026-09-23T02:00:00Z"), "America/New_York")).toBe("2026-09-22");
});
it("allows a persistence adapter to make reruns idempotent", async () => {
  const seen = new Set<string>();
  const persist = async (item: { key: string }) => { if (seen.has(item.key)) return "existing" as const; seen.add(item.key); return "created" as const; };
  expect(await generateForPlans([weekly], "2026-09-01", "2026-09-04", persist)).toEqual({ created: 2, existing: 0 });
  expect(await generateForPlans([weekly], "2026-09-01", "2026-09-04", persist)).toEqual({ created: 0, existing: 2 });
});
