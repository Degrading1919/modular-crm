import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { consentRecords, customerAssets, customerChangeRequests, customerContacts, customerPreferences, customers, notificationPreferences, serviceFeedback, ticketStatusDefinitions, ticketTypeDefinitions, tickets } from "@modular-crm/db";
import { DomainError } from "@modular-crm/domain";
import { getDb } from "../db";
import { type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized, rows, uuidArray } from "./sql";
import { estimateAction, invoiceAction } from "./workflows";

function customerActor(actor: SessionActor): asserts actor is SessionActor & { kind: "customer"; customerIds: Set<string> } {
  if (actor.kind !== "customer") throw new DomainError("FORBIDDEN", "Customer access is required.", 403);
}

function firstCustomerId(actor: SessionActor): string {
  customerActor(actor);
  const id = [...actor.customerIds][0];
  if (!id) throw new DomainError("FORBIDDEN", "No customer account is linked.", 403);
  return id;
}

function ids(actor: SessionActor) { customerActor(actor); return [...actor.customerIds]; }

function customerLocationPredicate(actor: SessionActor, customerColumn: string, locationColumn: string) {
  customerActor(actor);
  const scopes = [...actor.customerLocationIds].map(([customerId, locationIds]) =>
    sql`(${sql.raw(customerColumn)}=${customerId} and ${sql.raw(locationColumn)}=any(${uuidArray([...locationIds])}))`);
  return scopes.length ? sql`(${sql.join(scopes, sql` or `)})` : sql`false`;
}

function invoiceLocationPredicate(actor: SessionActor, invoiceAlias: string) {
  customerActor(actor);
  const alias = sql.raw(invoiceAlias);
  const servicePlanId = sql`nullif(${alias}.billing_snapshot->>'servicePlanId','')`;
  const hasServicePlan = sql`${servicePlanId} is not null`;
  const visibleServicePlan = sql`exists (select 1 from service_plans isp where isp.tenant_id=${alias}.tenant_id
    and isp.id::text=${servicePlanId} and isp.customer_id=${alias}.customer_id
    and ${customerLocationPredicate(actor, "isp.customer_id", "isp.service_location_id")})`;
  const jobLines = sql`exists (select 1 from invoice_items ii where ii.tenant_id=${alias}.tenant_id and ii.invoice_id=${alias}.id and ii.job_id is not null)`;
  const visibleJobLines = sql`not exists (
    select 1 from invoice_items ii join jobs j on j.id=ii.job_id and j.tenant_id=ii.tenant_id
    where ii.tenant_id=${alias}.tenant_id and ii.invoice_id=${alias}.id and ii.job_id is not null
      and (j.customer_id <> ${alias}.customer_id or not ${customerLocationPredicate(actor, "j.customer_id", "j.service_location_id")})
  )`;
  const branchLocation = [...actor.customerLocationIds].map(([customerId, locationIds]) => sql`(
    ${alias}.customer_id=${customerId} and exists (select 1 from service_locations sl
      where sl.tenant_id=${alias}.tenant_id and sl.customer_id=${alias}.customer_id
        and sl.organization_location_id=${alias}.organization_location_id
        and sl.id=any(${uuidArray([...locationIds])}))
      and not exists (select 1 from service_locations hidden_sl
        where hidden_sl.tenant_id=${alias}.tenant_id and hidden_sl.customer_id=${alias}.customer_id
          and hidden_sl.organization_location_id=${alias}.organization_location_id
          and not hidden_sl.id=any(${uuidArray([...locationIds])}))
  )`);
  const fallback = branchLocation.length ? sql`(${sql.join(branchLocation, sql` or `)})` : sql`false`;
  return sql`(((${jobLines} and ${visibleJobLines}) or (not ${jobLines} and ((${hasServicePlan} and ${visibleServicePlan}) or (not ${hasServicePlan} and ${fallback}))))
    and (not ${hasServicePlan} or ${visibleServicePlan}))`;
}

