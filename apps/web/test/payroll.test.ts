import { describe, expect, it } from "vitest";
import type { Permission } from "@modular-crm/domain";

process.env.DATABASE_URL ??= "postgres://localhost:5432/modular_crm_test";
const { calculatePayrollBreakdown, handlePayroll, payrollCsvCell, payrollSnapshotInLocationScope } = await import("../lib/api/payroll.ts");

const profile = {
  id: "profile-a",
  hourlyRateMinor: 1_200,
  overtimeConfiguration: { afterMinutes: 60, multiplier: 1.5 },
  perJobConfiguration: { amountMinor: 50 },
  commissionConfiguration: { rateBasisPoints: 1_000 },
  mileageRateMinorPerUnit: 100,
  bonusConfiguration: {},
  currency: "USD",
};

function emptyInputs() {
  return { timeEntries: [], unpaidBreaks: [], completedJobs: [], mileage: [], tips: [] };
}

describe("payroll calculation", () => {
  it("includes time that crosses into a period and subtracts overlapping unpaid breaks once", () => {
    const result = calculatePayrollBreakdown({
      periodStart: "2026-04-02", periodEnd: "2026-04-02", profile,
      ...emptyInputs(),
      timeEntries: [
        { id: "time-2", shiftId: "shift-a", locationId: "branch-a", startsAt: "2026-04-02T00:30:00Z", endsAt: "2026-04-02T01:15:00Z" },
        { id: "time-1", shiftId: "shift-a", locationId: "branch-a", startsAt: "2026-04-01T23:30:00Z", endsAt: "2026-04-02T00:30:00Z" },
      ],
      unpaidBreaks: [{ id: "break-a", shiftId: "shift-a", startedAt: "2026-04-02T00:40:00Z", endedAt: "2026-04-02T00:50:00Z" }],
    });

    expect(result.snapshot.inputs.approvedMinutes).toBe(65);
    expect(result.snapshot.formula).toMatchObject({ regularMinutes: 60, overtimeMinutes: 5, hourlyMinor: 1_200, overtimeMinor: 150 });
    expect(result.grossMinor).toBe(1_350);
    expect(result.snapshot.components[0]?.sourceEntityIds).toEqual(["time-1", "time-2"]);
  });

  it("filters every pay input and snapshot location to the manager's allowed branches", () => {
    const result = calculatePayrollBreakdown({
      periodStart: "2026-04-02", periodEnd: "2026-04-02", profile,
      locationScope: { allLocations: false, locationIds: new Set(["branch-a"]) },
      ...emptyInputs(),
      timeEntries: [
        { id: "time-a", shiftId: "shift-a", locationId: "branch-a", startsAt: "2026-04-02T08:00:00Z", endsAt: "2026-04-02T08:30:00Z" },
        { id: "time-b", shiftId: "shift-b", locationId: "branch-b", startsAt: "2026-04-02T08:00:00Z", endsAt: "2026-04-02T10:00:00Z" },
      ],
      unpaidBreaks: [{ id: "break-b", shiftId: "shift-b", startedAt: "2026-04-02T08:00:00Z", endedAt: "2026-04-02T08:15:00Z" }],
      completedJobs: [
        { id: "job-a", locationId: "branch-a", completedAt: "2026-04-02T09:00:00Z", totalMinor: 1_000 },
        { id: "job-b", locationId: "branch-b", completedAt: "2026-04-02T09:00:00Z", totalMinor: 5_000 },
      ],
      mileage: [
        { id: "mile-a", locationId: "branch-a", occurredOn: "2026-04-02", distanceMeters: 1_609, personalVehicle: true },
        { id: "mile-b", locationId: "branch-b", occurredOn: "2026-04-02", distanceMeters: 8_000, personalVehicle: true },
      ],
      tips: [
        { id: "tip-a", locationId: "branch-a", createdAt: "2026-04-02T09:00:00Z", amountMinor: 200, currency: "USD" },
        { id: "tip-b", locationId: "branch-b", createdAt: "2026-04-02T09:00:00Z", amountMinor: 3_000, currency: "USD" },
      ],
    });

    expect(result.grossMinor).toBe(1_050);
    expect(result.snapshot.locationIds).toEqual(["branch-a"]);
    expect(result.snapshot.inputs).toMatchObject({
      approvedTimeEntryIds: ["time-a"], completedJobIds: ["job-a"],
      mileageRecordIds: ["mile-a"], tipIds: ["tip-a"],
    });
  });

  it("produces the same version snapshot regardless of source row order", () => {
    const first = {
      periodStart: "2026-04-02", periodEnd: "2026-04-02", profile,
      ...emptyInputs(),
      timeEntries: [
        { id: "time-b", shiftId: null, locationId: "branch-b", startsAt: "2026-04-02T10:00:00Z", endsAt: "2026-04-02T10:30:00Z" },
        { id: "time-a", shiftId: null, locationId: "branch-a", startsAt: "2026-04-02T09:00:00Z", endsAt: "2026-04-02T09:30:00Z" },
      ],
      completedJobs: [
        { id: "job-b", locationId: "branch-b", completedAt: "2026-04-02T11:00:00Z", totalMinor: 500 },
        { id: "job-a", locationId: "branch-a", completedAt: "2026-04-02T08:00:00Z", totalMinor: 1_000 },
      ],
      mileage: [], tips: [],
    };
    const second = { ...first, timeEntries: [...first.timeEntries].reverse(), completedJobs: [...first.completedJobs].reverse() };

    expect(calculatePayrollBreakdown(first).snapshot).toEqual(calculatePayrollBreakdown(second).snapshot);
  });

  it("rejects invalid dates and negative mileage inputs", () => {
    expect(() => calculatePayrollBreakdown({ periodStart: "2026-02-31", periodEnd: "2026-03-01", profile, ...emptyInputs() })).toThrow("valid payroll date range");
    expect(() => calculatePayrollBreakdown({
      periodStart: "2026-04-02", periodEnd: "2026-04-02", profile, ...emptyInputs(),
      mileage: [{ id: "mile-a", locationId: "branch-a", occurredOn: "2026-04-02", distanceMeters: -1, personalVehicle: true }],
    })).toThrow("Mileage distance cannot be negative");
  });

 it("treats a null overtime threshold as unset", () => {
    const result = calculatePayrollBreakdown({
      periodStart: "2026-04-02", periodEnd: "2026-04-02", profile: { ...profile, overtimeConfiguration: { afterMinutes: null } },
      ...emptyInputs(),
      timeEntries: [{ id: "time-a", shiftId: null, locationId: "branch-a", startsAt: "2026-04-02T08:00:00Z", endsAt: "2026-04-02T09:00:00Z" }],
    });

    expect(result.snapshot.formula).toMatchObject({ regularMinutes: 60, overtimeMinutes: 0 });
  });

  it("uses organization-local midnights across the spring DST transition", () => {
    const result = calculatePayrollBreakdown({
      periodStart: "2026-03-08", periodEnd: "2026-03-08", timeZone: "America/New_York", profile,
      ...emptyInputs(),
      timeEntries: [
        { id: "before", shiftId: null, locationId: "branch-a", startsAt: "2026-03-08T04:30:00Z", endsAt: "2026-03-08T05:00:00Z" },
        { id: "at-start", shiftId: null, locationId: "branch-a", startsAt: "2026-03-08T05:00:00Z", endsAt: "2026-03-08T05:30:00Z" },
        { id: "at-end", shiftId: null, locationId: "branch-a", startsAt: "2026-03-09T03:30:00Z", endsAt: "2026-03-09T04:00:00Z" },
        { id: "after", shiftId: null, locationId: "branch-a", startsAt: "2026-03-09T04:00:00Z", endsAt: "2026-03-09T04:30:00Z" },
      ],
    });

    expect(result.snapshot.inputs).toMatchObject({ approvedMinutes: 60, approvedTimeEntryIds: ["at-end", "at-start"] });
  });

  it("includes the repeated hour in a 25-hour local payroll day", () => {
    const result = calculatePayrollBreakdown({
      periodStart: "2026-11-01", periodEnd: "2026-11-01", timeZone: "America/New_York",
      profile: { ...profile, overtimeConfiguration: { afterMinutes: 2_000, multiplier: 1.5 } },
      ...emptyInputs(),
      timeEntries: [{ id: "fall-back", shiftId: null, locationId: "branch-a", startsAt: "2026-11-01T04:00:00Z", endsAt: "2026-11-02T05:00:00Z" }],
    });

    expect(result.snapshot.inputs.approvedMinutes).toBe(1_500);
    expect(result.snapshot.formula).toMatchObject({ regularMinutes: 1_500, overtimeMinutes: 0 });
  });
});

