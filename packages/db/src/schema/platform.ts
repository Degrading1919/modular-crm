import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { active, currency, jsonObject, money, record, status } from "./columns.ts";
import { memberships, organizationLocations, organizations, tenants } from "./identity.ts";
import { customers, leads } from "./crm.ts";
import { tickets } from "./systems.ts";

export const sites = pgTable("sites", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id), status: status(),
  templateKey: text("template_key").notNull(), templateVersion: text("template_version").notNull(), slug: text("slug").notNull(),
  branding: jsonObject("branding"), settings: jsonObject("settings"), publishedAt: timestamp("published_at", { withTimezone: true }),
}, (t) => [uniqueIndex("sites_slug_ux").on(t.slug), index("sites_tenant_status_idx").on(t.tenantId, t.status)]);

export const domains = pgTable("domains", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), siteId: uuid("site_id").notNull().references(() => sites.id),
  hostname: text("hostname").notNull(), domainType: text("domain_type").notNull(), verificationStatus: text("verification_status").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false), verificationData: jsonb("verification_data").$type<Record<string, unknown>>(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
}, (t) => [uniqueIndex("domains_hostname_ux").on(sql`lower(${t.hostname})`)]);

export const siteContents = pgTable("site_contents", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), siteId: uuid("site_id").notNull().references(() => sites.id),
  contentKey: text("content_key").notNull(), content: jsonObject("content"), version: integer("version").notNull().default(1),
}, (t) => [uniqueIndex("site_contents_key_ux").on(t.siteId, t.contentKey)]);

export const siteForms = pgTable("site_forms", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), siteId: uuid("site_id").notNull().references(() => sites.id),
  formType: text("form_type").notNull(), name: text("name").notNull(), schema: jsonObject("schema"), behavior: jsonObject("behavior"), active: active(),
});

export const siteSubmissions = pgTable("site_submissions", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), siteId: uuid("site_id").notNull().references(() => sites.id),
  siteFormId: uuid("site_form_id").notNull().references(() => siteForms.id), idempotencyKey: text("idempotency_key").notNull(),
  payload: jsonObject("payload"), leadId: uuid("lead_id").references(() => leads.id), customerId: uuid("customer_id").references(() => customers.id),
  status: status(), submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("site_submissions_idempotency_ux").on(t.siteId, t.idempotencyKey)]);

export const termsVersions = pgTable("terms_versions", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  documentType: text("document_type").notNull(), version: text("version").notNull(), content: text("content").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(), active: active(),
}, (t) => [uniqueIndex("terms_versions_type_version_ux").on(t.tenantId, t.documentType, t.version)]);

export const termsAcceptances = pgTable("terms_acceptances", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  termsVersionId: uuid("terms_version_id").notNull().references(() => termsVersions.id), actorType: text("actor_type").notNull(),
  actorId: text("actor_id"), relatedEntityType: text("related_entity_type"), relatedEntityId: uuid("related_entity_id"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(), ipAddress: text("ip_address"), userAgent: text("user_agent"),
});

export const apiCredentials = pgTable("api_credentials", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(), tokenPrefix: text("token_prefix").notNull(), scopes: text("scopes").array().notNull(),
  status: status(), expiresAt: timestamp("expires_at", { withTimezone: true }), lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdByMembershipId: uuid("created_by_membership_id").notNull().references(() => memberships.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("api_credentials_hash_ux").on(t.tokenHash), index("api_credentials_tenant_status_idx").on(t.tenantId, t.status)]);

export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), name: text("name").notNull(), url: text("url").notNull(),
  eventPatterns: text("event_patterns").array().notNull(), secretReference: text("secret_reference").notNull(), status: status(),
  createdByMembershipId: uuid("created_by_membership_id").notNull().references(() => memberships.id),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }), lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), webhookSubscriptionId: uuid("webhook_subscription_id").notNull().references(() => webhookSubscriptions.id),
  domainEventId: uuid("domain_event_id").notNull(), status: status(), attemptCount: integer("attempt_count").notNull().default(0),
  responseStatus: integer("response_status"), responseExcerpt: text("response_excerpt"), nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }), deliveredAt: timestamp("delivered_at", { withTimezone: true }),
}, (t) => [uniqueIndex("webhook_deliveries_event_ux").on(t.webhookSubscriptionId, t.domainEventId)]);

