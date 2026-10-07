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

### Pilot security and observability

Security rate limits use opaque, hashed PostgreSQL fixed-window counters with atomic upsert, not per-process memory. Sign-in (both HTTP and V1) and password reset each have normalized-email-only budgets of 10 attempts/15 minutes alongside email/address budgets of 5/10 minutes. Successful sign-in resets that account's sign-in and current email/address counters, never the shared address budget or another account. Broad address budgets protect malformed authentication, signup, public forms, portal invitations/estimate links and developer API traffic. The worker deletes expired counters. Rejections return 429, Retry-After and plain business copy. One shared client-address helper selects the entry at forwarded-chain length minus TRUSTED_PROXY_HOPS (production default 1, local default 0). Without proxy trust, or for missing/invalid entries, use a fixed local key; never trust x-real-ip or arbitrary leftmost entries. Secure ingress to a fixed trusted proxy path; see DEPLOYMENT.md.

Web and worker logs are JSON with level, time, request ID, known tenant, route, status and duration. Only allowlisted operational metadata is logged; request/response bodies, exceptions, customer details, credentials and bearer URLs are excluded. Valid UUID request IDs are echoed or freshly generated, persisted on domain events and durable work, and propagated through recovered queues without overloading business correlation IDs.

ErrorReporter is provider-neutral. Console is the local default; an optional OTLP/HTTP JSON logs collector is configured with OTEL_EXPORTER_OTLP_LOGS_ENDPOINT. Report unexpected API 5xx and worker failures, never expected 4xx. Allowlisted structural diagnostics include the error class, bounded cause-chain SQLSTATE/driver code and up to five function@basename:line frames, never message text, full paths, SQL or values. API failures converted to responses retain their exception only in request-local memory for the outer reporter. Export failures are bounded, logged without collector credentials, and cannot alter business outcomes or retry contracts. Production validation warns, but does not fail, when no external reporter is configured.

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

## Configurable service details and privacy

Industry Pack field definitions are the shared runtime schema for public intake, typed CSV mapping, customer assets and service-location details. Ordinary custom fields remain generic JSON; private values use the existing encrypted service-access instructions, not new plaintext columns. Public submission and import receipts redact private field values before persistence. Portal projections include only pack-declared visible fields, and mutation schemas permit only separately declared editable fields while preserving internal stored values. Assigned-job reads retain tenant, customer and service-location restrictions before decrypting private instructions. Pack changes do not migrate or delete historical customer data.

Shared screens consume pack metadata and generic asset/location view models. The pet-specific compatibility vocabulary stays in its pack, while an industry-neutral source guard prevents new hard-coded niche assumptions in web and domain source. The additional house-cleaning seed uses disjoint identities and keeps existing fixtures intact.

## Capability and subscription boundary

Keep a canonical registry of stable functional capabilities and data-defined commercial modules. Module definitions carry display metadata, availability, dependencies, compatibility, and the functional capabilities they provide. Dependencies are evaluated centrally. Connector capabilities describe provider functions and remain a separate namespace from commercial product capabilities.

Tenant entitlement records are authoritative for the right to use a module. Tenant enablement/configuration and UI visibility or prominence are stored separately. Industry Pack recommendations and onboarding answers may propose a setup but cannot create an entitlement by themselves. Existing tenants and local demonstrations may receive explicit grants so previously working V1 flows remain available.

Authorized use requires both a tenant capability decision and the actor's role, customer, or location permissions. Apply the decision at server action boundaries used by APIs, background workers, automations, connectors, public sites, and the customer portal. Frontend navigation consumes the same effective state for presentation. Disabling or removing a module prevents future active work while retaining historical records and appropriate read/export access.

Keep commercial accounting provider neutral. Module grants, usage measurements, allowances, account credits, promotions, and administrative adjustments should remain distinct records so a future billing connector executes payments without defining the product model. Memberships and role permissions do not imply billable seats; commercial seat rules may distinguish administrators from field users or use business volume instead.

## Authorization model

Authorization should be tenant-aware and permission-based.

Role permission checks and commercial capability checks answer different questions and must both be enforced for an action that belongs to a subscribable capability.

Business workspace presentation uses `apps/web/lib/workspace-access.ts`: each surface pairs its required usable tenant feature with its existing API read permissions; hub alternatives pair each child feature with that child's permissions rather than combining unrelated any-of sets. Sidebar prominence is an additional presentation filter, not authority. Direct routes, workspace links, hub cards, and dashboard actions use the same decision; write buttons additionally require the relevant mutation permission. Permission-denied and capability-unavailable states remain distinct. Historical document/API reads retain their existing read/export contracts.

