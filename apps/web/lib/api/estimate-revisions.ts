import { and, eq, isNull, sql } from "drizzle-orm";
import { customers,leads,estimateItems, estimateRevisions, estimates, secureEstimateTokens, services } from "@modular-crm/db";
import { assertTransition, DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { requireTenantFeature } from "./capability-enforcement";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized } from "./sql";
import { documentPricing, pricingFields, storedLine } from "./document-lines";

// Keep the staff revision contract narrow: customer/lead and branch identity
// come from the locked estimate and cannot be reassigned by this request.
const revisionSchema = z.object({
  title: z.string().trim().min(1).max(500),
  totalCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  notes: z.string().max(10_000).optional(),
  serviceId: z.uuid().nullable().optional(),
  ...pricingFields,
}).strict().refine(body => !!body.lines || body.totalCents !== undefined,"Add estimate lines.");

function assertEstimateLocation(actor: SessionActor, locationId: string | null): void {
  requireStaff(actor);
  if (!actor.allLocations && (!locationId || !actor.locationIds.has(locationId))) {
    throw new DomainError("NOT_FOUND", "Estimate not found.", 404);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Create a new immutable estimate revision and make it the current draft. */
export async function reviseEstimate(request: Request, estimateId: string, actor: SessionActor): Promise<Response> {
  requireStaff(actor);
  requirePermission(actor, "estimates.update_draft");
  await requireTenantFeature(actor.tenantId, "estimate_management");
  const body = await readBody(request, revisionSchema);
  const db = getDb();

  const updated = await db.transaction(async (tx) => {
    // Match the estimate-first lock order used by send and secure-link reads.
    await tx.execute(sql`SELECT id FROM estimates WHERE tenant_id = ${actor.tenantId} AND id = ${estimateId} FOR UPDATE`);
    const [current] = await tx.select().from(estimates).where(and(
      eq(estimates.id, estimateId), eq(estimates.tenantId, actor.tenantId),
    )).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "Estimate not found.", 404);
    assertEstimateLocation(actor, current.organizationLocationId);
    if (!["draft", "declined", "expired"].includes(current.status)) {
      throw new DomainError("INVALID_TRANSITION", "Only draft, declined, or expired estimates can be revised.", 409);
    }
    if (current.status !== "draft") assertTransition("estimate", current.status, "draft");

    const [priorRevision] = await tx.select().from(estimateRevisions).where(and(
      eq(estimateRevisions.tenantId, actor.tenantId),
      eq(estimateRevisions.estimateId, current.id),
      eq(estimateRevisions.revisionNumber, current.currentRevision),
    )).limit(1);
    if (!priorRevision) throw new DomainError("CONFLICT", "The current estimate revision is missing.", 409);
    const priorItems = await tx.select().from(estimateItems).where(and(
      eq(estimateItems.tenantId, actor.tenantId), eq(estimateItems.estimateRevisionId, priorRevision.id),
    )).orderBy(estimateItems.sortOrder);

    const serviceId = body.lines ? body.lines.find(line=>line.serviceId)?.serviceId ?? null : body.serviceId === undefined ? priorItems[0]?.serviceId ?? null : body.serviceId;
    const [contact] = current.customerId
      ? await tx.select({organizationId:customers.organizationId}).from(customers).where(and(eq(customers.tenantId,actor.tenantId),eq(customers.id,current.customerId))).limit(1)
      : current.leadId ? await tx.select({organizationId:leads.organizationId}).from(leads).where(and(eq(leads.tenantId,actor.tenantId),eq(leads.id,current.leadId))).limit(1) : [];
    if(!contact) throw new DomainError("NOT_FOUND","Estimate contact not found.",404);
    let service: { id: string; name: string } | undefined;
    if (serviceId) {
      [service] = await tx.select({ id: services.id, name: services.name }).from(services).where(and(
        eq(services.id, serviceId), eq(services.tenantId, actor.tenantId), eq(services.organizationId, contact.organizationId),
      )).limit(1);
      if (!service) throw new DomainError("NOT_FOUND", "Service not found.", 404);
    }

    const pricing = await documentPricing(tx,actor.tenantId,contact.organizationId,{...body,serviceId},true);
    const totalMinor = BigInt(pricing.totalMinor);
    const revisionNumber = current.currentRevision + 1;
    const notes = body.notes === undefined ? priorRevision.notes : body.notes;
    const priorSnapshot = record(priorRevision.snapshot);
    const pricingSnapshot = {
      currency: current.currency,
      ...pricing,
    };
    const snapshot = {
      ...priorSnapshot,
      title: body.title,
      serviceId,
      serviceName: service?.name ?? (serviceId ? priorSnapshot.serviceName ?? null : null),
      notes: notes ?? null,
      totalCents: pricing.totalMinor,
      pricingSnapshot,
    };

    const [revision] = await tx.insert(estimateRevisions).values({
      tenantId: actor.tenantId,
      estimateId: current.id,
      revisionNumber,
      subtotalMinor: BigInt(pricing.subtotalMinor),
      discountMinor: BigInt(pricing.discountMinor),
      taxMinor: BigInt(pricing.taxMinor),
      totalMinor,
      notes,
      termsText: priorRevision.termsText,
      termsVersion: priorRevision.termsVersion,
      snapshot,
    }).returning();
    if (!revision) throw new Error("Could not save estimate revision.");

    await tx.insert(estimateItems).values(pricing.items.map(line => ({
      tenantId: actor.tenantId,
      estimateRevisionId: revision.id,
      ...storedLine(line),
    })));

    const now = new Date();
    // Revoke outstanding links for older revisions. Consumed tokens remain as
    // immutable decision history, while new sends issue a fresh revision-bound token.
    await tx.update(secureEstimateTokens).set({ revokedAt: now, updatedAt: now }).where(and(
      eq(secureEstimateTokens.tenantId, actor.tenantId),
      eq(secureEstimateTokens.estimateId, current.id),
      isNull(secureEstimateTokens.consumedAt),
      isNull(secureEstimateTokens.revokedAt),
    ));

    const [saved] = await tx.update(estimates).set({
      status: "draft",
      currentRevision: revisionNumber,
      totalMinor,
      expiresAt: null,
      declinedAt: null,
      approvedAt: null,
      updatedAt: now,
    }).where(and(eq(estimates.id, current.id), eq(estimates.tenantId, actor.tenantId))).returning();
    if (!saved) throw new Error("Could not update estimate.");

    await recordEvent(actor, {
      type: "estimate.revised",
      entityType: "estimate",
      entityId: current.id,
      payload: { revisionNumber, totalCents: pricing.totalMinor },
      auditAction: "estimate.revise",
      before: { status: current.status, currentRevision: current.currentRevision, totalMinor: Number(current.totalMinor) },
      after: { status: "draft", currentRevision: revisionNumber, totalMinor: pricing.totalMinor },
      locationId: current.organizationLocationId,
    }, tx);

    return { ...saved, revision, items: pricing.items };
  });

  return json({ item: normalized(updated) });
}
