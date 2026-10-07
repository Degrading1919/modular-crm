import { sql } from "drizzle-orm";
import { handleRecords } from "./records";
import { handlePaymentReads } from "./payment-reads";
import { handleInvoiceRefund } from "./refunds";
import { requireStaff, type SessionActor } from "./actor";
import { json } from "./http";
import { normalized, rows, uuidArray } from "./sql";

const names: Record<string, string> = {
  reminder_sent: "Unpaid invoice reminder sent",
  created: "Record created", updated: "Details updated", converted: "Converted to a customer", contacted: "Contacted", qualified: "Qualified", quoted: "Quote prepared",
  assigned: "Technician assigned", rescheduled: "Visit rescheduled", schedule_changed: "Schedule updated", dispatched: "Added to a published route", en_route: "Technician on the way", in_progress: "Work started", paused: "Work paused", completed: "Work completed", skipped: "Visit skipped", missed: "Visit missed", canceled: "Job canceled", needs_return: "Return visit needed",
  issued: "Invoice issued", paid: "Payment recorded", partially_paid: "Partial payment recorded", refunded: "Refund recorded", refund_review_resolved: "Refund review resolved", void: "Invoice voided", overdue: "Invoice overdue", lost: "Lead closed", disqualified: "Lead closed",
};

/** Explicit related sections; every linkable object retains its own permission/scope. */
export async function handleRecordDetails(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  const [resource, id, action] = path;
  if (request.method !== "GET" || path.length !== 3 || action !== "detail" || !id || !["customers", "jobs", "invoices", "leads"].includes(resource ?? "")) return null;
  requireStaff(actor);
  const response = await handleRecords(request, [resource!, id], actor);
  const { item } = await response!.json() as { item: Record<string, unknown> };
  // Raw PostgreSQL reads return timestamps as SQL strings; write-side ORM reads
  // use Date. Expose the same ISO/millisecond revision token on both backends.
  if (typeof item.updatedAt === "string") item.updatedAt = new Date(item.updatedAt).toISOString();
  const tenant = actor.tenantId;
  const scope = (column: string) => actor.allLocations ? sql`true` : sql`${sql.raw(column)} = any(${uuidArray(actor.locationIds)})`;
  const related: Record<string, unknown> = {};
  if (resource === "customers") {
    if (actor.permissions.has("jobs.read")) related.jobs = normalized(await rows(sql`select j.id,j.status,j.scheduled_date,s.name as service_name from jobs j join services s on s.tenant_id=j.tenant_id and s.id=j.service_id where j.tenant_id=${tenant} and j.customer_id=${id} and ${scope("j.organization_location_id")} order by j.scheduled_date desc nulls last,j.id limit 100`));
    if (actor.permissions.has("invoices.read")) related.invoices = normalized(await rows(sql`select id,invoice_number as number,status,currency,total_minor as total_cents,balance_minor as balance_cents from invoices where tenant_id=${tenant} and customer_id=${id} and ${scope("organization_location_id")} order by created_at desc,id limit 100`));
    if (actor.permissions.has("payments.read")) {
      const url = new URL(request.url); url.searchParams.set("customerId", id);
      const paymentResponse = await handlePaymentReads(new Request(url), ["payments"], actor);
      related.payments = (await paymentResponse!.json()).items;
    }
  }
  if (resource === "jobs") {
    related.visits = normalized(await rows(sql`select id,status,starts_at,ends_at,window_start,window_end,timezone from appointments where tenant_id=${tenant} and job_id=${id} order by created_at desc,id limit 100`));
    related.routeHistory = actor.permissions.has("routes.read") ? normalized(await rows(sql`select rs.id,rs.status,rp.id as route_id,rp.route_date from route_stops rs join route_plans rp on rp.tenant_id=rs.tenant_id and rp.id=rs.route_plan_id where rs.tenant_id=${tenant} and rs.job_id=${id} and ${scope("rp.organization_location_id")} order by rp.route_date desc,rs.id limit 100`)) : undefined;
    related.notes = normalized(await rows(sql`select id,body,created_at from notes where tenant_id=${tenant} and entity_type='job' and entity_id=${id} order by created_at desc,id limit 100`));
    related.photos = normalized(await rows(sql`select f.id,f.original_name,f.created_at from file_links fl join files f on f.tenant_id=fl.tenant_id and f.id=fl.file_id where fl.tenant_id=${tenant} and fl.entity_type='job' and fl.entity_id=${id} and f.mime_type like 'image/%' order by f.created_at desc,f.id limit 100`));
  }
  if (resource === "invoices") {
    related.lines = normalized(await rows(sql`select id,service_id,description,quantity,unit_amount_minor as unit_cents,total_minor as total_cents,discount_minor,metadata from invoice_items where tenant_id=${tenant} and invoice_id=${id} order by sort_order,id`));
    if (actor.permissions.has("payments.read")) {
      const payments = await handleInvoiceRefund(request, ["invoices", id, "payments"], actor);
      related.payments = (await payments!.json()).items;
      related.refunds = normalized(await rows(sql`select r.id,r.amount_minor as amount_cents,r.currency,r.status,r.reason,r.created_at from refunds r where r.tenant_id=${tenant} and exists(select 1 from payment_allocations pa where pa.tenant_id=r.tenant_id and pa.payment_id=r.payment_id and pa.invoice_id=${id}) order by r.created_at desc,r.id limit 100`));
    }
  }
  if (resource === "leads" && actor.permissions.has("customers.read") && item.convertedCustomerId) {
    related.customer = normalized(await rows(sql`select id,display_name as name from customers where tenant_id=${tenant} and id=${String(item.convertedCustomerId)} and ${scope("owning_location_id")}`));
  }
  const history = await rows(sql`select id,event_type,occurred_at,payload from domain_events where tenant_id=${tenant} and entity_type=${resource!.slice(0,-1)} and entity_id=${id} and (location_id is null or ${scope("location_id")}) order by occurred_at desc,id limit 100`);
  const timeline = history.map((event) => {
    const payload = event.payload as Record<string, unknown>;
    const suffix = String(event.event_type).split(".").slice(1).join(".");
    return { id: event.id, occurredAt: event.occurred_at, title: names[suffix] ?? "Record activity", ...(typeof payload.reason === "string" ? { description: payload.reason } : {}) };
  });
  return json({ item, related, timeline: normalized(timeline) });
}
