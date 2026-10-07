import { and, eq, inArray, sql } from "drizzle-orm";
import { invoiceItems, invoices, jobInvoiceLinks, jobs, servicePlans } from "@modular-crm/db";
import { assertTransition, DomainError, requirePermission } from "@modular-crm/domain";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { lockSourceEstimates, requireInvoiceLocation } from "./job-billing";
import { recordEvent } from "./events";
import { expireExcessHostedPages } from "./hosted-page-expiry";
import { json } from "./http";
import { normalized } from "./sql";

export async function voidInvoice(actor: SessionActor, id: string) {
  requireStaff(actor); requirePermission(actor, "invoices.void");
  const db = getDb();
  const result = await db.transaction(async tx => {
    const [accessible] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, id)));
    if (!accessible) throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
    requireInvoiceLocation(actor, accessible);
    // Billing order: estimate → jobs → plans → invoice. Preserve frozen invoice lines as history.
    const candidates = await tx.select({ job: jobs }).from(invoiceItems).innerJoin(jobs, and(eq(jobs.tenantId, invoiceItems.tenantId), eq(jobs.id, invoiceItems.jobId))).where(and(eq(invoiceItems.tenantId, actor.tenantId), eq(invoiceItems.invoiceId, id)));
    const linked = await tx.select({ job: jobs }).from(jobInvoiceLinks).innerJoin(jobs, and(eq(jobs.tenantId, jobInvoiceLinks.tenantId), eq(jobs.id, jobInvoiceLinks.jobId))).where(and(eq(jobInvoiceLinks.tenantId, actor.tenantId), eq(jobInvoiceLinks.invoiceId, id)));
    const work = [...new Map([...candidates, ...linked].map(item => [item.job.id, item.job])).values()];
    await lockSourceEstimates(tx, actor.tenantId, work);
    if (work.length) await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.tenantId, actor.tenantId), inArray(jobs.id, work.map(job => job.id)))).orderBy(jobs.id).for("update");
    const plans = await tx.select().from(servicePlans).where(and(eq(servicePlans.tenantId, actor.tenantId), sql`${servicePlans.billingConfiguration}->>'oneTimeInvoiceId' = ${id}`)).orderBy(servicePlans.id).for("update");
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, id))).for("update");
    requireInvoiceLocation(actor, invoice!);
    if (invoice!.status === "void") return { item: invoice, duplicate: true };
    assertTransition("invoice", invoice!.status, "void");
    const [payment] = await tx.execute(sql`select pa.id from payment_allocations pa join payments p on p.tenant_id=pa.tenant_id and p.id=pa.payment_id where pa.tenant_id=${actor.tenantId} and pa.invoice_id=${id} and p.status='succeeded' limit 1`).then(result => result.rows);
    if (invoice!.paidMinor > 0n || payment) throw new DomainError("CONFLICT", "This invoice has recorded payments. Review its payments instead of voiding it.", 409);
    const now = new Date();
    const [saved] = await tx.update(invoices).set({ status: "void", voidedAt: now, balanceMinor: 0n, updatedAt: now }).where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, id))).returning();
    await tx.delete(jobInvoiceLinks).where(and(eq(jobInvoiceLinks.tenantId, actor.tenantId), eq(jobInvoiceLinks.invoiceId, id)));
    for (const plan of plans) { const configuration = { ...plan.billingConfiguration }; delete configuration.oneTimeInvoiceId; await tx.update(servicePlans).set({ billingConfiguration: configuration, updatedAt: now }).where(and(eq(servicePlans.tenantId, actor.tenantId), eq(servicePlans.id, plan.id))); }
    await recordEvent(actor, { type: "invoice.void", entityType: "invoice", entityId: id, locationId: invoice!.organizationLocationId, auditAction: "invoice.void", before: { status: invoice!.status }, after: { status: "void" }, payload: { releasedVisits: work.length } }, tx);
    return { item: saved, duplicate: false };
  });
  await expireExcessHostedPages(actor.tenantId, id);
  return json(normalized(result));
}
