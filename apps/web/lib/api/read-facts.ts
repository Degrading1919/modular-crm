import { sql, type SQL } from "drizzle-orm";

// Callers still supply tenant/object/location authorization. These predicates
// describe facts, not access grants or recurrence predictions.
export function businessTimeZone(alias = "j"): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error("Invalid job alias.");
  const j = sql.raw(alias);
  return sql`coalesce(
    (select l.timezone from organization_locations l where l.tenant_id=${j}.tenant_id and l.id=${j}.organization_location_id),
    (select o.timezone from organizations o where o.tenant_id=${j}.tenant_id and o.id=${j}.organization_id),
    (select t.default_timezone from tenants t where t.id=${j}.tenant_id), 'UTC')`;
}

export function jobBusinessDate(alias = "j", instant: SQL = sql`current_timestamp`): SQL {
  return sql`(${instant} at time zone ${businessTimeZone(alias)})::date`;
}

export function upcomingJob(alias = "j", instant?: SQL): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error("Invalid job alias.");
  const j = sql.raw(alias);
  return sql`${j}.scheduled_date >= ${jobBusinessDate(alias, instant)}
    and ${j}.status in ('scheduled','dispatched','en_route','in_progress','paused')`;
}

export function openInvoiceBalance(alias = "i"): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error("Invalid invoice alias.");
  const i = sql.raw(alias);
  return sql`case when ${i}.status in ('issued','partially_paid','overdue')
    and ${i}.issued_at is not null and ${i}.voided_at is null and ${i}.written_off_at is null
    then ${i}.balance_minor else 0 end`;
}

/** Net received funds plus applied credits beyond the invoice's collectible value. */
export function invoiceOverpayment(alias = "i"): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error("Invalid invoice alias.");
  const i = sql.raw(alias);
  return sql`greatest(${i}.paid_minor
    - coalesce((select sum(r.amount_minor) from refunds r join payment_allocations pa on pa.tenant_id=r.tenant_id and pa.payment_id=r.payment_id
        where pa.tenant_id=${i}.tenant_id and pa.invoice_id=${i}.id and r.status='succeeded'),0)
    - greatest((case when ${i}.status in ('void','written_off') or ${i}.voided_at is not null or ${i}.written_off_at is not null then 0 else ${i}.total_minor end)
        - coalesce((select sum(ca.amount_minor) from credit_allocations ca where ca.tenant_id=${i}.tenant_id and ca.invoice_id=${i}.id),0),0),0)`;
}
