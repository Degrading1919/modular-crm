export type ReportScope = Readonly<{ tenantId: string; allowedLocationIds: readonly string[] | null }>;
export type ScopedRow = Readonly<{ tenantId: string; locationId?: string | null }>;
export type ReportPeriod = Readonly<{ from: string; to: string }>;
export type ReportDefinition = Readonly<{ key: string; title: string; category: "customer" | "sales" | "operations" | "routes" | "financial" | "staff" | "payroll" | "inventory" | "location"; description: string; dimensions: readonly string[] }>;

export const CORE_REPORTS: readonly ReportDefinition[] = Object.freeze([
  { key: "customer-growth", title: "Customer growth", category: "customer", description: "New customers minus customers lost during the selected period.", dimensions: ["location", "customer_type", "referral_source"] },
  { key: "customer-status", title: "Customer status", category: "customer", description: "Current active, paused and inactive customer counts.", dimensions: ["location", "customer_type"] },
  { key: "lead-conversion", title: "Lead conversion", category: "sales", description: "Converted leads divided by leads with a terminal decision in the selected cohort.", dimensions: ["location", "lead_source"] },
  { key: "estimate-conversion", title: "Estimate conversion", category: "sales", description: "Approved estimates divided by approved and declined estimates in the selected cohort.", dimensions: ["location", "service"] },
  { key: "job-outcomes", title: "Job outcomes", category: "operations", description: "Jobs completed, skipped, missed, canceled and requiring a return visit.", dimensions: ["location", "service", "zone", "technician"] },
  { key: "service-productivity", title: "Service productivity", category: "operations", description: "Completed jobs divided by actual service hours.", dimensions: ["location", "service", "technician"] },
  { key: "route-performance", title: "Route performance", category: "routes", description: "Stops, drive time, service time and distance from route records.", dimensions: ["location", "technician", "zone"] },
  { key: "invoice-collections", title: "Invoiced and collected", category: "financial", description: "Issued invoice totals and settled payments in the period; operational figures, not financial statements.", dimensions: ["location", "service", "customer_type"] },
  { key: "outstanding-aging", title: "Outstanding balances", category: "financial", description: "Open balances grouped by days past due.", dimensions: ["location", "customer_type"] },
  { key: "staff-productivity", title: "Staff productivity", category: "staff", description: "Completed jobs and service revenue per approved work hour.", dimensions: ["location", "technician"] },
  { key: "payroll-inputs", title: "Payroll inputs", category: "payroll", description: "Approved hours, calculated gross pay, tips and mileage for export.", dimensions: ["location", "staff"] },
  { key: "inventory-usage", title: "Inventory usage", category: "inventory", description: "Stock movement and low-stock status from inventory records.", dimensions: ["location", "item"] },
  { key: "location-rollup", title: "Location rollup", category: "location", description: "Authorized location totals for jobs, invoiced and collected amounts.", dimensions: ["location"] },
]);

function timestamp(value: string): number {
  const result = new Date(value).getTime();
  if (!Number.isFinite(result)) throw new Error(`Invalid report date: ${value}`);
  return result;
}
function within(value: string | undefined, period: ReportPeriod): boolean {
  return value !== undefined && timestamp(value) >= timestamp(period.from) && timestamp(value) <= timestamp(period.to);
}
export function validateReportPeriod(period: ReportPeriod): void { if (timestamp(period.from) > timestamp(period.to)) throw new Error("Report period begins after it ends"); }

/** Apply authorized scope before aggregation. An empty location list grants no locations. */
export function scopeReportRows<T extends ScopedRow>(rows: readonly T[], scope: ReportScope): T[] {
  if (!scope.tenantId) throw new Error("Report scope needs a tenant");
  const locations = scope.allowedLocationIds === null ? null : new Set(scope.allowedLocationIds);
  return rows.filter((row) => row.tenantId === scope.tenantId && (locations === null || (row.locationId !== undefined && row.locationId !== null && locations.has(row.locationId))));
}

export function safeRatio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
export function compareMetric(current: number, previous: number): { current: number; previous: number; change: number; percentage: number | null } {
  return { current, previous, change: current - previous, percentage: previous === 0 ? null : (current - previous) / Math.abs(previous) * 100 };
}

