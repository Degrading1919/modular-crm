# V1 Public API and Webhook Specification

## Goal

Make Modular CRM extensible beyond built-in connectors while keeping the internal application free to evolve.

## Scope

V1 exposes a versioned API for high-value business resources and an outbound webhook system.

The API is not required for ordinary customers.

## Authentication

Initial machine-access methods:

- tenant-scoped API keys/tokens
- future OAuth application authorization without breaking resource contracts

Keys:

- are shown once
- stored hashed where possible
- have explicit scopes
- may be revoked
- have optional expiry
- record last use

## API scopes

Examples:

- customers:read
- customers:write
- leads:read
- leads:write
- jobs:read
- jobs:write
- estimates:read
- estimates:write
- invoices:read
- payments:read
- service_plans:read
- service_plans:write
- tickets:read
- tickets:write
- webhooks:manage

## Resource principles

- tenant scope inferred from credential, never client-supplied as authority
- stable opaque IDs
- cursor pagination
- normalized errors
- idempotency key support for unsafe creates/mutations
- ISO timestamps
- money as amount/currency
- explicit custom_fields
- rate limiting

## Initial resources

- customers
- customer contacts
- service locations
- customer assets
- leads
- services
- service plans
- jobs
- estimates
- invoices
- payment status/read models
- tickets

Do not expose payroll/compensation/security administration by default.

## API versioning

Use a stable path or media-version strategy such as:

`/api/v1/...`

Breaking changes require a new major API version.

Internal application code does not need to call the public API when direct domain-service calls are more appropriate.

## Outbound webhooks

Tenant can register webhook endpoints for selected normalized domain events.

Subscription includes:

- URL
- subscribed event patterns
- secret
- status
- optional description

Payload:

- event ID
- event type
- event version
- timestamp
- tenant-safe resource references
- normalized payload

## Delivery

- HMAC-style signature
- timestamp to mitigate replay
- retry with backoff
- delivery log
- manual retry
- automatic disable/attention state after sustained failures
- duplicate-safe event ID

## Webhook UI

Owner/Admin can:

- create endpoint
- select events
- reveal/copy signing secret once
- send test event
- inspect deliveries
- retry failed delivery
- rotate secret
- disable/delete endpoint

Technical developer features live under an advanced/developer settings area and do not clutter ordinary onboarding.
