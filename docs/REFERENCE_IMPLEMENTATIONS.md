# Reference Implementations

These projects are architectural references for how mature applications integrate comparable capabilities.

Provider documentation remains authoritative for current API behavior. These projects are references for product architecture and implementation patterns.

## Twenty CRM

Repository: https://github.com/twentyhq/twenty

Study for:

- configurable CRM concepts
- metadata/object models
- workflows
- permissions
- integrations
- self-hosting patterns

Do not assume code is reusable without checking its current license.

## Cal.com

Repository: https://github.com/calcom/cal.com

Study for:

- integration marketplace/app patterns
- OAuth connections
- calendar provider abstraction
- payment integrations
- webhook lifecycle
- installable connection concepts

## Chatwoot

Repository: https://github.com/chatwoot/chatwoot

Study for:

- messaging channels
- provider abstractions
- webhook-driven communication
- production retry/idempotency concerns
- connection health and message state

## Dub

Repository: https://github.com/dubinc/dub

Study for:

- modern multi-tenant SaaS patterns
- Next.js application structure
- custom domains
- billing
- transactional email
- workspace/tenant concepts

## Webstudio

Repository: https://github.com/webstudio-is/webstudio

Study for:

- template/site builder concepts
- publishing flows
- custom domains
- structured website content
- portable website hosting

Webstudio is currently AGPL-3.0. Architectural concepts may be studied, but source reuse must be evaluated carefully before any code is copied.

## Pilot hardening references (2026-10-06)

- [Better Auth rate limiting](https://better-auth.com/docs/concepts/rate-limit): its default process-memory storage cannot share a guessing budget across app servers. Modular CRM applies its own atomic PostgreSQL limiter to both V1 and direct authentication HTTP routes.
- [OpenTelemetry OTLP specification](https://opentelemetry.io/docs/specs/otlp/): the optional collector adapter uses OTLP/HTTP JSON log envelopes, lower-camel-case fields and string-encoded nanosecond timestamps. The deployment setting is the complete trusted logs endpoint.
- [Jobber review marketing tools](https://help.getjobber.com/en/articles/reviews-marketing-tools/): completed-visit follow-up and owner-controlled activation inform the pack's draft review-request recipe. No vendor source code was copied; implementations are original and no new third-party runtime dependency was introduced.

## Platform subscription research (2026-10-07)

- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions), [trials](https://docs.stripe.com/billing/subscriptions/trials), [signature verification](https://docs.stripe.com/webhooks), [subscription retrieval](https://docs.stripe.com/api/subscriptions/retrieve), [price retrieval](https://docs.stripe.com/api/prices/retrieve) and [portal deep links](https://docs.stripe.com/customer-management/portal-deep-links): separate platform credentials, canonical reconciliation under lock, signed replay-safe events, hosted card/setup flows and provider-owned plan-change confirmation. REST requests and webhook destination pin `2025-02-24.acacia`; do not accidentally adopt Basil's changed invoice/subscription fields. Checkout requires at least two remaining trial days; extend a shorter remaining trial, never charge early.
- [Dub workspace billing upgrade](https://github.com/dubinc/dub/blob/main/apps/web/app/api/workspaces/%5BidOrSlug%5D/billing/upgrade/route.ts): studied workspace authorization, server price/customer binding, hosted Checkout for new subscriptions and `subscription_update_confirm` for existing subscription changes. [Dub's license](https://github.com/dubinc/dub/blob/main/LICENSE.md) is AGPL-3.0 outside separately licensed enterprise directories. Only concepts were studied; no source was copied or new runtime dependency introduced.

## Customer-domain and certificate comparison (2026-10-07)

| Reference | Proven pattern / fit | Choice for this slice |
| --- | --- | --- |
| [Vercel domain setup](https://vercel.com/docs/domains/set-up-custom-domain) | Guided DNS, ownership conflicts, distinct apex/www setup, automatically managed SSL | Adopt owner-flow concepts, not a new hosting dependency outside the AWS stack |
| [Cloudflare for SaaS validation](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/) | Separate hostname ownership, routing and active certificate evidence | Adopt independent evidence; would require a separate platform zone/account and connector configuration |
| [CloudFront SaaS Manager](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-config-options.html), [managed certificates](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/managed-cloudfront-certificates.html), [SDK SaaS resource example](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example_cloudfront_CreateSaasResources_section.html) | Shared distribution configuration, customer-specific domains/certificates, connection-group routing endpoint, automated managed certificate lifecycle | Selected AWS deployment adapter; CDK shared resources, runtime tenants, no per-customer synth/deploy |
| [Caddy on-demand HTTPS](https://caddyserver.com/docs/automatic-https#on-demand-tls) | Portable ACME with issuance authorization; requires shared certificate persistence/HA and abuse/rate-limit operations | Viable alternate edge adapter, deferred to avoid a second certificate service in the current AWS deployment |

CloudFront supports CloudFront-hosted validation for a new/cutover domain, or self-hosted validation for an uninterrupted existing-site migration. This slice implements the former; it does not promise a zero-downtime migration. Flattened apex validation additionally requires the exact connection-group TXT challenge, not a shared CloudFront IP alone. The application never creates Route 53 records. Cache and origin-request policies replace unsupported legacy TTL/forwarding settings; legacy distribution logging is also unsupported. Per-domain request recovery uses deterministic names, current ETags and binding validation, not test retries.

Implementations are original; no vendor/server source was copied. Proprietary product documentation is used for concepts/API behavior only. New runtime dependencies are the Apache-2.0 [AWS SDK v3](https://github.com/aws/aws-sdk-js-v3/blob/main/LICENSE) and MIT [tldts](https://github.com/remusao/tldts/blob/master/LICENSE) for public-suffix-aware root/www classification. The latter avoids misclassifying roots under multi-label suffixes such as co.uk.

Offline IAM review: `uvx iam-policy-autopilot@latest generate-policies packages/connectors/src/website-cloudfront.ts --service-hints cloudfront --pretty` (0.3.0). Generated actions were narrowed to this account/stage tag and distribution-tenant resource type; the optional VPC-origin dependency is unnecessary for our HTTPS custom origin. [CloudFront service authorization](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html) requires wildcard Resource for create; mandatory RequestTag/TagKeys restrict it, existing-tenant mutations require ResourceTag, and application binding checks enforce the configured parent/group. IAM does not expose parent-distribution condition keys for that create action. There are no ACM-admin, DNS-zone or general-distribution permissions on app roles.

## Research rule

For every major integration or subsystem:

1. Study at least one mature production implementation.
2. Verify behavior against current provider documentation.
3. Prefer proven patterns.
4. Avoid importing unnecessary complexity.
5. Verify license compatibility before source reuse.
