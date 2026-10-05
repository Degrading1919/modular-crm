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
7. complete end-to-end suite against isolated database/mail services

Implemented by `.github/workflows/ci.yml`; view current [CI status and runs](https://github.com/Degrading1919/modular-crm/actions/workflows/ci.yml). It triggers on every pull request regardless of base branch and on pushes to `main`.

Independent checks are named **Lint**, **Typecheck**, **Unit and integration tests**, **Production build**, and **Playwright (PostgreSQL)**, so one failed gate does not hide other results. They use Node 22, pnpm's exact `packageManager` version, frozen dependency installs and a pnpm store cache. Build/auth and encryption keys are freshly generated and masked per job, not repository secrets or deployment credentials. Existing dotenv scripts accept CI environment variables without a `.env`; a fresh local clone must replace the example auth secret before building.

The browser job uses `postgres:17-alpine` and `axllent/mailpit:v1.27.8`, matching Compose. It migrates and seeds a fresh PostgreSQL database, installs Chromium with its system dependencies, then runs `pnpm test:e2e --reporter=line,html`. Playwright keeps one worker and zero retries. Failure artifacts contain the HTML report, retained traces and screenshots for seven days; only isolated development fixtures and temporary sessions are used. No real provider accounts, MinIO service, deployment or application image build is involved.

Existing unit/integration tests retain their in-process isolated fixtures, including PGlite where already used. The app and worker in CI use real PostgreSQL; CI must not start the PGlite TCP server or compensate for its transport limitation with retries, sleeps or ordering changes. PGlite remains a local convenience, not evidence of production PostgreSQL behavior.

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
