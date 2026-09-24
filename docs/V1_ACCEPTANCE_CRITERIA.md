# V1 Acceptance Criteria

V1 is considered ready for owner playtesting when all critical scenarios below work locally end to end using seed data and mock/test connectors.

## Installation and local boot

- A fresh checkout has a documented setup path.
- One command sequence installs dependencies, starts required local infrastructure, applies schema/migrations, seeds data, and launches the application.
- No production API key is required to exercise core flows.
- Mock/test integrations are clearly identified in the UI.
- Seed accounts exist for owner, office manager, technician, and customer.

## Tenant isolation

- Two seeded businesses contain overlapping names/emails without data leakage.
- A user from Tenant A cannot fetch or mutate Tenant B records by direct URL/API manipulation.
- A customer portal identity sees only linked customer/location data.
- Franchise/parent scope can see authorized child locations and no others.

## Pet-waste business setup

An owner can:

- sign up
- choose Pet Waste Removal
- create business profile
- configure service area/pricing zone
- select/modify services and recurring frequencies
- configure payment/messaging mocks
- publish a basic generated website
- invite staff

## Modular capability setup

- The Industry Pack uses plain-language onboarding answers to recommend a focused capability setup; the owner can accept it or customize it.
- The owner can add or remove available modules later in the same tenant without a migration or a new application.
- Module definitions and feature membership are data-defined; prices, allowances, and staff-seat charges are not fixed in application code.
- Entitlement, enabled/configured state, and navigation prominence can differ, and server-side actions enforce entitlement and dependencies.
- Removing a module prevents new use while prior operational and financial records remain available for history and export.
- Workers, automations, connectors, public features, and portal actions honor the same effective capability state when they act for a tenant.
- Usage measurement and account credits/adjustments can be recorded independently of a payment provider.

## Import and migration

- Owner can upload a customer CSV.
- High-confidence columns map automatically.
- Ambiguous mappings are surfaced for confirmation.
- Duplicate candidates are shown rather than merged blindly.
- Import is idempotent on retry.
- Import summary and error rows are available.
- Tenant-scoped CSV export works.
- Full business-data export excludes secrets and protected payment credentials.

## Public website/signup

A visitor can:

- enter service address
- receive service-area eligibility result
- choose service/frequency
- enter pet and yard/access data
- receive configured pricing or quote-required result
- accept terms
- enter mock/test payment method when required
- submit signup

The submission produces the correct Lead or Customer/Service Plan flow exactly once.

## Lead and estimate flow

Office staff can:

- create a lead
- record source/contact
- create/send estimate
- customer views estimate
- customer approves
- lead converts to customer
- approved work creates appropriate service plan/job

Revision, decline, and expiration behavior is testable.

## Recurring-service generation

- Active weekly service plan creates unique future jobs.
- Running generator twice does not duplicate jobs.
- Pause prevents affected occurrences.
- Resume restores future generation.
- Frequency/pricing changes apply from effective date without altering history.
- Cancellation stops future generation according to policy.

## Scheduling and dispatch

Office staff can:

- view unassigned jobs
- assign technician/date
- bulk move/skip work
- create route
- optimize route using mock/test routing adapter
- manually reorder stops
- publish route

Technician sees the published route immediately/after refresh and cannot see unauthorized jobs.

## Field workflow

Technician can:

- clock in
- see ordered route
- open next job
- view gate/safety/pet details
- send mock on-the-way notification
- start job
- add note/photo
- complete required checklist
- complete job
- skip another job with required reason
- record break/mileage
- clock out

Completion updates office/customer views and route progress.

## Billing and payment

- Completion can generate/issue an invoice according to service plan.
- Customer can view invoice in portal.
- Mock/test payment succeeds and updates balance.
- Failed payment produces retry/error state.
- Partial/manual payment works.
- Refund produces linked immutable refund record.
- Historical issued invoice remains unchanged after later service-price edits.

## Customer documents

- estimate renders for browser/print/download
- invoice renders with payments/credits/balance
- payment receipt renders
- customer account statement reconciles seeded activity
- service completion report includes configured proof
- historical issued documents render from preserved snapshots

