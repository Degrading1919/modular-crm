import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { customers, estimateApprovals, estimates, invoiceItems, invoices, jobs, jobInvoiceLinks, servicePlans } from "@modular-crm/db";
import { DomainError, requirePermission, type DocumentPricing } from "@modular-crm/domain";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { requireTenantFeature } from "./capability-enforcement";
import { storedLine } from "./document-lines";
import { recordEvent } from "./events";
import { json } from "./http";
import { normalized } from "./sql";
import { existingJobInvoice, requireInvoiceLocation } from "./job-billing";
export async function estimateInvoice(actor: SessionActor, id: string) {
  requireStaff(actor); requirePermission(actor,"estimates.read"); requirePermission(actor,"invoices.create");
  await requireTenantFeature(actor.tenantId,"invoicing");
  const outcome = await getDb().transaction(async tx => {
    const [estimate] = await tx.select().from(estimates).where(and(eq(estimates.tenantId,actor.tenantId),eq(estimates.id,id))).for("update");
    if (!estimate || !actor.allLocations && (!estimate.organizationLocationId || !actor.locationIds.has(estimate.organizationLocationId))) throw new DomainError("NOT_FOUND","Estimate not found.",404);
    if (estimate.status !== "approved" || !estimate.customerId) throw new DomainError("CONFLICT","Approve this estimate before creating its invoice.",409);
    const [existing] = await tx.select().from(invoices).where(and(eq(invoices.tenantId,actor.tenantId),sql`${invoices.billingSnapshot}->>'estimateId' = ${id}`)).limit(1);
    if (existing) { requireInvoiceLocation(actor, existing); return { item: existing,duplicate:true }; }
    const [approval] = await tx.select().from(estimateApprovals).where(and(eq(estimateApprovals.tenantId,actor.tenantId),eq(estimateApprovals.estimateId,id),eq(estimateApprovals.decision,"approved"))).orderBy(desc(estimateApprovals.occurredAt)).limit(1);
    const pricing = approval?.pricingSnapshot as unknown as DocumentPricing;
    if (!pricing?.items?.length) throw new DomainError("CONFLICT","This historical estimate has no approved line snapshot. Create an invoice with its recorded details.",409);
    const [plan] = await tx.select().from(servicePlans).where(and(eq(servicePlans.tenantId, actor.tenantId), sql`${servicePlans.pricingSnapshot}->>'estimateRevisionId' = ${approval!.estimateRevisionId}`)).limit(1);
    if (plan && (plan.billingConfiguration.timing === "on_completion" || plan.billingConfiguration.timing === undefined && ["per_job", "manual_invoice"].includes(String(plan.billingConfiguration.type)))) throw new DomainError("CONFLICT", "Visits on this plan are billed automatically. Complete the visits instead of billing the estimate again.", 409);
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, actor.tenantId), sql`${jobs.priceSnapshot}->>'estimateRevisionId' = ${approval!.estimateRevisionId}`)).orderBy(jobs.id).for("update");
    if (job) {
      if (!actor.allLocations && (!job.organizationLocationId || !actor.locationIds.has(job.organizationLocationId))) throw new DomainError("NOT_FOUND", "Job not found.", 404);
      const billed = await existingJobInvoice(tx, actor.tenantId, job.id);
      if (billed) { requireInvoiceLocation(actor, billed); return { item: billed, duplicate: true }; }
    }
    const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId,actor.tenantId),eq(customers.id,estimate.customerId))).limit(1);
    if (!customer) throw new DomainError("NOT_FOUND","Customer not found.",404);
    const [invoice] = await tx.insert(invoices).values({tenantId:actor.tenantId,organizationId:customer.organizationId,organizationLocationId:estimate.organizationLocationId,customerId:customer.id,status:"draft",invoiceNumber:`INV-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0,8).toUpperCase()}`,currency:estimate.currency,subtotalMinor:BigInt(pricing.subtotalMinor),discountMinor:BigInt(pricing.discountMinor),taxMinor:BigInt(pricing.taxMinor),totalMinor:BigInt(pricing.totalMinor),balanceMinor:BigInt(pricing.totalMinor),billingSnapshot:{...pricing,estimateId:id,serviceLocationId:estimate.serviceLocationId,estimateRevisionId:approval!.estimateRevisionId,businessName:actor.tenantName,customerName:customer.displayName}}).returning();
    await tx.insert(invoiceItems).values(pricing.items.map(line=>({tenantId:actor.tenantId,invoiceId:invoice!.id,jobId:job?.id ?? null,...storedLine(line)})));
    if (job) await tx.insert(jobInvoiceLinks).values({ tenantId: actor.tenantId, customerId: job.customerId, jobId: job.id, invoiceId: invoice!.id });
    await recordEvent(actor,{type:"invoice.created",entityType:"invoice",entityId:invoice!.id,auditAction:"invoice.create_from_estimate",payload:{estimateId:id,totalMinor:pricing.totalMinor},locationId:estimate.organizationLocationId},tx);
    return {item:invoice,duplicate:false};
  });
  return json(normalized(outcome),outcome.duplicate ? 200 : 201);
}
