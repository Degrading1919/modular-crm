# V1 State Machines

State transitions are server-enforced, tenant-scoped, auditable, and should emit domain events for automations, notifications, reporting, and integrations.

## Lead

States:

`new -> contacted -> qualified -> quoted -> converted`

Terminal alternatives:

`lost`
`disqualified`

Rules:

- A lead may be converted directly from new/contacted/qualified without an estimate.
- Creating an estimate normally moves a qualified lead to quoted.
- Conversion creates or links a Customer and preserves source/history.
- Lost/disqualified leads remain searchable and reportable.
- Reopening a lost lead returns it to contacted or qualified as explicitly chosen.

## Customer

Lifecycle status:

`active | paused | inactive | blocked`

Rules:

- Active customers may receive new jobs/service plans.
- Paused customers retain history and billing but recurring job generation is suspended according to pause dates.
- Inactive customers do not generate recurring work.
- Blocked customers cannot self-book or generate new work until unblocked.
- Customer records are archived, not hard-deleted, when financial/job history exists.

## Estimate

States:

`draft -> sent -> viewed -> approved`

Alternatives:

`declined`
`expired`
`canceled`

Rules:

- Draft estimates are editable.
- Sending freezes a version snapshot.
- Material edits after send create a new revision while retaining prior versions.
- Approved estimates cannot be silently changed.
- Approval may create a Job, Service Plan, Invoice, or any configured combination.
- Declined/expired estimates may be revised and resent as a new version.
- Secure-link and portal approvals record identity/context, timestamp, IP/user agent when available, and accepted terms version.

## Service Plan

States:

`draft -> active -> paused -> active -> ended`

Alternative:

`canceled`

Rules:

- Activation requires customer, service location, service definition, schedule/frequency, pricing, and effective date.
- Active plans generate jobs according to recurrence configuration.
- Pause may be bounded by start/end dates or indefinite.
- Cancellation stops future generation but does not remove already completed work.
- Future generated jobs may be canceled automatically based on tenant policy.
- Pricing changes use effective dates and do not retroactively rewrite historical invoices/jobs.

## Job

Primary states:

`draft -> unscheduled -> scheduled -> dispatched -> en_route -> in_progress -> completed`

Field work may move `in_progress -> paused -> in_progress` while retaining timer/status history.

Alternative operational states:

`skipped`
`missed`
`canceled`
`needs_return`

Rules:

- A job may be created directly as scheduled when date/assignment is known.
- Dispatched means the job has been committed to a field route/assignee.
- en_route may be triggered manually or by technician workflow.
- in_progress records actual start time.
- completed requires required forms/checklists and required proof for the Industry Pack.
- skipped requires reason; photo/note may be required by configuration.
- missed is operationally distinct from skipped and should support rescheduling.
- needs_return creates or links a follow-up/reclean/return Job while retaining the original completion/issue history.
- Canceled jobs remain reportable and never disappear from route/job history.
- Reopening completed work should create a correction/reopen event rather than erase completion history.

## Appointment

States:

`tentative -> confirmed -> completed`

Alternatives:

`canceled`
`no_show`
`rescheduled`

Rules:

- A job may have multiple appointment history records.
- Reschedule creates a new scheduled occurrence/history record rather than overwriting audit history.
- Recurring route businesses may use service-day windows rather than exact times.

## Route Plan

States:

`draft -> optimized -> published -> in_progress -> completed`

Alternative:

`canceled`

Rules:

- Optimization may be run repeatedly before publication.
- Manual stop order changes after optimization are preserved.
- Publishing makes the route visible to assigned technicians.
- A published/in-progress route may be reoptimized when allowed; the prior order remains in history.
- Route completion derives from stop completion/terminal state, but an authorized user may manually close with explanation.

## Invoice

States:

`draft -> issued -> partially_paid -> paid`

Alternatives:

`void`
`overdue`
`written_off`

