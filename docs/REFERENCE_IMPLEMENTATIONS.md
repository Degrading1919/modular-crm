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

## Research rule

For every major integration or subsystem:

1. Study at least one mature production implementation.
2. Verify behavior against current provider documentation.
3. Prefer proven patterns.
4. Avoid importing unnecessary complexity.
5. Verify license compatibility before source reuse.
