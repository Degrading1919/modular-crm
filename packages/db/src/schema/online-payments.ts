import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { invoices } from "./finance.ts";
import { organizations, tenants } from "./identity.ts";
import { connectorInstallations } from "./systems.ts";

/** Account references themselves stay in the installation's bound encrypted credentials. */
export const onlinePaymentAccounts = pgTable("online_payment_accounts", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  organizationId: uuid("organization_id").notNull(), installationId: uuid("installation_id").notNull(),
  provider: text("provider").notNull(), accountHash: text("account_hash"), allowPartial: boolean("allow_partial").notNull().default(false),
  chargesEnabled: boolean("charges_enabled").notNull().default(false), detailsNeeded: boolean("details_needed").notNull().default(true),
}, (t) => [
  uniqueIndex("online_accounts_tenant_id_id_ux").on(t.tenantId, t.id),
  uniqueIndex("online_accounts_branch_ux").on(t.tenantId, t.organizationId),
  uniqueIndex("online_accounts_provider_hash_ux").on(t.provider, t.accountHash),
  foreignKey({ columns: [t.tenantId, t.organizationId], foreignColumns: [organizations.tenantId, organizations.id], name: "online_accounts_organization_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.installationId], foreignColumns: [connectorInstallations.tenantId, connectorInstallations.id], name: "online_accounts_installation_tenant_fk" }),
]);
export const onlinePaymentSessions = pgTable("online_payment_sessions", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  invoiceId: uuid("invoice_id").notNull(), accountId: uuid("account_id").notNull(),
  clientKey: text("client_key").notNull(), amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(), currency: text("currency").notNull(),
  providerReference: text("provider_reference"), paymentReference: text("payment_reference"), url: text("url"),
  status: text("status").notNull().default("creating"), failureMessage: text("failure_message"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id], name: "online_sessions_invoice_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.accountId], foreignColumns: [onlinePaymentAccounts.tenantId, onlinePaymentAccounts.id], name: "online_sessions_account_tenant_fk" }),
  uniqueIndex("online_sessions_client_key_ux").on(t.tenantId, t.invoiceId, t.clientKey),
  uniqueIndex("online_sessions_provider_ux").on(t.accountId, t.providerReference),
  index("online_sessions_invoice_idx").on(t.tenantId, t.invoiceId, t.status),
  check("online_sessions_positive_amount", sql`${t.amountMinor} > 0`),
]);
export const onlinePaymentEvents = pgTable("online_payment_events", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  accountId: uuid("account_id").notNull(), providerEventId: text("provider_event_id").notNull(), payloadHash: text("payload_hash").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.accountId], foreignColumns: [onlinePaymentAccounts.tenantId, onlinePaymentAccounts.id], name: "online_events_account_tenant_fk" }),
  uniqueIndex("online_events_provider_id_ux").on(t.accountId, t.providerEventId),
]);
