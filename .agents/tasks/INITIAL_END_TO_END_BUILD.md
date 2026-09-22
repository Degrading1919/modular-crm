# Initial End-to-End Codex Build

Assume responsibility for implementing Modular CRM from the repository source of truth.

Read `AGENTS.md` and `docs/INDEX.md`, then read the linked V1 specifications needed to understand the complete application.

## Goal

Build the entire initial locally runnable Modular CRM application end to end: backend, frontend, worker, database, connector framework, Pet Waste Removal reference Industry Pack, public website, business application, technician application, customer portal, seed data, and automated tests.

This is not a scaffolding task and not an architecture-writing task. The repository documentation already defines the product.

The completed result should be something the project owner can start locally, log into as each seeded role, operate like a real pet-waste-removal company, and use for hands-on product evaluation.

## Implementation approach

Use `docs/V1_IMPLEMENTATION_ARCHITECTURE.md` as the default technical direction.

Use the existing documentation as product requirements rather than repeatedly asking the owner to reconfirm decisions.

Where a small implementation detail is unspecified, choose the simplest solution consistent with the documented architecture and continue.

Do not stop after individual modules for approval. Work through the application end to end and test it.

## Reference implementations

Study the current reference projects in `docs/REFERENCE_IMPLEMENTATIONS.md` when their production patterns can reduce reinvention:

- Twenty CRM
- Cal.com
- Chatwoot
- Dub
- Webstudio

Use them as architectural references, not as permission to copy incompatible licensed code.

Verify provider-specific implementation behavior against current provider documentation.

## Required result

At completion:

- local infrastructure starts from documented commands
- schema/migrations are complete
- realistic seed data loads
- owner/admin application works
- office/manager workflows work
- technician/PWA workflow works
- customer portal works
- public pet-waste website/signup works
- recurring service/job generation works
- routing works with deterministic local mock
- billing/payments work with deterministic local mock
- email/SMS work in local/mock mode
- automation recipes and custom rule builder work
- payroll/time tracking works
- inventory/parts and purchasing basics work
- multi-location/franchise scope works
- advanced reports have real seeded output
- connector marketplace works
- critical connector packages are mock-complete and documented credentials-ready where specified
- import/export works
- public API/webhooks work
- audit/security/tenant boundaries are enforced
- automated tests cover critical scenarios
- `docs/V1_ACCEPTANCE_CRITERIA.md` is satisfied or any genuine blocker is explicitly documented

## Local usability

No production Stripe, Square, QuickBooks, Xero, Google, Microsoft, Twilio, routing, AI, or other external credential is required to run or evaluate the application.

External provider adapters must fail gracefully as "not configured" and the local mock implementations must allow the entire product to be exercised.

## Quality bar

Do not leave:

- fake buttons
- dead navigation
- unimplemented placeholder pages for required V1 features
- core flows that only exist as static UI
- unsafe cross-tenant shortcuts
- generated demo metrics disconnected from seeded records
- provider-specific logic scattered through core domain code

Use realistic seeded records and make the UI coherent enough for actual playtesting, not merely technical verification.

## Final handoff

Before considering the task complete:

1. run formatting/lint/type checks
2. run unit/integration tests
3. run end-to-end tests
4. exercise the seeded owner, technician, customer, and public-signup flows
5. update README/local setup
6. update documentation for any implementation decision that materially changed the documented design

Then leave the repository in a runnable state and provide a concise implementation/handoff summary.
