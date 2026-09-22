# V1 Domain Model

This document defines the shared business concepts Codex should use when designing the initial database schema. It is intentionally domain-level rather than a final SQL schema.

## Platform and organization

### User
Global authenticated identity for staff/admin users.

### Tenant
Top-level SaaS isolation boundary.

### Organization
Business entity operating inside a tenant.

### Parent / Franchise Organization
Optional hierarchy above operating organizations or branches.

### Location / Branch
Operational business location used for staffing, reporting, inventory, dispatch, and local settings.

### Membership
Links a user to a tenant/organization and optional location scope.

### Role Template
Default role such as Owner/Admin, Office/Manager, or Field Technician.

### Permission
Granular server-enforced capability.

## Customer domain

### Customer
Residential or commercial customer record.

### Customer Contact
One or more people associated with a customer.

### Service Location
Physical location where work occurs.

### Customer Portal Identity
Authenticated customer-side identity linked only to permitted customer/location records.

### Customer Asset
Configurable serviced object or profile defined by an Industry Pack.

Examples:
- pet/dog
- septic system
- appliance
- chimney

### Customer Preference
Notification, scheduling, billing, and service preferences.

### Customer Change Request
Portal-originated request to update service, address, asset, pause/cancel status, or other business-controlled data.

## Lead and sales domain

### Lead
Prospective customer before conversion.

### Lead Source
Referral/marketing source.

### Estimate
Proposed work and pricing.

### Estimate Item
Service/product/fee line.

### Estimate Approval
Approval/rejection record including secure-link or portal action.

### Coupon / Promotion
Reusable discount rule.

## Service catalog and pricing

### Service
Sellable service definition.

### Product
Sellable physical or non-service item.

### Price Rule
Pricing logic tied to service, quantity, frequency, zone, location, customer type, or Industry Pack fields.

### Service Area / Pricing Zone
Geographic area used for eligibility, pricing, routing, or reporting.

### Add-on / Cross-sell
Optional service/product recommendation associated with a core service.

## Recurring service and scheduling

### Service Plan
Customer-specific agreement defining recurring work, pricing, frequency, billing behavior, and effective dates.

### Recurrence Rule
Schedule recurrence configuration.

### Job
Unit of work to perform.

### Appointment
Scheduled time/window for a job.

### Job Assignment
Staff/crew assignment.

### Job Status Event
History of state changes such as scheduled, en route, started, completed, skipped, missed, canceled, rescheduled, or reclean/return required.

### Dispatch Board State
Operational assignment/order representation derived from jobs, appointments, and routes.

## Routing and geography

### Geocode
Normalized coordinates and provider metadata for a service or business location.

### Route Plan
Technician/crew route for a date or shift.

### Route Stop
Ordered job/location within a route.

### Route Optimization Run
Provider request/result, constraints, estimated travel, and optimization metadata.

### Travel / Mileage Record
Business travel, odometer, or reimbursable mileage associated with staff/job/route.

## Field execution

### Job Form Template
Configurable checklist/form defined by core or Industry Pack.

### Job Form Response
Completed field data.

### Note
Internal or customer-visible note.

### File / Media
Photo, document, signature, or attachment with visibility metadata.

### Completion Proof
Customer-visible completion evidence, including time, photos, signature, and summary.

### Time Entry
Work time record associated with staff and optionally jobs/locations.

### Shift
Clock-in/out period.

### Break
Break period within a shift.

## Billing and money

### Invoice
Amount due for completed or scheduled work.

### Invoice Item
Service/product/fee/tax/discount line.

### Payment
Recorded payment against an invoice or account.

### Refund
Money returned against a payment.

### Payment Method Reference
Provider-safe reference to a customer's stored payment method. Never store raw card details.

### Tip
One-time or recurring tip attributable to customer/job/staff.

### Tax Rule
Tenant/location/service/customer tax configuration.

### Billing Schedule
Recurring invoice/payment timing associated with service plans.

## Payroll and compensation

V1 payroll scope is operational gross-pay support, not tax filing or withholding.

### Compensation Profile
Hourly rate, commission, bonus, per-job, mileage, or other supported compensation settings.

### Payroll Period
Date range used to aggregate compensation inputs.

### Payroll Calculation
Gross-pay calculation based on approved time, commissions, bonuses, tips, and mileage.

### Pay Statement
Human-readable gross-pay breakdown/export.

Tax withholding, government filing, and direct-deposit payroll processing should be handled by external payroll connectors rather than recreated in V1.

## Inventory and parts

### Inventory Item
Tracked supply, part, consumable, or product.

### Inventory Location
Branch, warehouse, vehicle, or technician stock location.

### Stock Movement
Receive, transfer, consume, adjust, return, or sell inventory.

### Job Material Usage
Inventory consumed by a job.

### Reorder Rule
Threshold/target information for low-stock reporting and automation.

## Communication

### Notification Preference
Per-customer channel/event preference.

### Message Template
Reusable email or SMS content.

### Outbound Message
Email/SMS notification request and delivery state.

### Communication Event
History entry for sent/delivered/failed communication.

A full omnichannel inbound conversation inbox is outside V1.

## Support and requests

### Ticket
Customer or staff support/work request.

### Ticket Type
Configurable type.

### Ticket Status
Configurable workflow state.

### Ticket Comment
Conversation/history within a ticket.

## Automation

### Automation Recipe
Core or Industry Pack supplied default automation.

### Automation Rule
Tenant-created trigger-condition-action rule.

### Automation Trigger
Event that starts evaluation.

### Automation Condition
Optional predicate.

### Automation Action
One or more actions to execute.

### Automation Run
Execution history, status, retry, and error details.

## Integrations

### Connector Definition
Marketplace metadata and supported capabilities.

### Connector Installation
Tenant-specific connection to a provider.

### Connector Credential
Encrypted/secure authorization material.

### Connector Resource Mapping
Selected provider account/calendar/location/etc. mapped to Modular CRM.

### Sync State
Cursor/status for imported or synchronized data.

### Webhook Event
Verified, idempotently processed provider event.

## Website

### Site
Tenant/location public website configuration.

### Domain
Platform or custom hostname association.

### Site Template
Reusable template.

### Site Content
Structured business data used by the template.

### Site Form
Lead/signup/booking/contact form definition.

### Site Submission
Form result linked into CRM workflows.

## Reporting

### Report Definition
Core, Industry Pack, or configurable report.

### Saved Report / View
Tenant-saved filters/grouping.

### Metric Snapshot
Optional precomputed aggregates for expensive reporting.

## Auditability

### Audit Event
Security/business history for sensitive changes.

### Activity Event
Timeline event shown on customer, job, billing, or staff records.

## Modeling rules

- Tenant isolation applies to every tenant-owned entity.
- Use shared generic entities plus Industry Pack metadata/custom fields instead of niche-specific tables where practical.
- Persist important state transitions and external events rather than relying only on current-state columns.
- Money should use integer minor units plus currency code.
- Dates/times should preserve tenant/location timezone semantics.
- Provider-specific IDs belong in connector/integration records, not scattered across core business tables.