Authenticated staff can read effective capability feature state without `tenant.read`. Staff without `tenant.billing_manage` receive only feature state and an empty management-module list, not onboarding answers or management recommendations. Setup, recommendation, and enablement mutations still require `tenant.billing_manage`; customers cannot read the staff catalog. This read boundary grants no permissions. Seeded Office / Manager defaults derive from `permissionsForRole("office")`, including repair of older category-whitelist overrides when reseeded; deliberate technician fixture restrictions remain separate.

The existing Payments workspace reads `GET /api/v1/payments`. This collection requires staff access and `payments.read`, returns only the workspace view model, and scopes every query to the current tenant. Non-owner location scope is compatible with the invoice-list location model: every allocated invoice's business location must be in scope, or an unallocated payment must belong to an in-scope customer owning location. Staff receipt access uses those same allocated invoice locations, not the branches of their underlying service properties. Customer receipt access still checks every underlying job/service-plan property grant; partial allocation access never exposes a whole receipt. Owner all-location access is preserved. This endpoint adds no payment creation, collection, refund, connector, detail, or other mutation behavior.

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

## Durable job billing ownership

`job_invoice_links` owns the active once-per-job billing claim independently of editable invoice lines. Its tenant/customer composite foreign keys bind the job and invoice to the same customer; its tenant/job unique key prevents double billing. Invoice lines retain their job references for existing document/property authorization. Estimate conversion and manual/batch billing lock source estimates before jobs; completion and batch billing lock plans before claiming once-only charges. Explicit unpaid-invoice voiding follows estimate → sorted jobs → sorted plans → invoice locks and releases active links/claims atomically, preserving frozen historical lines. Batch replay receipts persist with domain events under tenant/user-scoped idempotency keys. Historical invoice links are backfilled without repricing records. Shared currency formatting derives decimal scale from the currency's standard minor-unit exponent. See [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md#automatic-billing-and-unpaid-invoice-reminders) for the user-facing contract.

## Technology direction

Current preferred direction:

- TypeScript
- React / Next.js
- PostgreSQL
- Docker-compatible local development
- environment-based configuration
- standard OAuth where supported

The production hosting provider should remain replaceable.

### Production startup and health contract

Web Node startup (Next.js instrumentation, before requests) and worker startup each validate `readServerConfig` once. Production refuses missing database configuration, missing/development/short authentication signing secrets, invalid 32-byte base64url encryption keys, mock connectors or mock DNS verification, missing/non-HTTPS application/auth/public URLs, and development Mailpit mail transport. One aggregate startup message names all invalid settings without printing values. Builds compile without requiring deployment-only settings; production runtime never inherits that exemption.

Production mail uses explicit `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` and optional paired `SMTP_USER`/`SMTP_PASSWORD`; port 465 may use `SMTP_SECURE=true`, otherwise STARTTLS is required. Development retains Mailpit defaults. `LOCAL_SMOKE_TEST=true` permits only loopback HTTP URLs for an explicitly local production smoke test, not missing URLs, mock behavior, Mailpit or unsafe secrets. Never use this exception in a deployed container.

Both processes expose unauthenticated `GET /api/health/live` (200, no database work) and `GET /api/health/ready` (200 or 503). Responses contain only a generic status and are not cached. Readiness uses a dedicated PostgreSQL connection with one-second connect and query/statement timeouts (allow a load-balancer timeout of at least three seconds) and verifies every migration shipped in the application against the Drizzle ledger. A missing ledger or any missing migration is unavailable; probes never migrate or alter data. The worker additionally inspects actual active pg-boss polling workers for every registered application queue; initial startup, removed/stopping workers and shutdown are not ready. Its HTTP listener uses `WORKER_HEALTH_PORT` (default 3001), bound on the container interface; web uses the normal app port. Use liveness for process restart and readiness for traffic/operational availability, not liveness to test database health. Keep these probes internal to container/load-balancer networking where possible.

Malformed PostgreSQL input casts (`22P02`, including nested Drizzle causes) are normalized centrally to a plain 400 validation response. Existing explicit UUID validation may return 404 instead. Authentication, capability, tenant/location checks and transaction atomicity remain in place; neither SQL details nor input values appear in the error response. Other database faults remain server errors, not fabricated not-found responses.

### Portable production images and release order

