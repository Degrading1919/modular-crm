import { and, asc, eq, isNull } from "drizzle-orm";
import { customers, estimateItems, estimateRevisions, estimates, leads, secureEstimateTokens, serviceLocations, type Database } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody } from "./http";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Estimate = Pick<typeof estimates.$inferSelect, "id" | "customerId" | "leadId" | "serviceLocationId" | "organizationLocationId">;
const text = z.string().trim().min(1).max(200);
const addressSchema = z.object({ line1: text, line2: z.string().trim().max(200).optional(), city: text, region: text, postalCode: text, countryCode: z.string().regex(/^[A-Z]{2}$/).default("US") });
export const propertyMessage = "Add a complete service address below before sending or approving this estimate.";

export async function estimateProperty(db: Database | Tx, tenantId: string, estimate: Estimate) {
  const [lead] = estimate.leadId ? await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, estimate.leadId))) : [];
  const customerId = estimate.customerId ?? lead?.customerId;
  const [customer] = customerId ? await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId))) : [];
  const properties = customer ? await db.select().from(serviceLocations).where(and(eq(serviceLocations.tenantId, tenantId), eq(serviceLocations.customerId, customer.id), eq(serviceLocations.active, true), estimate.serviceLocationId ? eq(serviceLocations.id, estimate.serviceLocationId) : lead?.serviceLocationId ? eq(serviceLocations.id, lead.serviceLocationId) : estimate.organizationLocationId ? eq(serviceLocations.organizationLocationId, estimate.organizationLocationId) : undefined)).orderBy(asc(serviceLocations.createdAt), asc(serviceLocations.id)).limit(2) : [];
  const property = properties.length === 1 ? properties[0] : undefined;
  const address = property ? { line1: property.addressLine1, line2: property.addressLine2 ?? "", city: property.city, region: property.region, postalCode: property.postalCode, countryCode: property.countryCode } : !customer ? lead?.address ?? {} : {};
  const scopeMatches = property ? !estimate.organizationLocationId || property.organizationLocationId === estimate.organizationLocationId : !!lead && (!lead.owningLocationId || lead.owningLocationId === estimate.organizationLocationId);
  return { ready: !!scopeMatches && addressSchema.safeParse(address).success, address, sourceUpdatedAt: (property?.updatedAt ?? lead?.updatedAt)?.toISOString() ?? null, property, customer, lead };
}

/** Run under the estimate lock before a token, conversion, or work is created. */
export async function requireEstimateProperty(db: Database | Tx, tenantId: string, estimate: Estimate) {
  const source = await estimateProperty(db, tenantId, estimate);
  if (!source.ready) throw new DomainError("VALIDATION_ERROR", propertyMessage, 422, { fix: "service_address" });
  return source;
}

