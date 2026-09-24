# V1 Domain Events and Application Contracts

The implementation may use server actions, route handlers, internal services, queues, or APIs as appropriate, but business behavior should be expressed through stable application/domain contracts.

## Domain event envelope

Every meaningful domain event should expose a normalized envelope similar to:

- event_id
- event_type
- event_version
- occurred_at
- tenant_id
- organization_id when applicable
- location_id when applicable
- actor_type
- actor_id when applicable
- entity_type
- entity_id
- correlation_id
- causation_id
- payload

Events are immutable facts. Consumers must tolerate repeated delivery by using event_id/idempotency.

## Required event families

### Leads
- lead.created
- lead.updated
- lead.qualified
- lead.converted
- lead.lost

### Customers
- customer.created
- customer.updated
- customer.status_changed
- customer_change_request.submitted
- customer_change_request.approved
- customer_change_request.rejected

### Estimates
- estimate.created
- estimate.sent
- estimate.viewed
- estimate.approved
- estimate.declined
- estimate.expired

### Service plans
- service_plan.created
- service_plan.activated
- service_plan.paused
- service_plan.resumed
- service_plan.changed
- service_plan.canceled
- service_plan.ended

### Jobs
- job.created
- job.scheduled
- job.assigned
- job.dispatched
- job.en_route
- job.started
- job.completed
- job.skipped
- job.missed
- job.canceled
- job.needs_return

### Routes
- route.created
- route.optimized
- route.published
- route.changed
- route.started
- route.completed

### Billing
- invoice.created
- invoice.issued
- invoice.overdue
- invoice.paid
- payment.pending
- payment.succeeded
- payment.failed
- payment.refunded

### Staff/payroll
- shift.started
- shift.ended
- time_entry.created
- time_entry.corrected
- payroll_period.opened
- payroll_period.approved
- payroll_period.exported

### Inventory
- inventory.moved
- inventory.low_stock
- job_material.used

### Messaging
- outbound_message.queued
- outbound_message.sent
- outbound_message.delivered
- outbound_message.failed

### Tickets
- ticket.created
- ticket.updated
- ticket.status_changed
- ticket.closed

### Website
- site.published
- site_submission.created

### Connectors
- connector.connected
- connector.disconnected
- connector.needs_attention
- connector.sync_completed
- connector.sync_failed

## Service boundaries

Core application services should be organized around behavior, not UI pages.

Expected boundaries include:

- IdentityService
- AuthorizationService
- OrganizationService
- CustomerService
- LeadService
- EstimateService
- ServicePlanService
- SchedulingService
- JobService
- RoutingService
- BillingService
- PaymentCapability
- StaffTimeService
- PayrollService
- InventoryService
- MessagingCapability
- TicketService
- AutomationService
- ConnectorService
- WebsiteService
- ReportingService
- AuditService

Names may vary, but UI code should not contain core business rules directly.

## Command behavior

Business mutations should follow a command-like contract:

1. authenticate actor
2. resolve tenant/organization scope
3. authorize capability
4. validate current entity state
5. validate input
6. apply transaction
7. append audit/activity data
8. emit domain event(s)
9. enqueue external/automation side effects
10. return normalized result

External network calls should generally occur outside the primary database transaction unless atomic behavior requires otherwise.

## Query behavior

- Queries are always tenant-scoped.
- Customer portal queries are additionally customer-relationship-scoped.
- Location/franchise scope is enforced by permissions.
- Lists use pagination/cursor strategy suitable for large datasets.
- Filters/sorts should map to reportable/indexed fields where possible.
- UI-specific view models may compose data from multiple services but do not bypass authorization.

## Idempotency

Idempotency is required for:

- public website signup/submission processing
- lead conversion
- recurring job generation
- payment creation
- provider webhooks
- invoice generation
- automation runs
- outbound messages where duplicate delivery would be harmful
- external sync imports

## Background work

Use background jobs for:

- route optimization
- recurring job generation
- bulk reschedule/skip
- message delivery
- payment retries
- connector synchronization
- webhook processing after verification
- report/materialized metric refresh
- media processing
- website publication when asynchronous
- automation actions that do not need synchronous completion

Each job records status, attempts, last error, correlation context, and tenant.

The worker sweeps the transactional outbox at startup and every 15 seconds, with a once-per-minute pg-boss schedule as a persistent recovery sweep. Consumers remain idempotent by event or action key.

## Error contract

User-facing errors should normalize into:

- code
- message
- field_errors when applicable
- retryable boolean
- correlation_id

Do not expose provider secrets, raw stack traces, SQL errors, or internal tokens to end users.

## Connector capability contracts

Examples:

### Payment capability
- create_customer_reference
- attach_payment_method
- create_payment
- refund_payment
- retrieve_payment_status
- create_customer_portal/session when supported

### Messaging capability
- send_email
- send_sms
- validate_address/number when supported
- process_delivery_event

### Calendar capability
- list_calendars
- create_event
- update_event
- delete_event
- sync_events

### Accounting capability
- discover_company
- export/sync_customer
- export/sync_invoice
- export/sync_payment
- retrieve_sync_status

### Routing capability
- geocode
- calculate_matrix
- optimize_route
- retrieve_route

The core application calls capabilities, not provider-specific SDKs.

## Versioning

- Domain event payloads carry event_version.
- Public/connector APIs are versioned before external third parties are encouraged to depend on them.
- Industry Pack schemas carry a pack version and support migrations.
- Automation rules store configuration version.
