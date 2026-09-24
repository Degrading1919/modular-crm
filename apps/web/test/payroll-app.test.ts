import { describe, expect, it } from "vitest";
import * as React from "react";

Object.assign(globalThis, { React });
const { buildPayrollCorrectionPayload, buildPayrollProfilePayload } = await import("../components/PayrollApp");
import type { PayrollProfileDraft } from "../components/PayrollApp";

const profileDraft: PayrollProfileDraft = {
  membershipId: "member-1",
  effectiveFrom: "2026-09-01",
  effectiveTo: "",
  hourlyDollars: "22.50",
  overtimeAfterMinutes: "2400",
  overtimeMultiplier: "1.5",
  perJobDollars: "0.75",
  bonusDollars: "40.00",
  completionBonusDollars: "1.25",
  commissionPercent: "8.75",
  mileageDollarsPerMile: "0.67",
  currency: "usd",
};

describe("payroll workspace input mapping", () => {
  it("maps owner-entered pay rates into the API's minor units and rate settings", () => {
    expect(buildPayrollProfilePayload(profileDraft)).toEqual({
      membershipId: "member-1",
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
      hourlyRateMinor: 2_250,
      overtimeConfiguration: { afterMinutes: 2_400, multiplier: 1.5 },
      perJobConfiguration: { amountMinor: 75 },
      commissionConfiguration: { rateBasisPoints: 875 },
      mileageRateMinorPerUnit: 67,
      bonusConfiguration: { amountMinor: 4_000, completionBonusMinor: 125 },
      currency: "USD",
    });
  });

  it("keeps staff identity out of edits and requires both overtime settings", () => {
    expect(buildPayrollProfilePayload({ ...profileDraft, membershipId: "" }, false)).not.toHaveProperty("membershipId");
    expect(() => buildPayrollProfilePayload({ ...profileDraft, overtimeMultiplier: "" })).toThrow("both the overtime threshold and overtime rate");
  });

  it("supports signed manual corrections while enforcing a non-zero amount and reason", () => {
    expect(buildPayrollCorrectionPayload("member-1", "-12.34", "Missed break adjustment")).toEqual({
      membershipId: "member-1",
      amountMinor: -1_234,
      description: "Missed break adjustment",
    });
    expect(() => buildPayrollCorrectionPayload("member-1", "0.00", "Reason")).toThrow("other than zero");
  });
});