Rules:

- Issuing freezes an invoice version.
- Paid/partially-paid invoices are not silently edited; corrections use credits/adjustments or replacement invoice workflows.
- Due-state is computed from due date and remaining balance; overdue is a business state/flag.
- Void is allowed only when accounting rules permit and must retain audit history.
- An invoice may cover one or more jobs/service periods where tenant configuration allows.
- Recurring billing may create invoice drafts or immediately issue/charge according to policy.

## Payment

States:

`pending -> succeeded`

Alternatives:

`failed`
`canceled`
`partially_refunded`
`refunded`

Rules:

- Provider webhooks are authoritative for asynchronous processor outcomes.
- Payment creation is idempotent.
- Raw card/bank credentials are never stored.
- A payment may be allocated across one or more invoice balances when supported.
- Refunds create immutable refund records linked to the original payment.
- Check/cash/manual payments are explicitly labeled by source and recorder.

## Ticket

Default states:

`open -> in_progress -> waiting_on_customer -> resolved -> closed`

Alternative:

`canceled`

Rules:

- Status vocabulary is tenant-configurable, but a normalized internal category must exist for reporting/automation.
- Tickets may originate from customer portal, staff, technician, website, or automation.
- Resolved tickets may be reopened.
- Customer visibility is explicit per ticket/comment/form.

## Customer Change Request

States:

`submitted -> reviewing -> approved`

Alternatives:

`rejected`
`withdrawn`

Rules:

- Customer-entered changes do not directly mutate controlled operational records unless configured as safe self-service fields.
- Approval applies the change and records before/after values.
- Rejecting records optional reason visible to customer.

## Automation Rule

States:

`draft -> active -> paused`

Alternative:

`archived`

Rules:

- Activating validates trigger/action configuration.
- Editing an active rule creates a new configuration version.
- Historical runs point to the version that executed.
- Archived rules do not trigger but remain auditable.

## Automation Run

States:

`queued -> running -> succeeded`

Alternatives:

`retrying`
`failed`
`canceled`
`skipped`

Rules:

- Runs have an idempotency key derived from rule/version + triggering event.
- Retriable failures use bounded retry/backoff.
- Non-retriable failures surface actionable error details.
- Duplicate external/domain events must not create duplicate business actions.

## Connector Installation

States:

`not_connected -> authorizing -> connected`

Problem states:

`needs_attention`
`expired`
`disabled`
`error`

Rules:

- Connection status is based on actual credential/provider health, not just presence of stored configuration.
- OAuth refresh failures move to needs_attention/expired.
- Disconnect revokes/deletes credentials where possible without deleting synchronized business records.
- Sync failures should not mark the entire connector disconnected unless authentication/provider access is invalid.

## Outbound Message

States:

`queued -> sent -> delivered`

Alternatives:

`failed`
`suppressed`
`canceled`

Rules:

- Provider delivery receipts update final state when available.
- Suppression applies when preference, consent, invalid address/number, or policy blocks delivery.
- Automations should not repeatedly resend the same logical message unless intentionally configured.

## Inventory Stock Movement

Movement types:

`receive | transfer_out | transfer_in | consume | return | adjust_up | adjust_down | sell`

Rules:

- Inventory quantity is derived from immutable movements, with optional cached balances.
- Transfers create linked out/in movements.
- Job material usage creates consume movements.
- Adjustments require reason and actor.
- Negative stock behavior is tenant-configurable; default is warn and prevent for serialized/strict items, allow-with-warning for consumables when explicitly enabled.

## Payroll Period

States:

`open -> review -> approved -> exported`

Alternative:

`reopened`

Rules:

- Open periods accept time/mileage/commission/tip inputs.
- Review freezes automatic changes unless explicitly reopened.
- Approved calculations are versioned and auditable.
- Export marks handoff to payroll/accounting connector/file; it does not imply taxes or direct deposit were processed.
