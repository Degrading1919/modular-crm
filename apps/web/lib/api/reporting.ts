import { sql, type SQL } from "drizzle-orm";
import { DomainError, requirePermission, settledPaymentStatuses } from "@modular-crm/domain";
import { rows, uuidArray, type DbRow } from "./sql";
import { requireStaff, type SessionActor } from "./actor";
import { json } from "./http";

export type ReportingActor = SessionActor & { kind: "staff"; organizationId: string; membershipId: string };
type ReportType = "financial" | "customers" | "jobs" | "routes" | "staff" | "inventory" | "locations";
type ReportRange = "week" | "month" | "quarter" | "year";
type Period = Readonly<{ startDate: string; endDateExclusive: string; startAt: string; endAt: string; asOfDate: string }>;

const reportTypes: readonly ReportType[] = ["financial", "customers", "jobs", "routes", "staff", "inventory", "locations"];
const reportRanges: readonly ReportRange[] = ["week", "month", "quarter", "year"];
const csvRowLimit = 5_000;

const settledPaymentStatusSql = sql.join(settledPaymentStatuses.map((status) => sql`${status}`), sql`, `);

function authorize(actor: SessionActor, permissions: readonly ("reports.operational_read" | "reports.financial_read" | "reports.staff_read" | "reports.payroll_read" | "reports.inventory_read" | "reports.franchise_read" | "reports.export" | "organization.rollup_reports_read")[]): ReportingActor {
  requireStaff(actor);
  for (const permission of permissions) requirePermission(actor, permission);
  return actor as ReportingActor;
}

function reportPermissions(type: ReportType): readonly ("reports.operational_read" | "reports.financial_read" | "reports.staff_read" | "reports.inventory_read" | "reports.franchise_read" | "organization.rollup_reports_read")[] {
  switch (type) {
    case "financial": return ["reports.financial_read"];
    case "customers": case "jobs": case "routes": return ["reports.operational_read"];
    case "staff": return ["reports.staff_read"];
    case "inventory": return ["reports.inventory_read"];
    case "locations": return ["reports.franchise_read", "organization.rollup_reports_read"];
  }
}

function safeIdentifier(alias: string, name: string): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(alias) || !/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("Unsafe reporting SQL identifier.");
  return sql.raw(`"${alias}"."${name}"`);
}

function rollupAllowed(actor: ReportingActor, requested: boolean): boolean {
  return requested && actor.permissions.has("reports.franchise_read") && actor.permissions.has("organization.rollup_reports_read");
}

/** Builds the tenant, organization, and location CTEs used before every report aggregate. */
export function buildReportScopeCtes(actor: ReportingActor, options: { rollup?: boolean; locationId?: string } = {}): SQL {
  const includeChildren = rollupAllowed(actor, options.rollup === true);
  const locationId = options.locationId ?? null;
  return sql`WITH RECURSIVE authorized_organizations(id) AS (
      SELECT o.id FROM organizations o WHERE o.tenant_id = ${actor.tenantId} AND o.id = ${actor.organizationId}
      UNION
      SELECT child.id FROM organizations child
      JOIN authorized_organizations parent ON child.parent_organization_id = parent.id
      WHERE child.tenant_id = ${actor.tenantId} AND ${includeChildren}
    ), allowed_locations(id, organization_id, name) AS (
      SELECT l.id, l.organization_id, l.name
      FROM organization_locations l
      WHERE l.tenant_id = ${actor.tenantId}
        AND l.organization_id IN (SELECT id FROM authorized_organizations)
        AND (${includeChildren} OR ${actor.allLocations} OR l.id = ANY(${uuidArray(actor.locationIds)}))
        AND (${locationId}::uuid IS NULL OR l.id = ${locationId}::uuid)
    )`;
}

function locatedScope(actor: ReportingActor, alias: string, locationColumn: string, organizationColumn: string, includeChildren = false): SQL {
  const location = safeIdentifier(alias, locationColumn);
  const organization = safeIdentifier(alias, organizationColumn);
  return sql`${organization} IN (SELECT id FROM authorized_organizations)
    AND (
      ${location} IN (SELECT id FROM allowed_locations)
      OR (${location} IS NULL AND ${actor.allLocations} AND ${organization} = ${actor.organizationId})
      OR (${location} IS NULL AND ${includeChildren} AND ${organization} IN (SELECT id FROM authorized_organizations))
    )`;
}

function locationOnlyScope(alias: string, locationColumn: string): SQL {
  return sql`${safeIdentifier(alias, locationColumn)} IN (SELECT id FROM allowed_locations)`;
}

function customerScopeCte(actor: ReportingActor, includeChildren = false): SQL {
  return sql`, customer_scope AS (
    SELECT c.id, c.tenant_id, c.organization_id, c.status, c.created_at, c.updated_at,
      CASE WHEN c.owning_location_id IN (SELECT id FROM allowed_locations) THEN c.owning_location_id
        ELSE service_location.organization_location_id END AS location_id
    FROM customers c
    LEFT JOIN LATERAL (
      SELECT sl.organization_location_id
      FROM service_locations sl JOIN allowed_locations al ON al.id = sl.organization_location_id
      WHERE sl.tenant_id = c.tenant_id AND sl.customer_id = c.id
      ORDER BY sl.organization_location_id, sl.id LIMIT 1
    ) service_location ON true
    WHERE c.tenant_id = ${actor.tenantId}
      AND c.archived_at IS NULL
      AND c.organization_id IN (SELECT id FROM authorized_organizations)
      AND (
        c.owning_location_id IN (SELECT id FROM allowed_locations)
        OR service_location.organization_location_id IS NOT NULL
        OR (c.owning_location_id IS NULL AND (${actor.allLocations} OR ${includeChildren})
          AND c.organization_id IN (SELECT id FROM authorized_organizations))
      )
  )`;
}

function customerLocationScope(actor: ReportingActor, includeChildren = false): SQL {
  return sql`(
    c.owning_location_id IN (SELECT id FROM allowed_locations)
    OR EXISTS (
      SELECT 1 FROM service_locations sl JOIN allowed_locations al ON al.id = sl.organization_location_id
      WHERE sl.tenant_id = c.tenant_id AND sl.customer_id = c.id
    )
    OR (c.owning_location_id IS NULL AND (${actor.allLocations} OR ${includeChildren})
      AND c.organization_id IN (SELECT id FROM authorized_organizations))
  )`;
}