async function notificationPreferenceState(actor: SessionActor, customerId: string) {
  const db = getDb();
  const [general] = await db.select().from(notificationPreferences).where(and(
    eq(notificationPreferences.tenantId, actor.tenantId), eq(notificationPreferences.customerId, customerId), eq(notificationPreferences.eventKey, "general"),
  )).limit(1);
  const consents = await db.select().from(consentRecords).where(and(
    eq(consentRecords.tenantId, actor.tenantId), eq(consentRecords.customerId, customerId), eq(consentRecords.category, "transactional"),
  )).orderBy(desc(consentRecords.capturedAt));
  const latestByChannel = new Map<string, typeof consents[number]>();
  for (const consent of consents) if (!latestByChannel.has(consent.channel)) latestByChannel.set(consent.channel, consent);
  const emailConsent = latestByChannel.get("email");
  const smsConsent = latestByChannel.get("sms");
  return {
    email: (general?.emailEnabled ?? true) && emailConsent?.state !== "opted_out" && emailConsent?.state !== "suppressed",
    sms: (general?.smsEnabled ?? false) && smsConsent?.state === "opted_in",
  };
}

async function profile(actor: SessionActor) {
  customerActor(actor);
  const id = firstCustomerId(actor);
  const permittedLocationIds = [...(actor.customerLocationIds.get(id) ?? [])];
  const db = getDb();
  const [customer] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.tenantId, actor.tenantId))).limit(1);
  if (!customer) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
  const [contacts, locations, pets, preferences] = await Promise.all([
    rows(sql`select id,first_name,last_name,email,phone from customer_contacts where tenant_id=${actor.tenantId} and customer_id=${id} and is_primary=true limit 1`),
    rows(sql`select id,address_line1 as address,city,region,postal_code from service_locations where tenant_id=${actor.tenantId} and customer_id=${id} and id=any(${uuidArray(permittedLocationIds)}) order by created_at`),
    rows(sql`select id,name,custom_fields from customer_assets where tenant_id=${actor.tenantId} and customer_id=${id} and archived_at is null and customer_visible=true and (service_location_id is null or service_location_id=any(${uuidArray(permittedLocationIds)})) order by created_at`),
    notificationPreferenceState(actor, id),
  ]);
  const contact = contacts[0];
  return normalized({ id, name: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") : customer.displayName,
    email: contact?.email ?? customer.billingEmail, phone: contact?.phone ?? customer.billingPhone,
    notificationPreferences: preferences,
    locations, pets: pets.map((pet) => ({ id: pet.id, name: pet.name, ...(pet.custom_fields as object ?? {}) })) });
}

