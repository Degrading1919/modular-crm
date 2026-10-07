import { sql, type SQL } from "drizzle-orm";
import { DomainError, requirePermission, settledPaymentStatuses } from "@modular-crm/domain";
import { rows, uuidArray, type DbRow } from "./sql";
import { requireStaff, type SessionActor } from "./actor";
import { json } from "./http";
import { businessTimeZone, invoiceOverpayment, jobBusinessDate, openInvoiceBalance, upcomingJob } from "./read-facts";
import { reportColumns, reportValue } from "../presentation";

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
    ), scope_options AS (select ${locationId}::uuid is null as include_unassigned)`;
}

function locatedScope(actor: ReportingActor, alias: string, locationColumn: string, organizationColumn: string, includeChildren = false): SQL {
  const location = safeIdentifier(alias, locationColumn);
  const organization = safeIdentifier(alias, organizationColumn);
  return sql`${organization} IN (SELECT id FROM authorized_organizations)
    AND (
      ${location} IN (SELECT id FROM allowed_locations)
      OR (${location} IS NULL AND (select include_unassigned from scope_options) AND ${actor.allLocations} AND ${organization} = ${actor.organizationId})
      OR (${location} IS NULL AND (select include_unassigned from scope_options) AND ${includeChildren} AND ${organization} IN (SELECT id FROM authorized_organizations))
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
        OR (c.owning_location_id IS NULL AND (select include_unassigned from scope_options) AND (${actor.allLocations} OR ${includeChildren})
          AND c.organization_id IN (SELECT id FROM authorized_organizations))
      )
  )`;
}

/** A whole receipt/refund is visible only when every allocated invoice is in scope.
 * Refunds have no invoice allocation: cross-location receipts remain Unassigned,
 * rather than inventing a proportional allocation or using a customer's home. */
function paymentScopeCte(actor: ReportingActor, includeChildren = false): SQL {
  return sql`, payment_scope AS (
    select p.*, case when allocation.invoice_count=0 then c.owning_location_id
      when allocation.location_count=1 and not allocation.has_unassigned then allocation.location_id else null end as location_id
    from payments p join customers c on c.id=p.customer_id and c.tenant_id=p.tenant_id
    cross join lateral (
      select count(*) as invoice_count, count(distinct i.organization_location_id) as location_count,
        min(i.organization_location_id::text)::uuid as location_id,
        bool_or(i.organization_location_id is null) as has_unassigned
      from payment_allocations pa join invoices i on i.tenant_id=pa.tenant_id and i.id=pa.invoice_id
      where pa.tenant_id=p.tenant_id and pa.payment_id=p.id
    ) allocation
    where p.tenant_id=${actor.tenantId} and c.organization_id in (select id from authorized_organizations)
      and not exists (select 1 from payment_allocations pa
        left join invoices i on i.tenant_id=pa.tenant_id and i.id=pa.invoice_id
        where pa.tenant_id=p.tenant_id and pa.payment_id=p.id
          and (i.id is null or i.customer_id<>p.customer_id
            or not (${locatedScope(actor, "i", "organization_location_id", "organization_id", includeChildren)})))
      and (allocation.invoice_count>0 or (${locatedScope(actor, "c", "owning_location_id", "organization_id", includeChildren)}))
  )`;
}

async function presentationScope(actor: ReportingActor, options: { rollup?: boolean; locationId?: string } = {}) {
  const locations = await rows(sql`${buildReportScopeCtes(actor, options)} select name from allowed_locations order by name`);
  return { label: locations.length ? locations.map((location) => String(location.name)).join(", ") : "No accessible business locations",
    includesUnassigned: actor.allLocations && !options.locationId,
    includesCrossLocationReceipts: locations.length > 1 && !options.locationId };
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
  const scope = buildReportScopeCtes(actor);
  const customerScope = customerScopeCte(actor);
  const metrics = (await rows(sql`${scope}${customerScope}
    SELECT
      (SELECT count(*)::int FROM jobs j WHERE j.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "j", "organization_location_id", "organization_id")}
        AND j.scheduled_date = ${jobBusinessDate()} AND j.status NOT IN ('draft','unscheduled','canceled')) AS "todaysJobs",
      (SELECT count(*)::int FROM jobs j WHERE j.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "j", "organization_location_id", "organization_id")}
        AND j.scheduled_date = ${jobBusinessDate()} AND j.status = 'scheduled'
        AND NOT EXISTS (SELECT 1 FROM job_assignments ja WHERE ja.tenant_id = j.tenant_id AND ja.job_id = j.id AND ja.removed_at IS NULL)) AS "unassignedJobs",
      (SELECT coalesce(sum(${openInvoiceBalance()}), 0)::bigint FROM invoices i WHERE i.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "i", "organization_location_id", "organization_id")}
        ) AS "openBalanceCents",
      (SELECT count(*)::int FROM customer_scope c WHERE c.status = 'active') AS "activeCustomers"`))[0] ?? {};

  const [upcoming, overdue] = await Promise.all([
    rows(sql`${scope}
      SELECT j.id, j.scheduled_date AS "scheduledDate", c.display_name AS "customerName", s.name AS "serviceName",
        concat_ws(', ', sl.address_line1, sl.city, sl.region) AS address,
        to_char(j.service_window_start AT TIME ZONE ${businessTimeZone()}, 'FMHH12:MI AM') AS "scheduledTime", j.status
      FROM jobs j
      JOIN customers c ON c.tenant_id = j.tenant_id AND c.id = j.customer_id
      JOIN services s ON s.tenant_id = j.tenant_id AND s.id = j.service_id
      LEFT JOIN service_locations sl ON sl.tenant_id = j.tenant_id AND sl.id = j.service_location_id
      WHERE j.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "j", "organization_location_id", "organization_id")}
        AND ${upcomingJob()} AND j.scheduled_date < ${jobBusinessDate()} + 7
      ORDER BY j.scheduled_date, j.service_window_start NULLS LAST, j.id LIMIT 5`),
    rows(sql`${scope}
      SELECT i.currency, count(*)::int AS count, coalesce(sum(i.balance_minor), 0)::bigint AS "balanceCents"
      FROM invoices i WHERE i.tenant_id = ${actor.tenantId}
        AND ${locatedScope(actor, "i", "organization_location_id", "organization_id")}
        AND ${openInvoiceBalance()} > 0 AND (i.due_at at time zone ${businessTimeZone("i")})::date < ${jobBusinessDate("i")}
      GROUP BY i.currency`),
  ]);

  const attention: { id: string; title: string; detail: string; href: string }[] = [];
  if (actor.permissions.has("invoices.read")) {
    const extra = await rows(sql`${scope} select i.id,i.invoice_number,i.currency,${invoiceOverpayment()} as extra
      from invoices i where i.tenant_id=${actor.tenantId} and ${locatedScope(actor, "i", "organization_location_id", "organization_id")}
      and ${invoiceOverpayment()} > 0 order by i.created_at,i.id limit 5`);
    for (const invoice of extra) attention.push({ id: `overpayment-${String(invoice.id)}`, title: "Extra payment needs attention",
      detail: `Invoice ${String(invoice.invoice_number)} has ${formatCents(number(invoice.extra), String(invoice.currency))} extra. Review and refund the extra amount.`, href: `/app/invoices/${String(invoice.id)}#invoice-refund` });
  }
  if (actor.role === "owner" && actor.permissions.has("connectors.read")) {
    const [account] = await rows(sql`select a.id from online_payment_accounts a
      join connector_installations c on c.tenant_id=a.tenant_id and c.id=a.installation_id
      where a.tenant_id=${actor.tenantId} and a.organization_id=${actor.organizationId} and c.status <> 'not_connected'
      and a.provider='stripe-online-payments' and a.account_hash is not null and (a.charges_enabled=false or a.details_needed=true) limit 1`);
    if (account) attention.push({ id: "payment-account-attention", title: "Stripe needs attention", detail: "Review your payment setup to keep accepting online payments.", href: "/app/connections" });
  }
  if (actor.role === "owner" && actor.permissions.has("tenant.update")) {
    const [blocked] = await rows(sql`${scope} SELECT l.id, l.name FROM organization_locations l
      WHERE l.tenant_id=${actor.tenantId} AND l.id IN (SELECT id FROM allowed_locations)
        AND (l.address_line1 IS NULL OR btrim(l.address_line1)='')
        AND EXISTS (SELECT 1 FROM outbound_messages m LEFT JOIN customers c ON c.id=m.customer_id AND c.tenant_id=m.tenant_id
          LEFT JOIN jobs j ON j.id=m.job_id AND j.tenant_id=m.tenant_id
          WHERE m.tenant_id=l.tenant_id AND m.failure_code='business_details_missing'
            AND coalesce(j.organization_location_id,c.owning_location_id)=l.id)
      ORDER BY l.name,l.id LIMIT 1`);
    if (blocked) attention.push({ id: "marketing-business-address", title: "Add your business address",
      detail: `Promotional emails for ${String(blocked.name)} need a business address. Service updates can still send.`,
      href: `/app/settings?locationId=${encodeURIComponent(String(blocked.id))}` });
  }
  if (number(metrics.unassignedJobs) > 0) attention.push({
    id: "unassigned-jobs", title: "Jobs need assignment",
    detail: `${number(metrics.unassignedJobs)} job${number(metrics.unassignedJobs) === 1 ? "" : "s"} scheduled today do not have a technician assigned.`, href: "/app/jobs",
  });
  if (sum(overdue, "count") > 0) attention.push({
    id: "overdue-invoices", title: "Overdue invoices",
    detail: `${sum(overdue, "count")} invoice${sum(overdue, "count") === 1 ? " has" : "s have"} ${overdue.map((row) => formatCents(number(row.balanceCents), String(row.currency))).join(" · ")} still due.`, href: "/app/billing",
  });

  const balances = (await rows(sql`${scope} select i.currency, sum(${openInvoiceBalance()})::bigint as cents from invoices i
    where i.tenant_id=${actor.tenantId} and ${locatedScope(actor, "i", "organization_location_id", "organization_id")}
    group by i.currency`)).map((balance) => ({ currency: balance.currency, cents: number(balance.cents) }));
  return json({ item: {
    metrics: {
      todaysJobs: number(metrics.todaysJobs), unassignedJobs: number(metrics.unassignedJobs),
      openBalanceCents: balances.length > 1 ? null : number(metrics.openBalanceCents), activeCustomers: number(metrics.activeCustomers),
    },
    attention,
    upcomingJobs: upcoming,
    scope: await presentationScope(actor),
    balances,
  } });
}