function estimateScope(actor: ReportingActor): SQL {
  return sql`(
    e.organization_location_id IN (SELECT id FROM allowed_locations)
    OR (e.organization_location_id IS NULL AND (
      EXISTS (SELECT 1 FROM customer_scope ec WHERE ec.id = e.customer_id)
      OR EXISTS (
        SELECT 1 FROM leads el WHERE el.id = e.lead_id AND el.tenant_id = e.tenant_id
          AND ${locatedScope(actor, "el", "owning_location_id", "organization_id")}
      )
    ))
  )`;
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function sum(rows_: readonly DbRow[], key: string): number {
  return rows_.reduce((total, row) => total + number(row[key]), 0);
}

function metric(key: string, label: string, value: number | string | null, change?: string) {
  return change ? { key, label, value, change } : { key, label, value };
}

function dateString(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function dateParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return dateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function zonedMidnight(date: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  let guess = Date.UTC(year!, month! - 1, day!);
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = dateParts(new Date(guess), timeZone);
    const observedLocalTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const targetLocalMidnight = Date.UTC(year!, month! - 1, day!);
    guess += targetLocalMidnight - observedLocalTime;
  }
  return new Date(guess).toISOString();
}

function makePeriod(range: ReportRange, timeZone: string, now = new Date()): Period {
  const today = dateParts(now, timeZone);
  const todayString = dateString(today.year, today.month, today.day);
  let startDate: string;
  if (range === "week") {
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    startDate = addDays(todayString, -((weekday + 6) % 7));
  } else if (range === "month") startDate = dateString(today.year, today.month, 1);
  else if (range === "quarter") startDate = dateString(today.year, Math.floor((today.month - 1) / 3) * 3 + 1, 1);
  else startDate = dateString(today.year, 1, 1);
  const endDateExclusive = addDays(todayString, 1);
  // Reports are year-to-date within each named range: earlier complete dates in the range and today.
  const startAt = zonedMidnight(startDate, timeZone);
  const endAt = zonedMidnight(endDateExclusive, timeZone);
  return { startDate, endDateExclusive, startAt, endAt, asOfDate: todayString };
}

function validTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value) return "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; }
  catch { return "UTC"; }
}

async function organizationTimeZone(actor: ReportingActor): Promise<string> {
  const [organization] = await rows(sql`SELECT timezone FROM organizations WHERE tenant_id = ${actor.tenantId} AND id = ${actor.organizationId} LIMIT 1`);
  return validTimeZone(organization?.timezone);
}

function parseType(value: string | null): ReportType {
  if (reportTypes.includes(value as ReportType)) return value as ReportType;
  throw new DomainError("VALIDATION_ERROR", "Choose a supported report type.", 422);
}

function parseRange(value: string | null): ReportRange {
  if (reportRanges.includes(value as ReportRange)) return value as ReportRange;
  throw new DomainError("VALIDATION_ERROR", "Choose week, month, quarter, or year.", 422);
}

function parseLocationId(value: string | null): string | undefined {
  if (value === null || value === "") return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new DomainError("VALIDATION_ERROR", "Choose a valid business location.", 422);
  }
  return value;
}

async function dashboard(actor: ReportingActor): Promise<Response> {
  const timeZone = await organizationTimeZone(actor);
  const todayParts = dateParts(new Date(), timeZone);
  const today = dateString(todayParts.year, todayParts.month, todayParts.day);
  const tomorrow = addDays(today, 1);
  const weekOut = addDays(today, 7);
  const scope = buildReportScopeCtes(actor);
  const customerScope = customerScopeCte(actor);
  const metrics = (await rows(sql`${scope}${customerScope}
    SELECT
      (SELECT count(*)::int FROM jobs j WHERE j.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "j", "organization_location_id", "organization_id")}
        AND j.scheduled_date = ${today}::date AND j.status <> 'canceled') AS "todaysJobs",
      (SELECT count(*)::int FROM jobs j WHERE j.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "j", "organization_location_id", "organization_id")}
        AND j.scheduled_date = ${today}::date AND j.status = 'scheduled'
        AND NOT EXISTS (SELECT 1 FROM job_assignments ja WHERE ja.tenant_id = j.tenant_id AND ja.job_id = j.id AND ja.removed_at IS NULL)) AS "unassignedJobs",
      (SELECT coalesce(sum(i.balance_minor), 0)::bigint FROM invoices i WHERE i.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "i", "organization_location_id", "organization_id")}
        AND i.status NOT IN ('draft', 'void') AND i.voided_at IS NULL AND i.balance_minor > 0) AS "openBalanceCents",
      (SELECT count(*)::int FROM customer_scope c WHERE c.status = 'active') AS "activeCustomers"`))[0] ?? {};

  const [upcoming, overdue] = await Promise.all([
    rows(sql`${scope}
      SELECT j.id, c.display_name AS "customerName", s.name AS "serviceName",
        concat_ws(', ', sl.address_line1, sl.city, sl.region) AS address,
        to_char(j.service_window_start AT TIME ZONE ${timeZone}, 'FMHH12:MI AM') AS "scheduledTime", j.status
      FROM jobs j
      JOIN customers c ON c.tenant_id = j.tenant_id AND c.id = j.customer_id
      JOIN services s ON s.tenant_id = j.tenant_id AND s.id = j.service_id
      LEFT JOIN service_locations sl ON sl.tenant_id = j.tenant_id AND sl.id = j.service_location_id
      WHERE j.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "j", "organization_location_id", "organization_id")}
        AND j.scheduled_date >= ${today}::date AND j.scheduled_date < ${weekOut}::date
        AND j.status NOT IN ('canceled', 'completed', 'skipped', 'missed')
      ORDER BY j.scheduled_date, j.service_window_start NULLS LAST, j.id LIMIT 5`),
    rows(sql`${scope}
      SELECT count(*)::int AS count, coalesce(sum(i.balance_minor), 0)::bigint AS "balanceCents"
      FROM invoices i WHERE i.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "i", "organization_location_id", "organization_id")}
        AND i.status NOT IN ('draft', 'void') AND i.voided_at IS NULL
        AND i.balance_minor > 0 AND i.due_at < ${zonedMidnight(today, timeZone)}::timestamptz`),
  ]);

  const attention: { id: string; title: string; detail: string; href: string }[] = [];
  if (number(metrics.unassignedJobs) > 0) attention.push({
    id: "unassigned-jobs", title: "Jobs need assignment",
    detail: `${number(metrics.unassignedJobs)} job${number(metrics.unassignedJobs) === 1 ? "" : "s"} scheduled today do not have a technician assigned.`, href: "/app/jobs",
  });
  if (number(overdue[0]?.count) > 0) attention.push({
    id: "overdue-invoices", title: "Overdue invoices",
    detail: `${number(overdue[0]?.count)} invoice${number(overdue[0]?.count) === 1 ? " has" : "s have"} ${formatCents(number(overdue[0]?.balanceCents))} still due.`, href: "/app/billing",
  });

  return json({ item: {
    metrics: {
      todaysJobs: number(metrics.todaysJobs), unassignedJobs: number(metrics.unassignedJobs),
      openBalanceCents: number(metrics.openBalanceCents), activeCustomers: number(metrics.activeCustomers),
    },
    attention,
    upcomingJobs: upcoming.map((job) => ({ ...job, scheduledTime: job.scheduledTime ?? "Today" })),
  } });
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
}

