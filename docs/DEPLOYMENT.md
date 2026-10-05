# Container deployment

These are operator instructions, not authorization to deploy. CI builds/tests locally and never publishes images, merges PRs or provisions infrastructure.

## Build once, configure at runtime

From the repository root with Docker/BuildKit available:

```sh
docker build --target web -t modular-crm:web .
docker build --target worker -t modular-crm:worker .
docker build --target migrate -t modular-crm:migrate .
node containers/smoke.mjs
```

All targets use digest-pinned Node 22 slim, frozen pnpm installs and a non-root UID 1000. Web runs `node apps/web/server.js` with Next standalone tracing from the workspace root; its image includes public/static assets. Worker runs compiled `node dist/index.js`, not `tsx`; migrate runs compiled `node dist/migrate/index.js` with SQL/journal assets. Build inputs exclude `.env*`, local data, `.git`, generated output and installed dependencies. Never pass real credentials as Docker build args. Build-time ephemeral placeholders are child-process-only, not image configuration or deployment values. Runtime configuration must pass its own production validation.

| Setting | Web / worker | Migrate |
| --- | --- | --- |
| `NODE_ENV` | Image fixes `production` | Image fixes `production` |
| `DATABASE_URL` | Required PostgreSQL connection, TLS for remote production | Required; release-role schema permissions |
| `BETTER_AUTH_SECRET` | Unique secret, at least 32 characters, not development value | Not needed |
| `WEBHOOK_SECRET_ENCRYPTION_KEY`, `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` | Each exactly 32 bytes encoded base64url without padding; preserve existing keys across releases | Not needed |
| `BETTER_AUTH_URL`, `APP_BASE_URL`, `PUBLIC_BASE_URL` | Required externally correct HTTPS URLs | Not needed |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | Production mail service and sender; optional paired `SMTP_USER` / `SMTP_PASSWORD`; `SMTP_SECURE=true` for implicit TLS | Not needed |
| `MOCK_CONNECTORS`, `DOMAIN_VERIFICATION_MODE` | No mocks; omit or set `false` / `dns` respectively | Not needed |
| `LOCAL_SMOKE_TEST` | Omit/false in deployment; true allows only loopback HTTP in isolated smoke | Not needed |
| `PORT`, `HOSTNAME` | Web defaults 3000 / 0.0.0.0 | Not needed |
| `WORKER_HEALTH_PORT` | Worker defaults 3001; do not publicly expose it | Not needed |
| `WORKER_POLL_STALE_MS`, `WORKER_JOB_MAX_MS` | Worker defaults 60000 / 300000; valid 1000–86400000 ms | Not needed |

Both long-lived processes presently validate the entire shared configuration, even where a particular setting is primarily consumed by the other process. Store secrets in your host's runtime secret facility. Do not commit an environment file or place secrets in an image/PR/log. Configure durable object storage separately if enabling uploads; container-local storage is ephemeral and these images do not provision persistence/connectors.

## Platform sender domain

Configure a verified platform sender in `SMTP_FROM`; the app supplies each business's display name and real contact Reply-To. Authorize the chosen SMTP relay in the sender domain's SPF record, enable its DKIM signing, and publish DMARC with aligned SPF or DKIM before tightening enforcement after monitoring reports. Do not put a tenant's unverified address in From. The relay must DKIM-sign `List-Unsubscribe` and `List-Unsubscribe-Post` for [RFC 8058 one-click unsubscribe](https://www.rfc-editor.org/rfc/rfc8058); preserve these headers when relaying. Configure the external HTTPS `APP_BASE_URL` correctly so customer opt-out links reach this app. See [sender authentication guidance](https://support.google.com/mail/answer/81126?hl=en).

