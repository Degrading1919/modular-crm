# Modular CRM Documentation Index

This repository is the source of truth. New implementation work should begin here rather than from old chat history.

## Product

1. [PRODUCT_SCOPE.md](./PRODUCT_SCOPE.md)
2. [V1_SCREEN_MAP.md](./V1_SCREEN_MAP.md)
3. [V1_ONBOARDING.md](./V1_ONBOARDING.md)
4. [V1_UX_DESIGN.md](./V1_UX_DESIGN.md)
5. [FEATURE_CATALOG.md](./FEATURE_CATALOG.md)
6. [DECISION_LOG.md](./DECISION_LOG.md)

## Domain and backend

1. [ARCHITECTURE.md](./ARCHITECTURE.md)
2. [V1_IMPLEMENTATION_ARCHITECTURE.md](./V1_IMPLEMENTATION_ARCHITECTURE.md)
3. [V1_DOMAIN_MODEL.md](./V1_DOMAIN_MODEL.md)
4. [V1_DATABASE_SCHEMA.md](./V1_DATABASE_SCHEMA.md)
5. [V1_STATE_MACHINES.md](./V1_STATE_MACHINES.md)
6. [V1_BUSINESS_RULES.md](./V1_BUSINESS_RULES.md)
7. [V1_DOMAIN_EVENTS.md](./V1_DOMAIN_EVENTS.md)
8. [V1_PERMISSIONS.md](./V1_PERMISSIONS.md)

## Product systems

- [V1_AUTOMATION_ENGINE.md](./V1_AUTOMATION_ENGINE.md)
- [V1_PRICING_ENGINE.md](./V1_PRICING_ENGINE.md)
- [V1_CONNECTOR_SDK.md](./V1_CONNECTOR_SDK.md)
- [V1_CONNECTOR_CATALOG.md](./V1_CONNECTOR_CATALOG.md)
- [CONNECTOR_SYSTEM.md](./CONNECTOR_SYSTEM.md)
- [V1_WEBSITE_SYSTEM.md](./V1_WEBSITE_SYSTEM.md)
- [V1_REPORTING.md](./V1_REPORTING.md)
- [V1_IMPORT_EXPORT.md](./V1_IMPORT_EXPORT.md)
- [V1_PUBLIC_API.md](./V1_PUBLIC_API.md)
- [V1_FIELD_APP.md](./V1_FIELD_APP.md)
- [V1_SECURITY_BASELINE.md](./V1_SECURITY_BASELINE.md)

## Industry Packs

- [INDUSTRY_PACKS.md](./INDUSTRY_PACKS.md)
- [industry-packs/PET_WASTE_REMOVAL.md](./industry-packs/PET_WASTE_REMOVAL.md)

## Build verification

- [V1_ACCEPTANCE_CRITERIA.md](./V1_ACCEPTANCE_CRITERIA.md)
- [V1_SEED_SCENARIOS.md](./V1_SEED_SCENARIOS.md)

## Research

- [REFERENCE_IMPLEMENTATIONS.md](./REFERENCE_IMPLEMENTATIONS.md)
- [research/SWEEP_AND_GO_FEATURE_AUDIT.md](./research/SWEEP_AND_GO_FEATURE_AUDIT.md)

## Agent workflow

- [../AGENTS.md](../AGENTS.md)
- [../.agents/skills/modular-crm-decision-sync/SKILL.md](../.agents/skills/modular-crm-decision-sync/SKILL.md)
- [../.agents/tasks/INITIAL_END_TO_END_BUILD.md](../.agents/tasks/INITIAL_END_TO_END_BUILD.md)

## Reading rule

The implementation agent should not treat every document as independent prose. The intended precedence is:

1. AGENTS.md
2. accepted decisions in DECISION_LOG.md
3. implementation/domain specifications
4. feature/research material

If two active documents conflict, resolve toward the newer explicit accepted decision and update stale documentation during the same change.
