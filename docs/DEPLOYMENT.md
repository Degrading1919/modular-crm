# Container deployment

These are operator instructions, not authorization to deploy. CI builds/tests locally and never publishes images, merges PRs or provisions infrastructure.

## Build once, configure at runtime

Optional error reporting: set OTEL_EXPORTER_OTLP_LOGS_ENDPOINT to a trusted collector's complete HTTPS /v1/logs endpoint accepting OTLP JSON. Local console reporting needs no service. Missing external reporting produces a production startup warning, not a startup failure; exported metadata excludes raw error messages, full stacks, paths and customer data. Structural class, SQLSTATE/driver code and up to five function@basename:line frames support diagnosis. Configure the collector through private infrastructure rather than credentials in its URL.

TRUSTED_PROXY_HOPS selects the verified address at X-Forwarded-For chain length minus hops. Production defaults to 1 (one ALB) and validates an integer 1–16; development/test defaults to 0 (ignore all address headers and use the fixed local budget). Set the exact count for your fixed proxy chain, never the number of client-supplied entries. Missing, short or invalid chains fall back to the same local budget; x-real-ip is ignored. Restrict application ingress to the trusted proxies only and prevent alternate shorter paths. Configure each proxy to append the address it actually observes (or overwrite client headers at the outer boundary), never preserve an unverified header. [AWS ALB documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html) confirms default append mode places the observed address on the right; any client-supplied leftmost value is untrusted. IPv4/IPv6 client ports are normalized away. Local proxy simulations must explicitly set TRUSTED_PROXY_HOPS.

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
| `TRUSTED_PROXY_HOPS` | Exact secured proxy-path count; production default 1, allowed 1–16; local default 0 | Not needed |
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

## Platform workspace subscription setup

This is future operator setup, not permission for agents to create products, use real keys or charge cards. The project owner must choose commercial prices first. Development/test defaults to **Standard (local example)** and **Small team (local example)**; those prices are demonstrations only. Production refuses missing/empty plans, placeholder plans, missing price IDs and mismatched provider prices. Web and worker fail startup when an active recurring price cannot be verified; no silent fallback to mock.

1. In a separate platform Stripe account, initially in test mode, create one product per plan and fixed recurring prices per supported currency/month or year. Do not reuse the tenant Connect account or `PAYMENTS_STRIPE_*` credentials. Set `PLATFORM_STRIPE_MODE=test`, a matching test secret key and this platform destination's signing secret. No real card data belongs in CRM APIs or logs.
2. Set `PLATFORM_BILLING_PLANS_JSON` to a nonempty array. Example shape only (owner-selected values and real **test** price IDs must replace this before startup):

   ```json
   [{"key":"standard","name":"Standard","seats":10,"capabilities":["*"],"prices":{"USD":{"monthly":2500,"yearly":25000,"monthlyPriceId":"price_REPLACE1","yearlyPriceId":"price_REPLACE2"}}}]
   ```

   Prices are positive integer currency minor units (USD cents; JPY units). Capability names are functional keys from the existing catalog, not connector keys or module IDs; `*` retains all otherwise entitled/enabled features. Use unique price IDs for every plan/currency/interval. The first plan/currency defines the free trial. All instances must share identical configuration. Keep historical plan keys/prices available for reconciliation; introducing a new price/key is an explicit plan version, not repricing already issued bills.
