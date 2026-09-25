import { describe, expect, it } from "vitest";
import { PET_WASTE_REMOVAL_PACK, resolveIndustryPack } from "@modular-crm/industry-packs";
import { recurrencePresetSchedule } from "../lib/api/industry-pack-runtime.ts";

describe("Industry Pack recurrence presets", () => {
  it("translates only recurrence rules supported by the shared scheduler", () => {
    const pack = {
      ...PET_WASTE_REMOVAL_PACK,
      recurrencePresets: [
        { key: "weekdays", label: "Weekdays", rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH" },
        { key: "month-day", label: "Monthly", rrule: "FREQ=MONTHLY;BYDAY=MO" },
        { key: "day-of-week", label: "Daily Monday", rrule: "FREQ=DAILY;BYDAY=MO" },
        { key: "custom", label: "Custom", custom: true },
      ],
    };
    const resolved = resolveIndustryPack(pack);

    expect(recurrencePresetSchedule(resolved, "weekdays")).toEqual({ frequencyType: "weekly", interval: 2, daysOfWeek: [1, 4] });
    expect(recurrencePresetSchedule(resolved, "month-day")).toBeUndefined();
    expect(recurrencePresetSchedule(resolved, "day-of-week")).toBeUndefined();
    expect(recurrencePresetSchedule(resolved, "custom")).toBeUndefined();
  });
});