export type CustomerReportRow = ScopedRow & Readonly<{ id: string; createdAt: string; lostAt?: string; status: "active" | "paused" | "inactive"; customerType?: string }>;
export function customerMetrics(rows: readonly CustomerReportRow[], scope: ReportScope, period: ReportPeriod) {
  validateReportPeriod(period);
  const scoped = scopeReportRows(rows, scope);
  const newCustomers = scoped.filter((row) => within(row.createdAt, period)).length;
  const lostCustomers = scoped.filter((row) => within(row.lostAt, period)).length;
  return { active: scoped.filter((row) => row.status === "active").length, paused: scoped.filter((row) => row.status === "paused").length, inactive: scoped.filter((row) => row.status === "inactive").length, newCustomers, lostCustomers, netGrowth: newCustomers - lostCustomers };
}

export type JobReportRow = ScopedRow & Readonly<{ id: string; scheduledAt: string; completedAt?: string; status: "scheduled" | "completed" | "skipped" | "missed" | "canceled" | "needs_return"; durationMinutes?: number; recleanOfJobId?: string; eligibleForReclean?: boolean; revenueMinor?: number }>;
export function jobMetrics(rows: readonly JobReportRow[], scope: ReportScope, period: ReportPeriod) {
  validateReportPeriod(period);
  const selected = scopeReportRows(rows, scope).filter((row) => within(row.completedAt ?? row.scheduledAt, period));
  const count = (status: JobReportRow["status"]) => selected.filter((row) => row.status === status).length;
  const completed = count("completed");
  const serviceMinutes = selected.filter((row) => row.status === "completed").reduce((sum, row) => sum + (row.durationMinutes ?? 0), 0);
  const eligible = selected.filter((row) => row.status === "completed" && row.eligibleForReclean).length;
  const recleans = selected.filter((row) => row.recleanOfJobId).length;
  return { scheduled: count("scheduled"), completed, skipped: count("skipped"), missed: count("missed"), canceled: count("canceled"), needsReturn: count("needs_return"), serviceMinutes, jobsPerServiceHour: safeRatio(completed, serviceMinutes / 60), recleans, recleanRate: safeRatio(recleans, eligible), completionRate: safeRatio(completed, completed + count("skipped") + count("missed") + count("canceled")) };
}

export type RouteReportRow = ScopedRow & Readonly<{ id: string; date: string; distanceKm: number; driveMinutes: number; serviceMinutes: number; stops: number; completedStops?: number }>;
export function routeMetrics(rows: readonly RouteReportRow[], scope: ReportScope, period: ReportPeriod) {
  validateReportPeriod(period);
  const selected = scopeReportRows(rows, scope).filter((row) => within(row.date, period));
  const sum = (key: "distanceKm" | "driveMinutes" | "serviceMinutes" | "stops") => selected.reduce((total, row) => total + row[key], 0);
  const distanceKm = sum("distanceKm");
  const driveMinutes = sum("driveMinutes");
  const serviceMinutes = sum("serviceMinutes");
  const stops = sum("stops");
  const completedStops = selected.reduce((total, row) => total + (row.completedStops ?? 0), 0);
  return { routes: selected.length, distanceKm, driveMinutes, serviceMinutes, stops, completedStops, stopsPerRoute: safeRatio(stops, selected.length), kmPerCompletedStop: safeRatio(distanceKm, completedStops), utilization: safeRatio(serviceMinutes, serviceMinutes + driveMinutes) };
}

