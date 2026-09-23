import { sql } from "drizzle-orm";
import { boolean, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { active, jsonObject, record, status } from "./columns.ts";
import { memberships, organizationLocations, organizations, tenants } from "./identity.ts";
import { customers, serviceLocations, services } from "./crm.ts";

export const recurrenceRules = pgTable("recurrence_rules", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), frequencyType: text("frequency_type").notNull(),
  interval: integer("interval").notNull().default(1), daysOfWeek: integer("days_of_week").array(), dayOfMonth: integer("day_of_month"),
  windowStart: time("window_start"), windowEnd: time("window_end"), timezone: text("timezone").notNull(), configuration: jsonObject("configuration"),
}, (t) => [uniqueIndex("recurrence_rules_tenant_id_id_ux").on(t.tenantId, t.id)]);

export const servicePlans = pgTable("service_plans", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), customerId: uuid("customer_id").notNull(),
  serviceLocationId: uuid("service_location_id").notNull().references(() => serviceLocations.id),
  organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id),
  serviceId: uuid("service_id").notNull().references(() => services.id), status: status(),
  effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to"), pricingSnapshot: jsonObject("pricing_snapshot"),
  billingConfiguration: jsonObject("billing_configuration"), recurrenceRuleId: uuid("recurrence_rule_id").notNull().references(() => recurrenceRules.id),
  preferredAssignment: jsonb("preferred_assignment").$type<Record<string, unknown>>(), pauseFrom: date("pause_from"), pauseUntil: date("pause_until"),
  canceledAt: timestamp("canceled_at", { withTimezone: true }), cancellationReason: text("cancellation_reason"), customFields: jsonObject("custom_fields"),
}, (t) => [
  uniqueIndex("service_plans_tenant_id_id_ux").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "service_plans_customer_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.serviceLocationId], foreignColumns: [serviceLocations.tenantId, serviceLocations.id], name: "service_plans_location_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.customerId, t.serviceLocationId], foreignColumns: [serviceLocations.tenantId, serviceLocations.customerId, serviceLocations.id], name: "service_plans_customer_location_fk" }),
  foreignKey({ columns: [t.tenantId, t.serviceId], foreignColumns: [services.tenantId, services.id], name: "service_plans_service_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.recurrenceRuleId], foreignColumns: [recurrenceRules.tenantId, recurrenceRules.id], name: "service_plans_recurrence_tenant_fk" }),
  index("service_plans_customer_status_idx").on(t.tenantId, t.customerId, t.status),
]);

export const jobs = pgTable("jobs", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id),
  customerId: uuid("customer_id").notNull(), serviceLocationId: uuid("service_location_id").notNull().references(() => serviceLocations.id),
  servicePlanId: uuid("service_plan_id").references(() => servicePlans.id), serviceId: uuid("service_id").notNull().references(() => services.id),
  parentJobId: uuid("parent_job_id"), relationType: text("relation_type"), status: status(),
  scheduledDate: date("scheduled_date"), serviceWindowStart: timestamp("service_window_start", { withTimezone: true }),
  serviceWindowEnd: timestamp("service_window_end", { withTimezone: true }), estimatedDurationMinutes: integer("estimated_duration_minutes"),
  actualStartedAt: timestamp("actual_started_at", { withTimezone: true }), actualCompletedAt: timestamp("actual_completed_at", { withTimezone: true }),
  assignedRouteId: uuid("assigned_route_id"), priceSnapshot: jsonb("price_snapshot").$type<Record<string, unknown>>(),
  billable: boolean("billable").notNull().default(true), skipReasonCode: text("skip_reason_code"), cancelReasonCode: text("cancel_reason_code"),
  internalSummary: text("internal_summary"), customerSummary: text("customer_summary"), customFields: jsonObject("custom_fields"),
}, (t) => [
  uniqueIndex("jobs_tenant_id_id_ux").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id], name: "jobs_customer_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.organizationId], foreignColumns: [organizations.tenantId, organizations.id], name: "jobs_organization_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.organizationLocationId], foreignColumns: [organizationLocations.tenantId, organizationLocations.id], name: "jobs_branch_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.organizationId, t.organizationLocationId], foreignColumns: [organizationLocations.tenantId, organizationLocations.organizationId, organizationLocations.id], name: "jobs_branch_org_fk" }),
  foreignKey({ columns: [t.tenantId, t.serviceLocationId], foreignColumns: [serviceLocations.tenantId, serviceLocations.id], name: "jobs_location_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.customerId, t.serviceLocationId], foreignColumns: [serviceLocations.tenantId, serviceLocations.customerId, serviceLocations.id], name: "jobs_customer_location_fk" }),
  foreignKey({ columns: [t.tenantId, t.serviceId], foreignColumns: [services.tenantId, services.id], name: "jobs_service_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.servicePlanId], foreignColumns: [servicePlans.tenantId, servicePlans.id], name: "jobs_plan_tenant_fk" }),
  index("jobs_date_status_idx").on(t.tenantId, t.scheduledDate, t.status),
  index("jobs_customer_date_idx").on(t.tenantId, t.customerId, t.scheduledDate),
  index("jobs_location_date_idx").on(t.tenantId, t.organizationLocationId, t.scheduledDate),
]);

export const appointments = pgTable("appointments", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), jobId: uuid("job_id").notNull().references(() => jobs.id),
  status: status(), startsAt: timestamp("starts_at", { withTimezone: true }), endsAt: timestamp("ends_at", { withTimezone: true }),
  windowStart: timestamp("window_start", { withTimezone: true }), windowEnd: timestamp("window_end", { withTimezone: true }),
  timezone: text("timezone").notNull(), version: integer("version").notNull().default(1),
  replacedAppointmentId: uuid("replaced_appointment_id"),
}, (t) => [index("appointments_job_idx").on(t.tenantId, t.jobId)]);

