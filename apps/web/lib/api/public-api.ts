import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { auditEvents, customerContacts, customers, domainEvents, leads, organizations, serviceLocations } from "@modular-crm/db";
import { DomainError } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { resolveApiCredentialFromRequest, type ResolvedApiCredential } from "./developer-credentials";
import { json, readBody } from "./http";

const resources = {
  customers: { scope: "customers" },
  leads: { scope: "leads" },
  jobs: { scope: "jobs" },
  estimates: { scope: "estimates" },
  invoices: { scope: "invoices" },
  payments: { scope: "payments" },
  "service-plans": { scope: "service_plans" },
  tickets: { scope: "tickets" },
} as const;

type PublicResource = keyof typeof resources;
type PublicRow = Record<string, unknown>;

const customFieldsSchema = z.record(z.string(), z.json()).optional();
const customerCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  address: z.string().trim().max(500).optional(),
  customerType: z.enum(["residential", "commercial"]).optional(),
  custom_fields: customFieldsSchema,
}).strict();
const customerUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  address: z.string().trim().max(500).optional(),
  customerType: z.enum(["residential", "commercial"]).optional(),
  custom_fields: customFieldsSchema,
}).strict().refine((body) => Object.keys(body).length > 0, "Supply at least one field to update.");
const leadCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  source: z.string().trim().max(200).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(10_000).optional(),
  custom_fields: customFieldsSchema,
}).strict();
const leadUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  source: z.string().trim().max(200).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(10_000).optional(),
  custom_fields: customFieldsSchema,
}).strict().refine((body) => Object.keys(body).length > 0, "Supply at least one field to update.");
const pageQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const idempotencyKeySchema = z.string().trim().min(8).max(200);

interface Cursor { createdAt: Date; id: string }

function cursorFromToken(token: string | undefined): Cursor | null {
  if (!token) return null;
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string" || !z.uuid().safeParse(decoded.id).success) {
      throw new Error("Invalid cursor shape");
    }
    const createdAt = new Date(decoded.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== decoded.createdAt) throw new Error("Invalid cursor timestamp");
    return { createdAt, id: decoded.id };
  } catch {
    throw new DomainError("VALIDATION_ERROR", "The cursor is invalid.", 422);
  }
}

function cursorToken(row: PublicRow): string {
  const dateValue = row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt));
  if (!Number.isFinite(dateValue.getTime())) throw new Error("The record has an invalid creation timestamp.");
  const createdAt = dateValue.toISOString();
  return Buffer.from(JSON.stringify({ createdAt, id: row.id }), "utf8").toString("base64url");
}

function decimalAmount(minorValue: unknown, currencyValue: unknown): string {
  const minor = BigInt(String(minorValue ?? "0"));
  const currency = String(currencyValue ?? "USD").toUpperCase();
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // The stored currency is expected to be ISO 4217. Keep a conventional cents fallback if legacy data is invalid.
  }
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const scale = 10n ** BigInt(digits);
  const whole = absolute / scale;
  const fraction = absolute % scale;
  return `${negative ? "-" : ""}${whole}${digits ? `.${fraction.toString().padStart(digits, "0")}` : ""}`;
}

function safeCustomFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeCustomFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/(?:secret|token|password|credential|encrypted|access.?instructions?|api.?key)/i.test(key),
  ).map(([key, item]) => [key, safeCustomFields(item)]));
}

function presentResourceRow(resource: PublicResource, row: PublicRow): PublicRow {
  const result = { ...row };
  if ("custom_fields" in result) result.custom_fields = safeCustomFields(result.custom_fields);
  for (const key of [
    "createdAt", "updatedAt", "serviceWindowStart", "serviceWindowEnd", "actualStartedAt", "actualCompletedAt",
    "expiresAt", "approvedAt", "declinedAt", "issuedAt", "dueAt", "receivedAt", "canceledAt", "resolvedAt", "closedAt",
  ]) {
    const value = result[key];
    if (value instanceof Date) result[key] = value.toISOString();
    else if (typeof value === "string") {
      const date = new Date(value);
      if (Number.isFinite(date.getTime())) result[key] = date.toISOString();
    }
  }
  if (resource === "estimates") {
    result.totalAmount = decimalAmount(result.totalMinor, result.currency);
    delete result.totalMinor;
  } else if (resource === "invoices") {
    result.subtotalAmount = decimalAmount(result.subtotalMinor, result.currency);
    result.totalAmount = decimalAmount(result.totalMinor, result.currency);
    result.paidAmount = decimalAmount(result.paidMinor, result.currency);
    result.balanceAmount = decimalAmount(result.balanceMinor, result.currency);
    delete result.subtotalMinor;
    delete result.totalMinor;
    delete result.paidMinor;
    delete result.balanceMinor;
  } else if (resource === "payments") {
    result.amount = decimalAmount(result.amountMinor, result.currency);
    delete result.amountMinor;
  }
  return result;
}

