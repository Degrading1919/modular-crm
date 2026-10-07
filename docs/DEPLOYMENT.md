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
| `PLATFORM_NAME` | Optional From suffix, default `Modular CRM`; single line, maximum 100 characters | Not needed |
| `PLATFORM_EMAIL_HOURLY_LIMIT`, `PLATFORM_EMAIL_DAILY_LIMIT` | Positive integer attempt caps, defaults 100 / 500 | Not needed |
| `PLATFORM_EMAIL_FIRST_WEEK_HOURLY_LIMIT`, `PLATFORM_EMAIL_FIRST_WEEK_DAILY_LIMIT` | Defaults 25 / 100 for the first seven days; must not exceed regular caps | Not needed |
| `MOCK_CONNECTORS`, `DOMAIN_VERIFICATION_MODE` | No mocks; omit or set `false` / `dns` respectively | Not needed |
| `LOCAL_SMOKE_TEST` | Omit/false in deployment; true allows only loopback HTTP in isolated smoke | Not needed |
| `PORT`, `HOSTNAME` | Web defaults 3000 / 0.0.0.0 | Not needed |
| `WORKER_HEALTH_PORT` | Worker defaults 3001; do not publicly expose it | Not needed |
| `WORKER_POLL_STALE_MS`, `WORKER_JOB_MAX_MS` | Worker defaults 60000 / 300000; valid 1000–86400000 ms | Not needed |

Both long-lived processes presently validate the entire shared configuration, even where a particular setting is primarily consumed by the other process. Store secrets in your host's runtime secret facility. Do not commit an environment file or place secrets in an image/PR/log. Configure durable object storage separately if enabling uploads; container-local storage is ephemeral and these images do not provision persistence/connectors.

## Platform sender domain

Configure a verified platform sender in `SMTP_FROM`; the app supplies each business's display name and real contact Reply-To. Authorize the chosen SMTP relay in the sender domain's SPF record, enable its DKIM signing, and publish DMARC with aligned SPF or DKIM before tightening enforcement after monitoring reports. Do not put a tenant's unverified address in From. The relay must DKIM-sign `List-Unsubscribe` and `List-Unsubscribe-Post` for [RFC 8058 one-click unsubscribe](https://www.rfc-editor.org/rfc/rfc8058); preserve these headers when relaying. Configure the external HTTPS `APP_BASE_URL` correctly so customer opt-out links reach this app. See [sender authentication guidance](https://support.google.com/mail/answer/81126?hl=en).

Service updates retain a business footer and can send without a street address. Promotional sends require an actual address and promotional opt-out; an owner dashboard prompt links to the affected branch's address form without blocking onboarding. The From name is `<Business name> via <PLATFORM_NAME>`. Unsubscribe is a signed public POST with no login requirement; GET is confirmation-only to avoid mail scanners changing preferences. HKDF separates its signing key (salt `modular-crm`, info `email-unsubscribe-signing-v1`); this release accepts both derived and previous direct-HMAC keys under the current auth secret. Remove the legacy verifier after the one-release transition. Rotating `BETTER_AUTH_SECRET` deliberately invalidates both generations of opt-out links; it also invalidates queued encrypted account bodies, so drain/reissue that work as part of rotation. Do not change secrets casually.

Web tenant-bound account mail and worker messages share the durable outbox. Platform attempt counters use PostgreSQL transactions, not process memory, with UTC calendar hour/day windows. Failed transport attempts count conservatively; queued excess work resumes at the next window, with no test retries or arbitrary delays. Use identical limit configuration across instances. Own connected providers are exempt. All account mail, including pre-tenant auth, bypasses tenant caps but observes a separate global five-attempts-per-recipient/UTC-hour limit in addition to Better Auth's existing entry-point limits. Account link expiry remains enforced by auth; a long delivery delay can require the recipient to request a fresh link, never an extension of expired authority.

The UI's sent status means relay acceptance, not inbox delivery. Bounce/complaint ingestion and recipient suppression are accepted but deferred to the delivery-webhooks slice; operators must currently monitor relay signals separately. SMTP cannot guarantee exactly-once across ambiguous acceptance, even with stable Message-ID. Validate sender authentication, reply handling and opt-out with controlled test addresses before human-authorized deployment. CI and local verification use Mailpit exclusively and do not prove real relay deliverability.

For one tenant's approved higher sending limits, an operator (not a tenant API) may upsert `platform_email_policies` in the release database. Verify the exact tenant ID first, record the operational approval, use positive integer bounds with first-week bounds no greater than normal bounds, and change all four together. For example, with a parameterized database client:

```sql
insert into platform_email_policies (tenant_id, hourly, daily, first_week_hourly, first_week_daily)
values ($1, $2, $3, $4, $5)
on conflict (tenant_id) do update set hourly=excluded.hourly, daily=excluded.daily,
first_week_hourly=excluded.first_week_hourly, first_week_daily=excluded.first_week_daily;
```

Removing that exact tenant's override restores global environment defaults. Marketing retains the 20% service reserve, all attempt accounting remains conservative, and account mail retains its separate five-per-recipient/hour limit. This does not authorize raising limits or executing operator writes during automated verification.

## Online payment service configuration

Subscribe the payment destination to `account.updated` as well as the financial events listed below. Monitor pending page closures and **Refund needs review** records; compare processor history before any human-authorized correction. Neither a late refund failure nor an excessive confirmation automatically rewrites confirmed ledger money.