async function financialReport(actor: ReportingActor, period: Period, locationId?: string) {
  const scope = buildReportScopeCtes(actor, { locationId });
  const customers = customerScopeCte(actor);
  const result = await rows(sql`${scope}${customers}, invoice_totals AS (
      SELECT i.organization_location_id AS location_id,
        coalesce(sum(i.total_minor) FILTER (WHERE i.issued_at >= ${period.startAt}::timestamptz AND i.issued_at < ${period.endAt}::timestamptz), 0)::bigint AS invoiced_cents,
        coalesce(sum(i.balance_minor) FILTER (WHERE i.issued_at < ${period.endAt}::timestamptz AND i.balance_minor > 0), 0)::bigint AS outstanding_cents,
        coalesce(sum(i.balance_minor) FILTER (WHERE i.balance_minor > 0 AND (i.due_at IS NULL OR i.due_at::date >= ${period.asOfDate}::date)), 0)::bigint AS current_cents,
        coalesce(sum(i.balance_minor) FILTER (WHERE i.balance_minor > 0 AND i.due_at::date < ${period.asOfDate}::date AND ${period.asOfDate}::date - i.due_at::date BETWEEN 1 AND 30), 0)::bigint AS days_1_30_cents,
        coalesce(sum(i.balance_minor) FILTER (WHERE i.balance_minor > 0 AND ${period.asOfDate}::date - i.due_at::date BETWEEN 31 AND 60), 0)::bigint AS days_31_60_cents,
        coalesce(sum(i.balance_minor) FILTER (WHERE i.balance_minor > 0 AND ${period.asOfDate}::date - i.due_at::date BETWEEN 61 AND 90), 0)::bigint AS days_61_90_cents,
        coalesce(sum(i.balance_minor) FILTER (WHERE i.balance_minor > 0 AND ${period.asOfDate}::date - i.due_at::date > 90), 0)::bigint AS over_90_cents
      FROM invoices i WHERE i.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "i", "organization_location_id", "organization_id")}
        AND i.status NOT IN ('draft', 'void') AND i.voided_at IS NULL AND i.issued_at IS NOT NULL
      GROUP BY i.organization_location_id
    ), payment_totals AS (
      SELECT c.location_id,
        coalesce(sum(p.amount_minor) FILTER (WHERE p.status IN (${settledPaymentStatusSql}) AND p.received_at >= ${period.startAt}::timestamptz AND p.received_at < ${period.endAt}::timestamptz), 0)::bigint AS gross_collected_cents,
        count(p.id) FILTER (WHERE p.status = 'failed' AND p.created_at >= ${period.startAt}::timestamptz AND p.created_at < ${period.endAt}::timestamptz)::int AS failed_payments
      FROM customer_scope c LEFT JOIN payments p ON p.tenant_id = c.tenant_id AND p.customer_id = c.id
      GROUP BY c.location_id
    ), refund_totals AS (
      SELECT c.location_id, coalesce(sum(r.amount_minor), 0)::bigint AS refunds_cents
      FROM customer_scope c JOIN payments p ON p.tenant_id = c.tenant_id AND p.customer_id = c.id
      JOIN refunds r ON r.tenant_id = p.tenant_id AND r.payment_id = p.id
      WHERE r.status = 'succeeded' AND coalesce(r.completed_at, r.created_at) >= ${period.startAt}::timestamptz
        AND coalesce(r.completed_at, r.created_at) < ${period.endAt}::timestamptz
      GROUP BY c.location_id
    ), financial_facts AS (
      SELECT location_id, invoiced_cents, outstanding_cents, current_cents,
        days_1_30_cents, days_31_60_cents, days_61_90_cents, over_90_cents,
        0::bigint AS gross_collected_cents, 0::bigint AS refunds_cents, 0::int AS failed_payments
      FROM invoice_totals
      UNION ALL
      SELECT location_id, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
        gross_collected_cents, 0::bigint, failed_payments
      FROM payment_totals
      UNION ALL
      SELECT location_id, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
        0::bigint, refunds_cents, 0::int
      FROM refund_totals
    ), financial_totals AS (
      SELECT location_id,
        sum(invoiced_cents)::bigint AS invoiced_cents,
        sum(outstanding_cents)::bigint AS outstanding_cents,
        sum(current_cents)::bigint AS current_cents,
        sum(days_1_30_cents)::bigint AS days_1_30_cents,
        sum(days_31_60_cents)::bigint AS days_31_60_cents,
        sum(days_61_90_cents)::bigint AS days_61_90_cents,
        sum(over_90_cents)::bigint AS over_90_cents,
        sum(gross_collected_cents)::bigint AS gross_collected_cents,
        sum(refunds_cents)::bigint AS refunds_cents,
        sum(failed_payments)::int AS failed_payments
      FROM financial_facts GROUP BY location_id
    ), report_rows AS (
      SELECT ft.location_id AS "locationId", coalesce(al.name, 'Unassigned') AS "locationName",
        ft.invoiced_cents AS "invoicedCents",
        (ft.gross_collected_cents - ft.refunds_cents)::bigint AS "collectedCents",
        ft.outstanding_cents AS "outstandingCents", ft.refunds_cents AS "refundsCents",
        ft.failed_payments AS "failedPayments", ft.current_cents AS "currentCents",
        ft.days_1_30_cents AS "days1To30Cents", ft.days_31_60_cents AS "days31To60Cents",
        ft.days_61_90_cents AS "days61To90Cents", ft.over_90_cents AS "over90DaysCents"
      FROM financial_totals ft LEFT JOIN allowed_locations al ON al.id = ft.location_id
      UNION ALL
      SELECT al.id, al.name, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::int,
        0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint
      FROM allowed_locations al
      WHERE NOT EXISTS (SELECT 1 FROM financial_totals ft WHERE ft.location_id = al.id)
    )
    SELECT * FROM report_rows ORDER BY "locationName"`);
  return {
    title: "Money collected and still due",
    metrics: [
      metric("invoicedCents", "Invoiced", sum(result, "invoicedCents")),
      metric("collectedCents", "Collected after refunds", sum(result, "collectedCents")),
      metric("outstandingCents", "Open balance", sum(result, "outstandingCents")),
      metric("refundsCents", "Refunds", sum(result, "refundsCents")),
      metric("failedPayments", "Failed payments", sum(result, "failedPayments")),
    ],
    rows: result,
  };
}

