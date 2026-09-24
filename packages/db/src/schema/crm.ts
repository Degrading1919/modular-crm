import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { active, currency, jsonObject, money, record, status } from "./columns.ts";
import { memberships, organizationLocations, organizations, tenants, user } from "./identity.ts";

export const customFieldDefinitions = pgTable("custom_field_definitions", {
  ...record(), tenantId: uuid("tenant_id").references(() => tenants.id), industryPackKey: text("industry_pack_key"),
  entityType: text("entity_type").notNull(), key: text("key").notNull(), label: text("label").notNull(),
  fieldType: text("field_type").notNull(), required: boolean("required").notNull().default(false),
  customerVisible: boolean("customer_visible").notNull().default(false), reportable: boolean("reportable").notNull().default(false),
  config: jsonObject("config"), sortOrder: integer("sort_order").notNull().default(0), active: active(),
}, (t) => [index("custom_fields_scope_idx").on(t.tenantId, t.entityType, t.key)]);

export const tags = pgTable("tags", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), name: text("name").notNull(),
  category: text("category"), colorToken: text("color_token"),
}, (t) => [uniqueIndex("tags_tenant_id_id_ux").on(t.tenantId, t.id), index("tags_tenant_name_idx").on(t.tenantId, t.name)]);

export const tagAssignments = pgTable("tag_assignments", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), tagId: uuid("tag_id").notNull().references(() => tags.id),
  entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(),
}, (t) => [uniqueIndex("tag_assignments_unique_ux").on(t.tenantId, t.tagId, t.entityType, t.entityId)]);

export const leadSources = pgTable("lead_sources", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), name: text("name").notNull(),
  category: text("category").notNull(), active: active(),
}, (t) => [uniqueIndex("lead_sources_tenant_id_id_ux").on(t.tenantId, t.id)]);

export const customers = pgTable("customers", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  owningLocationId: uuid("owning_location_id").references(() => organizationLocations.id),
  customerType: text("customer_type").notNull().default("residential"), status: text("status").notNull().default("active"),
  displayName: text("display_name").notNull(), companyName: text("company_name"),
  primaryContactId: uuid("primary_contact_id"), billingEmail: text("billing_email"), billingPhone: text("billing_phone"),
  billingAddress: jsonb("billing_address").$type<Record<string, unknown>>(), taxExempt: boolean("tax_exempt").notNull().default(false),
  paymentTermsDays: integer("payment_terms_days"), leadSourceId: uuid("lead_source_id").references(() => leadSources.id),
  defaultCurrency: currency("default_currency"), customFields: jsonObject("custom_fields"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("customers_tenant_id_id_ux").on(t.tenantId, t.id),
  index("customers_org_status_idx").on(t.tenantId, t.organizationId, t.status),
  index("customers_location_idx").on(t.tenantId, t.owningLocationId),
  index("customers_name_idx").on(t.tenantId, sql`lower(${t.displayName})`),
  foreignKey({ columns: [t.tenantId, t.organizationId], foreignColumns: [organizations.tenantId, organizations.id], name: "customers_organization_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.owningLocationId], foreignColumns: [organizationLocations.tenantId, organizationLocations.id], name: "customers_location_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.organizationId, t.owningLocationId], foreignColumns: [organizationLocations.tenantId, organizationLocations.organizationId, organizationLocations.id], name: "customers_location_org_fk" }),
]);

export const customerContacts = pgTable("customer_contacts", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").notNull(),
  firstName: text("first_name").notNull(), lastName: text("last_name").notNull(), email: text("email"), phone: text("phone"),
  role: text("role"), isPrimary: boolean("is_primary").notNull().default(false),
  billingContact: boolean("billing_contact").notNull().default(false), serviceContact: boolean("service_contact").notNull().default(false),
  customFields: jsonObject("custom_fields"), active: active(),
}, (t) => [
  uniqueIndex("customer_contacts_tenant_id_id_ux").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "customer_contacts_customer_tenant_fk" }),
  index("customer_contacts_customer_idx").on(t.tenantId, t.customerId),
  uniqueIndex("customer_contacts_primary_ux").on(t.tenantId, t.customerId).where(sql`${t.isPrimary} = true`),
]);