Stripe is hidden when all `PAYMENTS_STRIPE_*` settings are absent. To expose it, configure all of `PAYMENTS_STRIPE_SECRET_KEY`, `PAYMENTS_STRIPE_WEBHOOK_SECRET`, and `PAYMENTS_STRIPE_MODE` (`test` or `live`). Validation rejects incomplete/mismatched configuration and live keys in tests; these are server runtime secrets, never build arguments or owner fields. Maintain the existing connector encryption key to decrypt connected-account bindings. The adapter uses Stripe API version `2025-02-24.acacia`, Standard Connect hosted onboarding and direct card Checkout; operators must enable the relevant Connect platform and account capabilities. Read [Standard Connect onboarding](https://docs.stripe.com/connect/standard-accounts) and [direct charges](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted) before controlled setup.

Register an externally reachable HTTPS connected-account destination at `POST /api/v1/payments/webhooks/stripe-online-payments`. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed`, `refund.created`, `refund.updated`, `refund.failed`, and `charge.refund.updated`. Inject that destination's signing secret; preserve raw request bytes and `Stripe-Signature` through ingress. Test/live destinations and keys must match. Five-minute timestamp checks require synchronized server clocks. Configure ordinary provider retries: a refund/checkout delivered before its durable binding is available returns a conflict without consuming its event identity. Do not substitute webhook forwarding that strips account context, change invoice amounts in the browser, or infer success from the return URL.

Apply the online-account/session/event and card/fee migrations before admitting traffic. Back up the database and preserve encrypted bindings for late notifications, even after an owner disconnects new collection. Monitor provider delivery/retry failures and pending refunds; an ambiguous refund older than 23 hours is deliberately not resubmitted beyond the provider's idempotency window and requires processor review. Gross collected money, refunds and fee data remain distinct; unavailable fees are null, not fabricated zero fees.

Local and CI verification require `MOCK_CONNECTORS=true`, no Stripe credentials, and only the signed local hosted page; production refuses mocks. No live credential, charge, refund or external email is part of automated verification. Before human-authorized deployment, separately prove controlled test-mode onboarding, ingress/signatures/retries, actual account readiness, refunds and receipt messaging with the operator's intended Stripe destination. Mock/fixture success is not live-payment or PCI compliance certification.

## Release order and checks

1. Take a database backup and validate migration/rollback compatibility for the release. Use the same built revision for all targets.
2. Run the `migrate` image once with the target database connection injected securely, for example `docker run --rm --env-file /secure/release.env modular-crm:migrate`. It applies application and pg-boss migrations and queue registration; require exit 0 before proceeding. Failed migrations block rollout. Applied migrations can be replayed safely; do not run seed scripts in production.
3. Roll out web and worker with runtime configuration. Neither service runs schema upgrades at boot. Worker production startup refuses an uninitialized/outdated queue schema. Runtime identities need normal application/pg-boss operational permissions, not broad administrative access.
4. Check web port 3000 and worker port 3001: `/api/health/live` and `/api/health/ready` must return 200. Web readiness stays 503 for missing application migrations/unreachable PostgreSQL. Worker readiness also observes all consumer progress; readiness failure does not automatically retry a job. Check `/login` and its assets.
5. Route traffic only to ready web instances. Use liveness for both process restart checks and readiness for load-balancer admission/worker operational monitoring; the worker image `HEALTHCHECK` uses `/api/health/live`, not database-dependent readiness. Database failover must not cause healthy worker restart loops. Allow at least three seconds for bounded readiness probes, startup grace and graceful SIGTERM shutdown. Establish appropriate operational bounds before increasing worker limits for genuinely long jobs.

See the [Next standalone documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) and [Docker cache guidance](https://docs.docker.com/build/ci/github-actions/cache/). CI's isolated smoke checks all four endpoints, rendered login/static assets, non-root runtime, missing-connection migration rejection, migration replay, no auto-migration on web boot, and fatal unsafe production startup. It does not prove external SMTP, object storage, HTTPS termination or live provider credentials.

## AWS ECS/Fargate notes

Documentation only: no task definitions or infrastructure-as-code are created in this slice.

- Use separate web/worker services and a one-shot migration task from the same revision. Require successful task exit before the service rollout. Use Fargate `awsvpc`, matching Linux architecture and a valid CPU/memory pairing. Web container port is 3000; worker health is internal port 3001. For an ALB use target type `ip` and target-group health path `/api/health/ready`, expected 200, with startup grace. Terminate external HTTPS with the appropriate certificate and allow web ingress only from the ALB security group. Do not attach the worker to a public ALB. Configure the worker task-definition health check explicitly; ECS does not automatically adopt an image's Docker health check. See [ECS health checks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html) and [ALB checks](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html).
- Use private RDS PostgreSQL accessible only from task security groups, with backups and encrypted storage. Enforce TLS and trusted RDS certificates for `DATABASE_URL`; use the supported PostgreSQL engine version verified in the target region, not a hardcoded future availability assumption. Test the application's Drizzle and pg-boss permissions with release/runtime identities before rollout. [RDS PostgreSQL TLS guidance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html).
- Inject secret ARNs through each task definition's `secrets` entries, not plaintext `environment`. The execution role retrieves secrets/images and writes logs; the application task role covers any required runtime AWS calls. Scope secrets access and KMS decryption to the actual resources. For a JSON field reference retain the `:json-key::` suffix. Rotation requires new tasks; never rotate encryption keys casually because existing encrypted records depend on them. [ECS Secrets Manager injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html).
- Provide network access to image pulls, logging, secrets and configured outbound services (NAT or appropriate VPC endpoints). Configure deployment circuit breaker/rollback, sufficient drain/SIGTERM time, capacity for rolling updates, and sanitized logs. Image builds alone are not a production-readiness or deployment approval.