function cursorFilter(alias: string, cursor: Cursor | null) {
  if (!cursor) return sql``;
  const createdAt = sql.raw(`${alias}.created_at`);
  const id = sql.raw(`${alias}.id`);
  return sql`and (${createdAt} < ${cursor.createdAt} or (${createdAt} = ${cursor.createdAt} and ${id} < ${cursor.id}))`;
}

function idFilter(alias: string, id: string | undefined) {
  return id ? sql`and ${sql.raw(`${alias}.id`)} = ${id}` : sql``;
}

/** The selected columns intentionally omit internal summaries, provider data, and encrypted fields. */
async function queryResource(resource: PublicResource, tenantId: string, options: {
  id?: string;
  cursor?: Cursor | null;
  limit: number;
}): Promise<PublicRow[]> {
  const { id, cursor = null, limit } = options;
  const tenantIdValue = tenantId;
  let query: SQL;
  switch (resource) {
    case "customers": {
      query = sql`select c.id, c.display_name as name, c.billing_email as email,
        c.billing_phone as phone, c.billing_address->>'line1' as address, c.customer_type as "customerType",
        c.status, c.custom_fields as custom_fields, c.created_at as "createdAt", c.updated_at as "updatedAt"
        from customers c where c.tenant_id = ${tenantIdValue} ${idFilter("c", id)} ${cursorFilter("c", cursor)}
        order by c.created_at desc, c.id desc limit ${limit}`;
      break;
    }
    case "leads": {
      query = sql`select l.id,
        coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), l.company_name) as name,
        l.first_name as "firstName", l.last_name as "lastName", l.company_name as "companyName",
        l.email, l.phone, l.status, l.source_detail as source, l.address->>'line1' as address,
        l.custom_fields as custom_fields, l.created_at as "createdAt", l.updated_at as "updatedAt"
        from leads l where l.tenant_id = ${tenantIdValue} ${idFilter("l", id)} ${cursorFilter("l", cursor)}
        order by l.created_at desc, l.id desc limit ${limit}`;
      break;
    }
    case "jobs": {
      query = sql`select j.id, j.customer_id as "customerId", j.service_location_id as "serviceLocationId",
        j.service_plan_id as "servicePlanId", j.service_id as "serviceId", j.status, j.scheduled_date as "scheduledDate",
        j.service_window_start as "serviceWindowStart", j.service_window_end as "serviceWindowEnd",
        j.actual_started_at as "actualStartedAt", j.actual_completed_at as "actualCompletedAt",
        j.estimated_duration_minutes as "estimatedDurationMinutes", j.customer_summary as "customerSummary",
        j.custom_fields as custom_fields, j.created_at as "createdAt", j.updated_at as "updatedAt"
        from jobs j where j.tenant_id = ${tenantIdValue} ${idFilter("j", id)} ${cursorFilter("j", cursor)}
        order by j.created_at desc, j.id desc limit ${limit}`;
      break;
    }
    case "estimates": {
      query = sql`select e.id, e.customer_id as "customerId", e.lead_id as "leadId",
        e.service_location_id as "serviceLocationId", e.status, e.current_revision as "currentRevision",
        e.currency, e.total_minor::text as "totalMinor", e.expires_at as "expiresAt", e.approved_at as "approvedAt",
        e.declined_at as "declinedAt", e.created_at as "createdAt", e.updated_at as "updatedAt"
        from estimates e where e.tenant_id = ${tenantIdValue} ${idFilter("e", id)} ${cursorFilter("e", cursor)}
        order by e.created_at desc, e.id desc limit ${limit}`;
      break;
    }
    case "invoices": {
      query = sql`select i.id, i.customer_id as "customerId", i.status,
        i.invoice_number as "invoiceNumber", i.currency, i.subtotal_minor::text as "subtotalMinor",
        i.total_minor::text as "totalMinor", i.paid_minor::text as "paidMinor", i.balance_minor::text as "balanceMinor",
        i.issued_at as "issuedAt", i.due_at as "dueAt", i.created_at as "createdAt", i.updated_at as "updatedAt"
        from invoices i where i.tenant_id = ${tenantIdValue} ${idFilter("i", id)} ${cursorFilter("i", cursor)}
        order by i.created_at desc, i.id desc limit ${limit}`;
      break;
    }
    case "payments": {
      query = sql`select p.id, p.customer_id as "customerId", p.status,
        p.amount_minor::text as "amountMinor", p.currency, p.received_at as "receivedAt",
        p.created_at as "createdAt", p.updated_at as "updatedAt"
        from payments p where p.tenant_id = ${tenantIdValue} ${idFilter("p", id)} ${cursorFilter("p", cursor)}
        order by p.created_at desc, p.id desc limit ${limit}`;
      break;
    }
    case "service-plans": {
      query = sql`select sp.id, sp.customer_id as "customerId", sp.service_location_id as "serviceLocationId",
        sp.service_id as "serviceId", sp.status, sp.effective_from as "effectiveFrom", sp.effective_to as "effectiveTo",
        sp.pause_from as "pauseFrom", sp.pause_until as "pauseUntil", sp.canceled_at as "canceledAt",
        sp.custom_fields as custom_fields, sp.created_at as "createdAt", sp.updated_at as "updatedAt"
        from service_plans sp where sp.tenant_id = ${tenantIdValue} ${idFilter("sp", id)} ${cursorFilter("sp", cursor)}
        order by sp.created_at desc, sp.id desc limit ${limit}`;
      break;
    }
    case "tickets": {
      query = sql`select t.id, t.customer_id as "customerId", t.service_location_id as "serviceLocationId",
        t.job_id as "jobId", td.key as type, sd.key as status, t.priority, t.title, t.description,
        t.customer_visible as "customerVisible", t.due_at as "dueAt", t.resolved_at as "resolvedAt", t.closed_at as "closedAt",
        t.custom_fields as custom_fields, t.created_at as "createdAt", t.updated_at as "updatedAt"
        from tickets t left join ticket_type_definitions td on td.id=t.ticket_type_id and td.tenant_id=t.tenant_id
        left join ticket_status_definitions sd on sd.id=t.status_definition_id and sd.tenant_id=t.tenant_id
        where t.tenant_id = ${tenantIdValue} ${idFilter("t", id)} ${cursorFilter("t", cursor)}
        order by t.created_at desc, t.id desc limit ${limit}`;
      break;
    }
  }
  return (await getDb().execute(query)).rows as PublicRow[];
}

function listQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) throw new DomainError("VALIDATION_ERROR", "Each query parameter may be supplied only once.", 422);
    seen.add(key);
  }
  const values = Object.fromEntries(params.entries());
  const parsed = pageQuerySchema.parse(values);
  return { limit: parsed.limit, cursor: cursorFromToken(parsed.cursor) };
}

async function listResource(request: Request, resource: PublicResource, tenantId: string): Promise<Response> {
  const page = listQuery(request);
  const result = await queryResource(resource, tenantId, { ...page, limit: page.limit + 1 });
  const hasMore = result.length > page.limit;
  const items = (hasMore ? result.slice(0, page.limit) : result).map((row) => presentResourceRow(resource, row));
  return json({ items, nextCursor: hasMore && items.length ? cursorToken(items[items.length - 1]!) : null, hasMore });
}

async function readOne(resource: PublicResource, id: string, tenantId: string): Promise<Response> {
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Record not found.", 404);
  const [item] = await queryResource(resource, tenantId, { id, limit: 1 });
  if (!item) throw new DomainError("NOT_FOUND", "Record not found.", 404);
  return json({ item: presentResourceRow(resource, item) });
}

function requireScope(credential: ResolvedApiCredential, scope: string, access: "read" | "write") {
  if (!credential.scopes.includes(`${scope}:${access}`)) {
    throw new DomainError("FORBIDDEN", `This API credential does not have ${scope}:${access} access.`, 403);
  }
}

