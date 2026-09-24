import { sql } from "drizzle-orm";
import { bigint, boolean, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { active, currency, jsonObject, money, record, status } from "./columns.ts";
import { memberships, organizationLocations, organizations, tenants } from "./identity.ts";
import { customers, leads, serviceLocations } from "./crm.ts";
import { files, jobs, routePlans, servicePlans } from "./operations.ts";
import { invoices } from "./finance.ts";
import { domainEvents } from "./platform.ts";

export const ticketTypeDefinitions = pgTable("ticket_type_definitions", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), key: text("key").notNull(),
  name: text("name").notNull(), configuration: jsonObject("configuration"), active: active(),
}, (t) => [uniqueIndex("ticket_types_tenant_id_id_ux").on(t.tenantId, t.id), uniqueIndex("ticket_types_key_ux").on(t.tenantId, t.key)]);

export const ticketStatusDefinitions = pgTable("ticket_status_definitions", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), key: text("key").notNull(),
  name: text("name").notNull(), normalizedCategory: text("normalized_category").notNull(),
  sortOrder: integer("sort_order").notNull().default(0), active: active(),
}, (t) => [uniqueIndex("ticket_statuses_tenant_id_id_ux").on(t.tenantId, t.id), uniqueIndex("ticket_statuses_key_ux").on(t.tenantId, t.key)]);

export const tickets = pgTable("tickets", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").references(() => customers.id),
  serviceLocationId: uuid("service_location_id").references(() => serviceLocations.id), jobId: uuid("job_id").references(() => jobs.id),
  ticketTypeId: uuid("ticket_type_id").notNull().references(() => ticketTypeDefinitions.id),
  statusDefinitionId: uuid("status_definition_id").notNull().references(() => ticketStatusDefinitions.id),
  priority: text("priority").notNull().default("normal"), title: text("title").notNull(), description: text("description").notNull(),
  customerVisible: boolean("customer_visible").notNull().default(false), assignedMembershipId: uuid("assigned_membership_id").references(() => memberships.id),
  dueAt: timestamp("due_at", { withTimezone: true }), createdByActorType: text("created_by_actor_type").notNull(),
  createdByActorId: text("created_by_actor_id"), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }), customFields: jsonObject("custom_fields"),
}, (t) => [
  uniqueIndex("tickets_tenant_id_id_ux").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "tickets_customer_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.serviceLocationId], foreignColumns: [serviceLocations.tenantId, serviceLocations.id], name: "tickets_location_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.customerId, t.serviceLocationId], foreignColumns: [serviceLocations.tenantId, serviceLocations.customerId, serviceLocations.id], name: "tickets_location_customer_fk" }),
  foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id], name: "tickets_job_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.customerId, t.jobId], foreignColumns: [jobs.tenantId, jobs.customerId, jobs.id], name: "tickets_job_customer_fk" }),
  foreignKey({ columns: [t.tenantId, t.ticketTypeId], foreignColumns: [ticketTypeDefinitions.tenantId, ticketTypeDefinitions.id], name: "tickets_type_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.statusDefinitionId], foreignColumns: [ticketStatusDefinitions.tenantId, ticketStatusDefinitions.id], name: "tickets_status_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.assignedMembershipId], foreignColumns: [memberships.tenantId, memberships.id], name: "tickets_assignee_tenant_fk" }),
  index("tickets_customer_idx").on(t.tenantId, t.customerId), index("tickets_assignee_idx").on(t.tenantId, t.assignedMembershipId),
]);

export const ticketComments = pgTable("ticket_comments", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id), visibility: text("visibility").notNull(), body: text("body").notNull(),
  actorType: text("actor_type").notNull(), actorId: text("actor_id"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.ticketId], foreignColumns: [tickets.tenantId, tickets.id], name: "ticket_comments_ticket_tenant_fk" }),
  index("ticket_comments_ticket_idx").on(t.tenantId, t.ticketId, t.createdAt),
]);

export const notificationPreferences = pgTable("notification_preferences", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").notNull().references(() => customers.id),
  eventKey: text("event_key").notNull(), emailEnabled: boolean("email_enabled").notNull().default(true), smsEnabled: boolean("sms_enabled").notNull().default(false),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "notification_preferences_customer_tenant_fk" }),
  uniqueIndex("notification_preferences_event_ux").on(t.customerId, t.eventKey),
]);

export const messageTemplates = pgTable("message_templates", {
  ...record(), tenantId: uuid("tenant_id").references(() => tenants.id), industryPackKey: text("industry_pack_key"),
  key: text("key").notNull(), channel: text("channel").notNull(), name: text("name").notNull(), subjectTemplate: text("subject_template"),
  bodyTemplate: text("body_template").notNull(), version: integer("version").notNull().default(1), active: active(),
});

