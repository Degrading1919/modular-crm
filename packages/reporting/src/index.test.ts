import { expect, it } from "vitest";
import { compareMetric, customerMetrics, financialMetrics, jobMetrics, reportRowsToCsv, routeMetrics } from "./index.ts";

const scope = { tenantId: "a", allowedLocationIds: ["north"] };
const period = { from: "2026-09-01T00:00:00Z", to: "2026-09-30T23:59:59Z" };

it("scopes every aggregate by tenant and authorized location", () => {
  const customers = [
    { id: "1", tenantId: "a", locationId: "north", createdAt: "2026-09-03", status: "active" as const },
    { id: "2", tenantId: "a", locationId: "south", createdAt: "2026-09-03", status: "active" as const },
    { id: "3", tenantId: "b", locationId: "north", createdAt: "2026-09-03", status: "active" as const },
  ];
  expect(customerMetrics(customers, scope, period).newCustomers).toBe(1);
  expect(customerMetrics(customers, { tenantId: "a", allowedLocationIds: [] }, period).active).toBe(0);
  expect(reportRowsToCsv(customers, scope, [{ key: "id", label: "ID" }]).trim()).toBe('"ID"\r\n"1"');
});

it("calculates operations, routes, money and no-baseline comparisons", () => {
  const jobs = [
    { id: "1", tenantId: "a", locationId: "north", scheduledAt: "2026-09-03", completedAt: "2026-09-03", status: "completed" as const, durationMinutes: 30, eligibleForReclean: true },
    { id: "2", tenantId: "a", locationId: "north", scheduledAt: "2026-09-04", status: "skipped" as const },
    { id: "3", tenantId: "b", locationId: "north", scheduledAt: "2026-09-04", status: "completed" as const },
  ];
  expect(jobMetrics(jobs, scope, period).jobsPerServiceHour).toBe(2);
  expect(jobMetrics(jobs, scope, period).completionRate).toBe(0.5);
  expect(routeMetrics([{ id: "r", tenantId: "a", locationId: "north", date: "2026-09-03", distanceKm: 15, driveMinutes: 40, serviceMinutes: 60, stops: 3, completedStops: 3 }], scope, period).kmPerCompletedStop).toBe(5);
  const finances = financialMetrics([{ id: "i", tenantId: "a", locationId: "north", issuedAt: "2026-09-03", dueAt: "2026-09-05", totalMinor: 5000, balanceMinor: 3000, status: "partially_paid" }], [{ id: "p", tenantId: "a", locationId: "north", occurredAt: "2026-09-04", amountMinor: 2000, type: "payment", status: "succeeded" }], scope, period);
  expect(finances.invoicedMinor).toBe(5000);
  expect(finances.collectedMinor).toBe(2000);
  expect(finances.outstandingMinor).toBe(3000);
  expect(finances.aging.days1To30Minor).toBe(3000);
  expect(compareMetric(10, 0).percentage).toBeNull();
});

it("neutralizes formula-looking values in CSV", () => {
  expect(reportRowsToCsv([{ tenantId: "a", locationId: "north", name: "=1+1" }], scope, [{ key: "name", label: "Name" }])).toContain("'=1+1");
});
