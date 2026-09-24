import { randomUUID } from "node:crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  customerContacts, customers, estimateItems, estimateRevisions, estimates, invoiceItems, invoices, jobStatusEvents, jobs,
  organizationLocations, priceRules, recurrenceRules, serviceLocations, servicePlans, services, ticketStatusDefinitions,
  ticketTypeDefinitions, tickets, tenants, leads,
} from "@modular-crm/db";
import { DomainError, requirePermission, type Permission } from "@modular-crm/domain";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { first, normalized, rows, scopedGet, scopedUpdate, uuidArray } from "./sql";

type RecordResource = "leads" | "customers" | "jobs" | "estimates" | "invoices" | "service-plans" | "tickets" | "services";
const resources = new Set<RecordResource>(["leads", "customers", "jobs", "estimates", "invoices", "service-plans", "tickets", "services"]);

const readPermissions: Record<RecordResource, Permission> = {
  leads: "leads.read", customers: "customers.read", jobs: "jobs.read", estimates: "estimates.read",
  invoices: "invoices.read", "service-plans": "service_plans.read", tickets: "tickets.read", services: "services.read",
};

const locationSql = (actor: SessionActor, column: SQL): SQL => {
  requireStaff(actor);
  if (actor.allLocations) return sql`true`;
  return sql`${column} = any(${uuidArray(actor.locationIds)})`;
};

function assertLocationAccess(actor: SessionActor, locationId: string | null): void {
  requireStaff(actor);
  if (!actor.allLocations && (!locationId || !actor.locationIds.has(locationId))) {
    throw new DomainError("NOT_FOUND", "Record not found.", 404);
  }
}

async function assertTicketAccess(actor: SessionActor, id: string): Promise<void> {
  first(await rows(sql`select t.id from tickets t
    left join customers c on c.id=t.customer_id and c.tenant_id=t.tenant_id
    left join service_locations sl on sl.id=t.service_location_id and sl.tenant_id=t.tenant_id
    left join jobs j on j.id=t.job_id and j.tenant_id=t.tenant_id
    where t.id=${id} and t.tenant_id=${actor.tenantId}
      and ${locationSql(actor, sql`coalesce(sl.organization_location_id, j.organization_location_id, c.owning_location_id)`)} limit 1`));
}