function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
}

async function financialReport(actor: ReportingActor, period: Period, locationId?: string, rollup = false) {
  const scope = buildReportScopeCtes(actor, { locationId, rollup });
  const result = await rows(sql`${scope}${paymentScopeCte(actor, rollup)}, invoice_facts AS (
    select i.*, ${openInvoiceBalance()} as open_balance,
      (i.due_at at time zone coalesce(l.timezone,o.timezone,'UTC'))::date as due_date,
      (current_timestamp at time zone coalesce(l.timezone,o.timezone,'UTC'))::date as today
    from invoices i
    join organizations o on o.tenant_id=i.tenant_id and o.id=i.organization_id
    left join organization_locations l on l.tenant_id=i.tenant_id and l.id=i.organization_location_id
    where i.tenant_id=${actor.tenantId} and ${locatedScope(actor, "i", "organization_location_id", "organization_id", rollup)}
      and i.status not in ('draft','void') and i.voided_at is null and i.issued_at is not null
  ), financial_facts AS (
    select organization_location_id as location_id, currency,
      case when issued_at>=${period.startAt}::timestamptz and issued_at<${period.endAt}::timestamptz then total_minor else 0 end as invoiced_cents,
      open_balance as outstanding_cents, 0::bigint as gross_collected_cents, 0::bigint as refunds_cents, 0 as failed_payments,
      case when due_date is null or due_date>=today then open_balance else 0 end as current_cents,
      case when today-due_date between 1 and 30 then open_balance else 0 end as days_1_30_cents,
      case when today-due_date between 31 and 60 then open_balance else 0 end as days_31_60_cents,
      case when today-due_date between 61 and 90 then open_balance else 0 end as days_61_90_cents,
      case when today-due_date>90 then open_balance else 0 end as over_90_cents
    from invoice_facts
    union all
    select p.location_id,p.currency,0,0,p.amount_minor,0,0,0,0,0,0,0 from payment_scope p
      where p.status in (${settledPaymentStatusSql}) and p.received_at>=${period.startAt}::timestamptz and p.received_at<${period.endAt}::timestamptz
    union all
    select p.location_id,r.currency,0,0,0,r.amount_minor,0,0,0,0,0,0 from payment_scope p
      join refunds r on r.tenant_id=p.tenant_id and r.payment_id=p.id
      where r.status='succeeded' and coalesce(r.completed_at,r.created_at)>=${period.startAt}::timestamptz
        and coalesce(r.completed_at,r.created_at)<${period.endAt}::timestamptz
    union all
    select p.location_id,p.currency,0,0,0,0,1,0,0,0,0,0 from payment_scope p
      where p.status='failed' and p.created_at>=${period.startAt}::timestamptz and p.created_at<${period.endAt}::timestamptz
    union all
    select al.id,t.default_currency,0,0,0,0,0,0,0,0,0,0 from allowed_locations al
      join tenants t on t.id=${actor.tenantId}
  )
  select f.location_id as "locationId", coalesce(al.name,'Unassigned') as "locationName", f.currency,
    sum(invoiced_cents)::bigint as "invoicedCents", sum(outstanding_cents)::bigint as "outstandingCents",
    (sum(gross_collected_cents)-sum(refunds_cents))::bigint as "collectedCents",
    sum(refunds_cents)::bigint as "refundsCents", sum(failed_payments)::int as "failedPayments",
    sum(current_cents)::bigint as "currentCents", sum(days_1_30_cents)::bigint as "days1To30Cents",
    sum(days_31_60_cents)::bigint as "days31To60Cents", sum(days_61_90_cents)::bigint as "days61To90Cents",
    sum(over_90_cents)::bigint as "over90DaysCents"
  from financial_facts f left join allowed_locations al on al.id=f.location_id
  group by f.location_id,al.name,f.currency order by "locationName",f.currency`);
  const currencies = [...new Set(result.map((row) => String(row.currency)))];
  return {
    title: "Money collected and still due",
    metrics: [...currencies.flatMap((currency) => {
      const currencyRows = result.filter((row) => row.currency === currency);
      return [
        metric("invoicedCents", "Invoiced", sum(currencyRows, "invoicedCents")),
        metric("collectedCents", "Collected after refunds", sum(currencyRows, "collectedCents")),
        metric("outstandingCents", "Open balance", sum(currencyRows, "outstandingCents"), "Current unpaid issued invoices"),
        metric("refundsCents", "Refunds", sum(currencyRows, "refundsCents")),
      ].map((entry) => ({ ...entry, currency, label: currencies.length>1 ? `${entry.label} (${currency})` : entry.label }));
    }), metric("failedPayments", "Failed payments", sum(result, "failedPayments"))],
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
        case when count(*) filter (where sp.status='active' and
          (coalesce(sp.pricing_snapshot->>'amountMinor','') !~ '^[0-9]+$' or sp.pricing_snapshot->>'currency' is null))>0
          or count(distinct sp.pricing_snapshot->>'currency') filter (where sp.status='active')>1 then null
          else coalesce(sum(CASE WHEN sp.status = 'active' AND sp.pricing_snapshot->>'amountMinor' ~ '^[0-9]+$'
            THEN (sp.pricing_snapshot->>'amountMinor')::numeric ELSE 0 END), 0)::bigint end AS "activePlanPriceCents",
        min(sp.pricing_snapshot->>'currency') filter (where sp.status='active') as currency
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
    metric("active", "Active customers", active, "Current status"), metric("paused", "Paused customers", paused, "Current status"),
    metric("inactive", "Inactive customers", inactive, "Current status"), metric("newCustomers", "New customers", newCustomers),
    metric("lostCustomers", "Made inactive", lostCustomers), metric("netGrowth", "Net customer growth", newCustomers - lostCustomers),
    metric("activeRecurringPlans", "Active recurring plans", number(planRows[0]?.activeRecurringPlans), "Current active plans"),
    { ...metric("activePlanPriceCents", "Active plan price inputs", planRows[0]?.activePlanPriceCents == null ? null : number(planRows[0]?.activePlanPriceCents),
      planRows[0]?.activePlanPriceCents == null ? "Missing prices or more than one currency" : "Current prices, not invoiced revenue"), currency: String(planRows[0]?.currency ?? "USD") },
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
    (${actor.allLocations} AND (select include_unassigned from scope_options) AND ${org} = ${actor.organizationId})
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
      case when count(*) filter (where j.status='completed' and
        (coalesce(j.price_snapshot->>'amountMinor','') !~ '^[0-9]+$' or j.price_snapshot->>'currency' is null))>0
        or count(distinct j.price_snapshot->>'currency') filter (where j.status='completed')>1 then null
        else coalesce(sum(CASE WHEN j.price_snapshot->>'amountMinor' ~ '^[0-9]+$' THEN (j.price_snapshot->>'amountMinor')::numeric ELSE 0 END)
          FILTER (WHERE j.status = 'completed'), 0)::bigint end AS "revenueCents",
      min(j.price_snapshot->>'currency') filter (where j.status='completed') as currency
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
    const revenueCents = row.revenueCents == null ? null : number(row.revenueCents);
    return { staffId: row.staffId, staffName: row.staffName, completedJobs, serviceHours: rounded(serviceHours),
      jobsPerServiceHour: serviceHours ? rounded(completedJobs / serviceHours) : null,
      currency: row.currency, revenueCents, revenuePerHourCents: serviceHours && revenueCents !== null ? rounded(revenueCents / serviceHours) : null };
  });
  const totalJobs = sum(enriched, "completedJobs");
  const totalHours = sum(enriched, "serviceHours");
  const currencies = [...new Set(enriched.map((row) => row.currency).filter(Boolean))];
  const totalRevenue = enriched.some((row) => row.revenueCents === null) || currencies.length > 1 ? null : sum(enriched, "revenueCents");
  const metrics = [metric("completedJobs", "Completed jobs", totalJobs), metric("serviceHours", "Actual service hours", rounded(totalHours)),
    metric("jobsPerServiceHour", "Jobs per service hour", totalHours ? rounded(totalJobs / totalHours) : null),
    { ...metric("revenueCents", "Service price inputs", totalRevenue, totalRevenue === null ? "Missing prices or more than one currency" : "Job prices, not invoiced revenue"), currency: String(currencies[0] ?? "USD") },
    { ...metric("revenuePerHourCents", "Price inputs per service hour", totalHours && totalRevenue !== null ? rounded(totalRevenue / totalHours) : null), currency: String(currencies[0] ?? "USD") }];

  // Payroll figures are added only with the separate payroll-report permission.
  if (actor.permissions.has("reports.payroll_read")) {
    const payroll = (await rows(sql`${scope}, latest_calculations AS (
        SELECT DISTINCT ON (pc.payroll_period_id, pc.membership_id) pc.id, pc.tenant_id, pc.payroll_period_id,
          pc.membership_id, pc.gross_amount_minor, pc.currency, pc.calculation_snapshot
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
        case when count(distinct lc.currency)>1 then null else coalesce(sum(lc.gross_amount_minor), 0)::bigint end AS "grossPayCents",
        case when count(distinct lc.currency)>1 then null else coalesce(sum(ct.tips_cents), 0)::bigint end AS "tipsCents",
        min(lc.currency) as currency
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
      { ...metric("grossPayCents", "Calculated gross pay", payroll.grossPayCents == null ? null : number(payroll.grossPayCents), payroll.grossPayCents == null ? "More than one currency; see Pay & time" : "Reviewed or approved payroll in this period"), currency: String(payroll.currency ?? "USD") },
      { ...metric("tipsCents", "Payroll tips", payroll.tipsCents == null ? null : number(payroll.tipsCents)), currency: String(payroll.currency ?? "USD") },
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
    ), customer_totals AS (
      SELECT c.location_id, count(*) FILTER (WHERE c.status = 'active')::int AS active_customers,
        count(*) FILTER (WHERE c.created_at >= ${period.startAt}::timestamptz AND c.created_at < ${period.endAt}::timestamptz)::int AS new_customers
      FROM customer_scope c GROUP BY c.location_id
    )
    SELECT al.id AS "locationId", al.name AS "locationName",
      coalesce(jt.jobs, 0)::int AS jobs, coalesce(jt.completed_jobs, 0)::int AS "completedJobs",
      coalesce(ct.active_customers, 0)::int AS "activeCustomers", coalesce(ct.new_customers, 0)::int AS "newCustomers"
    FROM allowed_locations al
    LEFT JOIN job_totals jt ON jt.location_id = al.id
    LEFT JOIN customer_totals ct ON ct.location_id = al.id
    ORDER BY al.name`);
  const financial = await financialReport(actor, period, locationId, true);
  return {
    title: "Authorized location rollup",
    metrics: [metric("jobs", "Jobs", sum(result, "jobs")), metric("completedJobs", "Completed jobs", sum(result, "completedJobs")),
      ...financial.metrics.filter((entry) => ["invoicedCents", "collectedCents"].includes(entry.key)),
      metric("activeCustomers", "Active customers", sum(result, "activeCustomers")), metric("newCustomers", "New customers", sum(result, "newCustomers"))],
    rows: financial.rows.map((row, index) => {
      const location = result.find((entry) => entry.locationId === row.locationId);
      const repeatedLocation = financial.rows.slice(0, index).some((entry) => entry.locationId === row.locationId);
      return { locationId: row.locationId, locationName: row.locationName, currency: row.currency,
        jobs: repeatedLocation ? null : location?.jobs ?? null, completedJobs: repeatedLocation ? null : location?.completedJobs ?? null,
        activeCustomers: repeatedLocation ? null : location?.activeCustomers ?? null, newCustomers: repeatedLocation ? null : location?.newCustomers ?? null,
        invoicedCents: row.invoicedCents, collectedCents: row.collectedCents };
    }),
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
  if (!isExport) return json({ item: { title: data.title, metrics: data.metrics, rows: data.rows,
    scope: await presentationScope(scopedActor, { locationId, rollup: type === "locations" }), timeZone } });
  const rowsForExport = data.rows.slice(0, csvRowLimit);
  const columns = rowsForExport[0]
    ? reportColumns(rowsForExport[0])
    : exportColumns[type].map((column) => ({ ...column, label: reportColumns({ [column.key]: null })[0]!.label }));
  const truncated = data.rows.length > csvRowLimit;
  const presentedRows = rowsForExport.map((row: DbRow) => Object.fromEntries(columns.map(({ key }) => [key,
    /Cents$/.test(key) ? row[key] == null ? "" : reportValue(key, row[key], String(row.currency ?? "USD")) : row[key],
  ])));
  return new Response(reportRowsToCsv(presentedRows, columns), {
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
