# Decision Log

Compact history of accepted and superseded Modular CRM decisions.

Newest entries go first.

## 2026-09-24 — Industry Packs use a canonical evidence-backed research profile

- **Status:** Accepted
- **Area:** Industry Packs
- **Decision:** Prospective Industry Packs are researched through the canonical `docs/research/INDUSTRY_RESEARCH_PROFILE_TEMPLATE.md` contract, with completed profiles stored under `docs/research/industry-packs/<industry-key>.md`. Research preserves evidence, uncertainty, workflow realities, packaging signals, and candidate core-platform gaps before findings are translated into runtime pack configuration.
- **Rationale:** A shared profile lets multiple research agents work in parallel without inventing incompatible schemas and keeps source evidence separate from the compact runtime Industry Pack.
- **Authoritative doc:** `docs/INDUSTRY_PACKS.md`

## 2026-09-24 — Successful payments can send a receipt

- **Status:** Accepted
- **Area:** Industry Packs
- **Decision:** The pet-waste Industry Pack includes a `payment.succeeded` receipt email recipe addressed to the customer carried by the event, installed as a draft until the business enables it. Pause-review tickets filter customer change requests to `type=pause`.
- **Rationale:** Businesses need a demonstrable receipt workflow without unexpectedly changing existing customers' messaging behavior.
- **Authoritative doc:** `docs/INDUSTRY_PACKS.md`

## 2026-09-24 — Production requires a private auth signing key

- **Status:** Accepted
- **Area:** Architecture
- **Decision:** Local development may use the example auth signing secret, while production builds and runtime require a unique secret of at least 32 characters.
- **Rationale:** A public repository value cannot protect production sessions or signed links.
- **Authoritative doc:** `README.md`

## 2026-09-24 — Location events carry resource organization context

- **Status:** Accepted
- **Area:** Architecture
- **Decision:** A location-scoped domain event identifies the location's organization, while actor fields identify the initiating person. Business mutations, their domain events, and audit records commit together.
- **Rationale:** Parent staff may act within an authorized child franchise location; using the parent's organization as the event's resource scope violates tenant-safe constraints and prevents valid work.
- **Authoritative doc:** `docs/V1_DATABASE_SCHEMA.md`

## 2026-09-24 — Machine API scopes describe implemented operations

- **Status:** Accepted
- **Area:** Implementation
- **Decision:** V1 API credentials offer write scopes only for customer and lead operations that the machine API implements. Other business resources remain read-only until their write endpoints and contracts are implemented.
- **Rationale:** A granted scope must correspond to a usable operation rather than promising a route that always returns not found.
- **Authoritative doc:** `docs/V1_PUBLIC_API.md`

## 2026-09-24 — Background messages honor tenant installations and consent

- **Status:** Accepted
- **Area:** Connectors
- **Decision:** The worker selects a tenant's persisted messaging installation at send time, preferring live service over test delivery and never silently falling back to a mock when a configured service is unavailable. Implicit mock delivery requires the explicit local `MOCK_CONNECTORS=true` setting. Transactional consent and notification preferences are stored in the same form the worker enforces.
- **Rationale:** Owners must be able to trust both delivery mode and their customers' contact choices.
- **Authoritative doc:** `docs/CONNECTOR_SYSTEM.md`

## 2026-09-24 — Industry automation recipes follow recipient-bearing events

- **Status:** Accepted
- **Area:** Industry Packs
- **Decision:** Default Industry Pack automations filter customer signups and manual-review requests separately, and customer reminders use per-job dispatch events with a customer identity. Pack setup provides any ticket definitions needed by enabled recipes.
- **Rationale:** A route-wide event has no single recipient, and a manual-review lead cannot receive a customer confirmation.
- **Authoritative doc:** `docs/INDUSTRY_PACKS.md`

## 2026-09-24 — Effective-dated service-plan changes preserve generated work

- **Status:** Accepted
- **Area:** Product
- **Decision:** Service-plan frequency and price changes take effect prospectively and retain dated versions so newly generated jobs use the frequency and price effective on the service date. Keep previously generated future jobs and their snapshots by default; allow an explicit `cancel_unstarted` choice to cancel only generated draft, unscheduled, and scheduled jobs from the cutover date, preserving dispatched/started jobs and all prior job and invoice snapshots.
- **Rationale:** A future price or schedule update must apply consistently to newly generated work while preserving customer commitments and an auditable operational/financial history.
- **Authoritative doc:** `docs/V1_BUSINESS_RULES.md`

## 2026-09-24 — Infrastructure connectors use platform-owned configuration

