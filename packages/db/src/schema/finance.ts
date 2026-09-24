import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { active, currency, jsonObject, money, record, status } from "./columns.ts";
import { memberships, organizationLocations, organizations, tenants } from "./identity.ts";
import { customers, products, services } from "./crm.ts";
import { jobs, routePlans, servicePlans } from "./operations.ts";

export const invoices = pgTable("invoices", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id), customerId: uuid("customer_id").notNull(),
  status: status(), invoiceNumber: text("invoice_number").notNull(), currency: currency(),
  issuedAt: timestamp("issued_at", { withTimezone: true }), dueAt: timestamp("due_at", { withTimezone: true }),
  subtotalMinor: money("subtotal_minor"), discountMinor: money("discount_minor"), taxMinor: money("tax_minor"),
  totalMinor: money("total_minor"), paidMinor: money("paid_minor"), balanceMinor: money("balance_minor"),
  termsSnapshot: text("terms_snapshot"), billingSnapshot: jsonObject("billing_snapshot"),
  voidedAt: timestamp("voided_at", { withTimezone: true }), writtenOffAt: timestamp("written_off_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("invoices_tenant_id_id_ux").on(t.tenantId, t.id), uniqueIndex("invoices_tenant_customer_id_ux").on(t.tenantId, t.customerId, t.id), uniqueIndex("invoices_number_ux").on(t.tenantId, t.invoiceNumber),
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "invoices_customer_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.organizationId], foreignColumns: [organizations.tenantId, organizations.id], name: "invoices_organization_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.organizationLocationId], foreignColumns: [organizationLocations.tenantId, organizationLocations.id], name: "invoices_branch_tenant_fk" }),
  index("invoices_customer_idx").on(t.tenantId, t.customerId), index("invoices_status_due_idx").on(t.tenantId, t.status, t.dueAt),
  check("invoices_amounts_nonnegative", sql`${t.subtotalMinor} >= 0 AND ${t.discountMinor} >= 0 AND ${t.taxMinor} >= 0 AND ${t.totalMinor} >= 0 AND ${t.paidMinor} >= 0 AND ${t.balanceMinor} >= 0`),
]);

export const invoiceItems = pgTable("invoice_items", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), invoiceId: uuid("invoice_id").notNull(),
  jobId: uuid("job_id").references(() => jobs.id), serviceId: uuid("service_id").references(() => services.id), productId: uuid("product_id").references(() => products.id),
  description: text("description").notNull(), quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  unitAmountMinor: money("unit_amount_minor"), discountMinor: money("discount_minor"), taxMinor: money("tax_minor"),
  totalMinor: money("total_minor"), metadata: jsonObject("metadata"), sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id], name: "invoice_items_invoice_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id], name: "invoice_items_job_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.serviceId], foreignColumns: [services.tenantId, services.id], name: "invoice_items_service_tenant_fk" }),
  index("invoice_items_invoice_idx").on(t.tenantId, t.invoiceId),
]);

export const payments = pgTable("payments", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").notNull(),
  status: status(), sourceType: text("source_type").notNull(), connectorInstallationId: uuid("connector_installation_id"),
  providerReference: text("provider_reference"), amountMinor: money("amount_minor"), currency: currency(),
  receivedAt: timestamp("received_at", { withTimezone: true }), failureCode: text("failure_code"), failureMessage: text("failure_message"),
  idempotencyKey: text("idempotency_key").notNull(), recordedByActorType: text("recorded_by_actor_type").notNull(),
  recordedByActorId: text("recorded_by_actor_id"),
}, (t) => [
  uniqueIndex("payments_tenant_id_id_ux").on(t.tenantId, t.id), uniqueIndex("payments_idempotency_ux").on(t.tenantId, t.idempotencyKey),
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "payments_customer_tenant_fk" }),
  index("payments_customer_idx").on(t.tenantId, t.customerId), index("payments_status_received_idx").on(t.tenantId, t.status, t.receivedAt),
  check("payments_amount_nonnegative", sql`${t.amountMinor} >= 0`),
]);

export const paymentAllocations = pgTable("payment_allocations", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), paymentId: uuid("payment_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(), amountMinor: money("amount_minor"),
}, (t) => [
  uniqueIndex("payment_allocations_payment_invoice_ux").on(t.paymentId, t.invoiceId),
  foreignKey({ columns: [t.tenantId, t.paymentId], foreignColumns: [payments.tenantId, payments.id], name: "payment_allocations_payment_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id], name: "payment_allocations_invoice_tenant_fk" }),
  check("payment_allocations_amount_nonnegative", sql`${t.amountMinor} >= 0`),
]);

export const refunds = pgTable("refunds", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  paymentId: uuid("payment_id").notNull(), connectorInstallationId: uuid("connector_installation_id"),
  providerReference: text("provider_reference"), amountMinor: money("amount_minor"), currency: currency(), status: status(),
  reason: text("reason"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.paymentId], foreignColumns: [payments.tenantId, payments.id], name: "refunds_payment_tenant_fk" }),
  index("refunds_payment_idx").on(t.tenantId, t.paymentId), check("refunds_amount_nonnegative", sql`${t.amountMinor} >= 0`),
]);