3. Configure `PLATFORM_BILLING_TRIAL_DAYS` / `PLATFORM_BILLING_GRACE_DAYS` (defaults 14/7, bounds 1–365). Hosted Checkout does not charge before the promised trial end; if less than 48 hours remain when adding a card, it extends the remaining provider trial to at least 48 hours. The page explains this. A subscription already in trial uses the portal for changes, not a second Checkout subscription.
4. Register an externally reachable HTTPS **platform-account** destination at `POST /api/v1/platform-billing/webhook`, pinned to **2025-02-24.acacia**. Subscribe to `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and `checkout.session.completed`. Preserve raw body bytes and `Stripe-Signature`; synchronize clocks for five-minute checks. This is not the connected-account destination for customer invoice payments. Monitor retries/conflicts and rejected events; redirects are not proof of payment.
5. Configure the hosted customer portal to allow invoices, payment details, cancellation and plan switching **only** among configured products/prices. Keep quantity fixed at one workspace; the application enforces included seats. Choose the owner's cancellation timing, tax and proration policy in the provider and independently verify its confirmation pages in test mode. The portal handles financial confirmation; only signed/canonical state changes local access.
6. Apply migration 0022 before rolling out either process. Worker startup gives legacy tenants missing a subscription one trial, once, before starting jobs; communicate this upgrade/trial policy to existing businesses before release. Existing subscriptions never reset on restart. Web startup does not open the application database; liveness stays available before migration or during database outages, while readiness refuses traffic. The minute worker sweep and durable platform account-mail outbox provide trial-ending, failed-payment and read-only notices. Verify SMTP delivery and failed/out-of-order/duplicate webhook recovery in a controlled test environment.
7. `PLATFORM_OPERATOR_USER_IDS` is a comma-separated allowlist of actual Better Auth user IDs, managed by the operator, not tenant owners. Allowlisted signed-in users can open `/platform/billing` to view paginated business billing with status filters. No role chosen by a tenant grants this cross-tenant access.

For ECS, securely extend the `RuntimeSecretArn` JSON object with **all** of `PLATFORM_STRIPE_SECRET_KEY`, `PLATFORM_STRIPE_WEBHOOK_SECRET`, `PLATFORM_STRIPE_MODE`, `PLATFORM_BILLING_PLANS_JSON`, `PLATFORM_OPERATOR_USER_IDS`, `PLATFORM_BILLING_TRIAL_DAYS` and `PLATFORM_BILLING_GRACE_DAYS`. Blank operator IDs disable operator access. These keys are injected as ECS secrets into web/worker, never migrate or template environment. Missing JSON keys fail task startup. Replace tasks after config changes; never print secret JSON in agent tools. Native non-ECS runtime uses the same environment contract.

Owner note: **Your workspace is read-only, but your data is safe. Sign in to view or export everything and open Plan and billing to recover access. Customer payment links keep working. New automated messages stop; skipped reminders stay in history and are not replayed in a burst.** Cancellation and downgrades never delete customer data or staff. Existing permissions still govern which records each person can view.

Local simulation uses authenticated owner-only `/platform-billing/mock/*` actions and a separately signed hosted test page, with no real card or network charge. The production container smoke permits **only** mock platform billing under `LOCAL_SMOKE_TEST=true` with all three application URLs on HTTP loopback and explicit non-placeholder smoke plans. It does not relax tenant mock/DNS, mail, secret or production URL checks. Never set this flag on deployed services. Mock/fixture passing results are not evidence of an actual Stripe sandbox charge; controlled external-provider acceptance remains human work before deployment.

## Release order and checks

1. Take a database backup and validate migration/rollback compatibility for the release. Use the same built revision for all targets.
2. Run the `migrate` image once with the target database connection injected securely, for example `docker run --rm --env-file /secure/release.env modular-crm:migrate`. It applies application and pg-boss migrations and queue registration; require exit 0 before proceeding. Failed migrations block rollout. Applied migrations can be replayed safely; do not run seed scripts in production.
3. Roll out web and worker with runtime configuration. Neither service runs schema upgrades at boot. Worker production startup refuses an uninitialized/outdated queue schema. Runtime identities need normal application/pg-boss operational permissions, not broad administrative access.
4. Check web port 3000 and worker port 3001: `/api/health/live` and `/api/health/ready` must return 200. Web readiness stays 503 for missing application migrations/unreachable PostgreSQL. Worker readiness also observes all consumer progress; readiness failure does not automatically retry a job. Check `/login` and its assets.
5. Route traffic only to ready web instances. Use liveness for both process restart checks and readiness for load-balancer admission/worker operational monitoring; the worker image `HEALTHCHECK` uses `/api/health/live`, not database-dependent readiness. Database failover must not cause healthy worker restart loops. Allow at least three seconds for bounded readiness probes, startup grace and graceful SIGTERM shutdown. Establish appropriate operational bounds before increasing worker limits for genuinely long jobs.

See the [Next standalone documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) and [Docker cache guidance](https://docs.docker.com/build/ci/github-actions/cache/). CI's isolated smoke checks all four endpoints, rendered login/static assets, non-root runtime, missing-connection migration rejection, migration replay, no auto-migration on web boot, and fatal unsafe production startup. It does not prove external SMTP, object storage, HTTPS termination or live provider credentials.

## AWS ECS/Fargate operator runbook

`infra/aws` is executable CDK v2 infrastructure, not deployment authorization. Development and CI synthesize fixtures and run AwsSolutions checks only. **The following bootstrap, deployment, secret edits, release and recovery steps are future human/operator actions; agents must never execute them.** Work through staging first. The owner supplies the domain, sender/provider accounts, alert recipient and budget; the operator manages technical setup and keeps identifiers/configuration in a secure external environment file, never Git.

### Prerequisites and configuration

Use Node 22, pinned pnpm (`pnpm install --frozen-lockfile`), AWS CLI v2 authenticated through a short-lived operator profile, Bash 4+, jq, and Docker with Linux/amd64 builds. Limit operator permissions to the approved account and region; review CloudFormation changes before applying them. Have access to DNS, production SMTP credentials, and an AWS region that supports the chosen PostgreSQL 17.x/18.x minor. Verify engine availability in that region before setting `CRM_POSTGRES_VERSION`; the repository does not assume a future minor is available. Budget alerts and spend limits remain an account-level owner responsibility.

Set these environment names locally; values are not committed: `CRM_STAGE` (`staging` or `production`), `CRM_ACCOUNT`, `CRM_REGION`, `CRM_DOMAIN` (hostname only), `CRM_ALARM_EMAIL`, `CRM_POSTGRES_VERSION`, `CRM_SMTP_HOST`, `CRM_SMTP_FROM` (sender address), and `CRM_IMAGE_SHA` (full lowercase reviewed Git SHA). Set `AWS_REGION=$CRM_REGION` for the release script. Optional: `CRM_SES_DOMAIN`, `CRM_NAT_GATEWAYS` (0–2), `CRM_MULTI_AZ`, `CRM_WAF`, `CRM_WEB_COUNT` (1–6), `CRM_WORKER_COUNT` (1–4), `CRM_ACTIVE`, `CRM_RESTORE_SNAPSHOT` and optional `CRM_RESTORE_ALLOCATED_STORAGE` (GiB). Booleans are `true`/`false`. Keep staging and production configurations distinct. CDK context supports the corresponding camelCase names but command-line context exposes values in shell history; prefer environment configuration. `.context.json`/synth outputs stay ignored.

Defaults after activation: two AZs; staging one NAT, one web/one worker, t4g.small Single-AZ 20 GB database with 7-day backups; production two NATs, two web/one worker, t4g.medium Multi-AZ 100 GB with 14-day backups. Storage autoscaling ceilings are 100/1000 GB. All tasks are 0.5 vCPU/1 GB Linux x86_64; web autoscaling allows up to six. Production enables WAF, deletion protection and stack termination protection. Zero NAT is an isolated-network option, **not** a working outbound SMTP/connector configuration; retain NAT for this runbook. Four interface endpoints across both AZs cover ECR API/Docker, logs and secrets; the S3 gateway endpoint has no hourly charge.

### Bootstrap, deploy and DNS

After the owner authorizes spending and deployment, the operator runs this once per account/region, then deploys each stage with its own environment loaded:

```bash
pnpm --filter @modular-crm/aws exec cdk bootstrap "aws://$CRM_ACCOUNT/$CRM_REGION"
export CRM_ACTIVE=false
pnpm --filter @modular-crm/aws synth
pnpm --filter @modular-crm/aws exec cdk diff --all
pnpm --filter @modular-crm/aws exec cdk deploy --all --outputs-file /secure/crm-outputs.json
```

The network, data and app stacks are named `crm-<stage>-network`, `crm-<stage>-data`, and `crm-<stage>-app`. ACM DNS validation pauses deployment until the operator adds the certificate's displayed validation CNAME to DNS. Leave that record for renewal. No Route 53 zone lookup or automatic domain ownership assumption occurs. Once deployed, point the CRM hostname to the `LoadBalancerDns` output using a DNS CNAME (or provider alias for an apex). HTTP redirects to HTTPS; only the ALB can reach web port 3000. Worker/migrate have no inbound rules or public IPs. Confirm the SNS subscription email so alarms can be delivered.

Both services intentionally start at **zero tasks**: there are no images, usable runtime secrets or initialized schemas in a fresh account. RDS generates its own credential in Secrets Manager. In the Secrets Manager console, securely replace the placeholder `RuntimeSecretArn` secret with a JSON object containing `BETTER_AUTH_SECRET` (unique random 32+ characters), `WEBHOOK_SECRET_ENCRYPTION_KEY` and `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` (independently generated 32-byte unpadded base64url values). Set `SmtpSecretArn` to JSON `username`/`password` from the production SMTP provider. Never retrieve or print these values in agent tools or shell logs. ECS injects JSON keys through `secrets`; no secrets are in template `environment`. Missing JSON keys make task startup fail closed. Preserve encryption keys across releases/restores; rotating them requires a data re-encryption plan. Credential rotation requires new ECS tasks. See [ECS secret injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html).

The database connection URL is constructed inside each container from injected credential parts, encoding reserved password characters; web/worker still use the portable `DATABASE_URL` contract. The image includes public RDS CA trust anchors and sets `sslmode=verify-full`, never disables certificate/hostname checking. CA download failure fails the image build. Refresh/rebuild trust anchors before CA retirement. See [RDS TLS verification](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html). Only migrate receives the database administrator identity. After schemas/queues exist it provisions a separate generated runtime login: public-schema CRUD/sequence/function use and pg-boss schema-local queue-table management, with no superuser, database creation, role creation or replication permission. Restores reapply the current runtime identity before rollout. ECS application roles cannot administer RDS or read arbitrary secrets.

Storage uses the AWS SDK default credential chain, including temporary ECS session tokens and refresh before expiry; no static AWS keys are required. MinIO/other compatible hosts retain explicit static-key configuration. Download links signed by temporary credentials expire when that credential session expires even if a later link expiration was requested; request a fresh link rather than extending the session with static keys.

### Sender DNS and optional SES

Any supported SMTP provider is valid. `CRM_SES_DOMAIN` additionally creates an SES identity with Easy DKIM; SMTP credentials must still be supplied securely by the operator (they are not AWS access keys for application storage). Add the SES console's three DKIM CNAMEs. Publish the provider's SPF record; SES default MAIL FROM uses its managed SPF domain, while a custom MAIL FROM requires the configured MX/TXT pair from SES. Add `_dmarc` TXT with `v=DMARC1; p=none` initially, review reports/alignment, then adopt the owner's quarantine/reject policy. Do not publish conflicting SPF records. Use a sender within the verified identity, request SES production access, verify region-specific SMTP endpoint/credentials and send a controlled staging delivery before launch. Follow [SES MAIL FROM and SPF](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html).

### First release and later revisions

Take a database snapshot/backup, review forward/backward migration compatibility, and check out the exact approved SHA with clean tracked files. Operator-only command from repository root:

```bash
bash infra/aws/scripts/release.sh --execute "$CRM_STAGE" "$CRM_IMAGE_SHA"
```

The script refuses CI, wrong stage/region, partial SHA and dirty tracked files. It builds/pushes three immutable SHA images, registers definitions cloned from the stack, starts a private migrate task, waits for exit 0, then updates web/worker and waits for stability. Migration failure leaves services unchanged. A stable circuit-breaker rollback is **not** release success: the script verifies the intended task definitions and counts. Rollback commands for previous definitions print before any writes. Retain the release transcript without credentials. Waiter timeout is a failure requiring diagnosis, not permission to retry blindly.

Check HTTPS `/api/health/ready`, `/api/health/live`, `/login` and static assets; check worker live and ready endpoints from the private network. Complete first-owner registration and a controlled customer/job/file workflow without seeding production. Test file tenant isolation, platform email and intended provider sandbox accounts. WAF is production-on: only `SizeRestrictions_BODY` counts rather than blocks in the managed group; the following `LargeBodyPublicRequests` label rule blocks bodies over 8 KB only on `/api/v1/public`, `/api/auth`, `/api/v1/auth` and their descendants. Public quote, signup and contact-form endpoints live under `/api/v1/public` and remain protected, regardless of method or a supplied cookie. The remaining authenticated `/api/v1/` routes, including POST and PATCH estimate/invoice saves, imports and field-photo uploads, rely on application authorization and the existing 2 MB body limit; WAF does not validate sessions. All other common rules and rate limiting remain active. ALB body inspection is limited to the first 8 KB, so explicitly exercise authenticated document creation/editing above 8 KB and oversized public/auth requests with controlled staging data. See [AWS common rule limits](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html) and [URI regex matching](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-regex-match.html).

After the first successful release, retain the **same released `CRM_IMAGE_SHA`**, set `CRM_ACTIVE=true` and redeploy the app stack to enable the steady-state autoscaling minimum and missing-capacity alarms. All future CDK diffs/deployments must use the current migrated release SHA, not an old bootstrap SHA. Keep configuration and release history outside Git. Before deploying infrastructure changes for a newer revision, perform the migration-gated release first; never let CDK roll out an unmigrated image. Use readiness at the ALB and liveness in explicit ECS health checks. Capacity alarms compare running/desired dynamically, including autoscaled counts; RDS CPU/free-storage/connections and ALB 5xx/unhealthy-target alarms notify the encrypted SNS topic.

Application logs exclude customer/secrets, but ALB access logs contain raw URLs and VPC flow logs contain addresses. Treat the dedicated retained access-log bucket as sensitive: application roles cannot read it; restrict operator access and review retention/legal requirements. Task logs retain 30 days staging/90 production. Do not put credentials in URLs or enable request-body WAF sampling. CloudWatch alarm subscriptions must be confirmed and tested by the operator.

### Rollback and snapshot recovery

Application rollback: execute the two printed prior-task-definition commands and wait for both services to stabilize; check readiness and data compatibility. Reverting images does **not** reverse migrations. Prefer a forward repair when the previous binary cannot read the migrated schema. Preserve old immutable ECR images (no automatic pruning); maintain the rollback SHA in configuration before further CDK changes.

Database disaster recovery (operator-only): stop writes and pause web/worker services at zero, preserve a fresh forensic snapshot, select a known-good **same-account encrypted snapshot** and verify its timestamp/engine/schema and associated encryption keys. The operator must check `aws rds describe-db-snapshots --db-snapshot-identifier "$CRM_RESTORE_SNAPSHOT" --region "$CRM_REGION" --query 'DBSnapshots[0].{Encrypted:Encrypted,Status:Status,Engine:Engine,Version:EngineVersion,AllocatedStorage:AllocatedStorage}'` and require `Encrypted=true`, `Status=available` and the expected PostgreSQL version before deploying. Read the snapshot’s `AllocatedStorage` first. By default the restore template omits allocation and inherits the snapshot size, including removal of CDK’s implicit 100 GiB default. Only set `CRM_RESTORE_ALLOCATED_STORAGE` for a deliberate increase: it must be at least the reported snapshot size, at least 20 GiB staging/100 GiB production and strictly below the stage ceiling (100/1000 GiB). If the snapshot exceeds the stage ceiling, stop and review capacity configuration rather than request a smaller restore. Synth is offline and cannot validate actual snapshot storage. Load the stage's external configuration with `CRM_ACTIVE=false`, keep the compatible release SHA, set `CRM_RESTORE_SNAPSHOT` to that snapshot identifier, review the CDK diff and deploy. This creates a parallel private instance inheriting snapshot encryption/KMS and master identity and points task definitions to it; it does **not** delete the original database or weaken its deletion protection. Preserve the administrator secret matching the snapshot; if it has rotated, securely reset the restored instance password to match the current migration secret in the RDS console before release. Never retrieve/print credential values in agent tools. Verify schema/journal and representative tenant data from a private operator host before the migration-gated release. Account for duplicated database cost. CloudFormation restore intentionally omits DBName, master username/password and encryption creation properties; see [snapshot restrictions](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html).

After validation, release the compatible revision and restore `CRM_ACTIVE=true`. Retain `CRM_RESTORE_SNAPSHOT` in all subsequent configuration: removing it would switch services back to the original database. A new snapshot selection creates another parallel instance; review stateful-resource changes carefully. Restore the relevant S3 object versions separately where needed, and preserve application encryption keys so restored connector credentials remain readable. Define and rehearse recovery-time/recovery-point objectives; backups alone do not prove successful recovery. Never disable production protection or delete the original merely to make CloudFormation finish.

### Monthly planning estimate

USD, US East (N. Virginia), 730 hours/month, on-demand Linux x86, no free-tier/discount assumptions, at default active capacity. This is a **rough allowance, not a verified account quote**. Recalculate for the chosen region in the [AWS Pricing Calculator](https://calculator.aws/) before authorization. `node infra/aws/scripts/cost-estimate.mjs` reproduces the arithmetic.

| Component / assumption | Staging | Production |
| --- | ---: | ---: |
| Fargate: 2 / 3 tasks, each 0.5 vCPU + 1 GB | $36.04 | $54.06 |
| NAT: 1 / 2 gateways, excluding data processing | $32.85 | $65.70 |
| Four interface endpoints in two AZs | $58.40 | $58.40 |
| ALB, assumed 1 LCU average | $22.27 | $22.27 |
| Public IPv4: two ALB plus 1 / 2 NAT addresses | $10.95 | $14.60 |
| RDS compute/storage planning allowance: t4g.small 20 GB / t4g.medium Multi-AZ 100 GB | $30.00 | $130.00 |
| Logs/insights, S3, KMS, secrets, alarms/SNS, ECR and low-volume email allowance | $20.00 | $40.00 |
| WAF three rules + 1 million requests assumption | $0.00 | $8.60 |
| Approximate total | $210.51 | $393.63 |

Rates follow the public [Fargate examples](https://aws.amazon.com/fargate/pricing/), [VPC/NAT/IPv4 pricing](https://aws.amazon.com/vpc/pricing/), [PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/), [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) and [WAF pricing](https://aws.amazon.com/waf/pricing/). RDS/operations are explicitly budget allowances, not quoted SKU prices; check [RDS PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/) for current regional instance/storage charges. Autoscaling, migration tasks, log volume, retained snapshots/object versions, RDS burst CPU credits, storage growth, NAT/endpoint data, cross-AZ/internet egress, extra ALB IPs/LCUs, DNS/domain registration, paid providers, taxes and support can raise the bill. Zero ECS capacity does not stop network/database/storage charges. No purchase, commitment or provisioned resource is part of this implementation.
