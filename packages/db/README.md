# Database package

`@modular-crm/db` contains the Drizzle PostgreSQL schema, committed SQL migration, tenant-scoped repository helpers, and repeatable business fixtures. The schema follows `docs/V1_DATABASE_SCHEMA.md`; SQL `bigint` money columns use JavaScript `bigint` minor units.

## Local database on Windows without Docker

PGlite's [official socket server](https://pglite.dev/docs/pglite-socket) exposes an embedded PostgreSQL-compatible database to the existing `pg` client. It stores local data in the ignored repository directory `.local-data/pglite`.

In one PowerShell terminal:

```powershell
pnpm install
pnpm --filter @modular-crm/db infra:pglite
```

In another PowerShell terminal:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/postgres'
pnpm --filter @modular-crm/db migrate
pnpm --filter @modular-crm/db seed
```

Keep the first terminal open while running the web app and worker; use the same `DATABASE_URL` for them. The socket server supports up to ten local client connections. It is a development/playtest fallback; the normal Docker or production path remains PostgreSQL. PGlite multiplexes a single embedded connection, so confirm worker and web concurrency on ordinary PostgreSQL before production use.

The business seed creates two tenants, staff memberships, customer portal links, services, routes, jobs, invoices, payments, tickets, inventory, automation history, and sites. It is safe to run twice. The auth package provisions development password credentials for the seeded users; this package does not construct password hashes.

## Package API

- `createDatabase(connectionString)` returns a Drizzle database; `closeDatabase(db)` closes its pool.
- `schema` and named table exports are available from `@modular-crm/db`.
- `createTenantRepository(db, tenantId, scope?)` requires a tenant ID from a trusted session or API credential. Its customer, job, invoice, assignment, and portal methods include tenant conditions; optional organization/location scopes narrow reads and writes.
- `seedDevelopment(db, actorIds?)` returns stable `seedIds` and `seedUserIds` for tests and playtests.

All application migrations are committed in `drizzle/`. `pnpm --filter @modular-crm/db test` runs the migration and tenant isolation tests against an isolated in-memory PGlite database.

When generating a new migration that introduces a composite foreign key, check SQL statement order: the referenced unique index must be created before the foreign-key constraint. Drizzle Kit 0.31 emitted these in the opposite order for the initial migration, so its committed SQL was reordered and verified by applying it to a fresh database.