- **Status:** Accepted
- **Area:** Connectors
- **Decision:** Infrastructure connectors such as S3-compatible object storage may be marked platform-managed, read server-owned deployment configuration, and activate tenant-isolated runtime scopes without exposing connection fields in the tenant marketplace. Local filesystem storage remains the development fallback when S3 configuration is absent.
- **Rationale:** File storage is deployment infrastructure for most small businesses; owners should use protected files without selecting or managing bucket credentials.
- **Authoritative doc:** `docs/CONNECTOR_SYSTEM.md`

## 2026-09-24 — Messaging history distinguishes provider acceptance from delivery

- **Status:** Accepted
- **Area:** Connectors
- **Decision:** A connector send result records provider acceptance. Provider message identifiers are optional when an API does not return one, and the CRM must not invent an external ID or report recipient delivery unless the provider supplies delivery confirmation.
- **Rationale:** Email APIs have different response contracts; for example, Microsoft Graph returns an accepted response without a message resource. A common adapter must preserve that fact instead of overstating the provider result.
- **Authoritative doc:** `docs/CONNECTOR_SYSTEM.md`

## 2026-09-24 — Tenant connector credential and OAuth transaction boundary

- **Status:** Accepted
- **Area:** Connectors
- **Decision:** Store tenant API-key/service-account credentials only for explicitly opted-in `credentials_ready` connectors with manifest-declared fields, using the dedicated `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` and a context-bound authenticated payload. Real adapters receive validated credentials through a configured-scope factory; generic mock authorization cannot connect credentials-ready definitions. Preserve `local_ready` for local-only behavior. Owner-only credential operations never expose secret values, and disconnect clears stored credential data while preserving installation-linked operational history. OAuth state is durable, hashed, short-lived, bound to tenant/actor/connector/installation, and consumed once; PKCE verifier material is encrypted and erased upon consumption. Marketplace/API status distinguishes `live_setup` from mock and local modes and exposes only configured-state booleans and field metadata.
- **Rationale:** Provider adapters need a tenant-safe credential boundary before real integrations are enabled, while mock connectors must not be mistaken for credential-ready providers.
- **Authoritative doc:** `docs/CONNECTOR_SYSTEM.md`

## 2026-09-23 — Modular capability subscriptions complement Industry Packs

- **Status:** Accepted
- **Area:** Business Model
- **Decision:** Modular CRM remains one horizontal platform with a small required core, data-defined independently subscribable capability modules, and Industry Packs that recommend and configure a focused setup. Entitlement, enablement/configuration, and UI prominence are separate; server actions enforce access, while module removal preserves history. Pricing, module names, allowances, and seat rules remain open rather than hard-coded.
- **Rationale:** Small service businesses need depth in relevant workflows without paying for or navigating unrelated complexity, and should be able to grow without migrating systems.
- **Authoritative doc:** `docs/PRODUCT_SCOPE.md`
- **Supersedes:** The visibility-only module-setting rule in `docs/V1_ONBOARDING.md`

## 2026-09-23 — Durable local file adapter for Docker-free development

- **Status:** Accepted
- **Area:** Architecture
- **Decision:** Local development may use a durable tenant-separated filesystem `ObjectStorage` adapter when MinIO is unavailable. Protected file access remains authorized or short-lived signed, and S3-compatible storage remains the deployment target.
- **Rationale:** The local build must remain operable on machines without Docker while preserving the same storage boundary.
- **Authoritative doc:** `docs/V1_IMPLEMENTATION_ARCHITECTURE.md`

## 2026-09-22 — Autonomous build prompts stay mission-oriented

- **Status:** Accepted
- **Area:** Implementation
- **Decision:** Detailed product and architecture requirements belong in the repository source of truth. Major Codex implementation prompts should define the mission, hard guardrails, autonomy, and completion standard without restating the entire specification or requiring staged approvals.
- **Rationale:** The agentic-ai project demonstrated that a single broad, well-bounded prompt paired with strong repository context can produce a large coherent implementation more effectively than prescriptive milestone tasking.
- **Authoritative doc:** `AGENTS.md`


## 2026-09-22 — V1 specification is ready for end-to-end implementation

- **Status:** Accepted
- **Area:** Implementation
- **Decision:** The V1 product, backend, frontend, reference Industry Pack, local development model, seed scenarios, and acceptance criteria are sufficiently defined for Codex to begin the initial end-to-end build without further routine product clarification.
- **Rationale:** Remaining undecided items concern production launch/commercialization rather than the locally runnable application and do not block implementation.
- **Authoritative doc:** `docs/V1_BUILD_READINESS.md`


