# Modular CRM

A configurable, multi-tenant SaaS platform for small service businesses.

## Product thesis

Build one horizontal platform internally and sell vertical products externally.

The shared platform should handle CRM, customers, jobs, scheduling, billing, communications, websites, automation, and external connections. Each industry should receive a thin **Industry Pack** that adapts terminology, workflows, fields, forms, automations, reporting, and recommended integrations without requiring a separate application fork.

The intended user may have little technical experience beyond Facebook, email, spreadsheets, and basic mobile apps. Onboarding must therefore be self-guided, low-friction, and capability-oriented rather than infrastructure-oriented.

## Core principles

- One shared application and data model wherever practical.
- Strong tenant isolation.
- Industry behavior comes primarily from configuration, not forks.
- Connections are capability-first: users choose what they want to accomplish, not which API architecture to configure.
- External integrations live behind a connector registry/SDK.
- The app must remain usable locally with mocks before production credentials exist.
- Public business websites are generated from structured tenant data and templates.
- Prefer standards and portable infrastructure over unnecessary vendor lock-in.
- Build working end-to-end product slices, use them locally/live, then improve from observed friction.

## Repository role

This repository is the authoritative source for product decisions, architecture, research, and eventually production code.

Start with:

- [docs/INDEX.md](./docs/INDEX.md)
- [.agents/tasks/INITIAL_END_TO_END_BUILD.md](./.agents/tasks/INITIAL_END_TO_END_BUILD.md)

Core references:

- [AGENTS.md](./AGENTS.md)
- [docs/PRODUCT_SCOPE.md](./docs/PRODUCT_SCOPE.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/CONNECTOR_SYSTEM.md](./docs/CONNECTOR_SYSTEM.md)
- [docs/INDUSTRY_PACKS.md](./docs/INDUSTRY_PACKS.md)
- [docs/REFERENCE_IMPLEMENTATIONS.md](./docs/REFERENCE_IMPLEMENTATIONS.md)
