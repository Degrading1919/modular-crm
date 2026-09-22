# V1 Developer Workflow and Quality Gates

## Package manager

Use pnpm and commit the lockfile.

## Local commands

The implementation should converge on simple commands such as:

- `pnpm install`
- `pnpm infra:up`
- `pnpm db:migrate`
- `pnpm db:seed`
- `pnpm dev`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`

Exact script names may differ slightly if README documents them clearly.

## Environment

- `.env.example` committed
- local defaults use mock connectors
- startup validates environment shape
- secrets are never committed
- seed credentials are explicitly development-only

## Database workflow

- schema defined in code
- migrations committed
- no production schema drift dependent on manual dashboard clicks
- seeds are repeatable
- destructive reset script only for local/test environment

## CI

On pull requests/default-branch changes run:

1. install with frozen lockfile
2. formatting/lint
3. typecheck
4. unit tests
5. integration tests
6. build
7. critical end-to-end tests where CI environment supports browser/database services

## Test isolation

Tests must not depend on real external providers.

Use:

- mock connectors
- deterministic clock where needed
- isolated database/schema/test transactions
- stable seed factories

## Code quality

- domain logic outside UI components
- connector SDKs isolated
- server validation at boundaries
- no duplicated permission logic across pages
- no untyped provider payloads flowing into domain services
- shared error model
- structured logging

## Definition of done

A feature is complete only when:

- frontend interaction exists where required
- backend behavior exists
- permissions are enforced
- state/history/audit behavior is correct
- loading/empty/error states exist
- tests cover primary behavior
- documentation changes accompany material product decisions

## Initial-build completion

The first end-to-end build is complete only when the acceptance criteria document is exercised successfully and the project owner can playtest the seeded application without writing setup code or manually populating basic data.
