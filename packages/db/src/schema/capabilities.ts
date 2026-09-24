import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { jsonObject, record } from "./columns.ts";
import { tenants } from "./identity.ts";

/** Global, data-defined product module catalog. Keys are stable identifiers, not module names baked into code. */
export const capabilityModules = pgTable("capability_modules", {
  ...record(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  lifecycleState: text("lifecycle_state").notNull().default("active"),
  availability: jsonObject("availability"),
  compatibility: jsonObject("compatibility"),
  metadata: jsonObject("metadata"),
}, (t) => [
  uniqueIndex("capability_modules_key_ux").on(t.key),
  index("capability_modules_state_idx").on(t.lifecycleState),
  check("capability_modules_key_nonempty_ck", sql`length(btrim(${t.key})) > 0`),
  check("capability_modules_name_nonempty_ck", sql`length(btrim(${t.name})) > 0`),
]);

/** Atomic functional capabilities supplied by modules. Connector capabilities remain a separate catalog. */
export const capabilityFeatures = pgTable("capability_features", {
  ...record(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  lifecycleState: text("lifecycle_state").notNull().default("active"),
  availability: jsonObject("availability"),
  metadata: jsonObject("metadata"),
}, (t) => [
  uniqueIndex("capability_features_key_ux").on(t.key),
  index("capability_features_state_idx").on(t.lifecycleState),
  check("capability_features_key_nonempty_ck", sql`length(btrim(${t.key})) > 0`),
  check("capability_features_name_nonempty_ck", sql`length(btrim(${t.name})) > 0`),
]);

/** Many-to-many grouping from functional features into independently entitlable modules. */
export const capabilityModuleFeatures = pgTable("capability_module_features", {
  moduleId: uuid("module_id").notNull().references(() => capabilityModules.id),
  featureId: uuid("feature_id").notNull().references(() => capabilityFeatures.id),
  sortOrder: integer("sort_order").notNull().default(0),
  // Describes the module's composition; every membership row is included in module entitlement.
  required: boolean("required").notNull().default(true),
}, (t) => [
  primaryKey({ columns: [t.moduleId, t.featureId] }),
  index("capability_module_features_feature_idx").on(t.featureId),
]);

/** Module-to-module dependency and compatibility rules, represented as catalog data. */
export const capabilityModuleDependencies = pgTable("capability_module_dependencies", {
  moduleId: uuid("module_id").notNull().references(() => capabilityModules.id),
  dependsOnModuleId: uuid("depends_on_module_id").notNull().references(() => capabilityModules.id),
  dependencyType: text("dependency_type").notNull().default("requires"),
  conditions: jsonObject("conditions"),
}, (t) => [
  primaryKey({ columns: [t.moduleId, t.dependsOnModuleId, t.dependencyType] }),
  index("capability_module_dependencies_target_idx").on(t.dependsOnModuleId),
  check("capability_module_dependencies_distinct_ck", sql`${t.moduleId} <> ${t.dependsOnModuleId}`),
  check("capability_module_dependencies_type_nonempty_ck", sql`length(btrim(${t.dependencyType})) > 0`),
]);

/** Feature-to-feature dependencies for cases where one functional capability requires another. */
export const capabilityFeatureDependencies = pgTable("capability_feature_dependencies", {
  featureId: uuid("feature_id").notNull().references(() => capabilityFeatures.id),
  dependsOnFeatureId: uuid("depends_on_feature_id").notNull().references(() => capabilityFeatures.id),
  dependencyType: text("dependency_type").notNull().default("requires"),
  conditions: jsonObject("conditions"),
}, (t) => [
  primaryKey({ columns: [t.featureId, t.dependsOnFeatureId, t.dependencyType] }),
  index("capability_feature_dependencies_target_idx").on(t.dependsOnFeatureId),
  check("capability_feature_dependencies_distinct_ck", sql`${t.featureId} <> ${t.dependsOnFeatureId}`),
  check("capability_feature_dependencies_type_nonempty_ck", sql`length(btrim(${t.dependencyType})) > 0`),
]);

/** Immutable grant history; current entitlement is derived from its effective interval and revocation. */
export const tenantCapabilityGrants = pgTable("tenant_capability_grants", {
  ...record(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  moduleId: uuid("module_id").notNull().references(() => capabilityModules.id),
  source: text("source").notNull(),
  sourceReference: text("source_reference"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  grantDetails: jsonObject("grant_details"),
}, (t) => [
  index("tenant_capability_grants_effective_idx").on(t.tenantId, t.moduleId, t.effectiveFrom, t.effectiveUntil),
  index("tenant_capability_grants_source_idx").on(t.tenantId, t.source, t.sourceReference),
  check("tenant_capability_grants_source_nonempty_ck", sql`length(btrim(${t.source})) > 0`),
  check("tenant_capability_grants_interval_ck", sql`${t.effectiveUntil} is null or ${t.effectiveUntil} > ${t.effectiveFrom}`),
]);

/** Tenant operational/configuration state, intentionally independent from commercial entitlement. */
export const tenantCapabilitySettings = pgTable("tenant_capability_settings", {
  ...record(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  moduleId: uuid("module_id").notNull().references(() => capabilityModules.id),
  enabled: boolean("enabled").notNull().default(true),
  configuration: jsonObject("configuration"),
  uiProminence: text("ui_prominence").notNull().default("standard"),
}, (t) => [
  uniqueIndex("tenant_capability_settings_module_ux").on(t.tenantId, t.moduleId),
  index("tenant_capability_settings_enabled_idx").on(t.tenantId, t.enabled),
  check("tenant_capability_settings_prominence_nonempty_ck", sql`length(btrim(${t.uiProminence})) > 0`),
]);

/** Provider-neutral commercial account anchor, one per tenant in the initial model. */
export const commercialAccounts = pgTable("commercial_accounts", {
  ...record(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  status: text("status").notNull().default("active"),
  accountReference: text("account_reference"),
  metadata: jsonObject("metadata"),
}, (t) => [
  uniqueIndex("commercial_accounts_tenant_ux").on(t.tenantId),
  uniqueIndex("commercial_accounts_tenant_id_id_ux").on(t.tenantId, t.id),
  check("commercial_accounts_status_nonempty_ck", sql`length(btrim(${t.status})) > 0`),
]);

/** Generic append-oriented commercial ledger for credits, promotions, and administrative adjustments. */
export const commercialAccountEntries = pgTable("commercial_account_entries", {
  ...record(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  commercialAccountId: uuid("commercial_account_id").notNull(),
  entryType: text("entry_type").notNull(),
  source: text("source").notNull(),
  sourceReference: text("source_reference"),
  quantity: numeric("quantity", { precision: 20, scale: 6 }),
  unitKey: text("unit_key"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  details: jsonObject("details"),
}, (t) => [
  uniqueIndex("commercial_account_entries_tenant_id_id_ux").on(t.tenantId, t.id),
  index("commercial_account_entries_account_time_idx").on(t.tenantId, t.commercialAccountId, t.effectiveFrom),
  index("commercial_account_entries_type_idx").on(t.tenantId, t.entryType, t.effectiveFrom),
  foreignKey({
    columns: [t.tenantId, t.commercialAccountId],
    foreignColumns: [commercialAccounts.tenantId, commercialAccounts.id],
    name: "commercial_account_entries_account_tenant_fk",
  }),
  check("commercial_account_entries_type_nonempty_ck", sql`length(btrim(${t.entryType})) > 0`),
  check("commercial_account_entries_source_nonempty_ck", sql`length(btrim(${t.source})) > 0`),
  check("commercial_account_entries_interval_ck", sql`${t.effectiveUntil} is null or ${t.effectiveUntil} > ${t.effectiveFrom}`),
]);

/** Data-defined meter catalog. A meter describes a quantity and aggregation, not a price. */
export const usageMeters = pgTable("usage_meters", {
  ...record(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  unitKey: text("unit_key").notNull(),
  aggregation: text("aggregation").notNull(),
  lifecycleState: text("lifecycle_state").notNull().default("active"),
  availability: jsonObject("availability"),
  configuration: jsonObject("configuration"),
}, (t) => [
  uniqueIndex("usage_meters_key_ux").on(t.key),
  index("usage_meters_state_idx").on(t.lifecycleState),
  check("usage_meters_key_nonempty_ck", sql`length(btrim(${t.key})) > 0`),
  check("usage_meters_name_nonempty_ck", sql`length(btrim(${t.name})) > 0`),
  check("usage_meters_unit_nonempty_ck", sql`length(btrim(${t.unitKey})) > 0`),
  check("usage_meters_aggregation_nonempty_ck", sql`length(btrim(${t.aggregation})) > 0`),
]);

/** Append-only quantity observations, idempotent per commercial account. */
export const commercialUsageEvents = pgTable("commercial_usage_events", {
  ...record(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  commercialAccountId: uuid("commercial_account_id").notNull(),
  meterId: uuid("meter_id").notNull().references(() => usageMeters.id),
  idempotencyKey: text("idempotency_key").notNull(),
  quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
  source: text("source").notNull(),
  sourceReference: text("source_reference"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  dimensions: jsonObject("dimensions"),
}, (t) => [
  uniqueIndex("commercial_usage_events_idempotency_ux").on(t.tenantId, t.commercialAccountId, t.idempotencyKey),
  index("commercial_usage_events_meter_time_idx").on(t.tenantId, t.meterId, t.occurredAt),
  foreignKey({
    columns: [t.tenantId, t.commercialAccountId],
    foreignColumns: [commercialAccounts.tenantId, commercialAccounts.id],
    name: "commercial_usage_events_account_tenant_fk",
  }),
  check("commercial_usage_events_idempotency_nonempty_ck", sql`length(btrim(${t.idempotencyKey})) > 0`),
  check("commercial_usage_events_source_nonempty_ck", sql`length(btrim(${t.source})) > 0`),
]);

/** Time-bounded quantities included for a tenant and meter; period semantics remain data-defined. */
export const usageAllowances = pgTable("usage_allowances", {
  ...record(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  commercialAccountId: uuid("commercial_account_id").notNull(),
  meterId: uuid("meter_id").notNull().references(() => usageMeters.id),
  quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
  periodDefinition: jsonObject("period_definition"),
  source: text("source").notNull(),
  sourceReference: text("source_reference"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  details: jsonObject("details"),
}, (t) => [
  index("usage_allowances_effective_idx").on(t.tenantId, t.meterId, t.effectiveFrom, t.effectiveUntil),
  foreignKey({
    columns: [t.tenantId, t.commercialAccountId],
    foreignColumns: [commercialAccounts.tenantId, commercialAccounts.id],
    name: "usage_allowances_account_tenant_fk",
  }),
  check("usage_allowances_quantity_nonnegative_ck", sql`${t.quantity} >= 0`),
  check("usage_allowances_source_nonempty_ck", sql`length(btrim(${t.source})) > 0`),
  check("usage_allowances_interval_ck", sql`${t.effectiveUntil} is null or ${t.effectiveUntil} > ${t.effectiveFrom}`),
]);

/** Provider-neutral promotion definitions and eligibility/benefit data. */
export const commercialPromotions = pgTable("commercial_promotions", {
  ...record(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  lifecycleState: text("lifecycle_state").notNull().default("active"),
  availability: jsonObject("availability"),
  eligibility: jsonObject("eligibility"),
  benefit: jsonObject("benefit"),
  terms: jsonObject("terms"),
}, (t) => [
  uniqueIndex("commercial_promotions_key_ux").on(t.key),
  index("commercial_promotions_state_idx").on(t.lifecycleState),
  check("commercial_promotions_key_nonempty_ck", sql`length(btrim(${t.key})) > 0`),
  check("commercial_promotions_name_nonempty_ck", sql`length(btrim(${t.name})) > 0`),
]);

/** Applied promotion history for a tenant account, separate from the definition and ledger entries. */
export const commercialAccountPromotions = pgTable("commercial_account_promotions", {
  ...record(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  commercialAccountId: uuid("commercial_account_id").notNull(),
  promotionId: uuid("promotion_id").notNull().references(() => commercialPromotions.id),
  source: text("source").notNull(),
  sourceReference: text("source_reference"),
  status: text("status").notNull().default("active"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  details: jsonObject("details"),
}, (t) => [
  index("commercial_account_promotions_effective_idx").on(t.tenantId, t.commercialAccountId, t.effectiveFrom, t.effectiveUntil),
  foreignKey({
    columns: [t.tenantId, t.commercialAccountId],
    foreignColumns: [commercialAccounts.tenantId, commercialAccounts.id],
    name: "commercial_account_promotions_account_tenant_fk",
  }),
  check("commercial_account_promotions_source_nonempty_ck", sql`length(btrim(${t.source})) > 0`),
  check("commercial_account_promotions_status_nonempty_ck", sql`length(btrim(${t.status})) > 0`),
  check("commercial_account_promotions_interval_ck", sql`${t.effectiveUntil} is null or ${t.effectiveUntil} > ${t.effectiveFrom}`),
]);