export const outboundMessages = pgTable("outbound_messages", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").references(() => customers.id),
  jobId: uuid("job_id").references(() => jobs.id), invoiceId: uuid("invoice_id").references(() => invoices.id), channel: text("channel").notNull(),
  templateKey: text("template_key"), templateVersion: integer("template_version"), recipient: text("recipient").notNull(),
  renderedSubject: text("rendered_subject"), renderedBody: text("rendered_body").notNull(), status: status(),
  connectorInstallationId: uuid("connector_installation_id"), providerReference: text("provider_reference"),
  idempotencyKey: text("idempotency_key").notNull(), queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }), deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failureCode: text("failure_code"), failureMessage: text("failure_message"),
}, (t) => [
  uniqueIndex("outbound_messages_tenant_id_id_ux").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "outbound_messages_customer_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id], name: "outbound_messages_job_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.customerId, t.jobId], foreignColumns: [jobs.tenantId, jobs.customerId, jobs.id], name: "outbound_messages_job_customer_fk" }),
  foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id], name: "outbound_messages_invoice_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.customerId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.customerId, invoices.id], name: "outbound_messages_invoice_customer_fk" }),
  uniqueIndex("outbound_messages_idempotency_ux").on(t.tenantId, t.idempotencyKey), index("outbound_messages_queue_idx").on(t.tenantId, t.status, t.queuedAt),
]);

export const communicationEvents = pgTable("communication_events", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  outboundMessageId: uuid("outbound_message_id").notNull().references(() => outboundMessages.id), eventType: text("event_type").notNull(),
  providerEventId: text("provider_event_id"), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonObject("payload"),
}, (t) => [foreignKey({ columns: [t.tenantId, t.outboundMessageId], foreignColumns: [outboundMessages.tenantId, outboundMessages.id], name: "communication_events_message_tenant_fk" })]);

export const serviceFeedback = pgTable("service_feedback", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").notNull().references(() => customers.id),
  jobId: uuid("job_id").notNull().references(() => jobs.id), membershipId: uuid("membership_id").references(() => memberships.id),
  rating: integer("rating"), comment: text("comment"), visibility: text("visibility").notNull().default("internal"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(), source: text("source").notNull(),
  resolvedTicketId: uuid("resolved_ticket_id").references(() => tickets.id),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "service_feedback_customer_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id], name: "service_feedback_job_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.customerId, t.jobId], foreignColumns: [jobs.tenantId, jobs.customerId, jobs.id], name: "service_feedback_job_customer_fk" }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id], name: "service_feedback_member_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.resolvedTicketId], foreignColumns: [tickets.tenantId, tickets.id], name: "service_feedback_ticket_tenant_fk" }),
  uniqueIndex("service_feedback_source_ux").on(t.tenantId, t.customerId, t.jobId, t.source),
]);

export const consentRecords = pgTable("consent_records", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerId: uuid("customer_id").notNull().references(() => customers.id), channel: text("channel").notNull(),
  category: text("category").notNull(), state: text("state").notNull(), source: text("source").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(), actorType: text("actor_type").notNull(),
  actorId: text("actor_id"), evidence: jsonb("evidence").$type<Record<string, unknown>>(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "consent_records_customer_tenant_fk" }),
  index("consent_records_customer_idx").on(t.tenantId, t.customerId, t.channel, t.category, t.capturedAt),
]);

export const automationRules = pgTable("automation_rules", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), name: text("name").notNull(), description: text("description"),
  source: text("source").notNull(), sourceKey: text("source_key"), status: status(), version: integer("version").notNull().default(1),
  triggerConfig: jsonObject("trigger_config"), conditions: jsonObject("conditions"), actions: jsonb("actions").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  createdByMembershipId: uuid("created_by_membership_id").references(() => memberships.id), activeFrom: timestamp("active_from", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("automation_rules_tenant_id_id_ux").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.createdByMembershipId], foreignColumns: [memberships.tenantId, memberships.id], name: "automation_rules_creator_tenant_fk" }),
  index("automation_rules_status_idx").on(t.tenantId, t.status),
]);

export const automationRuns = pgTable("automation_runs", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), automationRuleId: uuid("automation_rule_id").notNull().references(() => automationRules.id),
  ruleVersion: integer("rule_version").notNull(), triggeringEventId: uuid("triggering_event_id").notNull(), idempotencyKey: text("idempotency_key").notNull(),
  status: status(), attempts: integer("attempts").notNull().default(0), startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }), nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  errorCode: text("error_code"), errorMessage: text("error_message"), contextSnapshot: jsonObject("context_snapshot"),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.automationRuleId], foreignColumns: [automationRules.tenantId, automationRules.id], name: "automation_runs_rule_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.triggeringEventId], foreignColumns: [domainEvents.tenantId, domainEvents.id], name: "automation_runs_event_tenant_fk" }),
  uniqueIndex("automation_runs_idempotency_ux").on(t.tenantId, t.idempotencyKey), index("automation_runs_retry_idx").on(t.tenantId, t.status, t.nextRetryAt),
]);

export const connectorInstallations = pgTable("connector_installations", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), organizationId: uuid("organization_id").references(() => organizations.id),
  connectorKey: text("connector_key").notNull(), status: status(), displayName: text("display_name"),
  credentialReference: text("credential_reference"), grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  providerAccountId: text("provider_account_id"), healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }), lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"), settings: jsonObject("settings"),
}, (t) => [
  uniqueIndex("connector_installations_tenant_id_id_ux").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.organizationId], foreignColumns: [organizations.tenantId, organizations.id], name: "connector_installations_organization_tenant_fk" }),
  uniqueIndex("connector_installations_account_ux").on(t.tenantId, t.connectorKey, t.providerAccountId),
]);