function requestIdempotencyKey(request: Request): string {
  const parsed = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key") ?? "");
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "An Idempotency-Key of 8 to 200 characters is required.", 422);
  return parsed.data;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nameParts(name: string) {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

function eventPayload(fields: string[]) {
  return { fields };
}

async function createCustomer(tenantId: string, credentialId: string, request: Request): Promise<Response> {
  const body = await readBody(request, customerCreateSchema);
  const idempotencyKey = requestIdempotencyKey(request);
  const reqFingerprint = fingerprint(body);
  const idempotencyEventId = deterministicUuid(`public-api:v1:${tenantId}:customers:POST:${idempotencyKey}`);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations)
      .where(and(eq(organizations.tenantId, tenantId), eq(organizations.active, true), isNull(organizations.parentOrganizationId)))
      .orderBy(asc(organizations.createdAt), asc(organizations.id)).limit(1);
    if (!organization) throw new DomainError("VALIDATION_ERROR", "This tenant has no active business organization.", 422);

    const id = randomUUID();
    const [reservation] = await tx.insert(domainEvents).values({
      id: idempotencyEventId, tenantId, eventType: "customer.created", actorType: "api_credential", actorId: credentialId,
      entityType: "customer", entityId: id, organizationId: organization.id,
      payload: eventPayload(["name", "email", "phone", "address", "customerType", "custom_fields"].filter((field) => field in body)),
    }).onConflictDoNothing().returning({ id: domainEvents.id });

    if (!reservation) {
      const [event] = await tx.select({ entityId: domainEvents.entityId }).from(domainEvents)
        .where(and(eq(domainEvents.id, idempotencyEventId), eq(domainEvents.tenantId, tenantId))).limit(1);
      if (!event) throw new Error("Idempotent customer request could not be resolved.");
      const [priorAudit] = await tx.select({ afterData: auditEvents.afterData }).from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId), eq(auditEvents.entityType, "customer"), eq(auditEvents.entityId, event.entityId),
        eq(auditEvents.action, "public_api.customer.create"),
      )).limit(1);
      if (priorAudit?.afterData?.requestFingerprint !== reqFingerprint) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different request.", 409);
      }
      const [prior] = await tx.select({ id: customers.id }).from(customers)
        .where(and(eq(customers.id, event.entityId), eq(customers.tenantId, tenantId))).limit(1);
      if (!prior) throw new Error("Idempotent customer record could not be resolved.");
      return { id: prior.id };
    }

    const parts = nameParts(body.name);
    const [customer] = await tx.insert(customers).values({
      id, tenantId, organizationId: organization.id, owningLocationId: null,
      displayName: body.name, billingEmail: body.email || null, billingPhone: body.phone || null,
      billingAddress: body.address ? { line1: body.address } : null,
      customerType: body.customerType ?? "residential", status: "active", customFields: body.custom_fields ?? {},
    }).returning({ id: customers.id });
    if (!customer) throw new Error("Customer could not be created.");
    await tx.insert(customerContacts).values({
      tenantId, customerId: id, firstName: parts.firstName, lastName: parts.lastName,
      email: body.email || null, phone: body.phone || null, isPrimary: true, serviceContact: true, billingContact: true,
    });
    if (body.address) {
      await tx.insert(serviceLocations).values({
        tenantId, customerId: id, organizationLocationId: null, name: "Primary address", addressLine1: body.address,
        city: "", region: "", postalCode: "", geocodeStatus: "pending",
      });
    }
    await tx.insert(auditEvents).values({
      tenantId, actorType: "api_credential", actorId: credentialId, action: "public_api.customer.create",
      entityType: "customer", entityId: id, afterData: { fields: Object.keys(body), requestFingerprint: reqFingerprint },
    });
    return { id };
  });
  const [item] = await queryResource("customers", tenantId, { id: result.id, limit: 1 });
  if (!item) throw new Error("Created customer could not be loaded.");
  return json({ item: presentResourceRow("customers", item) }, 201);
}