export async function handleEstimateProperty(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length !== 3 || path[0] !== "estimates" || path[2] !== "service-address" || !["GET", "POST"].includes(request.method)) return null;
  requireStaff(actor); requirePermission(actor, "estimates.read");
  z.uuid().parse(path[1]);
  const input = request.method === "POST" ? await readBody(request, z.object({ address: addressSchema, expectedUpdatedAt: z.iso.datetime({ offset: true }), sourceUpdatedAt: z.iso.datetime({ offset: true }) }).strict()) : null;
  const result = await getDb().transaction(async tx => {
    const [estimate] = await tx.select().from(estimates).where(and(eq(estimates.tenantId, actor.tenantId), eq(estimates.id, path[1]!))).for("update");
    if (!estimate || !actor.allLocations && (!estimate.organizationLocationId || !actor.locationIds.has(estimate.organizationLocationId))) throw new DomainError("NOT_FOUND", "Estimate not found.", 404);
    const source = await estimateProperty(tx, actor.tenantId, estimate);
    const contact = source.customer ?? source.lead;
    if (!contact || contact.organizationId !== actor.organizationId) throw new DomainError("NOT_FOUND", "Estimate not found.", 404);
    if (!input) return { ready: source.ready, address: source.address, sourceUpdatedAt: source.sourceUpdatedAt };
    requirePermission(actor, "estimates.update_draft");
    requirePermission(actor, source.customer ? "customers.update" : "leads.update");
    if (!["draft", "sent", "viewed"].includes(estimate.status) || source.ready) throw new DomainError("CONFLICT", "This estimate does not need an address correction. Refresh its details.", 409);
    if (estimate.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new DomainError("CONFLICT", "This estimate changed. Refresh before adding its address.", 409);
    const now = new Date();
    if (source.customer && source.property) {
      const [property] = await tx.select().from(serviceLocations).where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.id, source.property.id))).for("update");
      if (!property || property.updatedAt.toISOString() !== input.sourceUpdatedAt) throw new DomainError("CONFLICT", "This property changed. Refresh before editing its address.", 409);
      if (!actor.allLocations && (!property.organizationLocationId || !actor.locationIds.has(property.organizationLocationId))) throw new DomainError("NOT_FOUND", "Property not found.", 404);
      await tx.update(serviceLocations).set({ addressLine1: input.address.line1, addressLine2: input.address.line2 ?? null, city: input.address.city, region: input.address.region, postalCode: input.address.postalCode, countryCode: input.address.countryCode, geocodeStatus: "pending", latitude: null, longitude: null, updatedAt: now }).where(and(eq(serviceLocations.tenantId, actor.tenantId), eq(serviceLocations.id, property.id)));
    } else if (!source.customer && source.lead) {
      const [lead] = await tx.select().from(leads).where(and(eq(leads.tenantId, actor.tenantId), eq(leads.id, source.lead.id))).for("update");
      if (!lead || lead.customerId || lead.updatedAt.toISOString() !== input.sourceUpdatedAt) throw new DomainError("CONFLICT", "This lead changed. Refresh before adding its address.", 409);
      if (!actor.allLocations && (!lead.owningLocationId || !actor.locationIds.has(lead.owningLocationId))) throw new DomainError("NOT_FOUND", "Lead not found.", 404);
      await tx.update(leads).set({ address: input.address, owningLocationId: lead.owningLocationId ?? estimate.organizationLocationId, updatedAt: now }).where(and(eq(leads.tenantId, actor.tenantId), eq(leads.id, lead.id)));
    } else throw new DomainError("CONFLICT", "Choose a service property on the customer record first.", 409);
    const [prior] = await tx.select().from(estimateRevisions).where(and(eq(estimateRevisions.tenantId, actor.tenantId), eq(estimateRevisions.estimateId, estimate.id), eq(estimateRevisions.revisionNumber, estimate.currentRevision)));
    if (!prior) throw new DomainError("CONFLICT", "Estimate revision is missing.", 409);
    const lines = await tx.select().from(estimateItems).where(and(eq(estimateItems.tenantId, actor.tenantId), eq(estimateItems.estimateRevisionId, prior.id)));
    // Never edit a sent document. Preserve its prices/terms in a new revision
    // and revoke old links; resending delivers the corrected address.
    const [revision] = await tx.insert(estimateRevisions).values({ tenantId: actor.tenantId, estimateId: estimate.id, revisionNumber: estimate.currentRevision + 1, subtotalMinor: prior.subtotalMinor, discountMinor: prior.discountMinor, taxMinor: prior.taxMinor, totalMinor: prior.totalMinor, notes: prior.notes, termsText: prior.termsText, termsVersion: prior.termsVersion, snapshot: { ...prior.snapshot, serviceAddress: input.address } }).returning();
    await tx.insert(estimateItems).values(lines.map(({ id: _id, createdAt: _created, updatedAt: _updated, ...line }) => { void _id; void _created; void _updated; return { ...line, estimateRevisionId: revision!.id }; }));
    await tx.update(secureEstimateTokens).set({ revokedAt: now, updatedAt: now }).where(and(eq(secureEstimateTokens.tenantId, actor.tenantId), eq(secureEstimateTokens.estimateId, estimate.id), isNull(secureEstimateTokens.consumedAt), isNull(secureEstimateTokens.revokedAt)));
    await tx.update(estimates).set({ currentRevision: revision!.revisionNumber, serviceLocationId: source.property?.id ?? estimate.serviceLocationId, updatedAt: now }).where(and(eq(estimates.tenantId, actor.tenantId), eq(estimates.id, estimate.id)));
    await recordEvent(actor, { type: "estimate.address_added", entityType: "estimate", entityId: estimate.id, auditAction: "estimate.address_add", locationId: estimate.organizationLocationId, payload: { revisionId: revision!.id, sourceId: source.property?.id ?? source.lead?.id } }, tx);
    await recordEvent(actor, { type: source.customer ? "customer.updated" : "lead.updated", entityType: source.customer ? "customer" : "lead", entityId: contact.id, auditAction: "service_address.complete", locationId: estimate.organizationLocationId, payload: { estimateId: estimate.id } }, tx);
    return { ready: true };
  });
  return json({ item: result });
}