export const paymentMethodReferences = pgTable("payment_method_references", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").notNull().references(() => customers.id),
  connectorInstallationId: uuid("connector_installation_id").notNull(), providerCustomerRef: text("provider_customer_ref"),
  providerMethodRef: text("provider_method_ref").notNull(), methodType: text("method_type").notNull(), brand: text("brand"),
  last4: text("last4"), expiryMonth: integer("expiry_month"), expiryYear: integer("expiry_year"),
  isDefault: boolean("is_default").notNull().default(false), status: status(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "payment_methods_customer_tenant_fk" }),
  uniqueIndex("payment_methods_default_ux").on(t.tenantId, t.customerId, t.connectorInstallationId).where(sql`${t.isDefault} = true`),
]);

export const tips = pgTable("tips", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerId: uuid("customer_id").notNull().references(() => customers.id), jobId: uuid("job_id").references(() => jobs.id),
  membershipId: uuid("membership_id").references(() => memberships.id), paymentId: uuid("payment_id").references(() => payments.id),
  amountMinor: money("amount_minor"), currency: currency(), tipType: text("tip_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "tips_customer_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id], name: "tips_job_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id], name: "tips_membership_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.paymentId], foreignColumns: [payments.tenantId, payments.id], name: "tips_payment_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.customerId, t.jobId], foreignColumns: [jobs.tenantId, jobs.customerId, jobs.id], name: "tips_job_customer_fk" }),
]);

export const customerCredits = pgTable("customer_credits", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerId: uuid("customer_id").notNull().references(() => customers.id), sourceType: text("source_type").notNull(), sourceEntityId: uuid("source_entity_id"),
  originalAmountMinor: money("original_amount_minor"), remainingAmountMinor: money("remaining_amount_minor"), currency: currency(),
  status: status(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("customer_credits_tenant_id_id_ux").on(t.tenantId, t.id),
  uniqueIndex("customer_credits_tenant_customer_id_ux").on(t.tenantId, t.customerId, t.id),
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "customer_credits_customer_tenant_fk" }),
]);

export const creditAllocations = pgTable("credit_allocations", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerCreditId: uuid("customer_credit_id").notNull(), invoiceId: uuid("invoice_id").notNull(),
  amountMinor: money("amount_minor"), allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.customerCreditId], foreignColumns: [customerCredits.tenantId, customerCredits.id], name: "credit_allocations_credit_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id], name: "credit_allocations_invoice_tenant_fk" }),
]);

export const creditMemos = pgTable("credit_memos", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerId: uuid("customer_id").notNull(), invoiceId: uuid("invoice_id"),
  amountMinor: money("amount_minor"), currency: currency(), reason: text("reason").notNull(), status: status(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(), appliedAt: timestamp("applied_at", { withTimezone: true }),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "credit_memos_customer_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id], name: "credit_memos_invoice_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.customerId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.customerId, invoices.id], name: "credit_memos_invoice_customer_fk" }),
]);

export const taxRules = pgTable("tax_rules", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id),
  name: text("name").notNull(), conditions: jsonObject("conditions"), rateBasisPoints: integer("rate_basis_points"),
  externalTaxCode: text("external_tax_code"), priority: integer("priority").notNull().default(0), active: active(),
});

export const billingSchedules = pgTable("billing_schedules", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), servicePlanId: uuid("service_plan_id").notNull().references(() => servicePlans.id),
  billingType: text("billing_type").notNull(), intervalConfig: jsonObject("interval_config"), autopay: boolean("autopay").notNull().default(false),
  nextBillAt: timestamp("next_bill_at", { withTimezone: true }), active: active(),
}, (t) => [foreignKey({ columns: [t.tenantId, t.servicePlanId], foreignColumns: [servicePlans.tenantId, servicePlans.id], name: "billing_schedules_plan_tenant_fk" })]);

export const compensationProfiles = pgTable("compensation_profiles", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), membershipId: uuid("membership_id").notNull().references(() => memberships.id),
  effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to"), hourlyRateMinor: bigint("hourly_rate_minor", { mode: "bigint" }),
  overtimeConfiguration: jsonObject("overtime_configuration"), perJobConfiguration: jsonObject("per_job_configuration"),
  commissionConfiguration: jsonObject("commission_configuration"), mileageRateMinorPerUnit: bigint("mileage_rate_minor_per_unit", { mode: "bigint" }),
  bonusConfiguration: jsonObject("bonus_configuration"), currency: currency(),
}, (t) => [index("compensation_profiles_member_idx").on(t.tenantId, t.membershipId, t.effectiveFrom)]);

export const payrollPeriods = pgTable("payroll_periods", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  periodStart: date("period_start").notNull(), periodEnd: date("period_end").notNull(), status: status(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }), approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByMembershipId: uuid("approved_by_membership_id").references(() => memberships.id), exportedAt: timestamp("exported_at", { withTimezone: true }),
}, (t) => [uniqueIndex("payroll_periods_range_ux").on(t.tenantId, t.organizationId, t.periodStart, t.periodEnd)]);