async function createLead(tenantId: string, credentialId: string, request: Request): Promise<Response> {
  const body = await readBody(request, leadCreateSchema);
  const idempotencyKey = requestIdempotencyKey(request);
  const reqFingerprint = fingerprint(body);
  const idempotencyEventId = deterministicUuid(`public-api:v1:${tenantId}:leads:POST:${idempotencyKey}`);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations)
      .where(and(eq(organizations.tenantId, tenantId), eq(organizations.active, true), isNull(organizations.parentOrganizationId)))
      .orderBy(asc(organizations.createdAt), asc(organizations.id)).limit(1);
    if (!organization) throw new DomainError("VALIDATION_ERROR", "This tenant has no active business organization.", 422);

    const id = randomUUID();
    const [reservation] = await tx.insert(domainEvents).values({
      id: idempotencyEventId, tenantId, eventType: "lead.created", actorType: "api_credential", actorId: credentialId,
      entityType: "lead", entityId: id, organizationId: organization.id,
      payload: eventPayload(["name", "email", "phone", "source", "address", "notes", "custom_fields"].filter((field) => field in body)),
    }).onConflictDoNothing().returning({ id: domainEvents.id });
    if (!reservation) {
      const [event] = await tx.select({ entityId: domainEvents.entityId }).from(domainEvents)
        .where(and(eq(domainEvents.id, idempotencyEventId), eq(domainEvents.tenantId, tenantId))).limit(1);
      if (!event) throw new Error("Idempotent lead request could not be resolved.");
      const [priorAudit] = await tx.select({ afterData: auditEvents.afterData }).from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId), eq(auditEvents.entityType, "lead"), eq(auditEvents.entityId, event.entityId),
        eq(auditEvents.action, "public_api.lead.create"),
      )).limit(1);
      if (priorAudit?.afterData?.requestFingerprint !== reqFingerprint) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different request.", 409);
      }
      const [prior] = await tx.select({ id: leads.id }).from(leads)
        .where(and(eq(leads.id, event.entityId), eq(leads.tenantId, tenantId))).limit(1);
      if (!prior) throw new Error("Idempotent lead record could not be resolved.");
      return { id: prior.id };
    }

    const parts = nameParts(body.name);
    const customFields = { ...(body.custom_fields ?? {}), ...(body.notes ? { notes: body.notes } : {}) };
    const [lead] = await tx.insert(leads).values({
      id, tenantId, organizationId: organization.id, owningLocationId: null, status: "new",
      firstName: parts.firstName, lastName: parts.lastName, email: body.email || null, phone: body.phone || null,
      sourceDetail: body.source || null, address: body.address ? { line1: body.address } : null, customFields,
    }).returning({ id: leads.id });
    if (!lead) throw new Error("Lead could not be created.");
    await tx.insert(auditEvents).values({
      tenantId, actorType: "api_credential", actorId: credentialId, action: "public_api.lead.create",
      entityType: "lead", entityId: id, afterData: { fields: Object.keys(body), requestFingerprint: reqFingerprint },
    });
    return { id };
  });
  const [item] = await queryResource("leads", tenantId, { id: result.id, limit: 1 });
  if (!item) throw new Error("Created lead could not be loaded.");
  return json({ item: presentResourceRow("leads", item) }, 201);
}

async function updateCustomer(tenantId: string, credentialId: string, id: string, request: Request): Promise<Response> {
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Record not found.", 404);
  const body = await readBody(request, customerUpdateSchema);
  const db = getDb();
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(customers).where(and(eq(customers.id, id), eq(customers.tenantId, tenantId))).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "Record not found.", 404);
    const fields = Object.keys(body);
    const changes = {
      ...(body.name !== undefined ? { displayName: body.name } : {}),
      ...(body.email !== undefined ? { billingEmail: body.email || null } : {}),
      ...(body.phone !== undefined ? { billingPhone: body.phone || null } : {}),
      ...(body.address !== undefined ? { billingAddress: body.address ? { line1: body.address } : null } : {}),
      ...(body.customerType !== undefined ? { customerType: body.customerType } : {}),
      ...(body.custom_fields !== undefined ? { customFields: body.custom_fields } : {}),
      updatedAt: new Date(),
    };
    const [updated] = await tx.update(customers).set(changes).where(and(eq(customers.id, id), eq(customers.tenantId, tenantId))).returning({ id: customers.id });
    if (!updated) throw new DomainError("NOT_FOUND", "Record not found.", 404);
    const contactChanges = {
      ...(body.name !== undefined ? nameParts(body.name) : {}),
      ...(body.email !== undefined ? { email: body.email || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      updatedAt: new Date(),
    };
    if (Object.keys(contactChanges).length > 1) {
      await tx.update(customerContacts).set(contactChanges).where(and(
        eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, id), eq(customerContacts.isPrimary, true),
      ));
    }
    if (body.address !== undefined) {
      const [location] = await tx.select({ id: serviceLocations.id }).from(serviceLocations)
        .where(and(eq(serviceLocations.tenantId, tenantId), eq(serviceLocations.customerId, id), eq(serviceLocations.name, "Primary address")))
        .orderBy(asc(serviceLocations.createdAt), asc(serviceLocations.id)).limit(1);
      if (location) await tx.update(serviceLocations).set({ addressLine1: body.address || "", updatedAt: new Date() })
        .where(and(eq(serviceLocations.id, location.id), eq(serviceLocations.tenantId, tenantId)));
    }
    await tx.insert(domainEvents).values({
      tenantId, eventType: "customer.updated", actorType: "api_credential", actorId: credentialId,
      entityType: "customer", entityId: id, payload: eventPayload(fields),
    });
    await tx.insert(auditEvents).values({
      tenantId, actorType: "api_credential", actorId: credentialId, action: "public_api.customer.update",
      entityType: "customer", entityId: id, beforeData: { fields }, afterData: { fields },
    });
  });
  const [item] = await queryResource("customers", tenantId, { id, limit: 1 });
  if (!item) throw new DomainError("NOT_FOUND", "Record not found.", 404);
  return json({ item: presentResourceRow("customers", item) });
}