async function customerReport(actor: ReportingActor, period: Period, locationId?: string) {
  const scope = buildReportScopeCtes(actor, { locationId });
  const customers = customerScopeCte(actor);
  const [customerRows, planRows, leadRows, estimateRows] = await Promise.all([
    rows(sql`${scope}${customers}
      SELECT c.location_id AS "locationId", coalesce(al.name, 'Unassigned') AS "locationName",
        count(*) FILTER (WHERE c.status = 'active')::int AS active,
        count(*) FILTER (WHERE c.status = 'paused')::int AS paused,
        count(*) FILTER (WHERE c.status = 'inactive')::int AS inactive,
        count(*) FILTER (WHERE c.created_at >= ${period.startAt}::timestamptz AND c.created_at < ${period.endAt}::timestamptz)::int AS "newCustomers",
        count(*) FILTER (WHERE c.status = 'inactive' AND c.updated_at >= ${period.startAt}::timestamptz AND c.updated_at < ${period.endAt}::timestamptz)::int AS "lostCustomers"
      FROM customer_scope c LEFT JOIN allowed_locations al ON al.id = c.location_id
      GROUP BY c.location_id, al.name ORDER BY "locationName"`),
    rows(sql`${scope}${customers}
      SELECT count(*) FILTER (WHERE sp.status = 'active')::int AS "activeRecurringPlans",
        count(*) FILTER (WHERE sp.status = 'paused')::int AS "pausedRecurringPlans",
        coalesce(sum(CASE WHEN sp.status = 'active' AND sp.pricing_snapshot->>'amountMinor' ~ '^-?[0-9]+$'
          THEN (sp.pricing_snapshot->>'amountMinor')::numeric ELSE 0 END), 0)::bigint AS "activePlanPriceCents"
      FROM service_plans sp JOIN customer_scope c ON c.tenant_id = sp.tenant_id AND c.id = sp.customer_id
      WHERE sp.tenant_id = ${actor.tenantId} AND sp.status IN ('active', 'paused')
        AND (sp.organization_location_id IN (SELECT id FROM allowed_locations)
          OR (sp.organization_location_id IS NULL AND (c.location_id IN (SELECT id FROM allowed_locations)
            OR (c.location_id IS NULL AND (${actor.allLocations} OR false) AND c.organization_id IN (SELECT id FROM authorized_organizations)))))`),
    rows(sql`${scope}
      SELECT coalesce(ls.name, 'Other / no source') AS "leadSource", count(*)::int AS "leadsCreated",
        count(*) FILTER (WHERE l.converted_at IS NOT NULL OR l.status IN ('converted', 'won'))::int AS "convertedLeads",
        count(*) FILTER (WHERE l.converted_at IS NOT NULL OR l.status IN ('converted', 'won', 'lost', 'closed_lost', 'declined'))::int AS "terminalLeads"
      FROM leads l LEFT JOIN lead_sources ls ON ls.tenant_id = l.tenant_id AND ls.id = l.source_id
      WHERE l.tenant_id = ${actor.tenantId} AND l.archived_at IS NULL
        AND ${locatedScope(actor, "l", "owning_location_id", "organization_id")}
        AND l.created_at >= ${period.startAt}::timestamptz AND l.created_at < ${period.endAt}::timestamptz
      GROUP BY ls.name ORDER BY "leadSource"`),
    rows(sql`${scope}${customers}
      SELECT count(*) FILTER (WHERE e.status IN ('sent', 'approved', 'declined'))::int AS "estimatesSent",
        count(*) FILTER (WHERE e.status = 'approved' OR e.approved_at IS NOT NULL)::int AS "estimatesApproved",
        count(*) FILTER (WHERE e.status = 'declined' OR e.declined_at IS NOT NULL)::int AS "estimatesDeclined"
      FROM estimates e WHERE e.tenant_id = ${actor.tenantId} AND ${estimateScope(actor)}
        AND e.created_at >= ${period.startAt}::timestamptz AND e.created_at < ${period.endAt}::timestamptz`),
  ]);
  const active = sum(customerRows, "active");
  const paused = sum(customerRows, "paused");
  const inactive = sum(customerRows, "inactive");
  const newCustomers = sum(customerRows, "newCustomers");
  const lostCustomers = sum(customerRows, "lostCustomers");
  const convertedLeads = sum(leadRows, "convertedLeads");
  const terminalLeads = sum(leadRows, "terminalLeads");
  const approved = number(estimateRows[0]?.estimatesApproved);
  const declined = number(estimateRows[0]?.estimatesDeclined);
  const metrics = [
    metric("active", "Active customers", active), metric("paused", "Paused customers", paused),
    metric("inactive", "Inactive customers", inactive), metric("newCustomers", "New customers", newCustomers),
    metric("lostCustomers", "Made inactive", lostCustomers), metric("netGrowth", "Net customer growth", newCustomers - lostCustomers),
    metric("activeRecurringPlans", "Active recurring plans", number(planRows[0]?.activeRecurringPlans)),
    metric("activePlanPriceCents", "Active plan price inputs", number(planRows[0]?.activePlanPriceCents)),
    metric("leadConversionRate", "Lead conversion", terminalLeads ? rounded(convertedLeads / terminalLeads * 100) : null),
    metric("estimatesSent", "Estimates sent", number(estimateRows[0]?.estimatesSent)),
    metric("estimateConversionRate", "Estimate approval rate", approved + declined ? rounded(approved / (approved + declined) * 100) : null),
  ];
  for (const source of leadRows) {
    const label = String(source.leadSource ?? "Other / no source");
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other";
    const sourceTerminal = number(source.terminalLeads);
    metrics.push(metric(`leadConversion_${key}`, `${label} lead conversion`, sourceTerminal
      ? rounded(number(source.convertedLeads) / sourceTerminal * 100) : null));
  }
  return {
    title: "Customer growth and sales follow-up",
    metrics,
    rows: customerRows,
    leadRows,
  };
}

