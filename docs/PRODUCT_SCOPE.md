# Product Scope

## Goal

Create a simple, highly configurable operating platform for small service businesses that can be adapted quickly to many niche industries.

The system should let a business owner go from signup to a usable business stack with minimal assistance.

The product should be specified deeply enough before the first major Codex implementation task that Codex can build the initial backend and frontend end to end with minimal clarification or architectural rework.

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
- see the state of the business without technical setup

## Product model

The internal product is one shared platform.

The external experience is verticalized through Industry Packs.

A septic company should feel that the product was built for septic work. A chimney sweep, hood cleaner, appliance repair company, or small-engine shop should receive different language and workflow defaults while still using the same platform.

## Core business lifecycle

The default service-business lifecycle is:

`Lead → Customer → Estimate → Approval → Schedule → Job → Completion → Invoice → Payment → Recurring follow-up`

The platform must also support shortened paths where steps are unnecessary, such as direct booking without an estimate, recurring jobs that generate automatically, or payment collected at job completion.

## V1 account surfaces

### Owner / Admin

Full control of the tenant.

Primary capabilities:

- dashboard and reporting
- customer and lead management
- scheduling and dispatch
- estimates, invoices, payments, refunds
- service catalog and pricing
- recurring-service configuration
- staff invitations, roles, and permissions
- integrations and connector marketplace
- website setup and publishing
- automation settings
- business settings
- exports and audit/history views

### Office / Manager

Runs day-to-day operations without necessarily controlling ownership-level settings.

Primary capabilities:

- customers and leads
- estimates
- scheduling and dispatch
- jobs
- invoices and payment collection
- communications
- support/tickets
- reports appropriate to granted permissions
- technician assignment and operational changes

Sensitive business configuration, subscription ownership, destructive tenant actions, and security administration are owner-controlled by default.

### Field Technician

Mobile-first operational surface.

Primary capabilities:

- today's/assigned jobs
- route and navigation links
- customer/location access details needed for the job
- job instructions and safety notices
- start, pause, complete, skip, or flag a job
- notes, photos, forms, checklists, and signatures
- job-related customer communication
- payment collection when permission is granted
- time/mileage capture when enabled

The technician experience should hide unrelated office functionality by default.

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
