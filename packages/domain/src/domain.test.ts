import { describe, expect, it } from "vitest";
import { assertTransition } from "./states.ts";
import { canReadResource, permissionsForRole, type StaffActor } from "./permissions.ts";

import { generateOccurrences } from "./recurrence.ts";
import { invoiceFinancialPosition, makeInvoiceSnapshot, invoiceBalance, settledPaymentStatuses } from "./billing.ts";
import { calculateGrossPay } from "./payroll.ts";
import { makeTransfer, stockBalance } from "./inventory.ts";

it("keeps payroll and compensation access away from office managers by default", () => {
  const permissions = permissionsForRole("office");
  for (const key of ["payroll.read", "payroll.calculate", "payroll.review", "payroll.approve", "payroll.export", "reports.payroll_read", "compensation.read"] as const) {
    expect(permissions.has(key)).toBe(false);
  }
  expect(permissions.has("compensation.manage")).toBe(false);
  expect(permissions.has("reports.franchise_read")).toBe(false);
});

describe("authorization", () => {
  const actor: StaffActor = { kind: "staff", userId: "tech-a", tenantId: "tenant-a", role: "technician", permissions: permissionsForRole("technician"), locationIds: new Set(["branch-a"]), allLocations: false };
  it("requires tenant and assignment for a technician", () => {
    expect(canReadResource(actor, { tenantId: "tenant-a", locationId: "branch-a", assignedUserIds: ["tech-a"] }, "jobs.read")).toBe(true);
    expect(canReadResource(actor, { tenantId: "tenant-b", locationId: "branch-a", assignedUserIds: ["tech-a"] }, "jobs.read")).toBe(false);
    expect(canReadResource(actor, { tenantId: "tenant-a", locationId: "branch-a", assignedUserIds: ["other"] }, "jobs.read")).toBe(false);
  });

  it("requires customer resources to name a specifically granted service location", () => {
    const customer = {
      kind: "customer" as const, userId: "customer-user", tenantId: "tenant-a",
      customerIds: new Set(["customer-a"]), locationIds: new Set(["location-a", "location-b"]),
      customerLocationIds: new Map([["customer-a", new Set(["location-a"])]]),
    };
    expect(canReadResource(customer, { tenantId: "tenant-a", customerId: "customer-a", locationId: "location-a", customerVisible: true }, "jobs.read")).toBe(true);
    expect(canReadResource(customer, { tenantId: "tenant-a", customerId: "customer-a", locationId: "location-b", customerVisible: true }, "jobs.read")).toBe(false);
    expect(canReadResource(customer, { tenantId: "tenant-a", customerId: "customer-a", customerVisible: true }, "jobs.read")).toBe(false);
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
  it("reconciles gross payments, refunds, and credits through additional payment collection", () => {
    const afterRefund = invoiceFinancialPosition(10_000, 6_000, 2_000);
    expect(afterRefund).toMatchObject({ grossPaidCents: 6_000, netCollectedCents: 4_000, balanceCents: 6_000, status: "partially_paid" });

    const afterAdditionalPayment = invoiceFinancialPosition(10_000, 9_000, 2_000);
    expect(afterAdditionalPayment).toMatchObject({ grossPaidCents: 9_000, netCollectedCents: 7_000, balanceCents: 3_000, status: "partially_paid" });

    const afterCredit = invoiceFinancialPosition(10_000, 9_000, 2_000, 1_000);
    expect(afterCredit).toMatchObject({ netCollectedCents: 7_000, creditedCents: 1_000, balanceCents: 2_000 });
    expect(settledPaymentStatuses).toContain("partially_refunded");
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
