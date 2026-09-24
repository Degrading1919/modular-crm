# Architecture

## Architectural direction

Modular CRM should be:

- multi-tenant
- configuration-driven
- connector-extensible
- locally runnable
- portable across hosting providers
- usable with or without optional third-party integrations

## Shared core

The shared application should own common concepts such as:

- tenants/businesses
- users
- role templates and granular permissions
- tenant memberships
- customer portal identities
- customers
- locations
- configurable assets
- leads
- jobs
- appointments
- recurring services
- estimates
- invoices
- payments
- files/photos
- notes
- service catalog
- communication history
- automations
- integrations
- public website content

This common data model supports every capability without separate tenant deployments or Industry Pack forks. The exact required platform foundation and commercial module boundaries are configurable rather than embedded in database table names.

## Capability and subscription boundary

Keep a canonical registry of stable functional capabilities and data-defined commercial modules. Module definitions carry display metadata, availability, dependencies, compatibility, and the functional capabilities they provide. Dependencies are evaluated centrally. Connector capabilities describe provider functions and remain a separate namespace from commercial product capabilities.

Tenant entitlement records are authoritative for the right to use a module. Tenant enablement/configuration and UI visibility or prominence are stored separately. Industry Pack recommendations and onboarding answers may propose a setup but cannot create an entitlement by themselves. Existing tenants and local demonstrations may receive explicit grants so previously working V1 flows remain available.

Authorized use requires both a tenant capability decision and the actor's role, customer, or location permissions. Apply the decision at server action boundaries used by APIs, background workers, automations, connectors, public sites, and the customer portal. Frontend navigation consumes the same effective state for presentation. Disabling or removing a module prevents future active work while retaining historical records and appropriate read/export access.

Keep commercial accounting provider neutral. Module grants, usage measurements, allowances, account credits, promotions, and administrative adjustments should remain distinct records so a future billing connector executes payments without defining the product model. Memberships and role permissions do not imply billable seats; commercial seat rules may distinguish administrators from field users or use business volume instead.

## Authorization model

Authorization should be tenant-aware and permission-based.

Role permission checks and commercial capability checks answer different questions and must both be enforced for an action that belongs to a subscribable capability.

Internal users belong to one or more tenants through memberships. A membership receives a role template, and the role template resolves to granular permissions.

Initial role templates:

- Owner / Admin
- Office / Manager
- Field Technician

Do not encode authorization only as hard-coded role-name checks. Server-side actions and data access should evaluate capabilities/permissions so future custom roles do not require architectural changes.

Customer identities are distinct from internal tenant memberships. A customer may have portal access to one or more customer records/locations while remaining unable to access internal CRM data.

## Tenant isolation

All tenant-owned records must be scoped to a tenant.

Isolation should be enforced at the data-access layer. UI filtering alone is not sufficient.

Customer portal access must additionally enforce the relationship between the authenticated customer identity and the customer/location records explicitly available to that identity.

## Technology direction

Current preferred direction:

- TypeScript
- React / Next.js
- PostgreSQL
- Docker-compatible local development
- environment-based configuration
- standard OAuth where supported

The production hosting provider should remain replaceable.

## Local development

The application should boot locally without requiring real external accounts.

Integrations should support mocks, sandboxes, emulators, or test credentials where practical.

A future implementation task should provide a short local workflow such as:

`npm install`
`docker compose up` or equivalent local service startup
`npm run dev`

## Provider boundaries

Business logic should depend on capabilities rather than providers.

For example, the CRM should ask a payments capability to create a payment request rather than contain Stripe-specific logic throughout the application.

Provider-specific logic belongs in connector packages/modules.


## Organizational hierarchy

V1 must support multi-location and franchise operation without creating separate codebases.

The data model should distinguish:

- platform account / tenant
- business organization
- optional franchise or parent organization
- operating locations/branches
- staff memberships scoped to the organization and, where needed, selected locations
- customers and jobs associated with the appropriate operating location

Permissions and reporting should support both local-location views and rolled-up parent/franchise views.

## Automation architecture

V1 supports both predefined recipes and user-configurable rules.

The automation engine should model:

- trigger
- optional conditions
- one or more actions
- enabled/disabled state
- execution history
- retry/error state

Industry Packs may install default recipes without preventing owners from creating their own rules.

## Routing and field operations

Routing is a first-class V1 capability rather than a later add-on.

The shared core should support route stops, technician assignment, stop ordering, geocoded locations, estimated drive time, service duration, route optimization requests, and persisted route plans. Mapping/routing providers should remain behind connector/provider boundaries.
