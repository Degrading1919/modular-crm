# Decision Log

Compact history of accepted and superseded Modular CRM decisions.

Newest entries go first.

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