export const payrollCalculations = pgTable("payroll_calculations", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), payrollPeriodId: uuid("payroll_period_id").notNull().references(() => payrollPeriods.id),
  membershipId: uuid("membership_id").notNull().references(() => memberships.id), version: integer("version").notNull(),
  grossAmountMinor: money("gross_amount_minor"), currency: currency(), calculationSnapshot: jsonObject("calculation_snapshot"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("payroll_calculations_version_ux").on(t.payrollPeriodId, t.membershipId, t.version)]);

export const payrollComponents = pgTable("payroll_components", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), payrollCalculationId: uuid("payroll_calculation_id").notNull().references(() => payrollCalculations.id),
  componentType: text("component_type").notNull(), sourceEntityType: text("source_entity_type"), sourceEntityId: uuid("source_entity_id"),
  description: text("description").notNull(), quantity: numeric("quantity", { precision: 14, scale: 4 }), rateMinor: bigint("rate_minor", { mode: "bigint" }),
  amountMinor: money("amount_minor"), metadata: jsonObject("metadata"),
});

export const inventoryItems = pgTable("inventory_items", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), sku: text("sku"), name: text("name").notNull(),
  description: text("description"), unit: text("unit").notNull(), tracked: boolean("tracked").notNull().default(true),
  serialized: boolean("serialized").notNull().default(false), defaultCostMinor: bigint("default_cost_minor", { mode: "bigint" }),
  currency: text("currency"), active: active(), customFields: jsonObject("custom_fields"),
}, (t) => [uniqueIndex("inventory_items_tenant_id_id_ux").on(t.tenantId, t.id), index("inventory_items_sku_idx").on(t.tenantId, t.sku)]);

export const inventoryLocations = pgTable("inventory_locations", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id),
  membershipId: uuid("membership_id").references(() => memberships.id), name: text("name").notNull(), locationType: text("location_type").notNull(), active: active(),
}, (t) => [uniqueIndex("inventory_locations_tenant_id_id_ux").on(t.tenantId, t.id)]);

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id),
  inventoryLocationId: uuid("inventory_location_id").notNull().references(() => inventoryLocations.id),
  linkedMovementId: uuid("linked_movement_id"), movementType: text("movement_type").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(), unitCostMinor: bigint("unit_cost_minor", { mode: "bigint" }),
  currency: text("currency"), jobId: uuid("job_id").references(() => jobs.id), reason: text("reason"),
  actorMembershipId: uuid("actor_membership_id").references(() => memberships.id),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(), metadata: jsonObject("metadata"),
}, (t) => [index("stock_movements_balance_idx").on(t.tenantId, t.inventoryItemId, t.inventoryLocationId, t.occurredAt)]);

export const jobMaterialUsage = pgTable("job_material_usage", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), jobId: uuid("job_id").notNull().references(() => jobs.id),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id),
  inventoryLocationId: uuid("inventory_location_id").notNull().references(() => inventoryLocations.id),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(), stockMovementId: uuid("stock_movement_id").notNull().references(() => stockMovements.id),
});

export const vendors = pgTable("vendors", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), name: text("name").notNull(),
  contactName: text("contact_name"), email: text("email"), phone: text("phone"), website: text("website"),
  address: jsonb("address").$type<Record<string, unknown>>(), accountReference: text("account_reference"), active: active(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id), status: status(),
  orderNumber: text("order_number").notNull(), orderedAt: timestamp("ordered_at", { withTimezone: true }),
  expectedAt: timestamp("expected_at", { withTimezone: true }), receivedAt: timestamp("received_at", { withTimezone: true }),
  subtotalMinor: money("subtotal_minor"), taxMinor: money("tax_minor"), totalMinor: money("total_minor"), currency: currency(), notes: text("notes"),
}, (t) => [uniqueIndex("purchase_orders_number_ux").on(t.tenantId, t.orderNumber)]);

export const purchaseOrderItems = pgTable("purchase_order_items", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id), description: text("description").notNull(),
  quantityOrdered: numeric("quantity_ordered", { precision: 14, scale: 4 }).notNull(), quantityReceived: numeric("quantity_received", { precision: 14, scale: 4 }).notNull().default("0"),
  unitCostMinor: money("unit_cost_minor"), totalMinor: money("total_minor"),
});

export const reorderRules = pgTable("reorder_rules", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id),
  inventoryLocationId: uuid("inventory_location_id").notNull().references(() => inventoryLocations.id),
  reorderThreshold: numeric("reorder_threshold", { precision: 14, scale: 4 }).notNull(), targetQuantity: numeric("target_quantity", { precision: 14, scale: 4 }),
  active: active(),
}, (t) => [uniqueIndex("reorder_rules_item_location_ux").on(t.inventoryItemId, t.inventoryLocationId)]);