async function jobsReport(actor: ReportingActor, period: Period, locationId?: string) {
  const scope = buildReportScopeCtes(actor, { locationId });
  const result = await rows(sql`${scope}
    SELECT j.organization_location_id AS "locationId", coalesce(al.name, 'Unassigned') AS "locationName",
      count(*)::int AS "totalJobs",
      count(*) FILTER (WHERE j.status = 'scheduled')::int AS scheduled,
      count(*) FILTER (WHERE j.status = 'completed')::int AS completed,
      count(*) FILTER (WHERE j.status = 'skipped')::int AS skipped,
      count(*) FILTER (WHERE j.status = 'missed')::int AS missed,
      count(*) FILTER (WHERE j.status = 'canceled')::int AS canceled,
      count(*) FILTER (WHERE j.status = 'needs_return')::int AS "needsReturn",
      count(*) FILTER (WHERE j.relation_type = 'reclean')::int AS "recleanJobs",
      coalesce(sum(extract(epoch FROM (j.actual_completed_at - j.actual_started_at)) / 60)
        FILTER (WHERE j.status = 'completed' AND j.actual_started_at IS NOT NULL AND j.actual_completed_at IS NOT NULL), 0)::numeric AS "serviceMinutes"
    FROM jobs j LEFT JOIN allowed_locations al ON al.id = j.organization_location_id
    WHERE j.tenant_id = ${actor.tenantId}
      AND ${locatedScope(actor, "j", "organization_location_id", "organization_id")}
      AND j.scheduled_date >= ${period.startDate}::date AND j.scheduled_date < ${period.endDateExclusive}::date
    GROUP BY j.organization_location_id, al.name ORDER BY "locationName"`);
  const totalJobs = sum(result, "totalJobs");
  const completed = sum(result, "completed");
  const skipped = sum(result, "skipped");
  const missed = sum(result, "missed");
  const canceled = sum(result, "canceled");
  const recleanJobs = sum(result, "recleanJobs");
  const serviceHours = sum(result, "serviceMinutes") / 60;
  const decidedJobs = completed + skipped + missed + canceled;
  return {
    title: "Job outcomes and recleans",
    metrics: [metric("totalJobs", "Scheduled jobs", totalJobs), metric("completed", "Completed", completed),
      metric("skipped", "Skipped", skipped), metric("missed", "Missed", missed), metric("canceled", "Canceled", canceled),
      metric("needsReturn", "Needs return visit", sum(result, "needsReturn")), metric("recleanJobs", "Reclean jobs", recleanJobs),
      metric("completionRate", "Completion rate", decidedJobs ? rounded(completed / decidedJobs * 100) : null),
      metric("serviceHours", "Actual service hours", rounded(serviceHours)),
      metric("jobsPerServiceHour", "Jobs per service hour", serviceHours ? rounded(completed / serviceHours) : null)],
    rows: result,
  };
}

async function routesReport(actor: ReportingActor, period: Period, locationId?: string) {
  const scope = buildReportScopeCtes(actor, { locationId });
  const result = await rows(sql`${scope}, scoped_routes AS (
      SELECT rp.id, rp.organization_location_id, rp.estimated_distance_meters, rp.estimated_drive_seconds, rp.estimated_service_seconds
      FROM route_plans rp JOIN memberships m ON m.tenant_id = rp.tenant_id AND m.id = rp.membership_id
      WHERE rp.tenant_id = ${actor.tenantId}
        AND m.organization_id IN (SELECT id FROM authorized_organizations)
        AND (rp.organization_location_id IN (SELECT id FROM allowed_locations)
          OR (rp.organization_location_id IS NULL AND ${actor.allLocations} AND m.organization_id = ${actor.organizationId}))
        AND rp.route_date >= ${period.startDate}::date AND rp.route_date < ${period.endDateExclusive}::date
    ), stops_by_route AS (
      SELECT rs.route_plan_id, count(*)::int AS stops,
        count(*) FILTER (WHERE rs.status = 'completed')::int AS "completedStops"
      FROM route_stops rs JOIN scoped_routes sr ON sr.id = rs.route_plan_id
      WHERE rs.tenant_id = ${actor.tenantId} GROUP BY rs.route_plan_id
    )
    SELECT sr.organization_location_id AS "locationId", coalesce(al.name, 'Unassigned') AS "locationName",
      count(*)::int AS routes,
      coalesce(sum(sr.estimated_distance_meters), 0)::numeric / 1609.344 AS "routeMiles",
      coalesce(sum(sr.estimated_drive_seconds), 0)::numeric / 3600 AS "driveHours",
      coalesce(sum(sr.estimated_service_seconds), 0)::numeric / 3600 AS "serviceHours",
      coalesce(sum(sbr.stops), 0)::int AS stops, coalesce(sum(sbr."completedStops"), 0)::int AS "completedStops"
    FROM scoped_routes sr LEFT JOIN allowed_locations al ON al.id = sr.organization_location_id
    LEFT JOIN stops_by_route sbr ON sbr.route_plan_id = sr.id
    GROUP BY sr.organization_location_id, al.name ORDER BY "locationName"`);
  const routeCount = sum(result, "routes");
  const miles = sum(result, "routeMiles");
  const driveHours = sum(result, "driveHours");
  const serviceHours = sum(result, "serviceHours");
  const stops = sum(result, "stops");
  return {
    title: "Route miles, time, and stops",
    metrics: [metric("routes", "Routes", routeCount), metric("routeMiles", "Route miles", rounded(miles)),
      metric("driveHours", "Drive hours", rounded(driveHours)), metric("serviceHours", "Service hours", rounded(serviceHours)),
      metric("stops", "Stops", stops), metric("milesPerStop", "Miles per completed stop", sum(result, "completedStops") ? rounded(miles / sum(result, "completedStops")) : null)],
    rows: result,
  };
}

function membershipScope(actor: ReportingActor, alias: string): SQL {
  const member = safeIdentifier(alias, "id");
  const org = safeIdentifier(alias, "organization_id");
  const defaultLocation = safeIdentifier(alias, "default_location_id");
  return sql`${org} IN (SELECT id FROM authorized_organizations) AND (
    (${actor.allLocations} AND ${org} = ${actor.organizationId})
    OR ${defaultLocation} IN (SELECT id FROM allowed_locations)
    OR EXISTS (SELECT 1 FROM membership_location_scopes ms
      WHERE ms.tenant_id = ${actor.tenantId} AND ms.membership_id = ${member}
        AND ms.location_id IN (SELECT id FROM allowed_locations))
  )`;
}