async function updateProfile(request: Request, actor: SessionActor): Promise<Response> {
  customerActor(actor);
  const id = firstCustomerId(actor);
  const body = await readBody(request, z.object({ name: z.string().min(2).optional(), email: z.email().optional(), phone: z.string().optional(), notificationPreferences: z.object({ email: z.boolean(), sms: z.boolean() }).optional(), pets: z.array(z.object({ id: z.uuid(), name: z.string().min(1), safetyNotes: z.string().optional() })).optional() }));
  const db = getDb();
  await db.transaction(async (tx) => {
    if (body.name || body.email || body.phone) {
      const existing = await tx.select().from(customerContacts).where(and(eq(customerContacts.tenantId, actor.tenantId), eq(customerContacts.customerId, id), eq(customerContacts.isPrimary, true))).limit(1);
      const parts = body.name?.trim().split(/\s+/);
      if (existing[0]) await tx.update(customerContacts).set({ firstName: parts?.[0] ?? existing[0].firstName, lastName: parts?.slice(1).join(" ") ?? existing[0].lastName, email: body.email ?? existing[0].email, phone: body.phone ?? existing[0].phone, updatedAt: new Date() }).where(and(eq(customerContacts.id, existing[0].id), eq(customerContacts.tenantId, actor.tenantId)));
      await tx.update(customers).set({ billingEmail: body.email, billingPhone: body.phone, updatedAt: new Date() }).where(and(eq(customers.id, id), eq(customers.tenantId, actor.tenantId)));
    }
    if (body.notificationPreferences) {
      const capturedAt = new Date();
      await tx.insert(notificationPreferences).values({
        tenantId: actor.tenantId, customerId: id, eventKey: "general",
        emailEnabled: body.notificationPreferences.email, smsEnabled: body.notificationPreferences.sms,
      }).onConflictDoUpdate({ target: [notificationPreferences.customerId, notificationPreferences.eventKey], set: {
        tenantId: actor.tenantId, emailEnabled: body.notificationPreferences.email, smsEnabled: body.notificationPreferences.sms, updatedAt: capturedAt,
      } });
      for (const channel of ["email", "sms"] as const) await tx.insert(consentRecords).values({
        tenantId: actor.tenantId, customerId: id, channel, category: "transactional",
        state: body.notificationPreferences[channel] ? "opted_in" : "opted_out", source: "customer_portal_profile",
        capturedAt, actorType: "customer", actorId: actor.userId, evidence: { setting: channel, surface: "portal_profile" },
      });
      await tx.insert(customerPreferences).values({ tenantId: actor.tenantId, customerId: id, preferenceKey: "notifications", value: body.notificationPreferences })
        .onConflictDoUpdate({ target: [customerPreferences.tenantId, customerPreferences.customerId, customerPreferences.preferenceKey], set: { value: body.notificationPreferences, updatedAt: capturedAt } });
    }
    if (body.pets) for (const pet of body.pets) {
      const [existing] = await tx.select().from(customerAssets).where(and(eq(customerAssets.id, pet.id), eq(customerAssets.tenantId, actor.tenantId), eq(customerAssets.customerId, id), eq(customerAssets.customerVisible, true))).limit(1);
      if (!existing || (existing.serviceLocationId && !actor.customerLocationIds.get(id)?.has(existing.serviceLocationId))) throw new DomainError("NOT_FOUND", "Pet not found.", 404);
      await tx.update(customerAssets).set({ name: pet.name, customFields: { ...existing.customFields, safetyNotes: pet.safetyNotes }, updatedAt: new Date() }).where(and(eq(customerAssets.id, pet.id), eq(customerAssets.tenantId, actor.tenantId)));
    }
  });
  await recordEvent(actor, { type: "customer.profile_updated", entityType: "customer", entityId: id, auditAction: "customer.profile_update" });
  return json({ item: await profile(actor) });
}

