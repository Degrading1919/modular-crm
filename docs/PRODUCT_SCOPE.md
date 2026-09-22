# Product Scope

## Goal

Create a simple, highly configurable operating platform for small service businesses that can be adapted quickly to many niche industries.

The system should let a business owner go from signup to a usable business stack with minimal assistance.

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
- manage basic staff access and roles
- see the state of the business without technical setup

## Product model

The internal product is one shared platform.

The external experience is verticalized through Industry Packs.

A septic company should feel that the product was built for septic work. A chimney sweep, hood cleaner, appliance repair company, or small-engine shop should receive different language and workflow defaults while still using the same platform.

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
