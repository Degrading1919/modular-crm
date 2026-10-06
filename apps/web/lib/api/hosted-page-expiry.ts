import { logJson } from "@modular-crm/config/observability";
import { and, eq, inArray, sql } from "drizzle-orm";
import { invoices, onlinePaymentAccounts, onlinePaymentSessions } from "@modular-crm/db";
import { getDb } from "../db";
import { onlineForAccount } from "./online-payment-accounts";

/** Commit financial work first. Processor failure must never roll back recorded money. */
export async function expireExcessHostedPages(tenantId: string, invoiceId: string): Promise<void> {
  const db = getDb();
  const candidates = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where tenant_id=${tenantId} and id=${invoiceId} for update`);
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId))).limit(1);
    if (!invoice) return [];
    const balance = ["issued", "partially_paid", "overdue"].includes(invoice.status) && !invoice.voidedAt && !invoice.writtenOffAt ? invoice.balanceMinor : 0n;
    const active = await tx.select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.tenantId, tenantId), eq(onlinePaymentSessions.invoiceId, invoiceId), inArray(onlinePaymentSessions.status, ["creating", "open", "failed", "expire_pending"])));
    const excess = active.filter((row) => row.amountMinor > balance || row.status === "expire_pending");
    for (const row of excess) await tx.update(onlinePaymentSessions).set({ status: "expire_pending" }).where(eq(onlinePaymentSessions.id, row.id));
    return excess;
  });
  for (const session of candidates) {
    if (!session.providerReference) continue; // Creation response handler expires pages arriving later.
    try {
      const [account] = await db.select().from(onlinePaymentAccounts).where(and(eq(onlinePaymentAccounts.tenantId, tenantId), eq(onlinePaymentAccounts.id, session.accountId))).limit(1);
      if (!account) continue;
      if (session.expiresAt > new Date()) await (await onlineForAccount(account, true)).expireHostedPage(session.providerReference);
      await db.update(onlinePaymentSessions).set({ status: "expired" }).where(and(eq(onlinePaymentSessions.id, session.id), eq(onlinePaymentSessions.tenantId, tenantId), eq(onlinePaymentSessions.status, "expire_pending")));
    } catch {
      logJson("warn", "payment.page_expiry_pending", { invoiceId, sessionId: session.id });
    }
  }
}
