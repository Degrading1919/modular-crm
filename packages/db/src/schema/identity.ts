import { foreignKey, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, boolean, varchar } from "drizzle-orm/pg-core";
import { active, currency, jsonObject, record, status, updatedAt, utcNow } from "./columns.ts";

// Better Auth's four core models use the property names its Drizzle adapter expects.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: utcNow(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("user_email_ux").on(t.email)]);

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: utcNow(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("session_token_ux").on(t.token), index("session_user_id_idx").on(t.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: utcNow(),
  updatedAt: updatedAt(),
}, (t) => [index("account_user_id_idx").on(t.userId), uniqueIndex("account_provider_account_ux").on(t.providerId, t.accountId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: utcNow(),
  updatedAt: updatedAt(),
}, (t) => [index("verification_identifier_idx").on(t.identifier)]);

export const tenants = pgTable("tenants", {
  ...record(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  status: status(),
  defaultCurrency: currency("default_currency"),
  defaultTimezone: text("default_timezone").notNull().default("America/New_York"),
  industryPackKey: text("industry_pack_key"),
  industryPackVersion: text("industry_pack_version"),
  settings: jsonObject("settings"),
}, (t) => [uniqueIndex("tenants_slug_ux").on(t.slug)]);

export const organizations = pgTable("organizations", {
  ...record(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  parentOrganizationId: uuid("parent_organization_id"),
  organizationType: text("organization_type").notNull().default("business"),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  taxIdEncrypted: text("tax_id_encrypted"),
  email: text("email"),
  phone: text("phone"),
  timezone: text("timezone").notNull().default("America/New_York"),
  currency: currency(),
  settings: jsonObject("settings"),
  active: active(),
}, (t) => [
  uniqueIndex("organizations_tenant_id_id_ux").on(t.tenantId, t.id),
  index("organizations_parent_idx").on(t.tenantId, t.parentOrganizationId),
]);

export const organizationLocations = pgTable("organization_locations", {
  ...record(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  code: text("code").notNull(),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  region: text("region"),
  postalCode: text("postal_code"),
  countryCode: varchar("country_code", { length: 2 }).notNull().default("US"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  timezone: text("timezone").notNull().default("America/New_York"),
  phone: text("phone"),
  email: text("email"),
  active: active(),
  settings: jsonObject("settings"),
}, (t) => [
  uniqueIndex("org_locations_tenant_id_id_ux").on(t.tenantId, t.id),
  uniqueIndex("org_locations_tenant_org_id_ux").on(t.tenantId, t.organizationId, t.id),
  uniqueIndex("org_locations_code_ux").on(t.tenantId, t.organizationId, t.code),
  index("org_locations_tenant_org_idx").on(t.tenantId, t.organizationId),
  foreignKey({ columns: [t.tenantId, t.organizationId], foreignColumns: [organizations.tenantId, organizations.id], name: "org_locations_organization_tenant_fk" }),
]);

export const roleTemplates = pgTable("role_templates", {
  ...record(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  system: boolean("system").notNull().default(false),
  active: active(),
}, (t) => [uniqueIndex("role_templates_scope_key_ux").on(t.tenantId, t.key)]);

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable("role_permissions", {
  roleTemplateId: uuid("role_template_id").notNull().references(() => roleTemplates.id),
  permissionKey: text("permission_key").notNull().references(() => permissions.key),
  allowed: boolean("allowed").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.roleTemplateId, t.permissionKey] })]);

export const memberships = pgTable("memberships", {
  ...record(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: text("user_id").notNull().references(() => user.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  defaultLocationId: uuid("default_location_id").references(() => organizationLocations.id),
  roleTemplateId: uuid("role_template_id").notNull().references(() => roleTemplates.id),
  status: status(),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("memberships_tenant_id_id_ux").on(t.tenantId, t.id),
  uniqueIndex("memberships_user_org_ux").on(t.tenantId, t.userId, t.organizationId),
  index("memberships_tenant_status_idx").on(t.tenantId, t.status),
  foreignKey({ columns: [t.tenantId, t.organizationId], foreignColumns: [organizations.tenantId, organizations.id], name: "memberships_organization_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.defaultLocationId], foreignColumns: [organizationLocations.tenantId, organizationLocations.id], name: "memberships_location_tenant_fk" }),
]);

export const membershipLocationScopes = pgTable("membership_location_scopes", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  membershipId: uuid("membership_id").notNull().references(() => memberships.id),
  locationId: uuid("location_id").notNull().references(() => organizationLocations.id),
}, (t) => [
  primaryKey({ columns: [t.membershipId, t.locationId] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id], name: "membership_scopes_member_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [organizationLocations.tenantId, organizationLocations.id], name: "membership_scopes_location_tenant_fk" }),
]);
