import { and, eq } from "drizzle-orm";
import { connectorInstallations, customerContacts, customers, hasUsableFeature, invoices, loadTenantCapabilities, onlinePaymentAccounts, type Database } from "@modular-crm/db";
import { readServerConfig } from "@modular-crm/config";

/** A login-protected action link, not a bearer payment token or proof of collection. */
export async function invoicePaymentEmailLink(db: Database, tenantId: string, invoiceId: string, customerId: string | undefined, recipient: string): Promise<string | undefined> {
  const [invoice] = await db.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId))).limit(1);
  if (!invoice || invoice.customerId !== customerId || !["issued", "partially_paid", "overdue"].includes(invoice.status) || invoice.balanceMinor <= 0n) return undefined;
  const [customer] = await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, invoice.customerId))).limit(1);
  const [contact] = await db.select().from(customerContacts).where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, invoice.customerId), eq(customerContacts.isPrimary, true))).limit(1);
  if (recipient.toLowerCase() !== (customer?.billingEmail ?? contact?.email ?? "").toLowerCase()) return undefined;
  const [account] = await db.select({ provider: onlinePaymentAccounts.provider, status: connectorInstallations.status }).from(onlinePaymentAccounts)
    .innerJoin(connectorInstallations, and(eq(connectorInstallations.tenantId, onlinePaymentAccounts.tenantId), eq(connectorInstallations.id, onlinePaymentAccounts.installationId)))
    .where(and(eq(onlinePaymentAccounts.tenantId, tenantId), eq(onlinePaymentAccounts.organizationId, invoice.organizationId), eq(onlinePaymentAccounts.chargesEnabled, true))).limit(1);
  const config = readServerConfig(process.env);
  if (!account || account.status !== "connected" || !(account.provider === "mock-payments" ? config.mockConnectors : account.provider === "stripe-online-payments" && config.stripePayments)) return undefined;
  const capabilities = await loadTenantCapabilities(db, tenantId);
  if (!hasUsableFeature(capabilities, "invoicing") || !hasUsableFeature(capabilities, "payment_collection")) return undefined;
  return new URL(`/portal/billing/${invoice.id}`, config.appBaseUrl).toString();
}
