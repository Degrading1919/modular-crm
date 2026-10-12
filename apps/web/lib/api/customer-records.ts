import { and, eq } from "drizzle-orm";
import { customerContacts, customers, notes, serviceLocations } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { fieldsSchema, storePackFields, tenantIndustryPack } from "./pack-fields";

const text = z.string().trim().min(1).max(200);
const version = z.iso.datetime({ offset: true });
export async function handleCustomerRecords(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  const [resource, customerId, section, id] = path;
  if (resource !== "customers" || !customerId || !["properties", "contacts", "notes"].includes(section ?? "") || ![3, 4].includes(path.length) || !["POST", "PATCH"].includes(request.method)) return null;
  requireStaff(actor); requirePermission(actor, "customers.update");
  z.uuid().parse(customerId); if (id) z.uuid().parse(id);
  if ((request.method === "PATCH") !== !!id || section === "notes" && id) throw new DomainError("NOT_FOUND", "Customer action not found.", 404);
  const pack = await tenantIndustryPack(actor.tenantId);
  const schema = section === "properties" ? z.object({ name: text, addressLine1: text, addressLine2: z.string().trim().max(200).optional(), city: text, region: text, postalCode: text, countryCode: z.string().regex(/^[A-Z]{2}$/).default("US"), locationFields: fieldsSchema(pack.locationFields, true).optional(), expectedUpdatedAt: version.optional() }).strict()
    : section === "contacts" ? z.object({ firstName: text, lastName: z.string().trim().max(200), email: z.email().or(z.literal("")).optional(), phone: z.string().trim().max(100).optional(), billingContact: z.boolean().default(false), serviceContact: z.boolean().default(true), expectedUpdatedAt: version.optional() }).strict()
    : z.object({ body: z.string().trim().min(1).max(10_000) }).strict();
  const input = await readBody(request, schema as z.ZodType<Record<string, any>>);
  const result = await getDb().transaction(async tx => {
    const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, actor.tenantId), eq(customers.organizationId, actor.organizationId!), eq(customers.id, customerId))).for("update");
    if (!customer || !actor.allLocations && (!customer.owningLocationId || !actor.locationIds.has(customer.owningLocationId))) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
    let itemId: string;
    if (section === "properties") {
      const current = id ? (await tx.select().from(serviceLocations).where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.customerId, customerId), eq(serviceLocations.id, id), eq(serviceLocations.active, true))).for("update"))[0] : undefined;
      if (id && (!current || !actor.allLocations && (!current.organizationLocationId || !actor.locationIds.has(current.organizationLocationId)))) throw new DomainError("NOT_FOUND", "Service property not found.", 404);
      if (current && current.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new DomainError("CONFLICT", "This property changed. Refresh before editing it.", 409);
      const { expectedUpdatedAt: _version, locationFields, ...address } = input;
      void _version;
      const stored = storePackFields(pack.locationFields.filter(field => locationFields && Object.hasOwn(locationFields, field.key)), locationFields ?? {});
      const values = { ...address, customFields: { ...current?.customFields, ...stored.customFields }, ...(stored.accessInstructionsEncrypted ? { accessInstructionsEncrypted: stored.accessInstructionsEncrypted } : {}), geocodeStatus: "pending", latitude: null, longitude: null, updatedAt: new Date() };
      const [saved] = current ? await tx.update(serviceLocations).set(values).where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.id, current.id))).returning({ id: serviceLocations.id }) : await tx.insert(serviceLocations).values({ ...values, tenantId: actor.tenantId, customerId, organizationLocationId: customer.owningLocationId } as typeof serviceLocations.$inferInsert).returning({ id: serviceLocations.id });
      itemId = saved!.id;
    } else if (section === "contacts") {
      const current = id ? (await tx.select().from(customerContacts).where(and(eq(customerContacts.tenantId, actor.tenantId), eq(customerContacts.customerId, customerId), eq(customerContacts.id, id))).for("update"))[0] : undefined;
      if (id && !current) throw new DomainError("NOT_FOUND", "Contact not found.", 404);
      if (current && current.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new DomainError("CONFLICT", "This contact changed. Refresh before editing it.", 409);
      const { expectedUpdatedAt: _version, ...fields } = input;
      void _version;
      const values = { ...fields, email: input.email || null, phone: input.phone || null, updatedAt: new Date() };
      const [saved] = current ? await tx.update(customerContacts).set(values).where(and(eq(customerContacts.tenantId, actor.tenantId), eq(customerContacts.id, current.id))).returning({ id: customerContacts.id }) : await tx.insert(customerContacts).values({ ...values, tenantId: actor.tenantId, customerId } as typeof customerContacts.$inferInsert).returning({ id: customerContacts.id });
      itemId = saved!.id;
    } else {
      const [saved] = await tx.insert(notes).values({ tenantId: actor.tenantId, entityType: "customer", entityId: customerId, body: input.body, createdByActorType: "staff", createdByActorId: actor.userId }).returning({ id: notes.id }); itemId = saved!.id;
    }
    // Never copy private pack values (or contact/note text) into audit payloads.
    await recordEvent(actor, { type: "customer.updated", entityType: "customer", entityId: customerId, auditAction: `customer.${section}.${id ? "update" : "create"}`, locationId: customer.owningLocationId, payload: { section, itemId } }, tx);
    return { id: itemId };
  });
  return json({ item: result }, id ? 200 : 201);
}