function viewQuery(resource: RecordResource, actor: SessionActor, id?: string): SQL {
  const byId = id ? sql`and ${sql.raw(`${resource === "service-plans" ? "sp" : resource === "customers" ? "c" : resource === "leads" ? "l" : resource === "jobs" ? "j" : resource === "estimates" ? "e" : resource === "invoices" ? "i" : resource === "tickets" ? "t" : "s"}.id`)} = ${id}` : sql``;
  const limit = id ? 1 : 200;
  switch (resource) {
    case "leads": return sql`select l.*, trim(concat_ws(' ', l.first_name, l.last_name)) as name, l.source_detail as source
      from leads l where l.tenant_id = ${actor.tenantId} and ${locationSql(actor, sql`l.owning_location_id`)} ${byId} order by l.created_at desc limit ${limit}`;
    case "customers": return sql`select c.*, c.display_name as name, c.billing_email as email, c.billing_phone as phone,
      coalesce(c.billing_address->>'line1', sl.address_line1, '') as address
      from customers c left join lateral (select address_line1 from service_locations where tenant_id = c.tenant_id and customer_id = c.id order by created_at limit 1) sl on true
      where c.tenant_id = ${actor.tenantId} and ${locationSql(actor, sql`c.owning_location_id`)} ${byId} order by c.created_at desc limit ${limit}`;
    case "jobs": return sql`select j.*, c.display_name as customer_name, s.name as service_name, sl.address_line1 as address,
      u.name as technician_name
      from jobs j join customers c on c.id=j.customer_id and c.tenant_id=j.tenant_id
      join services s on s.id=j.service_id and s.tenant_id=j.tenant_id
      join service_locations sl on sl.id=j.service_location_id and sl.tenant_id=j.tenant_id
      left join job_assignments ja on ja.job_id=j.id and ja.tenant_id=j.tenant_id and ja.removed_at is null
      left join memberships m on m.id=ja.membership_id and m.tenant_id=j.tenant_id
      left join "user" u on u.id=m.user_id
      where j.tenant_id=${actor.tenantId} and ${locationSql(actor, sql`j.organization_location_id`)} ${byId}
      order by j.scheduled_date nulls last, j.created_at desc limit ${limit}`;
    case "estimates": return sql`select e.*, coalesce(c.display_name, nullif(trim(concat_ws(' ', l.first_name, l.last_name)), '')) as customer_name,
      nullif(trim(concat_ws(' ', l.first_name, l.last_name)), '') as lead_name,
      ('EST-' || left(e.id::text,8)) as number, e.total_minor as total_cents
      from estimates e left join customers c on c.id=e.customer_id and c.tenant_id=e.tenant_id
      left join leads l on l.id=e.lead_id and l.tenant_id=e.tenant_id
      where e.tenant_id=${actor.tenantId} and ${locationSql(actor, sql`e.organization_location_id`)} ${byId}
      order by e.created_at desc limit ${limit}`;
    case "invoices": return sql`select i.*, c.display_name as customer_name, i.invoice_number as number,
      i.total_minor as total_cents, i.balance_minor as balance_cents, i.due_at as due_date
      from invoices i join customers c on c.id=i.customer_id and c.tenant_id=i.tenant_id
      where i.tenant_id=${actor.tenantId} and ${locationSql(actor, sql`i.organization_location_id`)} ${byId}
      order by i.created_at desc limit ${limit}`;
    case "service-plans": return sql`select sp.*, c.display_name as customer_name, s.name as service_name,
      rr.frequency_type as frequency
      from service_plans sp join customers c on c.id=sp.customer_id and c.tenant_id=sp.tenant_id
      join services s on s.id=sp.service_id and s.tenant_id=sp.tenant_id
      join recurrence_rules rr on rr.id=sp.recurrence_rule_id and rr.tenant_id=sp.tenant_id
      where sp.tenant_id=${actor.tenantId} and ${locationSql(actor, sql`sp.organization_location_id`)} ${byId}
      order by sp.created_at desc limit ${limit}`;
    case "tickets": return sql`select t.*, t.title as subject, c.display_name as customer_name, ts.key as status
      from tickets t left join customers c on c.id=t.customer_id and c.tenant_id=t.tenant_id
      left join service_locations sl on sl.id=t.service_location_id and sl.tenant_id=t.tenant_id
      left join jobs j on j.id=t.job_id and j.tenant_id=t.tenant_id
      join ticket_status_definitions ts on ts.id=t.status_definition_id and ts.tenant_id=t.tenant_id
      where t.tenant_id=${actor.tenantId} and ${locationSql(actor, sql`coalesce(sl.organization_location_id, j.organization_location_id, c.owning_location_id)`)} ${byId} order by t.created_at desc limit ${limit}`;
    case "services": return sql`select s.*, s.default_duration_minutes as duration_minutes,
      (select pr.effects->>'amountMinor' from price_rules pr where pr.tenant_id=s.tenant_id and pr.conditions->>'serviceId'=s.id::text and pr.active=true order by pr.priority desc limit 1) as base_price_cents
      from services s where s.tenant_id=${actor.tenantId} ${byId} order by s.name limit ${limit}`;
  }
}

