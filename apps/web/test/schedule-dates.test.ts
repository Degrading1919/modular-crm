import { expect, it } from "vitest";
import { arrivalInstant, addDays, weekStart } from "../lib/schedule-dates";
it("keeps calendar weeks intact across year, month and DST boundaries", () => {
  expect(weekStart("2026-01-01")).toBe("2025-12-29"); expect(weekStart("2026-01-01", 0)).toBe("2025-12-28");
  expect(addDays("2026-03-07", 2)).toBe("2026-03-09"); expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
});
it("converts wall times in the branch zone, including non-hour offsets", () => {
  expect(arrivalInstant("2026-07-08", "09:30", "America/New_York").toISOString()).toBe("2026-07-08T13:30:00.000Z");
  expect(arrivalInstant("2026-01-08", "09:30", "Asia/Kathmandu").toISOString()).toBe("2026-01-08T03:45:00.000Z");
});
it("rejects nonexistent and ambiguous DST promises and invalid calendar/time values", () => {
  for (const [day, time] of [["2026-03-08", "02:30"], ["2026-11-01", "01:30"], ["2026-02-30", "09:00"], ["2026-07-08", "24:00"]]) expect(() => arrivalInstant(day!, time!, "America/New_York")).toThrow();
});
