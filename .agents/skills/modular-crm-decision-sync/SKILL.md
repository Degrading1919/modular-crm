---
name: modular-crm-decision-sync
description: "Deterministically record Modular CRM concepts, proposed features, accepted decisions, and superseded decisions in Degrading1919/modular-crm with minimal GitHub reads/writes."
---

# Modular CRM Decision Sync

Repository: `Degrading1919/modular-crm`
Default branch: `main`

## Classification

Classify each meaningful item as one of:

- `concept` — useful idea not yet approved.
- `proposal` — feature or architecture proposal under active consideration.
- `decision` — accepted direction that should guide implementation.
- `superseded` — prior decision replaced by a newer one.

If the user clearly directs or accepts something, treat it as a decision without asking a redundant confirmation.

## Deterministic routing

Use the first matching route:

1. Connector marketplace, providers, OAuth, imports/sync, webhooks, external apps -> `docs/CONNECTOR_SYSTEM.md`
2. Industry-specific behavior, vertical workflow, terminology, niche requirements -> `docs/INDUSTRY_PACKS.md`
3. Core architecture, tenancy, data model, hosting, deployment, portability, auth -> `docs/ARCHITECTURE.md`
4. User-visible capability, onboarding, website builder, CRM behavior, pricing/product packaging -> `docs/PRODUCT_SCOPE.md`
5. Reference implementation, competitor pattern, open-source project, licensing research -> `docs/REFERENCE_IMPLEMENTATIONS.md`
6. Otherwise -> `docs/DECISION_LOG.md`

Every accepted or superseded decision must also receive a compact entry in `docs/DECISION_LOG.md`.

Substantial unaccepted feature concepts go in `docs/FEATURE_CATALOG.md`.

## Minimal-write procedure

For one decision:

1. Fetch only the routed authoritative file and, when required, the decision log or feature catalog.
2. Patch the smallest relevant section.
3. Preserve existing structure and wording unless the new decision conflicts.
4. Batch coherent same-turn decisions into one documentation update when practical.
5. Do not reread the whole repository.

Do not duplicate the same full explanation across files.

## Decision log format

Newest entry first:

`## YYYY-MM-DD — Short title`

- **Status:** Accepted | Superseded
- **Area:** Product | Architecture | Connectors | Industry Packs | UX | Business Model | Implementation
- **Decision:** 1–3 normative sentences.
- **Rationale:** 1–2 sentences when useful.
- **Authoritative doc:** relative repository path
- **Supersedes:** optional prior title/date

## Feature catalog format

`### Feature name`

- **State:** Concept | Proposed | Accepted | Deferred
- **Problem:** one sentence
- **Behavior:** concise description
- **Industry scope:** Core | Industry-specific | Optional module
- **Dependencies:** only meaningful dependencies

Update an existing feature entry rather than duplicating it when its state changes.

## GitHub write rules

Prefer:

- `fetch_file` for current content/SHA.
- `update_file` for existing files.
- `create_file` only when the correct routed file does not exist.

Commit messages:

- `docs: record <short topic>`
- `docs: sync product decisions` for coherent batches

Never delete unrelated content, force-push, or create a branch/PR solely for routine documentation unless explicitly requested.

## Conflicts

When a new accepted decision contradicts active documentation:

1. Replace stale normative text in the authoritative document.
2. Record the new decision and supersession in the decision log.
3. Preserve historical rationale only where useful.

## Interaction behavior

Normally perform documentation sync silently alongside the user's request. Do not slow discussion with a confirmation question just to document a clear decision.

If GitHub write access fails, continue the substantive discussion and mention the access problem briefly.