async function staffReport(actor: ReportingActor, period: Period, locationId?: string) {
  const scope = buildReportScopeCtes(actor, { locationId });
  const staffRows = await rows(sql`${scope}
    SELECT m.id AS "staffId", u.name AS "staffName", count(*) FILTER (WHERE j.status = 'completed')::int AS "completedJobs",
      coalesce(sum(extract(epoch FROM (j.actual_completed_at - j.actual_started_at)))
        FILTER (WHERE j.status = 'completed' AND j.actual_started_at IS NOT NULL AND j.actual_completed_at IS NOT NULL), 0)::numeric AS "serviceSeconds",
      coalesce(sum(CASE WHEN j.price_snapshot->>'amountMinor' ~ '^-?[0-9]+$' THEN (j.price_snapshot->>'amountMinor')::numeric ELSE 0 END)
        FILTER (WHERE j.status = 'completed'), 0)::bigint AS "revenueCents"
    FROM jobs j JOIN job_assignments ja ON ja.tenant_id = j.tenant_id AND ja.job_id = j.id
      AND ja.removed_at IS NULL AND ja.assignment_role = 'primary'
    JOIN memberships m ON m.tenant_id = ja.tenant_id AND m.id = ja.membership_id
    JOIN "user" u ON u.id = m.user_id
    WHERE j.tenant_id = ${actor.tenantId} AND m.organization_id IN (SELECT id FROM authorized_organizations)
      AND ${locatedScope(actor, "j", "organization_location_id", "organization_id")}
      AND j.scheduled_date >= ${period.startDate}::date AND j.scheduled_date < ${period.endDateExclusive}::date
    GROUP BY m.id, u.name ORDER BY u.name`);
  const enriched = staffRows.map((row) => {
    const completedJobs = number(row.completedJobs);
    const serviceHours = number(row.serviceSeconds) / 3600;
    const revenueCents = number(row.revenueCents);
    return { staffId: row.staffId, staffName: row.staffName, completedJobs, serviceHours: rounded(serviceHours),
      jobsPerServiceHour: serviceHours ? rounded(completedJobs / serviceHours) : null,
      revenueCents, revenuePerHourCents: serviceHours ? rounded(revenueCents / serviceHours) : null };
  });
  const totalJobs = sum(enriched, "completedJobs");
  const totalHours = sum(enriched, "serviceHours");
  const totalRevenue = sum(enriched, "revenueCents");
  const metrics = [metric("completedJobs", "Completed jobs", totalJobs), metric("serviceHours", "Actual service hours", rounded(totalHours)),
    metric("jobsPerServiceHour", "Jobs per service hour", totalHours ? rounded(totalJobs / totalHours) : null),
    metric("revenueCents", "Service revenue inputs", totalRevenue),
    metric("revenuePerHourCents", "Revenue per service hour", totalHours ? rounded(totalRevenue / totalHours) : null)];

  // Payroll figures are added only with the separate payroll-report permission.
  if (actor.permissions.has("reports.payroll_read")) {
    const payroll = (await rows(sql`${scope}, latest_calculations AS (
        SELECT DISTINCT ON (pc.payroll_period_id, pc.membership_id) pc.id, pc.tenant_id, pc.payroll_period_id,
          pc.membership_id, pc.gross_amount_minor, pc.calculation_snapshot
        FROM payroll_calculations pc
        WHERE pc.tenant_id = ${actor.tenantId}
        ORDER BY pc.payroll_period_id, pc.membership_id, pc.version DESC
      ), component_totals AS (
        SELECT pco.payroll_calculation_id,
          coalesce(sum(pco.amount_minor) FILTER (WHERE pco.component_type = 'tip'), 0)::bigint AS tips_cents
        FROM payroll_components pco WHERE pco.tenant_id = ${actor.tenantId} GROUP BY pco.payroll_calculation_id
      )
      SELECT coalesce(sum(CASE WHEN lc.calculation_snapshot->>'hours' ~ '^[0-9]+(?:\\.[0-9]+)?$'
          THEN (lc.calculation_snapshot->>'hours')::numeric ELSE 0 END), 0)::numeric AS "approvedHours",
        coalesce(sum(lc.gross_amount_minor), 0)::bigint AS "grossPayCents",
        coalesce(sum(ct.tips_cents), 0)::bigint AS "tipsCents"
      FROM latest_calculations lc
      JOIN payroll_periods pp ON pp.tenant_id = lc.tenant_id AND pp.id = lc.payroll_period_id
      JOIN memberships m ON m.tenant_id = lc.tenant_id AND m.id = lc.membership_id
      LEFT JOIN component_totals ct ON ct.payroll_calculation_id = lc.id
      WHERE pp.organization_id IN (SELECT id FROM authorized_organizations)
        AND pp.status IN ('reviewed', 'approved', 'exported')
        AND pp.period_end >= ${period.startDate}::date AND pp.period_end < ${period.endDateExclusive}::date
        AND ${membershipScope(actor, "m")}`))[0] ?? {};
    const mileage = (await rows(sql`${scope}
      SELECT coalesce(sum(mr.distance_meters), 0)::bigint AS "mileageMeters"
      FROM mileage_records mr JOIN memberships m ON m.tenant_id = mr.tenant_id AND m.id = mr.membership_id
      LEFT JOIN shifts sh ON sh.tenant_id = mr.tenant_id AND sh.id = mr.shift_id
      LEFT JOIN route_plans rp ON rp.tenant_id = mr.tenant_id AND rp.id = mr.route_plan_id
      LEFT JOIN jobs j ON j.tenant_id = mr.tenant_id AND j.id = mr.job_id
      WHERE mr.tenant_id = ${actor.tenantId} AND ${membershipScope(actor, "m")}
        AND mr.occurred_on >= ${period.startDate}::date AND mr.occurred_on < ${period.endDateExclusive}::date
        AND (coalesce(j.organization_location_id, rp.organization_location_id, sh.organization_location_id, m.default_location_id) IN (SELECT id FROM allowed_locations)
          OR (${actor.allLocations} AND m.organization_id = ${actor.organizationId}))`))[0] ?? {};
    metrics.push(metric("approvedHours", "Approved hours", rounded(number(payroll.approvedHours))),
      metric("grossPayCents", "Calculated gross pay", number(payroll.grossPayCents)),
      metric("tipsCents", "Payroll tips", number(payroll.tipsCents)),
      metric("mileageMeters", "Payroll mileage input (meters)", number(mileage.mileageMeters)));
  }
  return { title: "Technician productivity and payroll inputs", metrics, rows: enriched };
}

