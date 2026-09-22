# Decision Log

Compact history of accepted and superseded Modular CRM decisions.

Newest entries go first.

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