async function portalList(actor: SessionActor, resource: string): Promise<Response> {
  customerActor(actor);
  const customerIds = ids(actor);
  let items: Record<string, unknown>[];
  switch (resource) {
    case "services": items = await rows(sql`select sp.*,s.name as service_name,rr.frequency_type as frequency,sl.address_line1 as address,
      (select min(j.scheduled_date) from jobs j where j.tenant_id=sp.tenant_id and j.service_plan_id=sp.id and j.scheduled_date>=current_date and j.status not in ('completed','skipped','canceled')) as next_service
      from service_plans sp join services s on s.id=sp.service_id and s.tenant_id=sp.tenant_id
      join recurrence_rules rr on rr.id=sp.recurrence_rule_id and rr.tenant_id=sp.tenant_id
      join service_locations sl on sl.id=sp.service_location_id and sl.tenant_id=sp.tenant_id
      where sp.tenant_id=${actor.tenantId} and ${customerLocationPredicate(actor, "sp.customer_id", "sp.service_location_id")} order by sp.created_at desc`); break;
    case "visits": items = await rows(sql`select j.id,j.service_plan_id,j.service_id,j.status,j.scheduled_date,j.actual_completed_at,j.customer_summary,
      s.name as service_name,sl.address_line1 as address,sf.rating as feedback_rating,sf.comment as feedback_comment,sf.submitted_at as feedback_submitted_at
      from jobs j
      join service_locations sl on sl.id=j.service_location_id and sl.tenant_id=j.tenant_id
      left join services s on s.id=j.service_id and s.tenant_id=j.tenant_id
      left join service_feedback sf on sf.job_id=j.id and sf.tenant_id=j.tenant_id and sf.customer_id=j.customer_id and sf.source='portal'
      where j.tenant_id=${actor.tenantId} and ${customerLocationPredicate(actor, "j.customer_id", "j.service_location_id")} and j.status='completed'
      order by coalesce(j.actual_completed_at,j.scheduled_date::timestamptz) desc limit 100`); break;
    case "estimates": items = await rows(sql`select e.*,('EST-' || left(e.id::text,8)) as number,e.total_minor as total_cents,er.snapshot->>'title' as title,er.notes
      from estimates e join estimate_revisions er on er.estimate_id=e.id and er.tenant_id=e.tenant_id and er.revision_number=e.current_revision
      where e.tenant_id=${actor.tenantId} and ${customerLocationPredicate(actor, "e.customer_id", "e.service_location_id")} and e.status<>'draft'
      order by e.created_at desc`); break;
    case "invoices": items = await rows(sql`select i.*,i.invoice_number as number,i.total_minor as total_cents,i.balance_minor as balance_cents,i.due_at as due_date
      from invoices i where i.tenant_id=${actor.tenantId} and i.customer_id=any(${uuidArray(customerIds)}) and i.status<>'draft'
        and ${invoiceLocationPredicate(actor, "i")}
      order by i.created_at desc`); break;
    case "payments": items = await rows(sql`select p.id,p.status,p.amount_minor,p.currency,p.received_at,
        json_agg(json_build_object('invoiceId',i.id,'invoiceNumber',i.invoice_number,'appliedAmountMinor',pa.amount_minor) order by i.invoice_number) as allocations
      from payments p
      join payment_allocations pa on pa.payment_id=p.id and pa.tenant_id=p.tenant_id
      join invoices i on i.id=pa.invoice_id and i.tenant_id=pa.tenant_id and i.customer_id=p.customer_id
      where p.tenant_id=${actor.tenantId} and p.customer_id=any(${uuidArray(customerIds)}) and p.status in ('succeeded','refunded') and i.status<>'draft'
        and ${invoiceLocationPredicate(actor, "i")}
        and not exists (select 1 from payment_allocations hidden_pa join invoices hidden_i
          on hidden_i.id=hidden_pa.invoice_id and hidden_i.tenant_id=hidden_pa.tenant_id
          where hidden_pa.tenant_id=p.tenant_id and hidden_pa.payment_id=p.id and hidden_i.customer_id=p.customer_id
            and not ${invoiceLocationPredicate(actor, "hidden_i")})
      group by p.id order by p.received_at desc nulls last limit 100`); break;
    case "tickets": items = await rows(sql`select t.id,t.title as subject,t.description,ts.key as status,t.created_at from tickets t
      join ticket_status_definitions ts on ts.id=t.status_definition_id and ts.tenant_id=t.tenant_id
      where t.tenant_id=${actor.tenantId} and t.customer_id=any(${uuidArray(customerIds)}) and t.customer_visible=true
        and ((t.service_location_id is not null and ${customerLocationPredicate(actor, "t.customer_id", "t.service_location_id")})
          or (t.service_location_id is null and t.job_id is null)
          or (t.service_location_id is null and exists (select 1 from jobs tj where tj.tenant_id=t.tenant_id and tj.id=t.job_id
            and tj.customer_id=t.customer_id and ${customerLocationPredicate(actor, "tj.customer_id", "tj.service_location_id")})))
      order by t.created_at desc`); break;
    case "requests": items = await rows(sql`select id,request_type as type,customer_message as details,status,created_at,applied_changes->>'customerResponse' as response from customer_change_requests
      where tenant_id=${actor.tenantId} and customer_id=any(${uuidArray(customerIds)})
        and (service_location_id is null or ${customerLocationPredicate(actor, "customer_change_requests.customer_id", "customer_change_requests.service_location_id")})
      order by created_at desc`); break;
    case "files": items = await rows(sql`select f.id,f.original_name as name,f.mime_type,f.created_at,fl.purpose as description
      from files f join file_links fl on fl.file_id=f.id and fl.tenant_id=f.tenant_id
      join jobs j on fl.entity_type='job' and fl.entity_id=j.id and j.tenant_id=f.tenant_id
      where f.tenant_id=${actor.tenantId} and ${customerLocationPredicate(actor, "j.customer_id", "j.service_location_id")} and f.visibility='customer' order by f.created_at desc`); break;
    default: throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  }
  if (resource === "files") items = items.map((item) => ({ ...item, url: `/api/v1/files/${item.id}/download` }));
  if (resource === "services") {
    const history = await portalList(actor, "visits").then(async (response) => ((await response.json()) as { items: Record<string, unknown>[] }).items);
    items = items.map((item) => ({ ...item, priceCents: Number((item.pricing_snapshot as Record<string, unknown> | null)?.amountMinor ?? 0), history: history.filter((job) => job.servicePlanId === item.id) }));
  }
  return json({ items: normalized(items) });
}