async function inventoryReport(actor: ReportingActor, period: Period, locationId?: string) {
  const scope = buildReportScopeCtes(actor, { locationId });
  const result = await rows(sql`${scope}, inventory_scope AS (
      SELECT il.id, il.organization_location_id, il.membership_id
      FROM inventory_locations il LEFT JOIN memberships im ON im.tenant_id = il.tenant_id AND im.id = il.membership_id
      WHERE il.tenant_id = ${actor.tenantId} AND il.active = true
        AND (il.organization_location_id IN (SELECT id FROM allowed_locations)
          OR (il.organization_location_id IS NULL AND im.organization_id IN (SELECT id FROM authorized_organizations)
            AND (im.default_location_id IN (SELECT id FROM allowed_locations)
              OR EXISTS (SELECT 1 FROM membership_location_scopes ims WHERE ims.tenant_id = im.tenant_id AND ims.membership_id = im.id AND ims.location_id IN (SELECT id FROM allowed_locations))
              OR (${actor.allLocations} AND im.organization_id = ${actor.organizationId}))))
    ), balances AS (
      SELECT sm.inventory_item_id, sm.inventory_location_id,
        coalesce(sum(CASE WHEN sm.movement_type IN ('consume', 'transfer_out', 'sell') THEN -abs(sm.quantity)
          WHEN sm.movement_type IN ('receive', 'transfer_in', 'return', 'sale_return') THEN abs(sm.quantity) ELSE sm.quantity END), 0)::numeric AS balance,
        coalesce(sum(abs(sm.quantity)) FILTER (WHERE sm.movement_type = 'consume'
          AND sm.occurred_at >= ${period.startAt}::timestamptz AND sm.occurred_at < ${period.endAt}::timestamptz), 0)::numeric AS consumed
      FROM stock_movements sm JOIN inventory_scope il ON il.id = sm.inventory_location_id
      WHERE sm.tenant_id = ${actor.tenantId} GROUP BY sm.inventory_item_id, sm.inventory_location_id
    ), thresholds AS (
      SELECT rr.inventory_item_id, rr.inventory_location_id, rr.reorder_threshold,
        coalesce(b.balance, 0) AS balance
      FROM reorder_rules rr JOIN inventory_scope il ON il.id = rr.inventory_location_id
      LEFT JOIN balances b ON b.inventory_item_id = rr.inventory_item_id AND b.inventory_location_id = rr.inventory_location_id
      WHERE rr.tenant_id = ${actor.tenantId} AND rr.active = true
    ), item_scope AS (
      SELECT DISTINCT sm.inventory_item_id AS id FROM stock_movements sm JOIN inventory_scope il ON il.id = sm.inventory_location_id
      WHERE sm.tenant_id = ${actor.tenantId}
      UNION
      SELECT DISTINCT rr.inventory_item_id AS id FROM reorder_rules rr JOIN inventory_scope il ON il.id = rr.inventory_location_id
      WHERE rr.tenant_id = ${actor.tenantId}
    ), item_totals AS (
      SELECT b.inventory_item_id, coalesce(sum(b.balance), 0)::numeric AS stock_on_hand,
        coalesce(sum(b.consumed), 0)::numeric AS used_units
      FROM balances b GROUP BY b.inventory_item_id
    ), low_stock_totals AS (
      SELECT t.inventory_item_id, count(DISTINCT t.inventory_location_id)::int AS low_stock_locations
      FROM thresholds t WHERE t.balance <= t.reorder_threshold GROUP BY t.inventory_item_id
    )
    SELECT i.id AS "itemId", i.name AS "itemName", i.unit,
      coalesce(it.stock_on_hand, 0)::numeric AS "stockOnHand",
      coalesce(it.used_units, 0)::numeric AS "usedUnits",
      coalesce(ls.low_stock_locations, 0)::int AS "lowStockLocations",
      (coalesce(ls.low_stock_locations, 0) > 0) AS "lowStock"
    FROM inventory_items i JOIN item_scope ix ON ix.id = i.id
    LEFT JOIN item_totals it ON it.inventory_item_id = i.id
    LEFT JOIN low_stock_totals ls ON ls.inventory_item_id = i.id
    WHERE i.tenant_id = ${actor.tenantId} AND i.active = true ORDER BY "itemName"`);
  return {
    title: "Stock on hand and inventory usage",
    metrics: [metric("stockOnHand", "Stock on hand (units)", rounded(sum(result, "stockOnHand"))),
      metric("usedUnits", "Used in this period (units)", rounded(sum(result, "usedUnits"))),
      metric("lowStockItems", "Items below reorder level", result.filter((row) => row.lowStock === true).length)],
    rows: result,
  };
}

async function locationsReport(actor: ReportingActor, period: Period, locationId?: string) {
  const scope = buildReportScopeCtes(actor, { rollup: true, locationId });
  const customers = customerScopeCte(actor, true);
  const result = await rows(sql`${scope}${customers}, job_totals AS (
      SELECT j.organization_location_id AS location_id, count(*)::int AS jobs,
        count(*) FILTER (WHERE j.status = 'completed')::int AS completed_jobs
      FROM jobs j WHERE j.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "j", "organization_location_id", "organization_id", true)}
        AND j.scheduled_date >= ${period.startDate}::date AND j.scheduled_date < ${period.endDateExclusive}::date
      GROUP BY j.organization_location_id
    ), invoice_totals AS (
      SELECT i.organization_location_id AS location_id, coalesce(sum(i.total_minor), 0)::bigint AS invoiced_cents
      FROM invoices i WHERE i.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "i", "organization_location_id", "organization_id", true)}
        AND i.issued_at >= ${period.startAt}::timestamptz AND i.issued_at < ${period.endAt}::timestamptz
        AND i.status NOT IN ('draft', 'void') AND i.voided_at IS NULL GROUP BY i.organization_location_id
    ), payment_totals AS (
      SELECT c.location_id, coalesce(sum(p.amount_minor) FILTER (WHERE p.status IN (${settledPaymentStatusSql})
        AND p.received_at >= ${period.startAt}::timestamptz AND p.received_at < ${period.endAt}::timestamptz), 0)::bigint AS gross_collected_cents
      FROM customer_scope c LEFT JOIN payments p ON p.tenant_id = c.tenant_id AND p.customer_id = c.id
      GROUP BY c.location_id
    ), refund_totals AS (
      SELECT c.location_id, coalesce(sum(r.amount_minor), 0)::bigint AS refunds_cents
      FROM customer_scope c JOIN payments p ON p.tenant_id = c.tenant_id AND p.customer_id = c.id
      JOIN refunds r ON r.tenant_id = p.tenant_id AND r.payment_id = p.id
      WHERE r.status = 'succeeded'
        AND coalesce(r.completed_at, r.created_at) >= ${period.startAt}::timestamptz
        AND coalesce(r.completed_at, r.created_at) < ${period.endAt}::timestamptz
      GROUP BY c.location_id
    ), customer_totals AS (
      SELECT c.location_id, count(*) FILTER (WHERE c.status = 'active')::int AS active_customers,
        count(*) FILTER (WHERE c.created_at >= ${period.startAt}::timestamptz AND c.created_at < ${period.endAt}::timestamptz)::int AS new_customers
      FROM customer_scope c GROUP BY c.location_id
    )
    SELECT al.id AS "locationId", al.name AS "locationName",
      coalesce(jt.jobs, 0)::int AS jobs, coalesce(jt.completed_jobs, 0)::int AS "completedJobs",
      coalesce(it.invoiced_cents, 0)::bigint AS "invoicedCents",
      (coalesce(pt.gross_collected_cents, 0) - coalesce(rt.refunds_cents, 0))::bigint AS "collectedCents",
      coalesce(ct.active_customers, 0)::int AS "activeCustomers", coalesce(ct.new_customers, 0)::int AS "newCustomers"
    FROM allowed_locations al
    LEFT JOIN job_totals jt ON jt.location_id = al.id
    LEFT JOIN invoice_totals it ON it.location_id = al.id
    LEFT JOIN payment_totals pt ON pt.location_id = al.id
    LEFT JOIN refund_totals rt ON rt.location_id = al.id
    LEFT JOIN customer_totals ct ON ct.location_id = al.id
    ORDER BY al.name`);
  return {
    title: "Authorized location rollup",
    metrics: [metric("jobs", "Jobs", sum(result, "jobs")), metric("completedJobs", "Completed jobs", sum(result, "completedJobs")),
      metric("invoicedCents", "Invoiced", sum(result, "invoicedCents")), metric("collectedCents", "Collected", sum(result, "collectedCents")),
      metric("activeCustomers", "Active customers", sum(result, "activeCustomers")), metric("newCustomers", "New customers", sum(result, "newCustomers"))],
    rows: result,
  };
}