export const serviceLocations = pgTable("service_locations", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").notNull(),
  organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id), name: text("name").notNull(),
  addressLine1: text("address_line1").notNull(), addressLine2: text("address_line2"), city: text("city").notNull(),
  region: text("region").notNull(), postalCode: text("postal_code").notNull(), countryCode: varchar("country_code", { length: 2 }).notNull().default("US"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }), longitude: numeric("longitude", { precision: 10, scale: 7 }),
  geocodeStatus: text("geocode_status").notNull().default("pending"), geocodeProvider: text("geocode_provider"),
  geocodeConfidence: numeric("geocode_confidence", { precision: 5, scale: 4 }), timezone: text("timezone"),
  accessInstructionsEncrypted: text("access_instructions_encrypted"), serviceZoneId: uuid("service_zone_id"),
  active: active(), customFields: jsonObject("custom_fields"),
}, (t) => [
  uniqueIndex("service_locations_tenant_id_id_ux").on(t.tenantId, t.id),
  uniqueIndex("service_locations_tenant_customer_id_ux").on(t.tenantId, t.customerId, t.id),
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "service_locations_customer_tenant_fk" }),
  index("service_locations_customer_idx").on(t.tenantId, t.customerId),
  foreignKey({ columns: [t.tenantId, t.organizationLocationId], foreignColumns: [organizationLocations.tenantId, organizationLocations.id], name: "service_locations_branch_tenant_fk" }),
]);

export const customerAssets = pgTable("customer_assets", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").notNull(),
  serviceLocationId: uuid("service_location_id").references(() => serviceLocations.id), assetTypeKey: text("asset_type_key").notNull(),
  name: text("name").notNull(), status: text("status").notNull().default("active"),
  customerVisible: boolean("customer_visible").notNull().default(true), customFields: jsonObject("custom_fields"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "customer_assets_customer_tenant_fk" }),
  index("customer_assets_location_idx").on(t.tenantId, t.serviceLocationId, t.assetTypeKey),
  foreignKey({ columns: [t.tenantId, t.serviceLocationId], foreignColumns: [serviceLocations.tenantId, serviceLocations.id], name: "customer_assets_location_tenant_fk" }),
]);

export const customerPreferences = pgTable("customer_preferences", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").notNull(),
  preferenceKey: text("preference_key").notNull(), value: jsonb("value").$type<unknown>().notNull(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "customer_preferences_customer_tenant_fk" }),
  uniqueIndex("customer_preferences_key_ux").on(t.tenantId, t.customerId, t.preferenceKey),
]);

export const portalAccess = pgTable("portal_access", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), userId: text("user_id").notNull().references(() => user.id),
  customerId: uuid("customer_id").notNull(), status: status(), invitedAt: timestamp("invited_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }), lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("portal_access_tenant_id_id_ux").on(t.tenantId, t.id),
  uniqueIndex("portal_access_user_customer_ux").on(t.tenantId, t.userId, t.customerId),
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "portal_access_customer_tenant_fk" }),
]);