Customer email includes text/HTML and the actual business street address. Nontransactional sends fail visibly if a customer/address is missing rather than inventing details. Unsubscribe is a signed public POST with no login requirement; GET is confirmation-only to avoid mail scanners changing preferences. Keep `BETTER_AUTH_SECRET` stable while issued links should remain valid; rotation invalidates existing signed links. The UI's sent status means relay acceptance, not inbox delivery; monitor provider delivery/bounce signals separately. SMTP cannot guarantee exactly-once across ambiguous acceptance, even with stable Message-ID. Validate sender authentication, reply handling and opt-out with controlled test addresses before human-authorized deployment. CI and local verification use Mailpit exclusively and do not prove real relay deliverability.

## Release order and checks

1. Take a database backup and validate migration/rollback compatibility for the release. Use the same built revision for all targets.
2. Run the `migrate` image once with the target database connection injected securely, for example `docker run --rm --env-file /secure/release.env modular-crm:migrate`. It applies application and pg-boss migrations and queue registration; require exit 0 before proceeding. Failed migrations block rollout. Applied migrations can be replayed safely; do not run seed scripts in production.
3. Roll out web and worker with runtime configuration. Neither service runs schema upgrades at boot. Worker production startup refuses an uninitialized/outdated queue schema. Runtime identities need normal application/pg-boss operational permissions, not broad administrative access.
4. Check web port 3000 and worker port 3001: `/api/health/live` and `/api/health/ready` must return 200. Web readiness stays 503 for missing application migrations/unreachable PostgreSQL. Worker readiness also observes all consumer progress; readiness failure does not automatically retry a job. Check `/login` and its assets.
5. Route traffic only to ready web instances. Use liveness for web restart and readiness for load-balancer admission; worker's image `HEALTHCHECK` uses readiness to detect hung handlers. Allow at least three seconds for bounded database probes, startup grace and graceful SIGTERM shutdown. Establish appropriate operational bounds before increasing worker limits for genuinely long jobs.

See the [Next standalone documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) and [Docker cache guidance](https://docs.docker.com/build/ci/github-actions/cache/). CI's isolated smoke checks all four endpoints, rendered login/static assets, non-root runtime, missing-connection migration rejection, migration replay, no auto-migration on web boot, and fatal unsafe production startup. It does not prove external SMTP, object storage, HTTPS termination or live provider credentials.

## AWS ECS/Fargate notes

Documentation only: no task definitions or infrastructure-as-code are created in this slice.

- Use separate web/worker services and a one-shot migration task from the same revision. Require successful task exit before the service rollout. Use Fargate `awsvpc`, matching Linux architecture and a valid CPU/memory pairing. Web container port is 3000; worker health is internal port 3001. For an ALB use target type `ip` and target-group health path `/api/health/ready`, expected 200, with startup grace. Terminate external HTTPS with the appropriate certificate and allow web ingress only from the ALB security group. Do not attach the worker to a public ALB. Configure the worker task-definition health check explicitly; ECS does not automatically adopt an image's Docker health check. See [ECS health checks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html) and [ALB checks](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html).
- Use private RDS PostgreSQL accessible only from task security groups, with backups and encrypted storage. Enforce TLS and trusted RDS certificates for `DATABASE_URL`; use the supported PostgreSQL engine version verified in the target region, not a hardcoded future availability assumption. Test the application's Drizzle and pg-boss permissions with release/runtime identities before rollout. [RDS PostgreSQL TLS guidance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html).
- Inject secret ARNs through each task definition's `secrets` entries, not plaintext `environment`. The execution role retrieves secrets/images and writes logs; the application task role covers any required runtime AWS calls. Scope secrets access and KMS decryption to the actual resources. For a JSON field reference retain the `:json-key::` suffix. Rotation requires new tasks; never rotate encryption keys casually because existing encrypted records depend on them. [ECS Secrets Manager injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html).
- Provide network access to image pulls, logging, secrets and configured outbound services (NAT or appropriate VPC endpoints). Configure deployment circuit breaker/rollback, sufficient drain/SIGTERM time, capacity for rolling updates, and sanitized logs. Image builds alone are not a production-readiness or deployment approval.