describe("payroll visibility and exports", () => {
  it("requires a location-limited viewer to have an explicit matching calculation location", () => {
    expect(payrollSnapshotInLocationScope({ locationIds: ["branch-a"] }, false, new Set(["branch-a"]))).toBe(true);
    expect(payrollSnapshotInLocationScope({ locationIds: ["branch-a", "branch-b"] }, false, new Set(["branch-a"]))).toBe(false);
    expect(payrollSnapshotInLocationScope({ locationIds: [] }, false, new Set(["branch-a"]))).toBe(false);
    expect(payrollSnapshotInLocationScope({ locationIds: [] }, true, new Set())).toBe(true);
  });

  it("neutralizes spreadsheet formulas in user-controlled CSV strings", () => {
    expect(payrollCsvCell("=HYPERLINK(\"https://example.test\")")).toBe("\"'=HYPERLINK(\"\"https://example.test\"\")\"");
    expect(payrollCsvCell(" +SUM(1,2)")).toBe("\"' +SUM(1,2)\"");
    expect(payrollCsvCell(-125)).toBe("\"-125\"");
  });
});

describe("payroll API routing", () => {
  const actor = {
    kind: "staff" as const,
    userId: "user-a",
    tenantId: "tenant-a",
    tenantName: "Test business",
    packKey: null,
    email: "staff@example.test",
    name: "Test Staff",
    role: "technician" as const,
    permissions: new Set<Permission>(),
    locationIds: new Set<string>(),
    allLocations: false,
    membershipId: "membership-a",
    organizationId: "organization-a",
  };

  it("dispatches the payroll period collection path", async () => {
    await expect(handlePayroll(new Request("http://localhost/api/v1/payroll/periods"), ["payroll", "periods"], actor))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("dispatches a calculation action using the period ID and action segment", async () => {
    const request = new Request("http://localhost/api/v1/payroll/periods/period-a/calculate", { method: "POST", body: "{}" });
    await expect(handlePayroll(request, ["payroll", "periods", "period-a", "calculate"], actor))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});