## 2026-09-22 — Portable PostgreSQL-first implementation stack

- **Status:** Accepted
- **Area:** Architecture
- **Decision:** The first end-to-end build will use a pnpm TypeScript workspace with Next.js, PostgreSQL/Drizzle, Better Auth, a PostgreSQL-backed worker using pg-boss, S3-compatible object storage, mock-first connector implementations, and Docker-compatible deployment. Provider-specific services remain behind replaceable capability boundaries.
- **Rationale:** This keeps local setup and starting capital low, supports the broad V1 operational scope without unnecessary infrastructure, and avoids locking the product to a single hosting/provider ecosystem.
- **Authoritative doc:** `docs/V1_IMPLEMENTATION_ARCHITECTURE.md`


## 2026-09-22 — V1 scope includes full field operations and business operations

- **Status:** Accepted
- **Area:** Product
- **Decision:** V1 includes route optimization/maps/drive-time planning, outbound email/SMS, both automation recipes and a rule builder, payroll/time tracking, inventory/parts, advanced reporting, and usable multi-location/franchise functionality.
- **Rationale:** The first usable build should function as an end-to-end operating system for the target small service business rather than a limited CRM demo.
- **Authoritative doc:** `docs/PRODUCT_SCOPE.md`

## 2026-09-22 — Pet waste removal is the first reference Industry Pack

- **Status:** Accepted
- **Area:** Industry Packs
- **Decision:** Pet waste removal will be the first fully implemented Industry Pack and the reference vertical used to validate shared CRM, recurring service, routing, field-tech, billing, customer portal, and website behavior.
- **Rationale:** Sweep&Go provides a mature reference workflow and the industry exercises many of the platform capabilities we want to generalize.
- **Authoritative doc:** `docs/INDUSTRY_PACKS.md`

## 2026-09-22 — Core service-business lifecycle is accepted

- **Status:** Accepted
- **Area:** Product
- **Decision:** The default lifecycle is Lead → Customer → Estimate → Approval → Schedule → Job → Completion → Invoice → Payment → Recurring follow-up, with optional shortcuts where a business does not require every step.
- **Rationale:** This accurately reflects the intended small-service-business operating flow and should now guide data modeling and frontend navigation rather than remain an open design question.
- **Authoritative doc:** `docs/PRODUCT_SCOPE.md`

## 2026-09-22 — V1 uses role templates backed by granular permissions

- **Status:** Accepted
- **Area:** Architecture
- **Decision:** V1 will provide Owner/Admin, Office/Manager, and Field Technician role templates backed by granular server-enforced permissions rather than authorization based only on hard-coded role names. Customer access is a separate portal identity/surface.
- **Rationale:** Small businesses need simple defaults, while the underlying authorization model must be flexible enough to support accountants, dispatchers, crew leaders, franchises, and custom roles later without redesigning the backend.
- **Authoritative doc:** `docs/ARCHITECTURE.md`

## 2026-09-22 — Persistent customer portal is part of V1

- **Status:** Accepted
- **Area:** Product
- **Decision:** V1 will include a persistent customer portal for profile/location data, service history, estimates, billing/payment interactions, recurring-service information, notification preferences, change requests, support interactions, and intentionally shared files/forms. Secure links remain available for low-friction individual actions.
- **Rationale:** The Sweep&Go feature audit showed that customer self-service is part of the core operating model, not merely an optional convenience.
- **Authoritative doc:** `docs/PRODUCT_SCOPE.md`

## 2026-09-22 — Define scope before the first full Codex build

- **Status:** Accepted
- **Area:** Implementation
- **Decision:** Refine the product scope, user flows, data model, integrations, and frontend behavior far enough that the first major Codex implementation task can build the initial backend and frontend end to end with minimal clarification or architectural rework.
- **Rationale:** The preferred development model is to make a complete usable application, operate it locally/live, then improve functionality from direct use and feedback.
- **Authoritative doc:** `docs/PRODUCT_SCOPE.md`

## 2026-09-22 — Repository documentation is part of product development

- **Status:** Accepted
- **Area:** Implementation
- **Decision:** Every meaningful Modular CRM concept, feature, architecture choice, connector rule, industry-pack rule, and UX requirement must be documented in the authoritative GitHub repository as part of the same work. A deterministic decision-sync workflow should minimize documentation overhead.
- **Rationale:** The repository is intended to become the authoritative source for future Codex and human development, so important decisions must not remain trapped in chat history.
- **Authoritative doc:** `AGENTS.md`
