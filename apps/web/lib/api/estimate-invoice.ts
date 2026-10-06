import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { customers, estimateApprovals, estimates, invoiceItems, invoices } from "@modular-crm/db";
import { DomainError, requirePermission, type DocumentPricing } from "@modular-crm/domain";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { requireTenantFeature } from "./capability-enforcement";
import { storedLine } from "./document-lines";
import { recordEvent } from "./events";
import { json } from "./http";
import { normalized } from "./sql";
export async function estimateInvoice(actor: SessionActor, id: string) {
  requireStaff(actor); requirePermission(actor,"estimates.read"); requirePermission(actor,"invoices.create");
  await requireTenantFeature(actor.tenantId,"invoicing");
  const outcome = await getDb().transaction(async tx => {
    const [estimate] = await tx.select().from(estimates).where(and(eq(estimates.tenantId,actor.tenantId),eq(estimates.id,id))).for("update");
    if (!estimate || !actor.allLocations && (!estimate.organizationLocationId || !actor.locationIds.has(estimate.organizationLocationId))) throw new DomainError("NOT_FOUND","Estimate not found.",404);
    if (estimate.status !== "approved" || !estimate.customerId) throw new DomainError("CONFLICT","Approve this estimate before creating its invoice.",409);
    const [existing] = await tx.select().from(invoices).where(and(eq(invoices.tenantId,actor.tenantId),sql`${invoices.billingSnapshot}->>'estimateId' = ${id}`)).limit(1);
    if (existing) return { item: existing,duplicate:true };
    const [approval] = await tx.select().from(estimateApprovals).where(and(eq(estimateApprovals.tenantId,actor.tenantId),eq(estimateApprovals.estimateId,id),eq(estimateApprovals.decision,"approved"))).orderBy(desc(estimateApprovals.occurredAt)).limit(1);
    const pricing = approval?.pricingSnapshot as unknown as DocumentPricing;
    if (!pricing?.items?.length) throw new DomainError("CONFLICT","This historical estimate has no approved line snapshot. Create an invoice with its recorded details.",409);
    const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId,actor.tenantId),eq(customers.id,estimate.customerId))).limit(1);
    if (!customer) throw new DomainError("NOT_FOUND","Customer not found.",404);
    const [invoice] = await tx.insert(invoices).values({tenantId:actor.tenantId,organizationId:customer.organizationId,organizationLocationId:estimate.organizationLocationId,customerId:customer.id,status:"draft",invoiceNumber:`INV-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0,8).toUpperCase()}`,currency:estimate.currency,subtotalMinor:BigInt(pricing.subtotalMinor),discountMinor:BigInt(pricing.discountMinor),taxMinor:BigInt(pricing.taxMinor),totalMinor:BigInt(pricing.totalMinor),balanceMinor:BigInt(pricing.totalMinor),billingSnapshot:{...pricing,estimateId:id,serviceLocationId:estimate.serviceLocationId,estimateRevisionId:approval!.estimateRevisionId,businessName:actor.tenantName,customerName:customer.displayName}}).returning();
    await tx.insert(invoiceItems).values(pricing.items.map(line=>({tenantId:actor.tenantId,invoiceId:invoice!.id,...storedLine(line)})));
    await recordEvent(actor,{type:"invoice.created",entityType:"invoice",entityId:invoice!.id,auditAction:"invoice.create_from_estimate",payload:{estimateId:id,totalMinor:pricing.totalMinor},locationId:estimate.organizationLocationId},tx);
    return {item:invoice,duplicate:false};
  });
  return json(normalized(outcome),outcome.duplicate ? 200 : 201);
}