export const portalLocationAccess = pgTable("portal_location_access", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  portalAccessId: uuid("portal_access_id").notNull().references(() => portalAccess.id),
  serviceLocationId: uuid("service_location_id").notNull().references(() => serviceLocations.id),
}, (t) => [
  primaryKey({ columns: [t.portalAccessId, t.serviceLocationId] }),
  foreignKey({ columns: [t.tenantId, t.portalAccessId], foreignColumns: [portalAccess.tenantId, portalAccess.id], name: "portal_location_access_portal_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.serviceLocationId], foreignColumns: [serviceLocations.tenantId, serviceLocations.id], name: "portal_location_access_location_tenant_fk" }),
]);

export const customerChangeRequests = pgTable("customer_change_requests", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").notNull().references(() => customers.id),
  serviceLocationId: uuid("service_location_id").references(() => serviceLocations.id), requestType: text("request_type").notNull(),
  status: status(), requestedChanges: jsonObject("requested_changes"), appliedChanges: jsonb("applied_changes").$type<Record<string, unknown>>(),
  customerMessage: text("customer_message"), internalNote: text("internal_note"), submittedByUserId: text("submitted_by_user_id").references(() => user.id),
  reviewedByMembershipId: uuid("reviewed_by_membership_id").references(() => memberships.id), reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (t) => [index("customer_change_requests_customer_idx").on(t.tenantId, t.customerId, t.status)]);

export const leads = pgTable("leads", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  owningLocationId: uuid("owning_location_id").references(() => organizationLocations.id), status: status(),
  firstName: text("first_name"), lastName: text("last_name"), companyName: text("company_name"), email: text("email"), phone: text("phone"),
  address: jsonb("address").$type<Record<string, unknown>>(), sourceId: uuid("source_id").references(() => leadSources.id),
  sourceDetail: text("source_detail"), customerId: uuid("customer_id").references(() => customers.id), serviceLocationId: uuid("service_location_id").references(() => serviceLocations.id),
  estimatedValueMinor: bigint("estimated_value_minor", { mode: "bigint" }), currency: varchar("currency", { length: 3 }),
  lostReason: text("lost_reason"), customFields: jsonObject("custom_fields"), convertedAt: timestamp("converted_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("leads_tenant_id_id_ux").on(t.tenantId, t.id),
  index("leads_tenant_status_idx").on(t.tenantId, t.status),
  index("leads_tenant_source_idx").on(t.tenantId, t.sourceId),
  index("leads_tenant_created_idx").on(t.tenantId, t.createdAt),
  foreignKey({ columns: [t.tenantId, t.organizationId], foreignColumns: [organizations.tenantId, organizations.id], name: "leads_organization_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.owningLocationId], foreignColumns: [organizationLocations.tenantId, organizationLocations.id], name: "leads_location_tenant_fk" }),
]);

export const services = pgTable("services", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  organizationId: uuid("organization_id").references(() => organizations.id), key: text("key").notNull(), name: text("name").notNull(),
  description: text("description"), serviceType: text("service_type").notNull(), defaultDurationMinutes: integer("default_duration_minutes"),
  taxable: boolean("taxable").notNull().default(false), active: active(), configuration: jsonObject("configuration"), customFields: jsonObject("custom_fields"),
}, (t) => [
  uniqueIndex("services_tenant_id_id_ux").on(t.tenantId, t.id), uniqueIndex("services_tenant_key_ux").on(t.tenantId, t.key),
  foreignKey({ columns: [t.tenantId, t.organizationId], foreignColumns: [organizations.tenantId, organizations.id], name: "services_organization_tenant_fk" }),
]);

export const products = pgTable("products", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), sku: text("sku"), name: text("name").notNull(),
  description: text("description"), taxable: boolean("taxable").notNull().default(false), inventoryItemId: uuid("inventory_item_id"),
  active: active(), customFields: jsonObject("custom_fields"),
}, (t) => [uniqueIndex("products_tenant_id_id_ux").on(t.tenantId, t.id), index("products_tenant_sku_idx").on(t.tenantId, t.sku)]);

export const serviceZones = pgTable("service_zones", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(), zoneType: text("zone_type").notNull(), definition: jsonObject("definition"),
  pricingPriority: integer("pricing_priority").notNull().default(0), active: active(),
}, (t) => [index("service_zones_org_idx").on(t.tenantId, t.organizationId)]);

export const priceRules = pgTable("price_rules", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(), priority: integer("priority").notNull().default(0), effectiveFrom: date("effective_from"), effectiveTo: date("effective_to"),
  conditions: jsonObject("conditions"), effects: jsonObject("effects"), active: active(), source: text("source").notNull().default("tenant"),
}, (t) => [index("price_rules_tenant_active_idx").on(t.tenantId, t.active, t.priority)]);