## Customer portal

Customer can:

- manage profile
- view/edit permitted pet data
- request access/service changes
- view upcoming/history
- see completion proof
- view/approve estimate
- view/pay invoices
- manage notification preferences
- request pause/change/cancel
- create support/reclean ticket
- submit service feedback/rating

Controlled changes require office approval and preserve before/after history.

## Outbound notifications

- Email and SMS adapters can run in mock/test mode.
- Template variables render correctly.
- Preference suppression works.
- Job completion, route/service reminder, payment receipt, and payment failure recipes are demonstrable.
- Delivery/error history is visible.

## Automation

- Default recipes install with Industry Pack.
- Owner can create custom trigger-condition-action rule.
- Rule executes exactly once for triggering event.
- Execution history is visible.
- Failed action retries when retryable.
- Recursive/unsafe configurations are prevented or warned.

## Inventory

- Owner creates inventory item.
- Stock is received at branch.
- Stock transfers to technician/vehicle.
- Technician consumes material on job.
- Balance updates via stock movements.
- Low-stock threshold can trigger alert/automation.
- Owner can create vendor and purchase order.
- Partial and full receiving update stock through immutable movements.

## Time and payroll

- Staff shift/break/mileage data aggregates into open payroll period.
- Compensation profile can combine hourly rate plus at least one bonus/commission/tip/mileage component.
- Manager can review/correct/approve.
- Gross pay is deterministic and exportable.
- No UI claims tax filing/direct deposit was completed unless a future connector actually does it.

## Multi-location/franchise

- Parent user can create/manage at least two locations.
- Staff can be scoped to one or both.
- Customers/jobs/routes can belong to a location.
- Location manager sees only scoped operation.
- Parent reporting rolls up both locations.
- Parent can configure a sample franchise royalty rule.
- A royalty statement can be calculated for a seeded period from child-unit activity.
- Configuration supports inherited defaults with location overrides where defined.

## Reporting

At minimum, seeded/demo reports prove:

- revenue/invoiced/collected/outstanding
- customer growth/loss
- recurring plan counts
- job completion/skip/miss/reclean
- route miles/drive/service time
- technician jobs/hour and revenue/hour
- lead source / estimate conversion
- payroll input totals
- inventory low-stock/usage
- multi-location rollup

CSV export works for appropriate lists/reports.

## Developer API and webhooks

- Owner can create and revoke a scoped API credential.
- API can list/create/update at least the documented high-value CRM resources.
- Tenant scope comes from credential and cannot be overridden by request input.
- Cursor pagination and normalized errors work.
- Idempotency key prevents duplicate create where required.
- Owner can register an outbound webhook endpoint.
- Test event can be sent.
- Deliveries are signed, logged, retried, and manually retryable.
- Duplicate domain-event delivery remains safe.

## Connector marketplace

- Marketplace groups connectors by capability.
- At least one working mock/test connector exists for each critical capability.
- Connection status/health is visible.
- Connect/disconnect/reconnect flow works.
- Provider-specific configuration does not leak into unrelated core business logic.
- Webhook processing demonstrates signature-verification interface and idempotency using a test connector.

## Website publishing

- Owner can populate site from structured business data.
- At least one pet-waste template renders responsive pages.
- Preview and publish states work.
- Platform subdomain routing works locally/test-wise.
- Lead/signup/contact forms feed CRM.
- Custom-domain data model/setup UI exists even if local development uses simulated verification.

## Security and audit

- Permission checks are server-side.
- Sensitive changes create audit events.
- Payment data stores references only.
- Connector secrets are not exposed to browser payloads.
- Signed/authorized file access is enforced.
- Public forms and auth routes have rate-limit strategy/tests.
- Direct object-reference attacks fail in automated tests.

## Automated test expectations

The repository should include:

- unit tests for pricing/state transitions/permissions/payroll calculations
- integration tests for persistence and service boundaries
- connector contract tests using mocks
- end-to-end browser tests for owner, technician, customer, and public signup paths
- tenant-isolation/security regression tests

A green automated test suite is required before the initial build is considered complete.
