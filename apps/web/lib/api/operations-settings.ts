import { and, eq } from "drizzle-orm";
import { customers, jobs, servicePlans, tenants } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { existingJobInvoice } from "./job-billing";
import { assignableTechnician } from "./job-planning";
import { json, readBody } from "./http";
import { normalized } from "./sql";

export async function handleOperationsSettings(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length !== 3 || request.method !== "POST" || !(path[0] === "jobs" && path[2] === "price" || path[0] === "service-plans" && path[2] === "assignment")) return null;
  requireStaff(actor);
  const id = z.uuid().parse(path[1]);
  if (path[0] === "jobs") {
    requirePermission(actor, "jobs.update");
    const body = await readBody(request, z.object({ priceCents: z.number().int().min(0).max(100_000_000), expectedUpdatedAt: z.iso.datetime({ offset: true }) }).strict());
    const item = await getDb().transaction(async tx => {
      const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.organizationId, actor.organizationId), eq(jobs.id, id))).for("update");
      if (!job || !actor.allLocations && (!job.organizationLocationId || !actor.locationIds.has(job.organizationLocationId))) throw new DomainError("NOT_FOUND", "Job not found.", 404);
      if (job.updatedAt.toISOString() !== body.expectedUpdatedAt) throw new DomainError("CONFLICT", "This visit changed. Refresh before setting its price.", 409);
      if (job.servicePlanId || job.priceSnapshot?.estimateRevisionId || await existingJobInvoice(tx, actor.tenantId, id)) throw new DomainError("CONFLICT", "This visit already has agreed or invoiced pricing. Review its original document instead.", 409);
      if (["canceled", "skipped", "missed"].includes(job.status)) throw new DomainError("CONFLICT", "Withdrawn work cannot be priced for billing.", 409);
      if (job.actualStartedAt && job.priceSnapshot) throw new DomainError("CONFLICT", "A started visit keeps its recorded price.", 409);
      const [tenant] = await tx.select({ currency: tenants.defaultCurrency }).from(tenants).where(eq(tenants.id, actor.tenantId));
      const priceSnapshot = { amountMinor: body.priceCents, currency: tenant?.currency ?? "USD", source: "office" };
      const [saved] = await tx.update(jobs).set({ priceSnapshot, updatedAt: new Date() }).where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, id))).returning();
      await recordEvent(actor, { type: "job.price_recorded", entityType: "job", entityId: id, locationId: job.organizationLocationId, auditAction: "job.set_price", before: { priceSnapshot: job.priceSnapshot }, after: { priceSnapshot } }, tx);
      return saved;
    });
    return json({ item: normalized(item) });
  }
  requirePermission(actor, "service_plans.update"); requirePermission(actor, "jobs.assign");
  const body = await readBody(request, z.object({ technicianId: z.uuid().nullable(), expectedUpdatedAt: z.iso.datetime({ offset: true }) }).strict());
  const item = await getDb().transaction(async tx => {
    const [plan] = await tx.select().from(servicePlans).where(and(eq(servicePlans.tenantId, actor.tenantId), eq(servicePlans.id, id))).for("update");
    if (!plan || !actor.allLocations && (!plan.organizationLocationId || !actor.locationIds.has(plan.organizationLocationId))) throw new DomainError("NOT_FOUND", "Service plan not found.", 404);
    if (plan.updatedAt.toISOString() !== body.expectedUpdatedAt) throw new DomainError("CONFLICT", "This plan changed. Refresh before changing its assigned worker.", 409);
    const [customer] = await tx.select({ organizationId: customers.organizationId }).from(customers).where(and(eq(customers.tenantId, actor.tenantId), eq(customers.organizationId, actor.organizationId), eq(customers.id, plan.customerId)));
    if (!customer) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
    if (body.technicianId) await assignableTechnician(tx, actor, { organizationId: customer.organizationId, organizationLocationId: plan.organizationLocationId }, body.technicianId);
    const preferredAssignment = body.technicianId ? { membershipId: body.technicianId } : null;
    const [saved] = await tx.update(servicePlans).set({ preferredAssignment, updatedAt: new Date() }).where(and(eq(servicePlans.tenantId, actor.tenantId), eq(servicePlans.id, id))).returning();
    await recordEvent(actor, { type: "service_plan.assignment_changed", entityType: "service_plan", entityId: id, locationId: plan.organizationLocationId, auditAction: "service_plan.assign", before: { preferredAssignment: plan.preferredAssignment }, after: { preferredAssignment } }, tx);
    return saved;
  });
  return json({ item: normalized(item) });
}