async function readResource(resource: RecordResource, actor: SessionActor, id?: string): Promise<Response> {
  requirePermission(actor, readPermissions[resource]);
  requireStaff(actor);
  if (actor.role === "technician") throw new DomainError("FORBIDDEN", "Use your assigned work view.", 403);
  const result = await rows(viewQuery(resource, actor, id));
  if (id) {
    const item = normalized(first(result)) as Record<string, unknown>;
    if (resource === "customers") {
      const [contacts, locations, pets] = await Promise.all([
        rows(sql`select * from customer_contacts where tenant_id=${actor.tenantId} and customer_id=${id}`),
        rows(sql`select id,name,address_line1,city,region,postal_code from service_locations where tenant_id=${actor.tenantId} and customer_id=${id}`),
        rows(sql`select id,name,custom_fields from customer_assets where tenant_id=${actor.tenantId} and customer_id=${id} and archived_at is null`),
      ]);
      item.contacts = normalized(contacts); item.locations = normalized(locations); item.pets = normalized(pets);
    }
    return json({ item });
  }
  return json({ items: normalized(result) });
}

const customerSchema = z.object({ name: z.string().min(2), email: z.email().optional().or(z.literal("")), phone: z.string().optional(), address: z.string().optional(), customerType: z.enum(["residential", "commercial"]).default("residential") });
const leadSchema = z.object({ name: z.string().min(2), email: z.email().optional().or(z.literal("")), phone: z.string().optional(), source: z.string().optional(), address: z.string().optional(), notes: z.string().optional() });
const jobSchema = z.object({ customerId: z.uuid(), serviceId: z.uuid().optional(), serviceName: z.string().optional(), address: z.string().optional(), scheduledDate: z.iso.date().optional(), notes: z.string().optional() });
const estimateSchema = z.object({
  customerId: z.uuid().optional(), leadId: z.uuid().optional(), serviceId: z.uuid().optional(),
  title: z.string().min(1), totalCents: z.number().int().nonnegative(), notes: z.string().optional(),
}).refine((body) => Boolean(body.customerId) !== Boolean(body.leadId), {
  message: "Choose either a customer or a lead.", path: ["customerId"],
});
const invoiceSchema = z.object({ customerId: z.uuid(), description: z.string().min(1), totalCents: z.number().int().nonnegative(), dueDate: z.iso.date().optional() });
const planSchema = z.object({ customerId: z.uuid(), serviceId: z.uuid(), frequency: z.string().default("weekly"), startDate: z.iso.date().optional() });
const ticketSchema = z.object({ subject: z.string().min(2), customerId: z.uuid().optional(), type: z.string().optional(), description: z.string().min(1) });
const serviceSchema = z.object({ name: z.string().min(2), description: z.string().optional(), basePriceCents: z.number().int().nonnegative().optional(), durationMinutes: z.number().int().positive().optional() });

