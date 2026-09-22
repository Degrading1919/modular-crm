# Decision Log

Compact history of accepted and superseded Modular CRM decisions.

Newest entries go first.

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
