# V1 Build Readiness

Status: **Ready for initial end-to-end Codex implementation**

This document distinguishes implementation blockers from later launch/business decisions.

## Product definition

Ready:

- product thesis and V1 scope
- primary lifecycle
- staff/customer surfaces
- permissions
- onboarding
- screen/navigation map
- Pet Waste Removal reference vertical
- customer portal
- website system
- routing/dispatch
- communications
- automation
- payroll/time
- inventory/parts/procurement
- reporting
- multi-location/franchise
- import/export
- public API/webhooks
- customer documents

## Backend definition

Ready:

- implementation architecture
- domain model
- implementation-level relational schema target
- state machines
- business rules
- domain events
- service boundaries
- pricing engine
- automation model
- connector SDK
- connector catalog/maturity model
- audit/security baseline
- background-job strategy

## Frontend definition

Ready:

- business application navigation
- field-technician surface
- customer portal
- public website
- guided onboarding
- progressive module disclosure
- UX/design principles
- loading/empty/error expectations
- responsive/mobile expectations

## Local development definition

Ready:

- PostgreSQL-first portable stack
- web + worker layout
- local object storage
- local email capture
- deterministic mocks for external capabilities
- seed/playtest tenants and roles
- developer workflow
- automated test expectations
- V1 acceptance criteria

## Validation

Ready:

- realistic seed scenarios
- end-to-end acceptance criteria
- tenant-isolation tests
- role/permission tests
- recurring-generation tests
- routing/billing/automation/payroll/inventory scenarios
- public signup/portal scenarios
- connector/API/webhook scenarios

## Not blockers for initial local build

These should be decided/configured before production launch or commercialization, but Codex does not need them to build V1:

- final product/company brand name
- final SaaS subscription tiers/pricing
- production hosting vendor/account
- production domains
- production payment/accounting/messaging/routing app registrations
- live provider credentials
- final legal terms/privacy policy
- final retention schedule
- tax/legal review for operating jurisdictions
- production email/SMS sender verification
- production observability vendor
- final sales/marketing site copy

## Implementation authority

The initial implementation task is:

`.agents/tasks/INITIAL_END_TO_END_BUILD.md`

Codex should proceed from repository documentation without requesting confirmation for ordinary implementation details already resolved by these specifications.

If implementation discovers a genuine contradiction or hard technical constraint, resolve it toward:

1. accepted decisions
2. documented product behavior
3. simplest portable architecture

and update the repository documentation in the same change.

Only material scope conflicts or requirements that cannot be reconciled should require project-owner input.