The root multi-stage `Dockerfile` builds `web`, `worker` and one-shot `migrate` targets from a digest-pinned Node 22 Debian slim base. Installs use the pinned pnpm workspace and frozen lockfile. Web runs the monorepo-aware Next standalone server with traced production dependencies, public files and static assets. Worker workspace TypeScript is compiled into ESM with esbuild; external libraries retain their production dependency closure via `pnpm deploy --prod`, with no `tsx` at runtime. All targets run as the non-root Node user. The allowlisted `.dockerignore` excludes environment files, credentials, local state, dependency directories and generated output.

Release order is **migrate successfully, then roll out web and worker** using the same revision. The one-shot target applies both the application Drizzle journal and pg-boss queue schema/registration; it requires explicit `DATABASE_URL`, exits non-zero on failure and is safe to run again when already applied. Production worker startup disables pg-boss schema creation/upgrades; neither service boots by running migrations. Development keeps existing queue initialization. Migration operators require schema privileges; runtime queue operations still require pg-boss's documented operational permissions. No seeds run during deployment.

Web and worker currently both enforce the shared production configuration: `DATABASE_URL`, `BETTER_AUTH_SECRET`, both 32-byte base64url encryption keys, HTTPS `BETTER_AUTH_URL` / `APP_BASE_URL` / `PUBLIC_BASE_URL`, and production `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` with optional paired SMTP credentials. Migrate requires only `DATABASE_URL`. Supply secrets at runtime, never as image build arguments/files. `LOCAL_SMOKE_TEST=true` is only for loopback HTTP production checks, never deployed environments. Worker uses port 3001 by default; web uses 3000. See [DEPLOYMENT.md](DEPLOYMENT.md) for process settings and host-specific notes.

Worker readiness additionally bounds actual pg-boss progress: every application consumer must have fetched within `WORKER_POLL_STALE_MS` (default 60000, allowing the installed pg-boss 30-second notification backstop), or an in-flight batch must be within `WORKER_JOB_MAX_MS` (default 300000) of its recorded start. Both are validated integer milliseconds in 1000–86400000. A healthy consumer cannot conceal a stuck peer. This observes availability only: it does not cancel/replay jobs, change idempotency or bypass queue error handling. Both image health checks use liveness, preventing database failover from becoming a container-restart loop. Worker readiness remains a separate operational/orchestration signal for stalled consumers and database availability. Load balancers use readiness to admit web traffic.

CI builds images locally with BuildKit cache and no registry push, then uses a fresh PostgreSQL container. The smoke gate proves migration isolation/replay, all four production probes, non-root execution, rendered login/static assets, absent runtime `tsx`/baked credentials, and fatal unsafe web configuration. Local Docker-daemon unavailability must be reported rather than counted as passing; hosted smoke evidence covers the exact PR head. No infrastructure is provisioned or deployed by this workflow.

## Local development

The application should boot locally without requiring real external accounts.

Integrations should support mocks, sandboxes, emulators, or test credentials where practical.

A future implementation task should provide a short local workflow such as:

`npm install`
`docker compose up` or equivalent local service startup
`npm run dev`

### Local database verification caveat

PR #4 verification on 2026-10-04 reproduced an existing PGlite TCP transport isolation defect on both the PR branch and base `main` revision `4a9ec4f1fa7e9c2e7cbd615bcc54adbc13542ad6`, using separately migrated and seeded in-memory databases. The technician browser workflow can fail after a successful clock-in because concurrent database clients share unnamed PostgreSQL statement/portal state in `pglite-socket` 0.2.11. Server logs capture session-lookup errors including `bind message supplies 1 parameters, but prepared statement "" requires 3` and `portal "" does not exist`; concurrent identity reads can return 401 and 200 with the same cookie.

A deterministic two-client protocol check reproduces the collision on both revisions without seed data or preceding browser tests: client A parses an unnamed statement, client B replaces it, and client A's bind fails with `08P01`. An independently executed query can likewise remove client A's unnamed portal (`34000`). No date-test clock or capability mutation is necessary. This is an emulator limitation, not evidence of a date-semantic or production authentication regression. Keep authentication and browser assertions intact; do not hide it with retries, sleeps, or reordered tests.

The local adapter now serializes backend ownership through an idle `ReadyForQuery`, covering the whole Parse/Bind/Execute/Sync cycle and retaining explicit transactions through commit/rollback. Disconnect cleanup waits for in-flight protocol work, clears error state and rolls back before releasing another client. The adapter remains pinned and guarded by deterministic TCP collision/transaction/disconnect coverage; it does not change production PostgreSQL pools or authentication. PGlite still has one backend session and is not a substitute for PostgreSQL CI or a general multi-session PostgreSQL server.