/** Single-use OAuth handoff state. Raw state is never persisted; verifier material is encrypted server-side. */
export const connectorOAuthTransactions = pgTable("connector_oauth_transactions", {
  stateHash: text("state_hash").primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  actorUserId: text("actor_user_id").notNull(), connectorKey: text("connector_key").notNull(),
  connectorInstallationId: uuid("connector_installation_id").notNull().references(() => connectorInstallations.id),
  verifierEnvelope: text("verifier_envelope"), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.connectorInstallationId], foreignColumns: [connectorInstallations.tenantId, connectorInstallations.id], name: "connector_oauth_transactions_installation_tenant_fk" }),
  index("connector_oauth_transactions_expiry_idx").on(t.expiresAt), index("connector_oauth_transactions_installation_idx").on(t.tenantId, t.connectorInstallationId),
]);

export const connectorResourceMappings = pgTable("connector_resource_mappings", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), connectorInstallationId: uuid("connector_installation_id").notNull().references(() => connectorInstallations.id),
  resourceType: text("resource_type").notNull(), providerResourceId: text("provider_resource_id").notNull(),
  localEntityType: text("local_entity_type"), localEntityId: uuid("local_entity_id"), metadata: jsonObject("metadata"),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.connectorInstallationId], foreignColumns: [connectorInstallations.tenantId, connectorInstallations.id], name: "connector_mappings_installation_tenant_fk" }),
  uniqueIndex("connector_mappings_provider_ux").on(t.connectorInstallationId, t.resourceType, t.providerResourceId),
]);

export const syncStates = pgTable("sync_states", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), connectorInstallationId: uuid("connector_installation_id").notNull().references(() => connectorInstallations.id),
  syncType: text("sync_type").notNull(), cursor: jsonb("cursor").$type<Record<string, unknown>>(), status: status(),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }), lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
  lastError: text("last_error"),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.connectorInstallationId], foreignColumns: [connectorInstallations.tenantId, connectorInstallations.id], name: "sync_states_installation_tenant_fk" }),
  uniqueIndex("sync_states_installation_type_ux").on(t.connectorInstallationId, t.syncType),
]);

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").references(() => tenants.id),
  connectorKey: text("connector_key").notNull(), connectorInstallationId: uuid("connector_installation_id").references(() => connectorInstallations.id),
  providerEventId: text("provider_event_id").notNull(), eventType: text("event_type").notNull(),
  signatureValid: boolean("signature_valid").notNull(), status: status(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(), processedAt: timestamp("processed_at", { withTimezone: true }),
  payload: jsonObject("payload"), errorMessage: text("error_message"),
}, (t) => [
  uniqueIndex("webhook_events_tenant_id_id_ux").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.connectorInstallationId], foreignColumns: [connectorInstallations.tenantId, connectorInstallations.id], name: "webhook_events_installation_tenant_fk" }),
  uniqueIndex("webhook_events_provider_ux").on(t.connectorKey, t.providerEventId), index("webhook_events_queue_idx").on(t.status, t.receivedAt),
]);

export const importBatches = pgTable("import_batches", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), sourceType: text("source_type").notNull(),
  connectorInstallationId: uuid("connector_installation_id").references(() => connectorInstallations.id), fileId: uuid("file_id").references(() => files.id),
  entityType: text("entity_type").notNull(), status: status(), mapping: jsonObject("mapping"),
  totalRows: integer("total_rows").notNull().default(0), validRows: integer("valid_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0), failedRows: integer("failed_rows").notNull().default(0),
  createdByMembershipId: uuid("created_by_membership_id").notNull().references(() => memberships.id),
  committedAt: timestamp("committed_at", { withTimezone: true }), errorSummary: jsonb("error_summary").$type<Record<string, unknown>>(),
}, (t) => [
  uniqueIndex("import_batches_tenant_id_id_ux").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.connectorInstallationId], foreignColumns: [connectorInstallations.tenantId, connectorInstallations.id], name: "import_batches_installation_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.fileId], foreignColumns: [files.tenantId, files.id], name: "import_batches_file_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.createdByMembershipId], foreignColumns: [memberships.tenantId, memberships.id], name: "import_batches_creator_tenant_fk" }),
  index("import_batches_tenant_status_idx").on(t.tenantId, t.status),
]);

export const importRows = pgTable("import_rows", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  rowNumber: integer("row_number").notNull(), sourcePayload: jsonObject("source_payload"),
  normalizedPayload: jsonb("normalized_payload").$type<Record<string, unknown>>(), status: status(),
  matchedEntityType: text("matched_entity_type"), matchedEntityId: uuid("matched_entity_id"), errors: jsonb("errors").$type<unknown[]>(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.importBatchId], foreignColumns: [importBatches.tenantId, importBatches.id], name: "import_rows_batch_tenant_fk" }),
  uniqueIndex("import_rows_batch_number_ux").on(t.importBatchId, t.rowNumber),
]);