export const estimates = pgTable("estimates", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").references(() => customers.id),
  leadId: uuid("lead_id").references(() => leads.id), serviceLocationId: uuid("service_location_id").references(() => serviceLocations.id),
  organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id), status: status(),
  currentRevision: integer("current_revision").notNull().default(1), expiresAt: timestamp("expires_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }), declinedAt: timestamp("declined_at", { withTimezone: true }),
  currency: currency(), totalMinor: money("total_minor"), createdByMembershipId: uuid("created_by_membership_id").references(() => memberships.id),
}, (t) => [uniqueIndex("estimates_tenant_id_id_ux").on(t.tenantId, t.id), index("estimates_tenant_status_idx").on(t.tenantId, t.status)]);

export const estimateRevisions = pgTable("estimate_revisions", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), estimateId: uuid("estimate_id").notNull().references(() => estimates.id),
  revisionNumber: integer("revision_number").notNull(), subtotalMinor: money("subtotal_minor"), discountMinor: money("discount_minor"),
  taxMinor: money("tax_minor"), totalMinor: money("total_minor"), termsText: text("terms_text"), termsVersion: text("terms_version"),
  notes: text("notes"), snapshot: jsonObject("snapshot"), sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("estimate_revisions_number_ux").on(t.estimateId, t.revisionNumber),
  uniqueIndex("estimate_revisions_tenant_estimate_id_ux").on(t.tenantId, t.estimateId, t.id),
]);

export const estimateItems = pgTable("estimate_items", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), estimateRevisionId: uuid("estimate_revision_id").notNull().references(() => estimateRevisions.id),
  serviceId: uuid("service_id").references(() => services.id), productId: uuid("product_id").references(() => products.id),
  description: text("description").notNull(), quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  unitAmountMinor: money("unit_amount_minor"), discountMinor: money("discount_minor"), taxMinor: money("tax_minor"),
  totalMinor: money("total_minor"), sortOrder: integer("sort_order").notNull().default(0), metadata: jsonObject("metadata"),
});

export const secureEstimateTokens = pgTable("secure_estimate_tokens", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), estimateId: uuid("estimate_id").notNull(),
  estimateRevisionId: uuid("estimate_revision_id").notNull(), tokenHash: text("token_hash").notNull(),
  allowedActions: text("allowed_actions").array().notNull().default(sql`ARRAY['approve', 'decline']::text[]`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }),
  consumedAction: text("consumed_action"), revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("secure_estimate_tokens_hash_ux").on(t.tokenHash),
  uniqueIndex("secure_estimate_tokens_tenant_estimate_id_ux").on(t.tenantId, t.estimateId, t.id),
  foreignKey({ columns: [t.tenantId, t.estimateId], foreignColumns: [estimates.tenantId, estimates.id], name: "secure_estimate_tokens_estimate_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.estimateId, t.estimateRevisionId], foreignColumns: [estimateRevisions.tenantId, estimateRevisions.estimateId, estimateRevisions.id], name: "secure_estimate_tokens_revision_tenant_fk" }),
  check("secure_estimate_tokens_actions_ck", sql`${t.allowedActions} <@ ARRAY['approve', 'decline']::text[] AND cardinality(${t.allowedActions}) > 0`),
  check("secure_estimate_tokens_consumed_ck", sql`(${t.consumedAt} IS NULL AND ${t.consumedAction} IS NULL) OR (${t.consumedAt} IS NOT NULL AND ${t.consumedAction} = ANY(${t.allowedActions}))`),
  index("secure_estimate_tokens_estimate_idx").on(t.tenantId, t.estimateId, t.expiresAt),
]);

export const estimateApprovals = pgTable("estimate_approvals", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), estimateId: uuid("estimate_id").notNull().references(() => estimates.id),
  estimateRevisionId: uuid("estimate_revision_id").notNull().references(() => estimateRevisions.id), decision: text("decision").notNull(),
  actorType: text("actor_type").notNull(), actorUserId: text("actor_user_id").references(() => user.id), secureTokenId: uuid("secure_token_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(), ipAddress: text("ip_address"),
  userAgent: text("user_agent"), termsVersion: text("terms_version"), comment: text("comment"),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.estimateId, t.secureTokenId], foreignColumns: [secureEstimateTokens.tenantId, secureEstimateTokens.estimateId, secureEstimateTokens.id], name: "estimate_approvals_secure_token_fk" }),
]);
