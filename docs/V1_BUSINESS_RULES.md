# V1 Business Rules

## General data behavior

- Prefer archive/disable over destructive deletion when history exists.
- Every material financial, security, permission, status, connector, payroll, and customer-controlled change must be auditable.
- Timestamps are stored in UTC and rendered in the relevant tenant/location timezone.
- Monetary values use integer minor units plus ISO currency.
- User-visible identifiers may be friendly sequences; database identity remains opaque.
- Customer-facing documents preserve immutable snapshots/version history once accepted or issued.
- Custom fields and Industry Pack values must be queryable and reportable without creating niche-specific schema for every field.

## Tenant and organization rules

- Every business record belongs to exactly one tenant.
- Operational records also belong to an organization/location where relevant.
- Parent/franchise users may access child locations only through explicit scope/permission.
- Cross-tenant access is never inferred from matching email addresses.
- Staff can belong to multiple locations/organizations with distinct permissions.

## Customer rules

- Residential and commercial customers use the same core Customer model with customer_type and configuration.
- A customer may have multiple contacts and multiple service locations.
- A service location may contain multiple configurable assets/work areas.
- Customer portal users may be linked to one or more customer/location records.
- Portal users cannot access internal-only notes, pricing internals, payroll, routing internals, or other customers.

## Lead conversion

On conversion:

1. Create/link Customer.
2. Create/link primary contact.
3. Create service location if collected.
4. Preserve lead source and original acquisition metadata.
5. Link estimate(s), website submissions, notes, files, and communications.
6. Apply selected Industry Pack defaults.
7. Optionally invite the customer to the portal.
8. Emit `lead.converted`.

Conversion is idempotent.

## Scheduling and recurring generation

- A Service Plan is the source of truth for recurring customer commitment.
- Jobs are concrete work instances generated from the plan.
- A recurring generator should create jobs far enough ahead for routing/visibility using a configurable horizon.
- Generator reruns are idempotent and cannot duplicate an occurrence.
- Changing a recurrence applies prospectively from an effective date.
- Bulk weather/holiday operations may skip/reschedule many jobs while preserving per-job history.
- Estimated duration may come from service, price rule, Industry Pack, customer, or historical override.

## Routing

- Geocoding happens when a service/business location is created or materially changed.
- Failed/low-confidence geocodes are surfaced for correction.
- Optimization input may include technician start/end, work windows, service durations, capacity/skills, locked stops, and priority.
- Provider-specific routing data is normalized into core RoutePlan/RouteStop records.
- Manual user ordering always overrides the last optimization output until reoptimization is explicitly requested.
- Route changes after technician publication generate a field-app update and optional notification.

## Estimates

- Taxes/discounts are computed from line-level configuration at creation time and snapshotted.
- An approved estimate can generate the configured downstream objects.
- Revisions preserve prior customer-visible versions.
- Expiration is configurable by tenant/service.

## Jobs and completion

- Required completion fields/forms come from service and Industry Pack configuration.
- Completion can trigger invoice creation, customer notification, route progress, inventory consumption, payroll inputs, and automations.
- Skip/missed/cancel reasons are structured codes plus optional free text.
- Completion proof visibility is configurable per form/file but defaults to customer-visible for designated proof photos.

## Billing

- Supported billing models include one-time, prepaid, postpaid, recurring period, per-job, and account/manual.
- Service Plans define billing behavior separately from scheduling recurrence.
- Automatic charging requires a valid provider payment method reference and explicit tenant/customer authorization policy.
- Failed automatic payments create actionable retry state and may trigger configured notifications/automations.
- Invoice numbering is tenant/location configurable and collision-safe.
- Refunds never delete original payment history.

## Taxes

- V1 stores tax configuration and can compute configured rates.
- External tax/accounting connectors may override/enrich tax calculations when enabled.
- Historical invoices preserve the tax result used at issue time.

## Communications

- Notification preferences are event-specific where practical.
- Transactional operational messages may have different consent rules than marketing messages; the system must distinguish them.
- Templates support variables from tenant, customer, location, job, route, invoice, estimate, and Industry Pack data.
- A message preview is available before manual send.
- Automated sends log template version and rendered content.
- SMS/email providers are replaceable through connectors.

