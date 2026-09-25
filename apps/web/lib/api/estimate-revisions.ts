import { and, eq, isNull, sql } from "drizzle-orm";
import { estimateItems, estimateRevisions, estimates, secureEstimateTokens, services } from "@modular-crm/db";
import { assertTransition, DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { requireTenantFeature } from "./capability-enforcement";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized } from "./sql";

// Keep the staff revision contract narrow: customer/lead and branch identity
// come from the locked estimate and cannot be reassigned by this request.
const revisionSchema = z.object({
  title: z.string().trim().min(1).max(500),
  totalCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  notes: z.string().max(10_000).optional(),
  serviceId: z.uuid().nullable().optional(),
}).strict();

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

    const serviceId = body.serviceId === undefined ? priorItems[0]?.serviceId ?? null : body.serviceId;
    let service: { id: string; name: string } | undefined;
    if (serviceId) {
      [service] = await tx.select({ id: services.id, name: services.name }).from(services).where(and(
        eq(services.id, serviceId), eq(services.tenantId, actor.tenantId), eq(services.organizationId, actor.organizationId),
      )).limit(1);
      if (!service) throw new DomainError("NOT_FOUND", "Service not found.", 404);
    }

    const totalMinor = BigInt(body.totalCents);
    const revisionNumber = current.currentRevision + 1;
    const notes = body.notes === undefined ? priorRevision.notes : body.notes;
    const priorSnapshot = record(priorRevision.snapshot);
    const pricingSnapshot = {
      currency: current.currency,
      subtotalMinor: body.totalCents,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: body.totalCents,
    };
    const snapshot = {
      ...priorSnapshot,
      title: body.title,
      serviceId,
      serviceName: service?.name ?? (serviceId ? priorSnapshot.serviceName ?? null : null),
      notes: notes ?? null,
      totalCents: body.totalCents,
      pricingSnapshot,
    };

    const [revision] = await tx.insert(estimateRevisions).values({
      tenantId: actor.tenantId,
      estimateId: current.id,
      revisionNumber,
      subtotalMinor: totalMinor,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor,
      notes,
      termsText: priorRevision.termsText,
      termsVersion: priorRevision.termsVersion,
      snapshot,
    }).returning();
    if (!revision) throw new Error("Could not save estimate revision.");

    await tx.insert(estimateItems).values({
      tenantId: actor.tenantId,
      estimateRevisionId: revision.id,
      serviceId,
      description: body.title,
      quantity: "1",
      unitAmountMinor: totalMinor,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor,
      sortOrder: 0,
    });

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
      payload: { revisionNumber, totalCents: body.totalCents },
      auditAction: "estimate.revise",
      before: { status: current.status, currentRevision: current.currentRevision, totalMinor: Number(current.totalMinor) },
      after: { status: "draft", currentRevision: revisionNumber, totalMinor: body.totalCents },
      locationId: current.organizationLocationId,
    }, tx);

    return { ...saved, revision, items: [{ serviceId, description: body.title, quantity: "1", unitAmountMinor: totalMinor, totalMinor }] };
  });

  return json({ item: normalized(updated) });
}
