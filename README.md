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

## Local quickstart

The standard local setup uses Docker Compose for PostgreSQL, MinIO, and Mailpit. Install Docker with Compose, Node.js 20.9 or newer, and pnpm 11.19.0 (the version recorded in `package.json`). From the repository root:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

On macOS or Linux, use `cp .env.example .env` in place of `Copy-Item`. Keep the development values in `.env` local; do not use them for deployment. Docker is required for this Compose-based setup. Local development uses mock connectors, so the core workflows do not require production accounts or credentials for payment, messaging, calendar, routing, or accounting providers.

The example environment also enables local custom-domain verification simulation. Production mode rejects simulated verification even if that development setting is present.

Open the application at [http://localhost:3000](http://localhost:3000). Mailpit's local email inbox is available at [http://localhost:8025](http://localhost:8025), and the MinIO console at [http://localhost:9001](http://localhost:9001). The seeded tenants and playtest scenarios are documented in [V1 Seed and Playtest Scenarios](./docs/V1_SEED_SCENARIOS.md).

The development seed creates these login accounts; each uses the development-only password `Demo12345!`:

| Tenant | Persona | Email |
| --- | --- | --- |
| Happy Yards | Owner/Admin | `owner@happyyards.test` |
| Happy Yards | Office manager | `manager@happyyards.test` |
| Happy Yards | Field technician (Terry) | `tech@happyyards.test` |
| Happy Yards | Field technician (Casey) | `casey@happyyards.test` |
| Happy Yards | Customer | `customer@happyyards.test` |
| CleanPaws | Owner/Admin | `owner@cleanpaws.test` |
| CleanPaws | Field technician | `tech@cleanpaws.test` |
| CleanPaws | Customer | `customer@cleanpaws.test` |

These credentials are for local development only; never use them in a deployed environment.

To stop the application, press **Ctrl+C** in the development terminal, then stop the Compose services from the repository root:

```powershell
pnpm infra:down
```

### Local database without Docker

For core application flows, the repository also includes an embedded PGlite server. In a separate terminal, start it with:

```powershell
pnpm infra:pglite
```

It prints the PostgreSQL URL it serves (by default `postgresql://postgres:postgres@127.0.0.1:5433/postgres`). Copy that URL into `DATABASE_URL` in `.env`, then run `pnpm db:migrate`, `pnpm db:seed`, and `pnpm dev` as above. This local database is stored under `.local-data/pglite/`; set `PGLITE_PORT` or `PGLITE_DATA_DIR` before starting the server to choose another port or data directory. PGlite covers the database required for the application; Compose remains the documented option when you also want the local MinIO and Mailpit services. If MinIO is not running, remove or comment out the five `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, and `OBJECT_STORAGE_REGION` values from `.env` to use durable local file storage.

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