async function createRequest(request: Request, actor: SessionActor): Promise<Response> {
  customerActor(actor);
  const id = firstCustomerId(actor);
  const body = await readBody(request, z.object({ type: z.enum(["change", "pause", "resume", "cancel", "access"]), servicePlanId: z.uuid().optional(), details: z.string().optional(), effectiveDate: z.iso.date().optional() }));
  let serviceLocationId: string | null = null;
  if (body.servicePlanId) {
    const plan = await rows(sql`select service_location_id from service_plans where id=${body.servicePlanId} and tenant_id=${actor.tenantId} and customer_id=${id} limit 1`);
    if (!plan.length || !actor.customerLocationIds.get(id)?.has(String(plan[0]!.service_location_id))) throw new DomainError("NOT_FOUND", "Service plan not found.", 404);
    serviceLocationId = String(plan[0]!.service_location_id);
  }
  const created = await getDb().transaction(async (tx) => {
    const [request] = await tx.insert(customerChangeRequests).values({ tenantId: actor.tenantId, customerId: id, serviceLocationId, requestType: body.type, status: "submitted", requestedChanges: { servicePlanId: body.servicePlanId, effectiveDate: body.effectiveDate }, customerMessage: body.details, submittedByUserId: actor.userId }).returning();
    if (!request) throw new Error("Could not submit service change request.");
    await recordEvent(actor, { type: "customer_change_request.submitted", entityType: "customer_change_request", entityId: request.id, payload: { customerId: id, type: body.type, serviceLocationId }, auditAction: "customer.request_change" }, tx);
    return request;
  });
  return json({ item: normalized(created) }, 201);
}

async function createTicket(request: Request, actor: SessionActor): Promise<Response> {
  const id = firstCustomerId(actor);
  const body = await readBody(request, z.object({ subject: z.string().min(2), description: z.string().min(1), type: z.string().default("support") }));
  const db = getDb();
  let [type] = await db.select().from(ticketTypeDefinitions).where(and(eq(ticketTypeDefinitions.tenantId, actor.tenantId), eq(ticketTypeDefinitions.key, body.type))).limit(1);
  let [status] = await db.select().from(ticketStatusDefinitions).where(and(eq(ticketStatusDefinitions.tenantId, actor.tenantId), eq(ticketStatusDefinitions.key, "open"))).limit(1);
  if (!type) [type] = await db.insert(ticketTypeDefinitions).values({ tenantId: actor.tenantId, key: body.type, name: body.type }).returning();
  if (!status) [status] = await db.insert(ticketStatusDefinitions).values({ tenantId: actor.tenantId, key: "open", name: "Open", normalizedCategory: "open" }).returning();
  const [created] = await db.insert(tickets).values({ tenantId: actor.tenantId, customerId: id, ticketTypeId: type!.id, statusDefinitionId: status!.id, title: body.subject, description: body.description, customerVisible: true, createdByActorType: "customer", createdByActorId: actor.userId }).returning();
  await recordEvent(actor, { type: "ticket.created", entityType: "ticket", entityId: created!.id, payload: { customerId: id }, auditAction: "ticket.create" });
  return json({ item: normalized(created) }, 201);
}

