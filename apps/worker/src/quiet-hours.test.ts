import { expect, it } from "vitest";
import { nextOutsideQuietHours } from "./quiet-hours.js";
it("waits overnight in the business timezone and permits daytime", () => {
  expect(nextOutsideQuietHours(new Date("2026-10-06T05:00:00Z"), "America/New_York")?.toISOString()).toBe("2026-10-06T12:00:00.000Z");
  expect(nextOutsideQuietHours(new Date("2026-10-06T16:00:00Z"), "America/New_York")).toBeNull();
});
it("handles DST and configured daytime quiet periods", () => {
  expect(nextOutsideQuietHours(new Date("2026-11-01T05:30:00Z"), "America/New_York")?.toISOString()).toBe("2026-11-01T13:00:00.000Z");
  expect(nextOutsideQuietHours(new Date("2026-10-06T13:00:00Z"), "UTC", { start: "12:00", end: "14:00" })?.toISOString()).toBe("2026-10-06T14:00:00.000Z");
});
