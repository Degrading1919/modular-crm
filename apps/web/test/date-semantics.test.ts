import { describe, expect, it } from "vitest";
import { businessDate, formatDateValue } from "../lib/dates.ts";
import { date } from "../components/api.ts";

describe("date semantics", () => {
  it("keeps a calendar date on its intended day in US and Pacific timezones", () => {
    expect(formatDateValue("2026-10-06", { month: "long", day: "numeric", timeZone: "America/New_York" })).toBe("October 6");
    expect(formatDateValue("2026-10-06", { month: "long", day: "numeric", timeZone: "Pacific/Auckland" })).toBe("October 6");
    expect(date("2026-10-06", { month: "short", day: "numeric", year: "numeric" })).toBe("Oct 6, 2026");
  });

  it("continues to convert timestamp instants using the requested timezone", () => {
    expect(formatDateValue("2026-10-06T01:30:00.000Z", {
      month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
    })).toBe("October 5 at 9:30 PM");
  });

  it("derives business today from the tenant timezone when UTC is on another day", () => {
    const instant = new Date("2026-10-06T02:30:00.000Z");
    expect(businessDate(instant, "America/New_York")).toBe("2026-10-05");
    expect(businessDate(instant, "Asia/Tokyo")).toBe("2026-10-06");
  });
});