async function createResource(resource: RecordResource, request: Request, actor: SessionActor): Promise<Response> {
  requireStaff(actor);
  const db = getDb();
  const organizationId = actor.organizationId;
  const locationId = actor.defaultLocationId ?? [...actor.locationIds][0] ?? null;
  assertLocationAccess(actor, locationId);
  if (resource === "customers") {
    requirePermission(actor, "customers.create");
    const body = await readBody(request, customerSchema);
    const created = await db.transaction(async (tx) => {
      const [customer] = await tx.insert(customers).values({ tenantId: actor.tenantId, organizationId, owningLocationId: locationId, displayName: body.name, billingEmail: body.email || null, billingPhone: body.phone || null, billingAddress: body.address ? { line1: body.address } : null, customerType: body.customerType, status: "active" }).returning();
      if (!customer) throw new Error("Could not create customer");
      const parts = body.name.trim().split(/\s+/);
      await tx.insert(customerContacts).values({ tenantId: actor.tenantId, customerId: customer.id, firstName: parts[0] ?? body.name, lastName: parts.slice(1).join(" "), email: body.email || null, phone: body.phone || null, isPrimary: true, serviceContact: true, billingContact: true });
      if (body.address) await tx.insert(serviceLocations).values({ tenantId: actor.tenantId, customerId: customer.id, organizationLocationId: locationId, name: "Primary address", addressLine1: body.address, city: "", region: "", postalCode: "", geocodeStatus: "pending" });
      return customer;
    });
    await recordEvent(actor, { type: "customer.created", entityType: "customer", entityId: created.id, payload: { name: body.name }, auditAction: "customer.create", after: { name: body.name } });
    return json({ item: normalized({ ...created, name: created.displayName, email: created.billingEmail, phone: created.billingPhone, address: body.address }) }, 201);
  }
  if (resource === "leads") {
    requirePermission(actor, "leads.create");
    const body = await readBody(request, leadSchema);
    const parts = body.name.trim().split(/\s+/);
    const [lead] = await db.insert(leads).values({ tenantId: actor.tenantId, organizationId, owningLocationId: locationId, status: "new", firstName: parts[0], lastName: parts.slice(1).join(" "), email: body.email || null, phone: body.phone || null, sourceDetail: body.source || null, address: body.address ? { line1: body.address } : null, customFields: body.notes ? { notes: body.notes } : {} }).returning();
    if (!lead) throw new Error("Could not create lead");
    await recordEvent(actor, { type: "lead.created", entityType: "lead", entityId: lead.id, payload: { source: body.source }, auditAction: "lead.create" });
    return json({ item: normalized({ ...lead, name: body.name }) }, 201);
  }
  if (resource === "services") {
    requirePermission(actor, "services.manage");
    const body = await readBody(request, serviceSchema);
    const key = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${randomUUID().slice(0, 5)}`;
    const [service] = await db.insert(services).values({ tenantId: actor.tenantId, organizationId, key, name: body.name, description: body.description, serviceType: "one_time", defaultDurationMinutes: body.durationMinutes ?? 30 }).returning();
    if (!service) throw new Error("Could not create service");
    if (body.basePriceCents !== undefined) await db.insert(priceRules).values({ tenantId: actor.tenantId, organizationId, name: `${body.name} base price`, priority: 0, conditions: { serviceId: service.id }, effects: { type: "set_base_amount", amountMinor: body.basePriceCents }, source: "tenant" });
    await recordEvent(actor, { type: "service.created", entityType: "service", entityId: service.id, auditAction: "service.create" });
    return json({ item: normalized({ ...service, basePriceCents: body.basePriceCents }) }, 201);
  }
  if (resource === "jobs") {
    requirePermission(actor, "jobs.create");
    const body = await readBody(request, jobSchema);
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, body.customerId), eq(customers.tenantId, actor.tenantId))).limit(1);
    if (!customer) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
    assertLocationAccess(actor, customer.owningLocationId);
    const [service] = await db.select().from(services).where(and(eq(services.tenantId, actor.tenantId), body.serviceId ? eq(services.id, body.serviceId) : eq(services.name, body.serviceName ?? ""))).limit(1);
    if (!service) throw new DomainError("VALIDATION_ERROR", "Choose a service from your catalog.", 422);
    const [location] = await db.select().from(serviceLocations).where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.customerId, customer.id))).limit(1);
    if (!location) throw new DomainError("VALIDATION_ERROR", "Add a service address for this customer first.", 422);
    assertLocationAccess(actor, location.organizationLocationId);
    const status = body.scheduledDate ? "scheduled" : "unscheduled";
    const [job] = await db.insert(jobs).values({ tenantId: actor.tenantId, organizationId, organizationLocationId: customer.owningLocationId ?? locationId, customerId: customer.id, serviceLocationId: location.id, serviceId: service.id, status, scheduledDate: body.scheduledDate, estimatedDurationMinutes: service.defaultDurationMinutes, internalSummary: body.notes }).returning();
    if (!job) throw new Error("Could not create job");
    await db.insert(jobStatusEvents).values({ tenantId: actor.tenantId, jobId: job.id, fromStatus: null, toStatus: status, actorType: "staff", actorId: actor.userId });
    await recordEvent(actor, { type: "job.created", entityType: "job", entityId: job.id, payload: { status }, auditAction: "job.create", locationId: job.organizationLocationId });
    return json({ item: normalized({ ...job, customerName: customer.displayName, serviceName: service.name, address: location.addressLine1 }) }, 201);
  }
  if (resource === "estimates") {
    requirePermission(actor, "estimates.create");
    const body = await readBody(request, estimateSchema);
    const [customer] = body.customerId
      ? await db.select().from(customers).where(and(eq(customers.id, body.customerId), eq(customers.tenantId, actor.tenantId))).limit(1)
      : [];
    const [lead] = body.leadId
      ? await db.select().from(leads).where(and(eq(leads.id, body.leadId), eq(leads.tenantId, actor.tenantId))).limit(1)
      : [];
    if (body.customerId && !customer) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
    if (body.leadId && !lead) throw new DomainError("NOT_FOUND", "Lead not found.", 404);
    const owningLocationId = customer?.owningLocationId ?? lead?.owningLocationId ?? locationId;
    assertLocationAccess(actor, owningLocationId);
    let service: { id: string; organizationId: string | null } | undefined;
    if (body.serviceId) {
      [service] = await db.select({ id: services.id, organizationId: services.organizationId }).from(services)
        .where(and(eq(services.id, body.serviceId), eq(services.tenantId, actor.tenantId), eq(services.organizationId, organizationId))).limit(1);
      if (!service) throw new DomainError("NOT_FOUND", "Service not found.", 404);
    }
    const leadName = lead?.companyName || [lead?.firstName, lead?.lastName].filter(Boolean).join(" ") || "Prospective customer";
    const contactName = customer?.displayName ?? leadName;
    const snapshot = {
      title: body.title,
      customerName: customer?.displayName ?? null,
      leadName: lead ? leadName : null,
      contactName,
      contactEmail: customer?.billingEmail ?? lead?.email ?? null,
      contactPhone: customer?.billingPhone ?? lead?.phone ?? null,
      serviceAddress: lead?.address ?? null,
      totalCents: body.totalCents,
    };
    const created = await db.transaction(async (tx) => {
      const [estimate] = await tx.insert(estimates).values({
        tenantId: actor.tenantId, customerId: customer?.id ?? null, leadId: lead?.id ?? null,
        organizationLocationId: owningLocationId, status: "draft", totalMinor: BigInt(body.totalCents), createdByMembershipId: actor.membershipId,
      }).returning();
      if (!estimate) throw new Error("Could not create estimate");
      const [revision] = await tx.insert(estimateRevisions).values({ tenantId: actor.tenantId, estimateId: estimate.id, revisionNumber: 1, subtotalMinor: BigInt(body.totalCents), totalMinor: BigInt(body.totalCents), notes: body.notes, snapshot }).returning();
      if (!revision) throw new Error("Could not create estimate revision");
      await tx.insert(estimateItems).values({ tenantId: actor.tenantId, estimateRevisionId: revision.id, serviceId: service?.id ?? null, description: body.title, quantity: "1", unitAmountMinor: BigInt(body.totalCents), totalMinor: BigInt(body.totalCents) });
      return estimate;
    });
    await recordEvent(actor, { type: "estimate.created", entityType: "estimate", entityId: created.id, auditAction: "estimate.create" });
    return json({ item: normalized({ ...created, customerName: customer?.displayName ?? null, leadName: lead ? leadName : null, totalCents: body.totalCents }) }, 201);
  }
  if (resource === "invoices") {
    requirePermission(actor, "invoices.create");
    const body = await readBody(request, invoiceSchema);
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, body.customerId), eq(customers.tenantId, actor.tenantId))).limit(1);
    if (!customer) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
    assertLocationAccess(actor, customer.owningLocationId);
    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
    const created = await db.transaction(async (tx) => {
      const [invoice] = await tx.insert(invoices).values({ tenantId: actor.tenantId, organizationId, organizationLocationId: customer.owningLocationId ?? locationId, customerId: customer.id, status: "draft", invoiceNumber, totalMinor: BigInt(body.totalCents), subtotalMinor: BigInt(body.totalCents), balanceMinor: BigInt(body.totalCents), dueAt: body.dueDate ? new Date(`${body.dueDate}T23:59:59Z`) : null, billingSnapshot: { businessName: actor.tenantName, customerName: customer.displayName, description: body.description, totalCents: body.totalCents } }).returning();
      if (!invoice) throw new Error("Could not create invoice");
      await tx.insert(invoiceItems).values({ tenantId: actor.tenantId, invoiceId: invoice.id, description: body.description, quantity: "1", unitAmountMinor: BigInt(body.totalCents), totalMinor: BigInt(body.totalCents) });
      return invoice;
    });
    await recordEvent(actor, { type: "invoice.created", entityType: "invoice", entityId: created.id, auditAction: "invoice.create" });
    return json({ item: normalized({ ...created, customerName: customer.displayName, number: invoiceNumber, totalCents: body.totalCents, balanceCents: body.totalCents }) }, 201);
  }
  if (resource === "service-plans") {
    requirePermission(actor, "service_plans.create");
    const body = await readBody(request, planSchema);
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, body.customerId), eq(customers.tenantId, actor.tenantId))).limit(1);
    const [service] = await db.select().from(services).where(and(eq(services.id, body.serviceId), eq(services.tenantId, actor.tenantId))).limit(1);
    if (!customer || !service) throw new DomainError("NOT_FOUND", "Customer or service not found.", 404);
    assertLocationAccess(actor, customer.owningLocationId);
    const [location] = await db.select().from(serviceLocations).where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.customerId, customer.id))).limit(1);
    if (!location) throw new DomainError("VALIDATION_ERROR", "Add a service address first.", 422);
    assertLocationAccess(actor, location.organizationLocationId);
    const [tenant] = await db.select({ timezone: tenants.defaultTimezone }).from(tenants).where(eq(tenants.id, actor.tenantId));
    const frequency = body.frequency === "every-two-weeks" ? "biweekly" : body.frequency;
    const created = await db.transaction(async (tx) => {
      const [rule] = await tx.insert(recurrenceRules).values({ tenantId: actor.tenantId, frequencyType: frequency, interval: frequency === "biweekly" ? 2 : 1, timezone: tenant?.timezone ?? "America/New_York" }).returning();
      if (!rule) throw new Error("Could not create recurrence");
      const [plan] = await tx.insert(servicePlans).values({ tenantId: actor.tenantId, customerId: customer.id, serviceLocationId: location.id, organizationLocationId: customer.owningLocationId ?? locationId, serviceId: service.id, recurrenceRuleId: rule.id, status: "active", effectiveFrom: body.startDate ?? new Date().toISOString().slice(0, 10), pricingSnapshot: {}, billingConfiguration: { type: "per_job" } }).returning();
      if (!plan) throw new Error("Could not create plan");
      return plan;
    });
    await recordEvent(actor, { type: "service_plan.created", entityType: "service_plan", entityId: created.id, auditAction: "service_plan.create" });
    return json({ item: normalized({ ...created, customerName: customer.displayName, serviceName: service.name, frequency }) }, 201);
  }
  if (resource === "tickets") {
    requirePermission(actor, "tickets.create");
    const body = await readBody(request, ticketSchema);
    if (body.customerId) {
      const [customer] = await db.select({ id: customers.id, owningLocationId: customers.owningLocationId }).from(customers).where(and(eq(customers.tenantId, actor.tenantId), eq(customers.id, body.customerId))).limit(1);
      if (!customer) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
      assertLocationAccess(actor, customer.owningLocationId);
    } else if (!actor.allLocations) {
      throw new DomainError("VALIDATION_ERROR", "Choose a customer for this ticket.", 422);
    }
    let [type] = await db.select().from(ticketTypeDefinitions).where(and(eq(ticketTypeDefinitions.tenantId, actor.tenantId), eq(ticketTypeDefinitions.key, body.type ?? "general"))).limit(1);
    let [status] = await db.select().from(ticketStatusDefinitions).where(and(eq(ticketStatusDefinitions.tenantId, actor.tenantId), eq(ticketStatusDefinitions.key, "open"))).limit(1);
    if (!type) [type] = await db.insert(ticketTypeDefinitions).values({ tenantId: actor.tenantId, key: body.type ?? "general", name: body.type ?? "General", active: true }).returning();
    if (!status) [status] = await db.insert(ticketStatusDefinitions).values({ tenantId: actor.tenantId, key: "open", name: "Open", normalizedCategory: "open", active: true }).returning();
    if (!type || !status) throw new Error("Ticket setup failed");
    const [ticket] = await db.insert(tickets).values({ tenantId: actor.tenantId, customerId: body.customerId, ticketTypeId: type.id, statusDefinitionId: status.id, title: body.subject, description: body.description, createdByActorType: "staff", createdByActorId: actor.userId, customerVisible: !!body.customerId }).returning();
    if (!ticket) throw new Error("Could not create ticket");
    await recordEvent(actor, { type: "ticket.created", entityType: "ticket", entityId: ticket.id, auditAction: "ticket.create" });
    return json({ item: normalized({ ...ticket, subject: body.subject, status: "open" }) }, 201);
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}

async function patchResource(resource: RecordResource, id: string, request: Request, actor: SessionActor): Promise<Response> {
  requireStaff(actor);
  const mapping: Partial<Record<RecordResource, { table: string; permission: Permission; locationColumn?: string; fields: Record<string, string> }>> = {
    leads: { table: "leads", permission: "leads.update", locationColumn: "owning_location_id", fields: { email: "email", phone: "phone", source: "source_detail" } },
    customers: { table: "customers", permission: "customers.update", locationColumn: "owning_location_id", fields: { name: "display_name", email: "billing_email", phone: "billing_phone" } },
    jobs: { table: "jobs", permission: "jobs.update", locationColumn: "organization_location_id", fields: { scheduledDate: "scheduled_date", notes: "internal_summary", customerSummary: "customer_summary" } },
    services: { table: "services", permission: "services.manage", fields: { name: "name", description: "description", active: "active", durationMinutes: "default_duration_minutes" } },
    tickets: { table: "tickets", permission: "tickets.update", fields: { subject: "title", description: "description", priority: "priority" } },
  };
  const config = mapping[resource];
  if (!config) throw new DomainError("VALIDATION_ERROR", "Use the document's revision or action flow for this change.", 422);
  const body = await request.json() as Record<string, unknown>;
  const entries = Object.entries(body).filter(([key]) => key in config.fields);
  if (entries.length === 0) throw new DomainError("VALIDATION_ERROR", "No supported changes were supplied.", 422);
  const before = await scopedGet(actor, { table: config.table, permission: config.permission, locationColumn: config.locationColumn }, id);
  if (resource === "tickets") await assertTicketAccess(actor, id);
  const changes = Object.fromEntries(entries.map(([key, value]) => [config.fields[key]!, value]));
  const updated = await scopedUpdate(actor, { table: config.table, permission: config.permission, locationColumn: config.locationColumn }, id, changes);
  await recordEvent(actor, { type: `${resource.replace(/s$/, "")}.updated`, entityType: resource.replace(/s$/, ""), entityId: id, auditAction: `${resource}.update`, before, after: updated });
  return json({ item: normalized(updated) });
}

export async function handleRecords(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  const resource = path[0] as RecordResource;
  if (!resources.has(resource)) return null;
  if (path.length > 2) return null;
  const id = path[1];
  if (request.method === "GET") return readResource(resource, actor, id);
  if (request.method === "POST" && !id) return createResource(resource, request, actor);
  if (request.method === "PATCH" && id) return patchResource(resource, id, request, actor);
  return null;
}
