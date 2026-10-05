import { and, eq, inArray, sql } from "drizzle-orm";
import { invoices, onlinePaymentAccounts, onlinePaymentSessions } from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { readServerConfig } from "@modular-crm/config";
import { z } from "zod";
import { getDb } from "../db";
import { assertCustomerDocumentAccess, type SessionActor } from "./actor";
import { json, readBody } from "./http";
import { onlineForAccount } from "./online-payment-accounts";
import { requireTenantFeature } from "./capability-enforcement";

export async function readableOnlineInvoice(actor: SessionActor, invoiceId: string, collect = true) {
  const [invoice] = await getDb().select().from(invoices).where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoiceId))).limit(1);
  if (!invoice) throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
  if (actor.kind === "staff") {
    requirePermission(actor, collect ? "payments.collect" : "invoices.read");
    if (!actor.allLocations && (!invoice.organizationLocationId || !actor.locationIds.has(invoice.organizationLocationId))) throw new DomainError("NOT_FOUND", "Invoice not found.", 404);
  } else await assertCustomerDocumentAccess(actor, invoice.customerId, invoice.organizationLocationId);
  return invoice;
}

export async function handleOnlinePaymentSession(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  const invoicePath = path[0] === "portal" ? path.slice(1) : path;
  if (invoicePath.length !== 3 || invoicePath[0] !== "invoices" || invoicePath[2] !== "checkout" || request.method !== "POST") return null;
  await requireTenantFeature(actor.tenantId, "invoicing");
  await requireTenantFeature(actor.tenantId, "payment_collection");
  const invoice = await readableOnlineInvoice(actor, invoicePath[1]!);
  const body = await readBody(request, z.object({ idempotencyKey: z.string().trim().min(1).max(200), amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict());
  const [account] = await getDb().select().from(onlinePaymentAccounts).where(and(eq(onlinePaymentAccounts.tenantId, actor.tenantId), eq(onlinePaymentAccounts.organizationId, invoice.organizationId))).limit(1);
  if (!account || !account.chargesEnabled) throw new DomainError("EXTERNAL_SERVICE_ERROR", "Online payments are not available. Contact your service team to arrange payment.", 503);
  const online = await onlineForAccount(account);
  const db = getDb();
  const session = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where tenant_id=${actor.tenantId} and id=${invoice.id} for update`);
    const [current] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoice.id))).limit(1);
    if (!current || !["issued", "partially_paid", "overdue"].includes(current.status) || current.balanceMinor <= 0n) throw new DomainError("CONFLICT", "This invoice no longer has a balance to pay.", 409);
    const amount = body.amountCents ?? Number(current.balanceMinor);
    if (!Number.isSafeInteger(amount) || amount > Number(current.balanceMinor) || (!account.allowPartial && amount !== Number(current.balanceMinor))) throw new DomainError("VALIDATION_ERROR", account.allowPartial ? "Enter an amount no greater than the open balance." : "This invoice must be paid in full.", 422);
    const [prior] = await tx.select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.tenantId, actor.tenantId), eq(onlinePaymentSessions.invoiceId, invoice.id), eq(onlinePaymentSessions.clientKey, body.idempotencyKey))).limit(1);
    if (prior) {
      if (prior.amountMinor !== BigInt(amount)) throw new DomainError("IDEMPOTENCY_CONFLICT", "This payment retry was used for a different amount.", 409);
      if (["expired", "succeeded"].includes(prior.status)) throw new DomainError("CONFLICT", "Start a new payment for the current balance.", 409);
      return prior;
    }
    // A declined card does not close the hosted page: recover it, or expire it before replacement.
    const active = await tx.select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.tenantId, actor.tenantId), eq(onlinePaymentSessions.invoiceId, invoice.id), inArray(onlinePaymentSessions.status, ["creating", "open", "failed"])));
    for (const pending of active) {
      if (pending.expiresAt > new Date() && pending.amountMinor === BigInt(amount)) return pending;
      if (pending.expiresAt > new Date() && !pending.providerReference) throw new DomainError("CONFLICT", "A payment page is still being prepared. Retry that payment before changing the amount.", 409);
      // The provider enforces this deadline too; expiring an already expired page is rejected.
      if (pending.providerReference && pending.expiresAt > new Date()) await online.expireHostedPage(pending.providerReference);
      await tx.update(onlinePaymentSessions).set({ status: "expired" }).where(eq(onlinePaymentSessions.id, pending.id));
    }
    const [created] = await tx.insert(onlinePaymentSessions).values({ tenantId: actor.tenantId, invoiceId: invoice.id, accountId: account.id, clientKey: body.idempotencyKey, amountMinor: BigInt(amount), currency: current.currency, expiresAt: new Date(Date.now() + 60 * 60 * 1000) }).returning();
    return created!;
  });
  if (session.expiresAt <= new Date()) throw new DomainError("CONFLICT", "This payment page has expired. Start a new payment.", 409);
  let url = session.url;
  if (!url) {
    const base = readServerConfig(process.env).appBaseUrl;
    const result = await online.createHostedPage({ invoiceReference: invoice.invoiceNumber, requestReference: session.id, amountMinor: Number(session.amountMinor), currency: session.currency,
      idempotencyKey: `checkout:${session.id}`, expiresAt: Math.floor(session.expiresAt.getTime() / 1000), returnUrl: new URL("/portal/billing?payment=processing", base).toString(), cancelUrl: new URL("/portal/billing", base).toString() });
    await db.update(onlinePaymentSessions).set({ url: result.url, providerReference: result.reference, status: "open" }).where(and(eq(onlinePaymentSessions.id, session.id), eq(onlinePaymentSessions.tenantId, actor.tenantId), eq(onlinePaymentSessions.status, "creating")));
    url = result.url;
  }
  return json({ item: { url, amountCents: Number(session.amountMinor), currency: session.currency } });
}