export const savedViews = pgTable("saved_views", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), membershipId: uuid("membership_id").references(() => memberships.id),
  reportKey: text("report_key").notNull(), name: text("name").notNull(), filters: jsonObject("filters"), grouping: jsonObject("grouping"),
  columns: jsonb("columns").$type<string[]>().notNull().default(sql`'[]'::jsonb`), shared: boolean("shared").notNull().default(false),
});

export const metricSnapshots = pgTable("metric_snapshots", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), metricKey: text("metric_key").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id), organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id),
  periodStart: date("period_start").notNull(), periodEnd: date("period_end").notNull(), dimensions: jsonObject("dimensions"),
  values: jsonObject("values"), computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("metric_snapshots_key_period_idx").on(t.tenantId, t.metricKey, t.periodStart, t.periodEnd)]);

export const internalNotifications = pgTable("internal_notifications", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  membershipId: uuid("membership_id").notNull().references(() => memberships.id), notificationType: text("notification_type").notNull(),
  title: text("title").notNull(), body: text("body").notNull(), entityType: text("entity_type"), entityId: uuid("entity_id"),
  readAt: timestamp("read_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("internal_notifications_member_idx").on(t.tenantId, t.membershipId, t.readAt)]);

export const franchiseAgreements = pgTable("franchise_agreements", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  parentOrganizationId: uuid("parent_organization_id").notNull().references(() => organizations.id),
  childOrganizationId: uuid("child_organization_id").notNull().references(() => organizations.id),
  effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to"), settings: jsonObject("settings"), active: active(),
});

export const royaltyRules = pgTable("royalty_rules", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  franchiseAgreementId: uuid("franchise_agreement_id").notNull().references(() => franchiseAgreements.id),
  ruleType: text("rule_type").notNull(), definition: jsonObject("definition"), effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"), active: active(),
});

export const royaltyStatements = pgTable("royalty_statements", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  franchiseAgreementId: uuid("franchise_agreement_id").notNull().references(() => franchiseAgreements.id),
  periodStart: date("period_start").notNull(), periodEnd: date("period_end").notNull(), status: status(),
  basisAmountMinor: money("basis_amount_minor"), royaltyAmountMinor: money("royalty_amount_minor"), currency: currency(),
  calculationSnapshot: jsonObject("calculation_snapshot"), issuedAt: timestamp("issued_at", { withTimezone: true }), paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const domainEvents = pgTable("domain_events", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").references(() => tenants.id), eventType: text("event_type").notNull(),
  eventVersion: integer("event_version").notNull().default(1), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  actorType: text("actor_type").notNull(), actorId: text("actor_id"), entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(), organizationId: uuid("organization_id").references(() => organizations.id),
  locationId: uuid("location_id").references(() => organizationLocations.id), correlationId: uuid("correlation_id"),
  causationId: uuid("causation_id"), payload: jsonObject("payload"), publishedAt: timestamp("published_at", { withTimezone: true }),
}, (t) => [index("domain_events_outbox_idx").on(t.publishedAt), index("domain_events_tenant_entity_idx").on(t.tenantId, t.entityType, t.entityId)]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  actorType: text("actor_type").notNull(), actorId: text("actor_id"), action: text("action").notNull(),
  entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(),
  beforeData: jsonb("before_data").$type<Record<string, unknown>>(), afterData: jsonb("after_data").$type<Record<string, unknown>>(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"), correlationId: uuid("correlation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_events_entity_idx").on(t.tenantId, t.entityType, t.entityId, t.createdAt)]);

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(), activityType: text("activity_type").notNull(),
  actorType: text("actor_type").notNull(), actorId: text("actor_id"), summary: text("summary").notNull(), metadata: jsonObject("metadata"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("activity_events_entity_idx").on(t.tenantId, t.entityType, t.entityId, t.occurredAt)]);