export const jobAssignments = pgTable("job_assignments", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), jobId: uuid("job_id").notNull(),
  membershipId: uuid("membership_id").notNull().references(() => memberships.id), assignmentRole: text("assignment_role").notNull().default("primary"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(), removedAt: timestamp("removed_at", { withTimezone: true }),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id], name: "job_assignments_job_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id], name: "job_assignments_member_tenant_fk" }),
  index("job_assignments_member_idx").on(t.tenantId, t.membershipId, t.removedAt),
  index("job_assignments_job_idx").on(t.tenantId, t.jobId),
]);

export const jobStatusEvents = pgTable("job_status_events", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  jobId: uuid("job_id").notNull(), fromStatus: text("from_status"), toStatus: text("to_status").notNull(),
  reasonCode: text("reason_code"), note: text("note"), actorType: text("actor_type").notNull(), actorId: text("actor_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id], name: "job_status_events_job_tenant_fk" }),
  index("job_status_events_job_idx").on(t.tenantId, t.jobId, t.occurredAt),
]);

export const recurringGenerationLedger = pgTable("recurring_generation_ledger", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), servicePlanId: uuid("service_plan_id").notNull().references(() => servicePlans.id),
  occurrenceKey: text("occurrence_key").notNull(), intendedDate: date("intended_date").notNull(),
  jobId: uuid("job_id").references(() => jobs.id), status: status(), generatedAt: timestamp("generated_at", { withTimezone: true }),
}, (t) => [uniqueIndex("recurring_ledger_occurrence_ux").on(t.servicePlanId, t.occurrenceKey)]);

export const routePlans = pgTable("route_plans", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id),
  membershipId: uuid("membership_id").notNull().references(() => memberships.id), routeDate: date("route_date").notNull(), status: status(),
  startLocation: jsonObject("start_location"), endLocation: jsonObject("end_location"),
  plannedStartAt: timestamp("planned_start_at", { withTimezone: true }), plannedEndAt: timestamp("planned_end_at", { withTimezone: true }),
  estimatedDistanceMeters: integer("estimated_distance_meters"), estimatedDriveSeconds: integer("estimated_drive_seconds"),
  estimatedServiceSeconds: integer("estimated_service_seconds"), publishedAt: timestamp("published_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }),
  currentOptimizationRunId: uuid("current_optimization_run_id"),
}, (t) => [
  uniqueIndex("route_plans_tenant_id_id_ux").on(t.tenantId, t.id),
  index("route_plans_date_member_idx").on(t.tenantId, t.routeDate, t.membershipId),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id], name: "route_plans_member_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.organizationLocationId], foreignColumns: [organizationLocations.tenantId, organizationLocations.id], name: "route_plans_branch_tenant_fk" }),
]);

export const routeStops = pgTable("route_stops", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), routePlanId: uuid("route_plan_id").notNull(),
  jobId: uuid("job_id").notNull(), sequence: integer("sequence").notNull(), locked: boolean("locked").notNull().default(false),
  plannedArrivalAt: timestamp("planned_arrival_at", { withTimezone: true }), plannedDepartureAt: timestamp("planned_departure_at", { withTimezone: true }),
  estimatedDriveSeconds: integer("estimated_drive_seconds"), estimatedDistanceMeters: integer("estimated_distance_meters"), status: status(),
  actualArrivalAt: timestamp("actual_arrival_at", { withTimezone: true }), actualDepartureAt: timestamp("actual_departure_at", { withTimezone: true }),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.routePlanId], foreignColumns: [routePlans.tenantId, routePlans.id], name: "route_stops_route_tenant_fk" }),
  foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id], name: "route_stops_job_tenant_fk" }),
  uniqueIndex("route_stops_job_ux").on(t.routePlanId, t.jobId), uniqueIndex("route_stops_sequence_ux").on(t.routePlanId, t.sequence),
]);