async function updateLead(tenantId: string, credentialId: string, id: string, request: Request): Promise<Response> {
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Record not found.", 404);
  const body = await readBody(request, leadUpdateSchema);
  const db = getDb();
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, tenantId))).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "Record not found.", 404);
    const fields = Object.keys(body);
    const priorCustomFields = (current.customFields ?? {}) as Record<string, unknown>;
    const customFields: Record<string, unknown> = body.custom_fields === undefined
      ? { ...priorCustomFields }
      : { ...body.custom_fields };
    if (body.notes !== undefined) customFields.notes = body.notes;
    const changes = {
      ...(body.name !== undefined ? nameParts(body.name) : {}),
      ...(body.email !== undefined ? { email: body.email || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      ...(body.source !== undefined ? { sourceDetail: body.source || null } : {}),
      ...(body.address !== undefined ? { address: body.address ? { line1: body.address } : null } : {}),
      ...(body.custom_fields !== undefined || body.notes !== undefined ? { customFields } : {}),
      updatedAt: new Date(),
    };
    const [updated] = await tx.update(leads).set(changes).where(and(eq(leads.id, id), eq(leads.tenantId, tenantId))).returning({ id: leads.id });
    if (!updated) throw new DomainError("NOT_FOUND", "Record not found.", 404);
    await tx.insert(domainEvents).values({
      tenantId, eventType: "lead.updated", actorType: "api_credential", actorId: credentialId,
      entityType: "lead", entityId: id, payload: eventPayload(fields),
    });
    await tx.insert(auditEvents).values({
      tenantId, actorType: "api_credential", actorId: credentialId, action: "public_api.lead.update",
      entityType: "lead", entityId: id, beforeData: { fields }, afterData: { fields },
    });
  });
  const [item] = await queryResource("leads", tenantId, { id, limit: 1 });
  if (!item) throw new DomainError("NOT_FOUND", "Record not found.", 404);
  return json({ item: presentResourceRow("leads", item) });
}

/** Bearer-token API resources. These paths bypass session actors, but never credential scopes. */
export async function handlePublicApi(request: Request, path: string[]): Promise<Response | null> {
  if (path[0] !== "public") return null;
  const resource = path[1] as PublicResource;
  const config = resources[resource];
  // The same public namespace also contains the existing slug-based website API.
  // Leave its actions to handlePublicSite; malformed paths under a machine resource
  // are still claimed here and return a normalized 404.
  if (!config) return null;
  const id = path[2];
  const validOperation = path.length === 2 && (request.method === "GET" || request.method === "POST")
    || path.length === 3 && (request.method === "GET" || request.method === "PATCH");
  if (!validOperation) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);

  const credential = await resolveApiCredentialFromRequest(request);
  if (!credential) throw new DomainError("UNAUTHENTICATED", "A valid API credential is required.", 401);
  const access = request.method === "GET" ? "read" : "write";
  requireScope(credential, config.scope, access);

  if (request.method === "GET") {
    return id ? readOne(resource, id, credential.tenantId) : listResource(request, resource, credential.tenantId);
  }
  if (request.method === "POST" && !id && resource === "customers") return createCustomer(credential.tenantId, credential.credentialId, request);
  if (request.method === "POST" && !id && resource === "leads") return createLead(credential.tenantId, credential.credentialId, request);
  if (request.method === "PATCH" && id && resource === "customers") return updateCustomer(credential.tenantId, credential.credentialId, id, request);
  if (request.method === "PATCH" && id && resource === "leads") return updateLead(credential.tenantId, credential.credentialId, id, request);
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