export type InvoiceReportRow = ScopedRow & Readonly<{ id: string; issuedAt: string; dueAt?: string; totalMinor: number; balanceMinor: number; status: "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "void" }>;
export type PaymentReportRow = ScopedRow & Readonly<{ id: string; occurredAt: string; amountMinor: number; type: "payment" | "refund"; status: "succeeded" | "pending" | "failed" }>;
export function financialMetrics(invoices: readonly InvoiceReportRow[], payments: readonly PaymentReportRow[], scope: ReportScope, period: ReportPeriod) {
  validateReportPeriod(period);
  const scopedInvoices = scopeReportRows(invoices, scope).filter((invoice) => invoice.status !== "draft" && invoice.status !== "void");
  const issued = scopedInvoices.filter((invoice) => within(invoice.issuedAt, period));
  const settled = scopeReportRows(payments, scope).filter((payment) => payment.status === "succeeded" && within(payment.occurredAt, period));
  const collectedMinor = settled.reduce((total, row) => total + (row.type === "refund" ? -row.amountMinor : row.amountMinor), 0);
  const asOf = timestamp(period.to);
  const open = scopedInvoices.filter((invoice) => timestamp(invoice.issuedAt) <= asOf && invoice.balanceMinor > 0);
  const aging = { currentMinor: 0, days1To30Minor: 0, days31To60Minor: 0, days61To90Minor: 0, over90DaysMinor: 0 };
  for (const invoice of open) {
    const overdueDays = invoice.dueAt ? Math.floor((asOf - timestamp(invoice.dueAt)) / 86400000) : 0;
    if (overdueDays <= 0) aging.currentMinor += invoice.balanceMinor;
    else if (overdueDays <= 30) aging.days1To30Minor += invoice.balanceMinor;
    else if (overdueDays <= 60) aging.days31To60Minor += invoice.balanceMinor;
    else if (overdueDays <= 90) aging.days61To90Minor += invoice.balanceMinor;
    else aging.over90DaysMinor += invoice.balanceMinor;
  }
  return { invoicedMinor: issued.reduce((total, row) => total + row.totalMinor, 0), collectedMinor, outstandingMinor: open.reduce((total, row) => total + row.balanceMinor, 0), failedPayments: scopeReportRows(payments, scope).filter((row) => row.status === "failed" && within(row.occurredAt, period)).length, refundsMinor: settled.filter((row) => row.type === "refund").reduce((total, row) => total + row.amountMinor, 0), aging };
}

export type PayrollReportRow = ScopedRow & Readonly<{ id: string; periodEnd: string; approvedHours: number; grossMinor: number; tipsMinor: number; mileageKm: number; status: "open" | "approved" | "exported" }>;
export function payrollMetrics(rows: readonly PayrollReportRow[], scope: ReportScope, period: ReportPeriod) {
  validateReportPeriod(period);
  const selected = scopeReportRows(rows, scope).filter((row) => row.status !== "open" && within(row.periodEnd, period));
  return { approvedHours: selected.reduce((sum, row) => sum + row.approvedHours, 0), grossMinor: selected.reduce((sum, row) => sum + row.grossMinor, 0), tipsMinor: selected.reduce((sum, row) => sum + row.tipsMinor, 0), mileageKm: selected.reduce((sum, row) => sum + row.mileageKm, 0) };
}

export type InventoryReportRow = ScopedRow & Readonly<{ id: string; itemId: string; occurredAt: string; quantityDelta: number; kind: "receive" | "transfer" | "consume" | "adjust" | "return"; balance: number; reorderThreshold?: number }>;
export function inventoryMetrics(rows: readonly InventoryReportRow[], scope: ReportScope, period: ReportPeriod) {
  validateReportPeriod(period);
  const scoped = scopeReportRows(rows, scope);
  const selected = scoped.filter((row) => within(row.occurredAt, period));
  const latest = new Map<string, InventoryReportRow>();
  for (const row of scoped.filter((row) => timestamp(row.occurredAt) <= timestamp(period.to)).sort((a, b) => timestamp(a.occurredAt) - timestamp(b.occurredAt))) latest.set(`${row.locationId}:${row.itemId}`, row);
  return { consumedUnits: selected.filter((row) => row.kind === "consume").reduce((sum, row) => sum - row.quantityDelta, 0), lowStockItems: Array.from(latest.values()).filter((row) => row.reorderThreshold !== undefined && row.balance <= row.reorderThreshold).length };
}

/** Export only already scoped rows. Prefix spreadsheet formula characters to avoid formula execution. */
export function reportRowsToCsv<T extends ScopedRow>(rows: readonly T[], scope: ReportScope, columns: readonly { key: keyof T; label: string }[]): string {
  const escape = (value: unknown): string => {
    const raw = value === null || value === undefined ? "" : String(value);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [columns.map((column) => escape(column.label)).join(","), ...scopeReportRows(rows, scope).map((row) => columns.map((column) => escape(row[column.key])).join(","))].join("\r\n");
}
