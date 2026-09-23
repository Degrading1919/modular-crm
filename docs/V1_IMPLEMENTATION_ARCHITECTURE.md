# V1 Implementation Architecture

This document is the default implementation direction for the first end-to-end Codex build. It favors fast local development, low operating cost, portability, and clear boundaries around replaceable providers.

## Repository layout

Use a pnpm workspace.

Suggested structure:

```
apps/
  web/                 Next.js application
  worker/              background-job worker
packages/
  db/                  PostgreSQL schema, migrations, repositories
  domain/              business services, state machines, events
  auth/                authentication/session integration
  connectors/          connector SDK, registry, provider packages, mocks
  industry-packs/      pack schema, loader, pet-waste pack
  automations/         trigger/condition/action engine
  pricing/             price-rule engine
  reporting/           report definitions/query helpers
  ui/                  shared UI components/design tokens
  config/              env/schema/shared configuration
  testkit/             fixtures, mocks, seeded actors/helpers
docs/
```

Do not split deployables further unless implementation pressure requires it.

## Web application

Use:

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- shadcn/ui or equivalent source-owned component primitives
- Zod for external/form/domain-boundary validation
- React Hook Form where complex client-side forms benefit from it
- TanStack Table for large operational tables
- MapLibre GL for vendor-neutral map rendering

Route groups should clearly separate:

- business/admin app
- technician app
- customer portal
- public tenant websites
- auth
- API/webhooks/integration callbacks

The same application may serve all surfaces while enforcing distinct authorization boundaries.

## Database

Use PostgreSQL as the authoritative transactional database.

Use Drizzle ORM + SQL migrations for the application schema.

Requirements:

- explicit foreign keys
- tenant_id on tenant-owned records
- composite indexes beginning with tenant_id for common tenant-scoped access
- database transactions around multi-entity business mutations
- JSONB only for genuinely configurable metadata/custom-field values, not as a substitute for relational modeling
- immutable/event-style tables where required by state history, audit, payments, stock movement, and automation execution

Avoid provider-specific database features that make ordinary PostgreSQL migration impractical.

## Authentication

Use Better Auth against PostgreSQL for the initial portable authentication layer.

Support:

- email/password
- email verification
- password reset
- staff sessions
- customer portal sessions
- future social/OAuth sign-in without redesign

Authorization remains Modular CRM domain logic. Authentication-library organization/role helpers must not replace the tenant/membership/permission model defined by this repository.

## Background jobs

Use pg-boss for PostgreSQL-backed background jobs so local development does not require Redis.

Use it for:

- recurring job generation
- route optimization calls
- outbound messages
- automation actions
- payment retries
- connector sync
- report refresh
- webhook follow-up processing
- media/site asynchronous work

The worker runs as a separate process from the web server but shares packages/domain and packages/db.

## File/object storage

Define an ObjectStorage capability.

Local development:

- MinIO or another S3-compatible local service
- A durable, tenant-separated filesystem adapter may be used when Docker is unavailable; it must keep the same `ObjectStorage` boundary and enforce signed, short-lived access to protected files.

Production-compatible targets:

- AWS S3
- Cloudflare R2
- other S3-compatible services

Store file metadata/authorization in PostgreSQL. Never depend on permanent public bucket URLs for protected customer/job files.

## Email and SMS

Local email:

- Mailpit for visual local capture
- in-memory/mock adapter for automated tests

SMS:

- deterministic mock adapter by default
- real providers installed as connectors

The domain communicates through MessagingCapability rather than directly importing a provider SDK.

## Payments

Provide a complete mock payment connector for local use.

Real payment providers use connector packages and token/reference storage only.

The core BillingService owns invoices, balances, payment allocation, refunds-as-business-records, and state transitions. Payment connectors own processor interactions.

## Maps, geocoding, and routing

Use MapLibre for visualization.

Define RoutingCapability for:

- geocode
- travel matrix
- route optimization
- route geometry/summary

Local development includes a deterministic mock routing provider with plausible travel times/distances.

Real routing/geocoding providers remain replaceable connectors.

## Realtime behavior

Do not make a proprietary realtime service mandatory.

V1 may use:

- server-rendered fresh queries
- targeted client polling for route/dispatch/payment/automation state
- optional Server-Sent Events where straightforward

Design an internal event/notification boundary so a hosted realtime provider can be added later without changing domain logic.

Correctness must never depend on realtime delivery.

## Automation engine

Rules use a declarative JSON-compatible schema:

- trigger
- conditions
- actions
- configuration version

No arbitrary tenant-supplied JavaScript/eval.

Automation actions call the same authorized domain services/capabilities as manual application actions.

## Pricing engine

Pricing rules are declarative and deterministic.

Support composable conditions such as:

- service
- customer type
- frequency
- quantity
- service/pricing zone
- custom-field/Industry Pack values
- date/effective period
- add-on selection

Support effects such as:

- fixed base price
- fixed add
- percentage add/discount
- quantity tier
- per-unit amount
- minimum/maximum where explicitly configured

Every estimate/job/invoice snapshot records the resolved monetary values so later price-rule changes do not alter history.

## Industry Pack runtime

Industry Packs are versioned data/configuration packages, not executable arbitrary tenant code.

A pack includes schemas/config for:

- terminology
- custom fields
- assets
- services
- recurrence presets
- forms
- workflows
- default automations
- report definitions
- website defaults
- recommended connector capabilities
- pricing-rule templates

The Pet Waste Removal pack ships in-repository as the reference implementation.

## Connector SDK

A connector package exports:

- manifest
- capability implementations
- auth/setup handlers
- webhook handlers where applicable
- connection-health check
- resource discovery/mapping
- optional sync operations
- mock/test fixtures

Core packages may depend on connector interfaces but not specific provider packages.

## Website system

Do not build a general visual page builder in V1.

Use:

- structured tenant/site content
- Industry Pack website defaults
- a small library of responsive templates
- sections enabled/disabled/reordered through structured configuration
- preview/publish state
- platform subdomain/custom-domain routing
- forms connected directly to application services

AI-assisted onboarding may populate structured content, but generated output must validate against the same site-content schema.

## Search

Start with PostgreSQL search:

- indexed normalized fields
- trigram/full-text indexes where appropriate
- tenant-scoped customer/job/lead search

Do not add Elasticsearch/OpenSearch in V1.

## Reporting

Use PostgreSQL queries/views/materialized aggregates as needed.

- lightweight reports query transactional tables directly
- expensive rollups may use refreshable metric/materialized tables
- all report definitions are tenant/location permission aware
- exports are background jobs for large datasets

Do not introduce a separate analytics warehouse in V1.

## Observability

Implement:

- structured JSON server/worker logs
- correlation IDs
- domain event IDs
- background-job attempt/error logs
- audit events
- connector sync/error logs

OpenTelemetry-compatible boundaries are preferred, but a hosted observability vendor is not required locally.

## Testing

Use:

- Vitest for unit/service tests
- PostgreSQL-backed integration tests
- Playwright for browser end-to-end tests
- connector contract tests
- deterministic clock/ID/test helpers where useful

Critical permissions, tenant isolation, pricing, financial state, recurring generation, and webhook idempotency require automated regression tests.

## Local development stack

Docker Compose should provide only infrastructure that improves parity:

- PostgreSQL
- MinIO
- Mailpit

Application processes:

- `pnpm dev:web`
- `pnpm dev:worker`

Provide a convenience `pnpm dev` that starts both when practical.

All other external services default to mocks.

## Environment configuration

Provide:

- `.env.example`
- startup validation of required variables
- safe defaults for local mocks
- separate public vs server-only variables
- no secrets committed to Git

The local application must boot after documented setup without Stripe, Twilio, Google, QuickBooks, OpenAI, or other production credentials.

## Deployment portability

The web and worker applications must each be containerizable.

The architecture should run on common Docker-capable PaaS/cloud targets without code forks.

A production deployment may later mix specialized managed services, but the codebase must not require Vercel, Supabase, Railway, Render, AWS, or another single vendor to function.

## Implementation rule

Prefer the smallest dependency that supports the documented behavior. Do not add microservices, Redis, Kafka, Elasticsearch, Kubernetes, or a separate analytics store unless an observed scale/reliability requirement justifies them.