## Automation

Core trigger families:

- lead created/updated/converted
- estimate sent/viewed/approved/declined/expired
- customer created/status changed
- service plan created/paused/resumed/canceled
- job created/scheduled/dispatched/en-route/started/completed/skipped/missed/canceled
- route published/changed/completed
- invoice issued/due/overdue/paid
- payment succeeded/failed/refunded
- ticket created/status changed
- inventory below threshold
- shift/time/payroll events
- connector health/sync errors
- website form submitted

Core action families:

- send email
- send SMS
- create/update task/ticket
- create job
- schedule/reschedule job
- create/issue invoice
- request/attempt payment
- update customer/tag/status/custom field
- notify staff
- add note
- invoke connector action/webhook
- pause/resume service plan where explicitly authorized

Rules:

- Conditions use a safe declarative expression model, not arbitrary user code.
- Actions run under the creating tenant and explicit system permission scope.
- Destructive/high-impact actions require clear configuration and audit trail.
- The editor should prevent obvious infinite loops and display warnings for recursive trigger/action combinations.

## Time and payroll

- Staff time can come from shifts, job timers, manual entries, and approved corrections.
- Overlapping shift/time entries are flagged.
- Managers approve corrections and payroll periods according to permission.
- Gross-pay components may include hourly time, overtime rules, per-job pay, commission, bonus, mileage, and tips.
- Payroll calculations are deterministic from approved source records and versioned.
- Tax calculation, withholding, filing, benefits, and direct deposit are external payroll responsibilities.

## Inventory

- Inventory may be tracked globally, per branch, warehouse, vehicle, or technician.
- Service/job definitions may define expected/default material usage.
- Actual field usage can differ and should be captured.
- Serialized items may require serial/identifier metadata; simple consumables do not.
- Reorder alerts can trigger automation.
- Inventory valuation/accounting remains lightweight in V1; accounting connectors may receive summarized transactions.

## Reporting

Default reporting dimensions:

- date/time period
- location/branch
- franchise/parent
- customer/customer type
- service
- service area/zone
- technician/team
- route
- lead source
- status
- Industry Pack fields where marked reportable

Core KPI families:

- revenue, invoiced, collected, outstanding
- new/lost/net customers
- active/paused service plans
- job completion/skip/miss/reclean rates
- route miles, drive time, service time, jobs/hour
- technician utilization/productivity
- average customer value
- estimate conversion
- payment failure/aging
- payroll/labor cost inputs
- inventory usage/reorder
- referral source performance

## Website and signup

- Public website content is tenant/location structured data rendered through a template.
- Service-area eligibility should be checked before presenting unavailable service options when possible.
- Public pricing/instant quote behavior is Industry Pack/configuration driven.
- Website submissions are idempotently converted into Lead or Customer/Service Plan flows according to form type.
- Signup may collect payment method through the configured payment connector without exposing raw payment credentials to Modular CRM.
- Terms acceptance records terms version and timestamp.
- Custom domains are optional; platform subdomains remain supported.

## Security and privacy

- Secrets and connector tokens are encrypted at rest and never returned to browser clients unless required by provider flow.
- Authorization is checked server-side for every protected mutation and sensitive read.
- File access uses tenant/customer-scoped authorization and non-guessable URLs or signed access.
- Webhooks validate signatures where providers support them.
- External events are idempotently processed.
- Rate limits apply to authentication, public forms, secure links, outbound messaging, and sensitive actions.
- Audit events record actor type: staff, customer, system, automation, connector, or public/anonymous.

## Offline and degraded behavior

- Field workflows should tolerate temporary network loss where feasible through queued local mutations for notes/forms/status/media metadata.
- Provider outages must not corrupt core business state.
- Connector-dependent actions enter retry/error state and remain visible.
- Core CRM, scheduling, jobs, and local mock flows must work without production connectors in development.

## Defaults versus customization

- Industry Packs supply opinionated defaults.
- Tenant owners can customize workflows, forms, automations, pricing, templates, and permissions within supported boundaries.
- A customization should not fork code or require a custom deployment for ordinary use.