export const routeOptimizationRuns = pgTable("route_optimization_runs", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), routePlanId: uuid("route_plan_id").notNull().references(() => routePlans.id),
  connectorInstallationId: uuid("connector_installation_id"), status: status(), inputSnapshot: jsonObject("input_snapshot"),
  outputSnapshot: jsonb("output_snapshot").$type<Record<string, unknown>>(), errorCode: text("error_code"), errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("route_optimization_runs_route_idx").on(t.tenantId, t.routePlanId)]);

export const formTemplates = pgTable("form_templates", {
  ...record(), tenantId: uuid("tenant_id").references(() => tenants.id), industryPackKey: text("industry_pack_key"), key: text("key").notNull(),
  name: text("name").notNull(), entityContext: text("entity_context").notNull(), schema: jsonObject("schema"),
  version: integer("version").notNull().default(1), active: active(),
});

export const formResponses = pgTable("form_responses", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), formTemplateId: uuid("form_template_id").notNull().references(() => formTemplates.id),
  formVersion: integer("form_version").notNull(), entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(),
  submittedByActorType: text("submitted_by_actor_type").notNull(), submittedByActorId: text("submitted_by_actor_id"),
  response: jsonObject("response"), submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("form_responses_entity_idx").on(t.tenantId, t.entityType, t.entityId)]);

export const notes = pgTable("notes", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(), visibility: text("visibility").notNull().default("internal"), body: text("body").notNull(),
  createdByActorType: text("created_by_actor_type").notNull(), createdByActorId: text("created_by_actor_id"),
}, (t) => [index("notes_entity_idx").on(t.tenantId, t.entityType, t.entityId)]);

export const files = pgTable("files", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), storageKey: text("storage_key").notNull(),
  originalName: text("original_name").notNull(), mimeType: text("mime_type").notNull(), byteSize: integer("byte_size").notNull(),
  checksum: text("checksum"), visibility: text("visibility").notNull(), uploadedByActorType: text("uploaded_by_actor_type").notNull(),
  uploadedByActorId: text("uploaded_by_actor_id"), metadata: jsonObject("metadata"),
}, (t) => [uniqueIndex("files_tenant_id_id_ux").on(t.tenantId, t.id), uniqueIndex("files_storage_key_ux").on(t.storageKey)]);

export const fileLinks = pgTable("file_links", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), fileId: uuid("file_id").notNull().references(() => files.id),
  entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(), purpose: text("purpose").notNull(),
}, (t) => [index("file_links_entity_idx").on(t.tenantId, t.entityType, t.entityId)]);

export const completionProofs = pgTable("completion_proofs", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), jobId: uuid("job_id").notNull().references(() => jobs.id),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(), completedByMembershipId: uuid("completed_by_membership_id").references(() => memberships.id),
  summary: text("summary"), signatureFileId: uuid("signature_file_id").references(() => files.id), snapshot: jsonObject("snapshot"),
}, (t) => [index("completion_proofs_job_idx").on(t.tenantId, t.jobId)]);

export const shifts = pgTable("shifts", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), membershipId: uuid("membership_id").notNull().references(() => memberships.id),
  organizationLocationId: uuid("organization_location_id").references(() => organizationLocations.id), status: status(),
  clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull(), clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
  notes: text("notes"), approvedByMembershipId: uuid("approved_by_membership_id").references(() => memberships.id),
}, (t) => [index("shifts_member_idx").on(t.tenantId, t.membershipId, t.clockInAt)]);

export const breaks = pgTable("breaks", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), shiftId: uuid("shift_id").notNull().references(() => shifts.id),
  breakType: text("break_type").notNull(), startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }), paid: boolean("paid").notNull().default(false),
});

export const timeEntries = pgTable("time_entries", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), membershipId: uuid("membership_id").notNull().references(() => memberships.id),
  shiftId: uuid("shift_id").references(() => shifts.id), jobId: uuid("job_id").references(() => jobs.id), source: text("source").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  durationSeconds: integer("duration_seconds").notNull(), correctionOfId: uuid("correction_of_id"), approvalStatus: status(), note: text("note"),
}, (t) => [index("time_entries_member_idx").on(t.tenantId, t.membershipId, t.startsAt)]);

export const mileageRecords = pgTable("mileage_records", {
  ...record(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), membershipId: uuid("membership_id").notNull().references(() => memberships.id),
  shiftId: uuid("shift_id").references(() => shifts.id), routePlanId: uuid("route_plan_id").references(() => routePlans.id),
  jobId: uuid("job_id").references(() => jobs.id), source: text("source").notNull(), distanceMeters: integer("distance_meters").notNull(),
  odometerStart: integer("odometer_start"), odometerEnd: integer("odometer_end"), personalVehicle: boolean("personal_vehicle").notNull().default(false),
  occurredOn: date("occurred_on").notNull(),
}, (t) => [index("mileage_records_member_idx").on(t.tenantId, t.membershipId, t.occurredOn)]);