export async function handlePortal(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] !== "portal") return null;
  customerActor(actor);
  const resource = path[1];
  if (request.method === "GET" && resource === "profile") return json({ item: await profile(actor) });
  if (request.method === "PATCH" && resource === "profile") return updateProfile(request, actor);
  if (request.method === "GET" && resource === "overview") {
    const [services, invoices, tickets, requests] = await Promise.all([portalList(actor, "services").then((res) => res.json()), portalList(actor, "invoices").then((res) => res.json()), portalList(actor, "tickets").then((res) => res.json()), portalList(actor, "requests").then((res) => res.json())]);
    const plans = services.items as Record<string, unknown>[];
    const bills = invoices.items as Record<string, unknown>[];
    const nextPlan = plans.filter((item) => !!item.nextService).sort((a, b) => String(a.nextService).localeCompare(String(b.nextService)))[0];
    const latestInvoice = bills[0] ?? null;
    const recentService = plans.flatMap((plan) => (plan.history as Record<string, unknown>[] | undefined) ?? [])
      .filter((job) => job.status === "completed").sort((a, b) => String(b.actualCompletedAt ?? b.scheduledDate).localeCompare(String(a.actualCompletedAt ?? a.scheduledDate)))[0] ?? null;
    return json({ item: { name: actor.name, nextService: nextPlan ? { ...nextPlan, scheduledDate: nextPlan.nextService } : null,
      activeServiceName: plans.find((plan) => plan.status === "active")?.serviceName ?? null, servicePlan: plans.find((plan) => plan.status === "active") ?? null,
      recentService: recentService ? { ...recentService, completedAt: recentService.actualCompletedAt, summary: recentService.customerSummary } : null,
      latestInvoice, requests: requests.items, services: plans, invoices: bills, tickets: tickets.items,
      balanceCents: bills.reduce((sum, item) => sum + Number(item.balanceCents ?? 0), 0) } });
  }
  if (request.method === "GET" && ["services", "visits", "estimates", "invoices", "payments", "tickets", "requests", "files"].includes(resource ?? "")) return portalList(actor, resource!);
  if (request.method === "POST" && resource === "requests") return createRequest(request, actor);
  if (request.method === "POST" && resource === "tickets") return createTicket(request, actor);
  if (request.method === "POST" && resource === "invoices" && path[2] && path[3] === "pay") return invoiceAction(request, actor, path[2], "pay");
  if (request.method === "POST" && resource === "estimates" && path[2] && ["approve", "decline"].includes(path[3] ?? "")) return estimateAction(request, actor, path[2], path[3]!);
  if (request.method === "POST" && resource === "feedback" && path[2]) {
    const body = await readBody(request, z.object({ rating: z.number().int().min(1).max(5), comment: z.string().optional() }));
    const customerId = firstCustomerId(actor);
    const job = await rows(sql`select id from jobs where tenant_id=${actor.tenantId} and customer_id=${customerId} and service_location_id=any(${uuidArray(actor.locationIds)}) and id=${path[2]} and status='completed' limit 1`);
    if (!job.length) throw new DomainError("NOT_FOUND", "Completed job not found.", 404);
    const [feedback] = await getDb().insert(serviceFeedback).values({ tenantId: actor.tenantId, customerId, jobId: path[2], rating: body.rating, comment: body.comment, source: "portal" }).onConflictDoNothing().returning();
    if (feedback) return json({ item: normalized(feedback) }, 201);
    const [existing] = await getDb().select().from(serviceFeedback).where(and(eq(serviceFeedback.tenantId, actor.tenantId), eq(serviceFeedback.customerId, customerId), eq(serviceFeedback.jobId, path[2]), eq(serviceFeedback.source, "portal"))).limit(1);
    return json({ item: normalized({ ...existing, jobId: path[2], duplicate: true }) }, 200);
  }
  return null;
}
