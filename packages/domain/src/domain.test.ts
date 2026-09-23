import { describe, expect, it } from "vitest";
import { assertTransition } from "./states.ts";
import { canReadResource, permissionsForRole, type StaffActor } from "./permissions.ts";
import { generateOccurrences } from "./recurrence.ts";
import { makeInvoiceSnapshot, invoiceBalance } from "./billing.ts";
import { calculateGrossPay } from "./payroll.ts";
import { makeTransfer, stockBalance } from "./inventory.ts";

describe("authorization", () => {
  const actor: StaffActor = { kind: "staff", userId: "tech-a", tenantId: "tenant-a", role: "technician", permissions: permissionsForRole("technician"), locationIds: new Set(["branch-a"]), allLocations: false };
  it("requires tenant and assignment for a technician", () => {
    expect(canReadResource(actor, { tenantId: "tenant-a", locationId: "branch-a", assignedUserIds: ["tech-a"] }, "jobs.read")).toBe(true);
    expect(canReadResource(actor, { tenantId: "tenant-b", locationId: "branch-a", assignedUserIds: ["tech-a"] }, "jobs.read")).toBe(false);
    expect(canReadResource(actor, { tenantId: "tenant-a", locationId: "branch-a", assignedUserIds: ["other"] }, "jobs.read")).toBe(false);
  });
});

describe("state and recurrence", () => {
  it("rejects incomplete and invalid field transitions", () => {
    expect(() => assertTransition("job", "in_progress", "completed", { requiredChecklist: true })).toThrow("checklist");
    expect(() => assertTransition("job", "scheduled", "skipped")).toThrow("reason");
    expect(() => assertTransition("job", "canceled", "completed", { completedChecklist: true })).toThrow("Cannot move");
  });
  it("generates stable unique keys and respects pause", () => {
    const schedule = { planId: "p1", frequency: "weekly" as const, startDate: "2026-09-21", status: "active" as const, pauseStart: "2026-09-28", pauseEnd: "2026-09-28" };
    expect(generateOccurrences(schedule, "2026-09-20", "2026-10-12").map((v) => v.serviceDate)).toEqual(["2026-09-21", "2026-10-05", "2026-10-12"]);
    expect(generateOccurrences(schedule, "2026-09-20", "2026-10-12")[0]?.key).toBe("p1:2026-09-21");
  });
  it("generates both workdays in a weekly route", () => {
    const dates = generateOccurrences({ planId: "p2", frequency: "weekly", startDate: "2026-09-21", weekdays: [1, 4], status: "active" }, "2026-09-21", "2026-10-02").map((v) => v.serviceDate);
    expect(dates).toEqual(["2026-09-21", "2026-09-24", "2026-09-28", "2026-10-01"]);
  });
});

describe("financial history", () => {
  it("keeps an issued snapshot and reconciles refund balance", () => {
    const source = [{ description: "Cleanup", quantity: 1, unitAmountCents: 2500 }];
    const invoice = makeInvoiceSnapshot({ lines: source, issuedAt: "2026-09-23T00:00:00Z", customerName: "Carter", businessName: "Happy Yards" });
    source[0]!.unitAmountCents = 9999;
    expect(invoice.totalCents).toBe(2500);
    expect(invoiceBalance(invoice.totalCents, 2500, 500)).toBe(500);
  });
  it("calculates gross pay deterministically", () => {
    expect(calculateGrossPay({ approvedMinutes: 600, hourlyRateCents: 2000, overtimeAfterMinutes: 480, jobsCompleted: 4, perJobCents: 100, mileageTenths: 120, mileageRateCentsPerMile: 67 }).grossCents).toBe(23204);
  });
});

describe("inventory", () => {
  it("keeps balanced paired transfers", () => {
    const moves = [{ type: "receive" as const, quantity: 10, itemId: "bags", stockLocationId: "branch" }, ...makeTransfer({ itemId: "bags", from: "branch", to: "truck", quantity: 3, transferId: "transfer-1" })];
    expect(stockBalance(moves, "bags", "branch")).toBe(7);
    expect(stockBalance(moves, "bags", "truck")).toBe(3);
  });
});