## Continuous integration boundary

Client data-loading effects depend on stable endpoints and the primitive identity, selected record, permission or explicit refresh version that actually changes the request. Equivalent permission arrays or render-created callbacks must not trigger new reads. Shared resource reload callbacks are stable; event subscriptions include complete dependencies without re-running field sync on each render. Keep `react-hooks/exhaustive-deps` as an error and fix dependencies rather than suppressing them or introducing self-triggering fetches.

Browser regression checks measure API GET counts during a deliberate three-second idle observation window. Main owner, field and portal screens fail if any `/api/v1` path repeats more than three times; automation history additionally permits no idle reads and verifies only its initial mount lifecycle and exactly one load per selected rule. The repository's `next dev` browser harness deliberately mounts effects twice under React Strict Mode; the test accounts for that exact development lifecycle, not extra idle requests. These observations detect request storms, not delays used to make failing actions pass. Preserve the existing one-worker, zero-retry runner and normal domain assertions.

GitHub pull requests (including stacked bases) and pushes to `main` run independent lint, typecheck, unit/integration, production-build and complete browser gates. The browser app/worker use fresh real PostgreSQL 17 and local Mailpit services; PGlite TCP is for local convenience only. Existing in-process unit fixtures remain isolated. CI uses pinned pnpm, Node 22, frozen installs and temporary generated secrets, never deployment credentials, and never merges or deploys. Preserve Playwright's one worker and zero retries; see `docs/V1_DEVELOPER_WORKFLOW.md` for the workflow and failure diagnostics.

Structured business export retains its read-only repeatable-read snapshot, tenant filters, bounded pages and sensitive-field exclusions. Primary-key catalog metadata is evaluated once per export, not repeatedly per discovered column; server-state verification of offline field work observes confirmed sync rather than the device's projected status.

## Provider boundaries

Business logic should depend on capabilities rather than providers.

For example, the CRM should ask a payments capability to create a payment request rather than contain Stripe-specific logic throughout the application.

Provider-specific logic belongs in connector packages/modules.

AWS deployment is isolated in the `infra/aws` workspace: network, stateful data and application stacks, validated operator-supplied staging/production configuration, pinned CDK v2 and resource-scoped AwsSolutions checks. Application packages never import infrastructure. The S3-compatible connector supports either static credentials (including MinIO) or the SDK's refreshing task-credential chain; tenant prefix checks are unchanged. Container entry points accept portable PostgreSQL secret parts and encode the connection URL at runtime, with verified TLS for RDS. Only migrate receives the administrator identity and provisions a separate constrained application/pg-boss runtime login; web/worker never receive administrator credentials. Production WAF retains common/rate rules with a body-size-label exception limited to authenticated import and field-photo POST paths, which retain application authorization and limits.

Initial ECS capacity is zero. An operator-only release builds immutable SHA images, requires successful application/queue migration, then rolls out web and worker and verifies that circuit-breaker rollback did not masquerade as success. No CI job provisions infrastructure or runs this script. Production uses private encrypted Multi-AZ RDS with 14-day backups, deletion/stack protection and final snapshots; object storage is private, encrypted and versioned. Snapshot restoration creates a parallel database while preserving the original and the snapshot choice in subsequent configuration. See DEPLOYMENT.md for first-release activation, secrets, DNS, recovery and operating-cost assumptions.


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

Field mutations use a serial, identity-scoped persisted queue. Transitions, notes and proof for the same job retain FIFO order; shift actions and mileage retain their own shared FIFO order because mileage requires an open shift. An unresolved operation holds later operations for that work item, not unrelated jobs or new ticket drafts. Sync, enqueue, retry and discard are serialized across the local page and, where Web Locks are available, across tabs. Retries preserve operation IDs, timestamps, payloads and expected prior states; offline projected statuses never bypass server validation or conflict detection.

Route publication validates all stops inside the dispatch transaction: tenant/organization/location, route date, current assignment and canonical job readiness must match before any stop is dispatched. Re-publication after optimization retains this route's already dispatched/active/finished stops, including canceled, missed and needs-return stops as inactive history; those stops still require matching scope, date and assignment and must never be reactivated or have their job progress reset. Dispatch records canonical job history and domain events atomically with publication.
