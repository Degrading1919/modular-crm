import { and, desc, eq, sql } from "drizzle-orm";
import { customers, payments } from "@modular-crm/db";
import { requirePermission } from "@modular-crm/domain";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { json } from "./http";
import { normalized, uuidArray } from "./sql";
import { z } from "zod";

/** Read-only collection for the existing Payments workspace. */
export async function handlePaymentReads(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length !== 1 || path[0] !== "payments" || request.method !== "GET") return null;
  requireStaff(actor);
  requirePermission(actor, "payments.read");
  const params = new URL(request.url).searchParams;
  const customerId = params.get("customerId");
  const search = z.string().trim().max(120).parse(params.get("search") ?? "");
  const status = z.string().max(50).parse(params.get("status") ?? "");
  const page = params.has("page") ? z.coerce.number().int().min(0).max(1_000_000).parse(params.get("page")) : undefined;
  if (customerId) z.uuid().parse(customerId);

  // Use the invoice-list location model: every allocated invoice's business
  // location must be in scope. An unallocated payment uses customer scope.
  // Receipt documents separately enforce their stricter object-access rules.
  // EXISTS avoids duplicate rows for payments applied to several invoices.
  const locations = uuidArray(actor.locationIds);
  const invalidAllocation = sql`not exists (
    select 1 from payment_allocations pa
    left join invoices i on i.id = pa.invoice_id and i.tenant_id = pa.tenant_id
    where pa.tenant_id = ${actor.tenantId} and pa.payment_id = ${payments.id}
      and (i.id is null or i.customer_id <> ${payments.customerId}
        or (not ${actor.allLocations} and (i.organization_location_id is null
          or not (i.organization_location_id = any(${locations})))))
  )`;
  const locationScope = actor.allLocations ? sql`true` : sql`(
    exists (select 1 from payment_allocations pa
      where pa.tenant_id = ${actor.tenantId} and pa.payment_id = ${payments.id})
    or ${customers.owningLocationId} = any(${locations})
  )`;
  const items = await getDb().select({
    id: payments.id, customerName: customers.displayName,
    amountCents: payments.amountMinor, currency: payments.currency,
    method: sql<string>`coalesce(${payments.recordedMethod}, ${payments.sourceType})`, reference: payments.reference,
    status: payments.status, createdAt: payments.createdAt,
  }).from(payments)
    .innerJoin(customers, and(eq(customers.id, payments.customerId), eq(customers.tenantId, payments.tenantId)))
    .where(and(eq(payments.tenantId, actor.tenantId), customerId ? eq(payments.customerId, customerId) : undefined, invalidAllocation, locationScope,
      search ? sql`position(lower(${search}) in lower(concat_ws(' ',${customers.displayName},${payments.reference},${payments.recordedMethod},${payments.amountMinor}::text))) > 0` : undefined,
      status ? eq(payments.status, status) : undefined))
    .orderBy(desc(payments.createdAt), desc(payments.id)).limit(page === undefined ? 200 : 51).offset(page === undefined ? 0 : page * 50);
  return json({ items: normalized(page === undefined ? items : items.slice(0, 50)), ...(page === undefined ? {} : { page, hasMore: items.length > 50 }) });
}
