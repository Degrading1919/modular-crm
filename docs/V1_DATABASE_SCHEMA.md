# V1 Database Schema Specification

This is the implementation-level relational schema target for the first Codex build. Drizzle may adjust syntax, but the domain shape, isolation, constraints, and history requirements should remain.

## Conventions

Unless noted otherwise, tenant-owned tables include:

- `id uuid primary key`
- `tenant_id uuid not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- optional `archived_at timestamptz`

Use UTC storage for timestamps.

Money:

- amount columns use `bigint` minor units
- companion `currency varchar(3)`

Flexible configured values:

- `custom_fields jsonb not null default '{}'`

Status values may be text with application validation when tenant/Industry-Pack customization is required. Core normalized state categories remain constrained by the domain state machines.

All common list/query indexes should begin with `tenant_id` where appropriate.

## Identity and organization

### tenants

- id
- name
- slug unique
- status
- default_currency
- default_timezone
- industry_pack_key
- industry_pack_version
- settings jsonb
- created_at
- updated_at

### organizations

- id
- tenant_id
- parent_organization_id nullable
- organization_type: business | franchise_parent | franchise_unit
- legal_name
- display_name
- tax_id_encrypted nullable
- email
- phone
- timezone
- currency
- settings jsonb
- active boolean

Index: tenant_id, parent_organization_id

### organization_locations

- id
- tenant_id
- organization_id
- name
- code
- address fields
- latitude numeric nullable
- longitude numeric nullable
- timezone
- phone
- email
- active boolean
- settings jsonb

Unique: tenant_id + organization_id + code

### memberships

Links Better Auth user identity to business scope.

- id
- tenant_id
- user_id varchar not null
- organization_id
- default_location_id nullable
- role_template_id
- status: invited | active | suspended | inactive
- invited_at nullable
- joined_at nullable
- last_active_at nullable

Unique: tenant_id + user_id + organization_id

### membership_location_scopes

- membership_id
- location_id

Primary key: membership_id + location_id

### role_templates

- id
- tenant_id nullable for system defaults
- key
- name
- description
- system boolean
- active boolean

### permissions

System catalog.

- key primary key
- category
- description

### role_permissions

- role_template_id
- permission_key
- allowed boolean

Primary key: role_template_id + permission_key

## Configuration

### custom_field_definitions

- id
- tenant_id nullable for pack/system definitions
- industry_pack_key nullable
- entity_type
- key
- label
- field_type
- required boolean
- customer_visible boolean
- reportable boolean
- config jsonb
- sort_order integer
- active boolean

Unique within effective scope: entity_type + key

### tags

- id
- tenant_id
- name
- category nullable
- color_token nullable

### tag_assignments

- id
- tenant_id
- tag_id
- entity_type
- entity_id

Unique: tenant_id + tag_id + entity_type + entity_id

## Customers and portal

### customers

- id
- tenant_id
- organization_id
- owning_location_id nullable
- customer_type: residential | commercial
- status: active | paused | inactive | blocked
- display_name
- company_name nullable
- primary_contact_id nullable
- billing_email nullable
- billing_phone nullable
- billing_address jsonb nullable
- tax_exempt boolean
- payment_terms_days integer nullable
- lead_source_id nullable
- default_currency
- custom_fields jsonb
- archived_at nullable

Indexes:
- tenant_id + organization_id + status
- tenant_id + owning_location_id
- tenant_id + lower(display_name)

### customer_contacts

- id
- tenant_id
- customer_id
- first_name
- last_name
- email nullable
- phone nullable
- role/title nullable
- is_primary boolean
- billing_contact boolean
- service_contact boolean
- custom_fields jsonb
- active boolean

### service_locations

- id
- tenant_id
- customer_id
- organization_location_id nullable
- name
- address_line1
- address_line2 nullable
- city
- region
- postal_code
- country_code
- latitude nullable
- longitude nullable
- geocode_status
- geocode_provider nullable
- geocode_confidence nullable
- timezone nullable
- access_instructions_encrypted nullable
- service_zone_id nullable
- active boolean
- custom_fields jsonb

Index: tenant_id + customer_id

### customer_assets

- id
- tenant_id
- customer_id
- service_location_id nullable
- asset_type_key
- name
- status
- customer_visible boolean
- custom_fields jsonb
- archived_at nullable

Index: tenant_id + service_location_id + asset_type_key

### customer_preferences

- id
- tenant_id
- customer_id
- preference_key
- value jsonb

Unique: tenant_id + customer_id + preference_key

### portal_access

Links Better Auth user to a customer relationship.

- id
- tenant_id
- user_id varchar
- customer_id
- status
- invited_at nullable
- activated_at nullable
- last_login_at nullable

Unique: tenant_id + user_id + customer_id

### portal_location_access

- portal_access_id
- service_location_id

Primary key: portal_access_id + service_location_id

### customer_change_requests

- id
- tenant_id
- customer_id
- service_location_id nullable
- request_type
- status: submitted | reviewing | approved | rejected | withdrawn
- requested_changes jsonb
- applied_changes jsonb nullable
- customer_message nullable
- internal_note nullable
- submitted_by_user_id nullable
- reviewed_by_membership_id nullable
- reviewed_at nullable

## Leads and sales

### lead_sources

- id
- tenant_id
- name
- category
- active boolean

### leads

- id
- tenant_id
- organization_id
- owning_location_id nullable
- status
- first_name nullable
- last_name nullable
- company_name nullable
- email nullable
- phone nullable
- address jsonb nullable
- source_id nullable
- source_detail nullable
- customer_id nullable
- service_location_id nullable
- estimated_value_minor nullable
- currency nullable
- lost_reason nullable
- custom_fields jsonb
- converted_at nullable
- archived_at nullable

Indexes:
- tenant_id + status
- tenant_id + source_id
- tenant_id + created_at

### estimates

Logical estimate identity.

- id
- tenant_id
- customer_id nullable
- lead_id nullable
- service_location_id nullable
- organization_location_id nullable
- status
- current_revision integer
- expires_at nullable
- approved_at nullable
- declined_at nullable
- currency
- total_minor
- created_by_membership_id nullable

### estimate_revisions

Immutable customer-visible versions.

- id
- tenant_id
- estimate_id
- revision_number
- subtotal_minor
- discount_minor
- tax_minor
- total_minor
- terms_text nullable
- terms_version nullable
- notes nullable
- snapshot jsonb
- sent_at nullable
- created_at

Unique: estimate_id + revision_number

### estimate_items

- id
- tenant_id
- estimate_revision_id
- service_id nullable
- product_id nullable
- description
- quantity numeric
- unit_amount_minor
- discount_minor
- tax_minor
- total_minor
- sort_order integer
- metadata jsonb

### estimate_approvals

- id
- tenant_id
- estimate_id
- estimate_revision_id
- decision: approved | declined
- actor_type
- actor_user_id nullable
- secure_token_id nullable
- occurred_at
- ip_address nullable
- user_agent nullable
- terms_version nullable
- comment nullable

## Service catalog and pricing

### services

- id
- tenant_id
- organization_id nullable
- key
- name
- description nullable
- service_type
- default_duration_minutes nullable
- taxable boolean
- active boolean
- configuration jsonb
- custom_fields jsonb

### products

- id
- tenant_id
- sku nullable
- name
- description nullable
- taxable boolean
- inventory_item_id nullable
- active boolean
- custom_fields jsonb

### service_zones

- id
- tenant_id
- organization_id
- name
- zone_type: postal_codes | polygon | radius | manual
- definition jsonb
- pricing_priority integer
- active boolean

### price_rules

- id
- tenant_id
- organization_id
- name
- priority integer
- effective_from date nullable
- effective_to date nullable
- conditions jsonb
- effects jsonb
- active boolean
- source: tenant | industry_pack

### coupons

- id
- tenant_id
- code
- name
- discount_definition jsonb
- starts_at nullable
- ends_at nullable
- max_redemptions nullable
- active boolean

### coupon_redemptions

- id
- tenant_id
- coupon_id
- customer_id nullable
- estimate_id nullable
- invoice_id nullable
- redeemed_at

## Recurring service and jobs

### service_plans

- id
- tenant_id
- customer_id
- service_location_id
- organization_location_id nullable
- service_id
- status
- effective_from date
- effective_to date nullable
- pricing_snapshot jsonb
- billing_configuration jsonb
- recurrence_rule_id
- preferred_assignment jsonb nullable
- pause_from date nullable
- pause_until date nullable
- canceled_at nullable
- cancellation_reason nullable
- custom_fields jsonb

### recurrence_rules

- id
- tenant_id
- frequency_type
- interval integer
- days_of_week integer[] nullable
- day_of_month integer nullable
- window_start time nullable
- window_end time nullable
- timezone
- configuration jsonb

### jobs

- id
- tenant_id
- organization_id
- organization_location_id nullable
- customer_id
- service_location_id
- service_plan_id nullable
- service_id
- parent_job_id nullable
- relation_type nullable
- status
- scheduled_date date nullable
- service_window_start timestamptz nullable
- service_window_end timestamptz nullable
- estimated_duration_minutes nullable
- actual_started_at nullable
- actual_completed_at nullable
- assigned_route_id nullable
- price_snapshot jsonb nullable
- billable boolean
- skip_reason_code nullable
- cancel_reason_code nullable
- internal_summary nullable
- customer_summary nullable
- custom_fields jsonb

Indexes:
- tenant_id + scheduled_date + status
- tenant_id + customer_id + scheduled_date
- tenant_id + service_location_id + scheduled_date
- tenant_id + organization_location_id + scheduled_date

### appointments

- id
- tenant_id
- job_id
- status
- starts_at nullable
- ends_at nullable
- window_start nullable
- window_end nullable
- timezone
- version integer
- replaced_appointment_id nullable

### job_assignments

- id
- tenant_id
- job_id
- membership_id
- assignment_role
- assigned_at
- removed_at nullable

### job_status_events

Immutable.

- id
- tenant_id
- job_id
- from_status nullable
- to_status
- reason_code nullable
- note nullable
- actor_type
- actor_id nullable
- occurred_at

### recurring_generation_ledger

Prevents duplicate occurrences.

- id
- tenant_id
- service_plan_id
- occurrence_key
- intended_date
- job_id nullable
- status
- generated_at nullable

Unique: service_plan_id + occurrence_key

## Routing

### route_plans

- id
- tenant_id
- organization_location_id nullable
- membership_id
- route_date
- status
- start_location jsonb
- end_location jsonb
- planned_start_at nullable
- planned_end_at nullable
- estimated_distance_meters nullable
- estimated_drive_seconds nullable
- estimated_service_seconds nullable
- published_at nullable
- started_at nullable
- completed_at nullable
- current_optimization_run_id nullable

Index: tenant_id + route_date + membership_id

### route_stops

- id
- tenant_id
- route_plan_id
- job_id
- sequence integer
- locked boolean
- planned_arrival_at nullable
- planned_departure_at nullable
- estimated_drive_seconds nullable
- estimated_distance_meters nullable
- status
- actual_arrival_at nullable
- actual_departure_at nullable

Unique: route_plan_id + job_id
Unique: route_plan_id + sequence

### route_optimization_runs

- id
- tenant_id
- route_plan_id
- connector_installation_id nullable
- status
- input_snapshot jsonb
- output_snapshot jsonb nullable
- error_code nullable
- error_message nullable
- started_at
- completed_at nullable

## Field execution

### form_templates

- id
- tenant_id nullable
- industry_pack_key nullable
- key
- name
- entity_context
- schema jsonb
- version integer
- active boolean

### form_responses

- id
- tenant_id
- form_template_id
- form_version
- entity_type
- entity_id
- submitted_by_actor_type
- submitted_by_actor_id nullable
- response jsonb
- submitted_at

### notes

- id
- tenant_id
- entity_type
- entity_id
- visibility: internal | customer
- body
- created_by_actor_type
- created_by_actor_id nullable

### files

- id
- tenant_id
- storage_key
- original_name
- mime_type
- byte_size
- checksum nullable
- visibility
- uploaded_by_actor_type
- uploaded_by_actor_id nullable
- metadata jsonb

### file_links

- id
- tenant_id
- file_id
- entity_type
- entity_id
- purpose

### completion_proofs

- id
- tenant_id
- job_id
- completed_at
- completed_by_membership_id nullable
- summary nullable
- signature_file_id nullable
- snapshot jsonb

## Staff time and mileage

### shifts

- id
- tenant_id
- membership_id
- organization_location_id nullable
- status
- clock_in_at
- clock_out_at nullable
- notes nullable
- approved_by_membership_id nullable

### breaks

- id
- tenant_id
- shift_id
- break_type
- started_at
- ended_at nullable
- paid boolean

### time_entries

- id
- tenant_id
- membership_id
- shift_id nullable
- job_id nullable
- source
- starts_at
- ends_at
- duration_seconds
- correction_of_id nullable
- approval_status
- note nullable

### mileage_records

- id
- tenant_id
- membership_id
- shift_id nullable
- route_plan_id nullable
- job_id nullable
- source
- distance_meters
- odometer_start nullable
- odometer_end nullable
- personal_vehicle boolean
- occurred_on date

## Billing

### invoices

- id
- tenant_id
- organization_id
- organization_location_id nullable
- customer_id
- status
- invoice_number
- currency
- issued_at nullable
- due_at nullable
- subtotal_minor
- discount_minor
- tax_minor
- total_minor
- paid_minor
- balance_minor
- terms_snapshot nullable
- billing_snapshot jsonb
- voided_at nullable
- written_off_at nullable

Unique: tenant_id + invoice_number

### invoice_items

- id
- tenant_id
- invoice_id
- job_id nullable
- service_id nullable
- product_id nullable
- description
- quantity numeric
- unit_amount_minor
- discount_minor
- tax_minor
- total_minor
- metadata jsonb
- sort_order integer

### payments

- id
- tenant_id
- customer_id
- status
- source_type
- connector_installation_id nullable
- provider_reference nullable
- amount_minor
- currency
- received_at nullable
- failure_code nullable
- failure_message nullable
- idempotency_key unique
- recorded_by_actor_type
- recorded_by_actor_id nullable

### payment_allocations

- id
- tenant_id
- payment_id
- invoice_id
- amount_minor

Unique: payment_id + invoice_id

### refunds

- id
- tenant_id
- payment_id
- connector_installation_id nullable
- provider_reference nullable
- amount_minor
- currency
- status
- reason nullable
- created_at
- completed_at nullable

### payment_method_references

- id
- tenant_id
- customer_id
- connector_installation_id
- provider_customer_ref nullable
- provider_method_ref
- method_type
- brand nullable
- last4 nullable
- expiry_month nullable
- expiry_year nullable
- is_default boolean
- status

### tips

- id
- tenant_id
- customer_id
- job_id nullable
- membership_id nullable
- payment_id nullable
- amount_minor
- currency
- tip_type: one_time | recurring
- created_at

### customer_credits

- id
- tenant_id
- customer_id
- source_type
- source_entity_id nullable
- original_amount_minor
- remaining_amount_minor
- currency
- status: active | exhausted | void
- created_at
- expires_at nullable

### credit_allocations

- id
- tenant_id
- customer_credit_id
- invoice_id
- amount_minor
- allocated_at

### credit_memos

- id
- tenant_id
- customer_id
- invoice_id nullable
- amount_minor
- currency
- reason
- status
- issued_at
- applied_at nullable

### tax_rules

- id
- tenant_id
- organization_location_id nullable
- name
- conditions jsonb
- rate_basis_points nullable
- external_tax_code nullable
- priority integer
- active boolean

### billing_schedules

- id
- tenant_id
- service_plan_id
- billing_type
- interval_config jsonb
- autopay boolean
- next_bill_at nullable
- active boolean

## Payroll

### compensation_profiles

- id
- tenant_id
- membership_id
- effective_from date
- effective_to date nullable
- hourly_rate_minor nullable
- overtime_configuration jsonb
- per_job_configuration jsonb
- commission_configuration jsonb
- mileage_rate_minor_per_unit nullable
- bonus_configuration jsonb
- currency

### payroll_periods

- id
- tenant_id
- organization_id
- period_start date
- period_end date
- status
- reviewed_at nullable
- approved_at nullable
- approved_by_membership_id nullable
- exported_at nullable

Unique: tenant_id + organization_id + period_start + period_end

### payroll_calculations

- id
- tenant_id
- payroll_period_id
- membership_id
- version integer
- gross_amount_minor
- currency
- calculation_snapshot jsonb
- calculated_at

Unique: payroll_period_id + membership_id + version

### payroll_components

- id
- tenant_id
- payroll_calculation_id
- component_type
- source_entity_type nullable
- source_entity_id nullable
- description
- quantity numeric nullable
- rate_minor nullable
- amount_minor
- metadata jsonb

## Inventory

### inventory_items

- id
- tenant_id
- sku nullable
- name
- description nullable
- unit
- tracked boolean
- serialized boolean
- default_cost_minor nullable
- currency nullable
- active boolean
- custom_fields jsonb

### inventory_locations

- id
- tenant_id
- organization_location_id nullable
- membership_id nullable
- name
- location_type: branch | warehouse | vehicle | technician
- active boolean

### stock_movements

Immutable.

- id
- tenant_id
- inventory_item_id
- inventory_location_id
- linked_movement_id nullable
- movement_type
- quantity numeric
- unit_cost_minor nullable
- currency nullable
- job_id nullable
- reason nullable
- actor_membership_id nullable
- occurred_at
- metadata jsonb

### job_material_usage

- id
- tenant_id
- job_id
- inventory_item_id
- inventory_location_id
- quantity numeric
- stock_movement_id

### vendors

- id
- tenant_id
- name
- contact_name nullable
- email nullable
- phone nullable
- website nullable
- address jsonb nullable
- account_reference nullable
- active boolean

### purchase_orders

- id
- tenant_id
- vendor_id
- organization_location_id nullable
- status: draft | ordered | partially_received | received | canceled
- order_number
- ordered_at nullable
- expected_at nullable
- received_at nullable
- subtotal_minor
- tax_minor
- total_minor
- currency
- notes nullable

### purchase_order_items

- id
- tenant_id
- purchase_order_id
- inventory_item_id
- description
- quantity_ordered numeric
- quantity_received numeric
- unit_cost_minor
- total_minor

### reorder_rules

- id
- tenant_id
- inventory_item_id
- inventory_location_id
- reorder_threshold numeric
- target_quantity numeric nullable
- active boolean

Unique: inventory_item_id + inventory_location_id

## Communication

### notification_preferences

- id
- tenant_id
- customer_id
- event_key
- email_enabled boolean
- sms_enabled boolean

Unique: customer_id + event_key

### message_templates

- id
- tenant_id nullable
- industry_pack_key nullable
- key
- channel
- name
- subject_template nullable
- body_template
- version integer
- active boolean

### outbound_messages

- id
- tenant_id
- customer_id nullable
- job_id nullable
- invoice_id nullable
- channel
- template_key nullable
- template_version nullable
- recipient
- rendered_subject nullable
- rendered_body
- status
- connector_installation_id nullable
- provider_reference nullable
- idempotency_key
- queued_at
- sent_at nullable
- delivered_at nullable
- failure_code nullable
- failure_message nullable

Unique: tenant_id + idempotency_key

### communication_events

- id
- tenant_id
- outbound_message_id
- event_type
- provider_event_id nullable
- occurred_at
- payload jsonb


## Customer feedback and communication consent

### service_feedback

- id
- tenant_id
- customer_id
- job_id
- membership_id nullable
- rating integer nullable
- comment nullable
- visibility: internal | customer_shared | public_candidate
- submitted_at
- source
- resolved_ticket_id nullable

Unique where desired: tenant_id + customer_id + job_id + source

### consent_records

Immutable preference/consent history.

- id
- tenant_id
- customer_id
- channel
- category
- state: opted_in | opted_out | unknown
- source
- captured_at
- actor_type
- actor_id nullable
- evidence jsonb nullable

Index: tenant_id + customer_id + channel + category + captured_at

## Tickets

### ticket_type_definitions

- id
- tenant_id
- key
- name
- configuration jsonb
- active boolean

### ticket_status_definitions

- id
- tenant_id
- key
- name
- normalized_category
- sort_order
- active boolean

### tickets

- id
- tenant_id
- customer_id nullable
- service_location_id nullable
- job_id nullable
- ticket_type_id
- status_definition_id
- priority
- title
- description
- customer_visible boolean
- assigned_membership_id nullable
- due_at nullable
- created_by_actor_type
- created_by_actor_id nullable
- resolved_at nullable
- closed_at nullable
- custom_fields jsonb

### ticket_comments

- id
- tenant_id
- ticket_id
- visibility
- body
- actor_type
- actor_id nullable
- created_at

## Automation

### automation_rules

- id
- tenant_id
- name
- description nullable
- source: tenant | core_recipe | industry_pack
- source_key nullable
- status
- version
- trigger_config jsonb
- conditions jsonb
- actions jsonb
- created_by_membership_id nullable
- active_from nullable
- archived_at nullable

### automation_runs

- id
- tenant_id
- automation_rule_id
- rule_version
- triggering_event_id
- idempotency_key
- status
- attempts integer
- started_at nullable
- completed_at nullable
- next_retry_at nullable
- error_code nullable
- error_message nullable
- context_snapshot jsonb

Unique: tenant_id + idempotency_key

## Connectors

Connector definitions are code manifests; tenant connection state is relational.

### connector_installations

- id
- tenant_id
- organization_id nullable
- connector_key
- status
- display_name nullable
- credential_reference nullable
- granted_scopes jsonb
- provider_account_id nullable
- health_checked_at nullable
- last_success_at nullable
- last_error_code nullable
- last_error_message nullable
- settings jsonb

Unique where appropriate: tenant_id + connector_key + provider_account_id

### connector_resource_mappings

- id
- tenant_id
- connector_installation_id
- resource_type
- provider_resource_id
- local_entity_type nullable
- local_entity_id nullable
- metadata jsonb

### sync_states

- id
- tenant_id
- connector_installation_id
- sync_type
- cursor jsonb nullable
- status
- last_started_at nullable
- last_completed_at nullable
- last_error nullable

Unique: connector_installation_id + sync_type

### webhook_events

- id
- tenant_id nullable until resolved
- connector_key
- connector_installation_id nullable
- provider_event_id
- event_type
- signature_valid boolean
- status
- received_at
- processed_at nullable
- payload jsonb
- error_message nullable

Unique: connector_key + provider_event_id


## Import staging

### import_batches

- id
- tenant_id
- source_type
- connector_installation_id nullable
- file_id nullable
- entity_type
- status
- mapping jsonb
- total_rows integer
- valid_rows integer
- imported_rows integer
- failed_rows integer
- created_by_membership_id
- committed_at nullable
- error_summary jsonb nullable

### import_rows

- id
- tenant_id
- import_batch_id
- row_number integer
- source_payload jsonb
- normalized_payload jsonb nullable
- status
- matched_entity_type nullable
- matched_entity_id nullable
- errors jsonb nullable

Unique: import_batch_id + row_number

## Website

### sites

- id
- tenant_id
- organization_id
- organization_location_id nullable
- status: draft | published | disabled
- template_key
- template_version
- slug
- branding jsonb
- settings jsonb
- published_at nullable

### domains

- id
- tenant_id
- site_id
- hostname
- domain_type: platform | custom
- verification_status
- is_primary boolean
- verification_data jsonb nullable
- verified_at nullable

Unique: lower(hostname)

### site_contents

- id
- tenant_id
- site_id
- content_key
- content jsonb
- version integer
- updated_at

Unique: site_id + content_key

### site_forms

- id
- tenant_id
- site_id
- form_type
- name
- schema jsonb
- behavior jsonb
- active boolean

### site_submissions

- id
- tenant_id
- site_id
- site_form_id
- idempotency_key
- payload jsonb
- lead_id nullable
- customer_id nullable
- status
- submitted_at
- processed_at nullable

Unique: site_id + idempotency_key

### terms_versions

- id
- tenant_id
- document_type
- version
- content
- effective_at
- active boolean

### terms_acceptances

- id
- tenant_id
- terms_version_id
- actor_type
- actor_id nullable
- related_entity_type nullable
- related_entity_id nullable
- accepted_at
- ip_address nullable
- user_agent nullable


## Developer API and outbound webhooks

### api_credentials

- id
- tenant_id
- name
- token_hash
- token_prefix
- scopes text[]
- status
- expires_at nullable
- last_used_at nullable
- created_by_membership_id
- revoked_at nullable

### webhook_subscriptions

- id
- tenant_id
- name
- url
- event_patterns text[]
- secret_reference
- status
- created_by_membership_id
- last_success_at nullable
- last_failure_at nullable

### webhook_deliveries

- id
- tenant_id
- webhook_subscription_id
- domain_event_id
- status
- attempt_count integer
- response_status nullable
- response_excerpt nullable
- next_retry_at nullable
- last_attempt_at nullable
- delivered_at nullable

Unique: webhook_subscription_id + domain_event_id

## Reporting and operations

### saved_views

- id
- tenant_id
- membership_id nullable
- report_key
- name
- filters jsonb
- grouping jsonb
- columns jsonb
- shared boolean

### metric_snapshots

- id
- tenant_id
- metric_key
- organization_id nullable
- organization_location_id nullable
- period_start
- period_end
- dimensions jsonb
- values jsonb
- computed_at

### internal_notifications

- id
- tenant_id
- membership_id
- notification_type
- title
- body
- entity_type nullable
- entity_id nullable
- read_at nullable
- created_at

## Franchise support

### franchise_agreements

- id
- tenant_id
- parent_organization_id
- child_organization_id
- effective_from
- effective_to nullable
- settings jsonb
- active boolean

### royalty_rules

- id
- tenant_id
- franchise_agreement_id
- rule_type: percentage | fixed | minimum | tiered
- definition jsonb
- effective_from
- effective_to nullable
- active boolean

### royalty_statements

- id
- tenant_id
- franchise_agreement_id
- period_start
- period_end
- status
- basis_amount_minor
- royalty_amount_minor
- currency
- calculation_snapshot jsonb
- issued_at nullable
- paid_at nullable

## Audit and activity

### domain_events

Outbox/domain-event source.

- id uuid primary key
- tenant_id nullable
- event_type
- event_version integer
- occurred_at
- actor_type
- actor_id nullable
- entity_type
- entity_id
- organization_id nullable
- location_id nullable
- correlation_id uuid nullable
- causation_id uuid nullable
- payload jsonb
- published_at nullable

Index: published_at for worker/outbox processing

### audit_events

- id
- tenant_id
- actor_type
- actor_id nullable
- action
- entity_type
- entity_id
- before_data jsonb nullable
- after_data jsonb nullable
- ip_address nullable
- user_agent nullable
- correlation_id nullable
- created_at

### activity_events

- id
- tenant_id
- entity_type
- entity_id
- activity_type
- actor_type
- actor_id nullable
- summary
- metadata jsonb
- occurred_at

## Background jobs

pg-boss owns its internal tables.

Application domain tables store only business-level run state such as automation_runs, sync_states, route_optimization_runs, etc.

## Required database constraints

- All child tenant_id values must match parent tenant_id; enforce in service/repository layer and with composite keys/FKs where practical.
- Financial amounts cannot be negative except explicit adjustment/refund component contexts.
- payment allocations cannot exceed payment amount.
- invoice balance is deterministically recomputed/maintained from total and allocations/refunds/credits according to billing service rules.
- route stop sequence is unique per route.
- recurring occurrence key is unique per service plan.
- webhook provider event ID is unique per connector.
- automation idempotency key is unique per tenant.
- public site hostname is globally unique.
- one default payment method per customer/provider installation should be enforced transactionally.
- one primary contact per customer should be enforced transactionally.

## Required indexes

Beyond explicit indexes above, add indexes for:

- tenant_id + updated_at on high-volume operational tables
- tenant_id + archived_at/status for active-record lists
- customer foreign keys on jobs/invoices/payments/tickets
- job scheduled_date/status/assignment
- invoice status/due_at
- payment status/received_at
- outbound_message status/queued_at
- automation_run status/next_retry_at
- webhook_event status/received_at
- stock_movement item/location/occurred_at
- audit/activity entity lookup
- full-text/trigram indexes for customer, lead, invoice number, job reference, and address search

## Deletion policy

Hard deletion is limited to:

- never-activated invitations
- drafts with no downstream references where business rules allow
- expired ephemeral tokens
- test/development cleanup

Business history, financial records, completed jobs, audit events, stock movements, payroll calculations, and external event records are never hard-deleted through normal UI operations.