async function report(actor: ReportingActor, type: ReportType, period: Period, locationId?: string) {
  switch (type) {
    case "financial": return financialReport(actor, period, locationId);
    case "customers": return customerReport(actor, period, locationId);
    case "jobs": return jobsReport(actor, period, locationId);
    case "routes": return routesReport(actor, period, locationId);
    case "staff": return staffReport(actor, period, locationId);
    case "inventory": return inventoryReport(actor, period, locationId);
    case "locations": return locationsReport(actor, period, locationId);
  }
}

const exportColumns: Record<ReportType, readonly { key: string; label: string }[]> = {
  financial: [{ key: "locationName", label: "Location" }, { key: "invoicedCents", label: "Invoiced cents" }, { key: "collectedCents", label: "Collected cents" }, { key: "outstandingCents", label: "Outstanding cents" }, { key: "refundsCents", label: "Refunds cents" }, { key: "failedPayments", label: "Failed payments" }],
  customers: [{ key: "locationName", label: "Location" }, { key: "active", label: "Active" }, { key: "paused", label: "Paused" }, { key: "inactive", label: "Inactive" }, { key: "newCustomers", label: "New customers" }, { key: "lostCustomers", label: "Made inactive" }],
  jobs: [{ key: "locationName", label: "Location" }, { key: "totalJobs", label: "Jobs" }, { key: "completed", label: "Completed" }, { key: "skipped", label: "Skipped" }, { key: "missed", label: "Missed" }, { key: "canceled", label: "Canceled" }, { key: "needsReturn", label: "Needs return" }, { key: "recleanJobs", label: "Reclean jobs" }],
  routes: [{ key: "locationName", label: "Location" }, { key: "routes", label: "Routes" }, { key: "routeMiles", label: "Route miles" }, { key: "driveHours", label: "Drive hours" }, { key: "serviceHours", label: "Service hours" }, { key: "stops", label: "Stops" }],
  staff: [{ key: "staffName", label: "Staff member" }, { key: "completedJobs", label: "Completed jobs" }, { key: "serviceHours", label: "Service hours" }, { key: "jobsPerServiceHour", label: "Jobs per service hour" }, { key: "revenueCents", label: "Revenue cents" }, { key: "revenuePerHourCents", label: "Revenue per hour cents" }],
  inventory: [{ key: "itemName", label: "Item" }, { key: "unit", label: "Unit" }, { key: "stockOnHand", label: "Stock on hand" }, { key: "usedUnits", label: "Used units" }, { key: "lowStockLocations", label: "Low stock locations" }],
  locations: [{ key: "locationName", label: "Location" }, { key: "jobs", label: "Jobs" }, { key: "completedJobs", label: "Completed jobs" }, { key: "invoicedCents", label: "Invoiced cents" }, { key: "collectedCents", label: "Collected cents" }, { key: "activeCustomers", label: "Active customers" }, { key: "newCustomers", label: "New customers" }],
};

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[\u0000-\u0020]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function reportRowsToCsv(data: readonly Record<string, unknown>[], columns: readonly { key: string; label: string }[]): string {
  return [columns.map((column) => csvCell(column.label)).join(","),
    ...data.map((row) => columns.map((column) => csvCell(row[column.key])).join(","))].join("\r\n");
}

async function handleReportRequest(request: Request, actor: SessionActor, isExport: boolean): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const type = parseType(params.get("type"));
  const range = parseRange(params.get("range") ?? "month");
  const locationId = parseLocationId(params.get("locationId"));
  const scopedActor = authorize(actor, [...reportPermissions(type), ...(isExport ? ["reports.export" as const] : [])]);
  const timeZone = await organizationTimeZone(scopedActor);
  const data = await report(scopedActor, type, makePeriod(range, timeZone), locationId);
  if (!isExport) return json({ item: { title: data.title, metrics: data.metrics, rows: data.rows } });
  const rowsForExport = data.rows.slice(0, csvRowLimit);
  const columns = rowsForExport[0]
    ? Object.keys(rowsForExport[0]).map((key) => ({ key, label: key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()) }))
    : exportColumns[type];
  const truncated = data.rows.length > csvRowLimit;
  return new Response(reportRowsToCsv(rowsForExport, columns), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${type}-report.csv"`,
      "cache-control": "no-store",
      ...(truncated ? { "x-report-truncated": "true", "x-report-row-limit": String(csvRowLimit) } : {}),
    },
  });
}

export async function handleReporting(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length === 1 && path[0] === "dashboard") {
    if (request.method !== "GET") return null;
    const scopedActor = authorize(actor, ["reports.operational_read", "reports.financial_read"]);
    return dashboard(scopedActor);
  }
  if (path[0] !== "reports" || (path.length !== 1 && !(path.length === 2 && path[1] === "export"))) return null;
  if (request.method !== "GET") return null;
  return handleReportRequest(request, actor, path[1] === "export");
}
