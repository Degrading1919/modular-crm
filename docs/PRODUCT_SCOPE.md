# Product Scope

## Goal

Create a simple, highly configurable operating platform for small service businesses that can be adapted quickly to many niche industries.

The system should let a business owner go from signup to a usable business stack with minimal assistance.

The product should be specified deeply enough before the first major Codex implementation task that Codex can build the initial backend and frontend end to end with minimal clarification or architectural rework.

## Truthful operational presentation

Upcoming work and **Next service** must come from actual eligible scheduled jobs (scheduled, dispatched, en route, in progress, or paused), using each job's business-location calendar date and the viewer's authorized scope. Customer summaries include one-time jobs as well as recurring-plan jobs. Recurrence is not proof of a booked visit; absent jobs remain explicitly not scheduled. A missing service time must not be replaced with “Today.”

Balances due mean current unpaid issued invoices, excluding drafts, voids, and written-off invoices. Historical invoice totals and actual amounts paid remain distinct from balances due. Financial summaries separate currencies, format minor units consistently, and identify their business-location scope; live balances are not represented as historical period snapshots. Receipts and refunds require every allocated invoice to be in scope and are attributed only when a single business location is known (or, for unallocated receipts, the customer's owning location). Cross-location receipts/refunds remain unassigned, never proportionally guessed, and are included only when every allocation is authorized by the report scope, never in a single-location report.

Missing pricing inputs stay unknown, not zero. Pricing inputs are not invoice revenue, and a summary that cannot represent multiple currencies reliably must show an unknown value rather than add incompatible amounts.

Invoice rows identify their actual business and location, including broader owner-visible businesses that are outside the dashboard's named scope. Report screens and CSV downloads use the same money formatting and plain column names, not internal IDs or minor-unit labels; API numeric fields retain their existing minor-unit contract.

User-facing failures must explain the problem and a useful recovery step in plain language, including authentication, connection, and validation failures. Preserve machine-readable status, codes, conflict details, and offline retry behavior; do not expose internal transitions, provider errors, or HTTP status numbers as user instructions. Preserve useful plain-language recovery copy. Failed reads must not masquerade as zero balances or empty successful summaries.

## Staff record selection and payment recording

Customers, jobs, invoices and leads open in a shared full-page record layout: named facts and status, authorized actions, scoped related records, a plain-language event history, and validated editing. Never render a raw database-field dump or internal money labels. Related lists describe their recent-record limit and authorized business-location scope; absence of related permission omits that section, not an invented empty result. Issued financial records remain immutable; draft invoices use the shared itemized document editor with optimistic locking.

## Itemized estimates and invoices

Estimates and draft invoices share ordered description, quantity, unit-price and optional line-discount editing, with catalog prefill or free entry. Catalog identity is checked within the tenant and document business. Businesses may set a default tax rate; each line explicitly selects Taxable. Document discounts accept an amount or percent. Always show subtotal, discount, tax and total, calculated by the shared domain calculator, not independently inferred by each screen.

Customers explicitly choose optional estimate add-ons before approval. Keep the sent revision immutable and save accepted lines and amounts in the approval snapshot; the approved total excludes declined lines. Estimate-to-invoice conversion copies that snapshot once under a record lock. Completion billing copies an itemized accepted job/plan snapshot when its existing completion policy applies. Catalog or tax-default changes cannot reprice approval or issuance history. Payments, reports, refunds and HTML/PDF documents use stored totals and the existing money ledger, not a fresh tax calculation. Existing untaxed single-total records remain one untaxed line with unchanged totals; any historical recorded tax is preserved, never erased.

The integer and tax allocation contract is specified in [V1_PRICING_ENGINE.md](V1_PRICING_ENGINE.md#itemized-document-calculation).

## Automatic billing and unpaid-invoice reminders

Business-level **Payment due** defaults to **On receipt** (zero days), with 7, 15 or 30 days after issue as alternatives. At manual, job/batch or completion issuance, preserve an explicitly entered due date; otherwise use agreed completion-plan terms where that policy applies, then the customer's terms, then the issuing business's default, adding that many 24-hour days to the actual issue timestamp. Zero-day agreed terms are valid. A draft without an explicit due date gets its deadline at issuance, not at draft creation. Changing this setting never backfills or changes historical issued invoices, including those with no due date.

Estimate lines explicitly say **Once** or **Every visit**, defaulting to Every visit for a recurring primary service and Once otherwise. A recurring approval stores only every-visit lines in the plan price and a separate frozen setup-charge snapshot. Under a plan lock, the first completed visit claims those setup charges and records its invoice; later visits cannot charge them again. Partition the accepted line discounts and tax without repricing or duplicating them. Existing plans retain their monetary totals and historical recurring lines mean Every visit. An amount discount on an estimate must fit the required lines alone, so declining optional work cannot make approval impossible.

A completed billable one-time job can create one draft invoice from its recorded price. Persist billing ownership independently of editable invoice lines and retain job references on the lines for document/portal access. Manual creation, estimate conversion and batch billing share source-estimate → job lock ordering and return the existing invoice rather than charging a job twice. Refuse conversion of estimates that created an automatically billed per-visit plan: “Visits on this plan are billed automatically.” This guard does not erase already issued historical invoices. A legacy total-only update cannot replace a multi-line draft; multi-visit invoices retain their visit lines rather than silently discarding their scope.

**Bill finished work** previews uninvoiced completed work in a chosen branch-calendar completion range, initially last month, within the viewer's accessible branches. Use the completed visit's branch timezone, then its business timezone, then the tenant default; never its original appointment date or the server clock. Show one row per customer, visit count and separate currency totals. Create drafts or explicitly issue them, serially per customer with durable replay receipts, progress and recoverable per-customer errors. Keep separate invoices per business branch and currency; do not mix scopes or money. Already invoiced visits never reappear, including after invoice editing or voiding. Replays check the existing invoice's branch independently of the job's current branch. Unknown recorded prices require review, not a guessed amount.

Business-level **Remind customers about unpaid invoices** is off by default. When enabled, default to a first service-category email three days after due, then seven days after the previous actual send, at most three reminders per invoice (configurable within bounded limits). Use the existing connector/platform email path, preferences, caps and service priority. Recheck current balance, status, due date, dispute marker and settings before sending; paid, voided, written-off or disputed invoices receive none. Include a login-protected Pay now link only when online payment collection is available, otherwise View your invoice. Each accepted send records the rendered message and an invoice timeline fact. Durable message keys and atomic claims prevent ordinary sweep/delivery replay duplication; provider acceptance followed by a process crash retains the existing external-delivery uncertainty, not an exactly-once SMTP guarantee. This slice does not introduce a dispute-management feature.

Reschedule and reassign are explicit audited, idempotent planning actions for work that has not started. They withdraw old route stops as retained removed history, clear the active route, and return dispatched/missed work to Scheduled through the canonical state machine. Started or terminal work must not be silently reset. Removed stops are history-only: exclude them from technician route selection, optimization inputs and sequence writes, and publication without relaxing validation of remaining stops. Reassigning to the current primary technician is rejected without withdrawing the visit. Cancellation records a required reason and emits one customer-bound cancellation event for configured notification rules. Conflict detection protects stale edits; replaying an action cannot duplicate assignment, history or notifications.

Staff create forms select named customers, services, open invoices, and saved service addresses rather than asking for internal IDs. Customer searches match name, phone, email, and address on the server within the existing tenant/location authorization; picking a customer offers only their accessible active service addresses. A single available address is selected automatically, while multiple addresses require an explicit choice. Jobs and service plans persist that choice; no eligible saved address requires recovery rather than a guessed address. Their operational branch uses the selected address's branch when assigned, otherwise the customer's owning branch, then the current workspace branch. Validate access to that resolved branch without changing the saved address or relaxing address access.

Recording money already received is distinct from charging a customer. Staff must choose Cash, Check, Card (taken outside the app), or Other and may enter a reference such as a check number. Persist payment method separately from source/connector provenance and show it in payment history and receipts. Keep invoice allocation, permission/capability checks, balance validation, and idempotent retries; a changed method/reference is a different request. Historical unspecified payments remain honestly “Method not recorded,” not guessed as cash or card; new unspecified requests are rejected. Explicit test payments require a connected mock payment service; staff recording never defaults to a test charge. The Payments collection remains a scoped read model; its recording form invokes the existing invoice-payment workflow, not a new generic payment mutation.

## Core customer outcomes

A business owner should be able to:

- create or import customers
- track customer status and history
- manage locations, assets, jobs, appointments, and recurring services
- create estimates and invoices
- accept payments
- send reminders and messages
- connect accounting, calendar, email, storage, payments, and other tools
- publish a simple professional website
- capture website leads directly into the CRM
- manage staff access and roles
- give customers a self-service portal
- plan routes and dispatch field work
- track time, payroll inputs, inventory/parts, and advanced reporting
- operate multiple locations or franchise units
- see the state of the business without technical setup

## Product model

The internal product is one shared platform.

The external experience is verticalized through Industry Packs.

Every tenant receives a small platform foundation. Operational capabilities can be grouped into independently subscribable modules within that same application. The commercial groupings, prices, allowances, and seat rules remain configurable product decisions; the illustrative V1 feature areas below are not fixed subscription packages.

An Industry Pack configures niche behavior and recommends an appropriate capability stack using the business's onboarding answers. Recommendations do not grant access. A tenant's commercial entitlement, its enabled/configured state, and the prominence of a capability in the user experience are separate choices. Server behavior must enforce access as well as the UI reflecting it.

Staff workspace navigation, direct routes, dashboard actions, and hub links must agree: show a tool only when its tenant capability is usable and the signed-in staff member has the appropriate existing permissions. Capability discovery is readable by staff without granting setup or subscription authority. A missing staff permission and an unavailable tenant capability are different access states; staff who cannot manage capabilities should be directed to ask an owner, not offered “Review my capabilities.” Office / Manager should reach permitted operational tools without being promoted to Owner, and read-only administrative access must not expose unauthorized write actions.

Office / Manager's default Locations access is read-only; organization updates and location administration remain Owner / Admin defaults, with explicit granular grants available to custom roles. Payments is a read-only collection without a generic payment-detail route: settled receipt-capable states link to the existing customer-ready receipt document, and other states render non-linked rows in both table and responsive-card layouts. Receipt documents retain their independent authorization checks.

Owners should be able to start with a focused setup and add or remove capabilities later without moving their data or changing applications. Removing a capability stops new operational use according to its policy while preserving historical operational and financial records. The customer promise is: **Software built around your business. Start with exactly what you need and add capabilities as you grow.**

A septic company should feel that the product was built for septic work. A chimney sweep, hood cleaner, appliance repair company, or small-engine shop should receive different language and workflow defaults while still using the same platform.

## Core business lifecycle

The default service-business lifecycle is:

`Lead → Customer → Estimate → Approval → Schedule → Job → Completion → Invoice → Payment → Recurring follow-up`

The platform must also support shortened paths where steps are unnecessary, such as direct booking without an estimate, recurring jobs that generate automatically, or payment collected at job completion.

## V1 operational depth

V1 is intended to be a complete operating product rather than a narrow CRM proof of concept.

It includes:

- route optimization
- interactive maps
- drive-time planning
- dispatch and technician assignment
- outbound email notifications
- outbound SMS notifications
- predefined automation recipes
- user-configurable automation rules
- payroll/time tracking
- inventory and parts tracking
- advanced reporting
- multi-location operation
- franchise operation
- customer portal
- connector marketplace
- template-driven public websites

A unified inbound customer conversation inbox is not required for V1. Customer communication in V1 may rely on outbound email/SMS plus portal requests, forms, and support/ticket interactions.

## Calendar-date semantics

Business calendar dates (for example, a service day or route date stored as `YYYY-MM-DD`) are dates, not UTC instants. They must retain their named calendar day across office, schedule, route, field, portal, and reporting surfaces. Timestamps remain instants rendered in the relevant tenant or location timezone; scheduling and other business “today” behavior derives its date from that configured timezone rather than a browser or UTC default.

## V1 account surfaces

### Owner / Admin

Full control of the tenant.

Primary capabilities:

- dashboard and reporting
- customer and lead management
- scheduling, routing, and dispatch
- estimates, invoices, payments, refunds
- service catalog and pricing
- recurring-service configuration
- staff invitations, roles, permissions, time, and payroll inputs
- inventory and parts
- integrations and connector marketplace
- website setup and publishing
- automation recipes and rule builder
- location/franchise administration
- business settings
- exports and audit/history views

### Office / Manager

Runs day-to-day operations without necessarily controlling ownership-level settings.

Primary capabilities:

- customers and leads
- estimates
- scheduling, routing, and dispatch
- jobs
- invoices and payment collection
- outbound communications
- support/tickets
- inventory/parts where permitted
- reports appropriate to granted permissions
- technician assignment and operational changes

Sensitive business configuration, subscription ownership, destructive tenant actions, and security administration are owner-controlled by default.

Commercial staff or field-user charges are distinct from authentication, memberships, and role permissions. The product must allow inexpensive or unlimited field users as well as other future pricing models without changing the identity model.

### Field Technician

Mobile-first operational surface.

Primary capabilities:

- today's/assigned jobs
- optimized route and drive-time plan
- navigation links
- customer/location access details needed for the job
- job instructions and safety notices
- start, pause, complete, skip, or flag a job
- notes, photos, forms, checklists, and signatures
- job-related outbound customer communication
- payment collection when permission is granted
- time/mileage capture
- inventory/part usage when relevant

The technician experience should hide unrelated office functionality by default.

Field job actions must intersect canonical legal transitions with the technician's granted permissions, including an explicit resume action for paused jobs. Device-saved progress must be distinguished from office-synced progress. Failed/conflicted updates retain evidence for review, current-job inspection and deliberate retry; technicians can download saved details before confirming discard of an update and its later dependent updates. Discard must leave unrelated work intact and must explain that it does not undo anything already received by the office.

A stop canceled before the route's first publication is retained as skipped route history, never dispatched or reactivated; valid remaining work can publish. Cancellation does not exempt a stop from tenant, business, branch, assignment, date or other-route ownership checks. A lapsed sign-in stops offline sending without losing evidence. Once the same user and tenant are confirmed signed in again, authentication-failed updates become eligible automatically with unchanged operation IDs and causal ordering; genuine conflicts and permission failures still require review.

### Customer

Persistent self-service portal plus secure action links.

Primary capabilities:

- profile and contact information
- service addresses/locations
- industry-specific asset/profile information exposed by the Industry Pack
- upcoming and historical services
- service status and completion proof
- estimates and approvals
- invoices, balances, payments, and saved payment methods where supported
- recurring-service details
- notification preferences
- service/change requests
- pause/cancel requests subject to business rules
- support/ticket interactions
- documents, photos, and forms intentionally shared with the customer

Secure links may still be used for low-friction actions such as estimate approval, invoice payment, form completion, or first-time account activation.

## Access-control model

V1 should ship with simple role templates rather than forcing businesses to design permissions from scratch.

Default templates:

- Owner / Admin
- Office / Manager
- Field Technician

These templates are backed by granular permissions so later versions can add custom roles, accountants, crew leaders, dispatchers, franchise users, or other combinations without rewriting authorization.

Customer access is a separate portal surface tied to the customer's relationship with a tenant.

## Non-goals for the initial product

- enterprise ERP complexity
- deep custom infrastructure per customer
- requiring users to configure APIs or webhooks manually
- building a completely separate codebase for every industry
- competing feature-for-feature with ServiceTitan on day one
- building a general-purpose website editor comparable to Webflow
- building a full omnichannel customer-service inbox in V1

## Website capability

The platform should provide a template-driven public website system.

The owner provides structured business information such as:

- business name
- phone/email
- service area
- services
- rates or pricing guidance
- hours
- description
- logo
- photos
- booking preferences

The platform uses that data to populate industry-aware templates.

A conversational assistant may collect the same structured information, but the website remains template-driven and deterministic.

Website forms, bookings, payments, and chat should feed directly into the CRM.

## Development philosophy

After the scope for a major product slice is defined, build it end to end, run it locally, use it as a real customer would, and iterate from observed friction.
