# V1 Connector SDK and Marketplace Specification

## Goal

Make external systems feel like installable capabilities rather than technical integrations.

The core application does not know which vendor implements payments, messaging, accounting, routing, calendar, storage, payroll export, or AI.

## Connector manifest

Every connector exports a manifest with:

- key
- name
- description
- logo/icon reference
- provider
- categories
- capabilities
- auth type
- required scopes/permissions
- supported environments
- setup complexity hint
- resource types that can be discovered
- webhook support
- sync modes
- documentation/support links
- connector version

Example capability keys:

- payments
- email
- sms
- accounting
- calendar
- routing
- geocoding
- storage
- payroll
- crm_import
- marketing
- ai
- analytics

## Connector package interface

A connector may implement:

- `beginAuthorization()`
- `completeAuthorization()`
- `refreshAuthorization()`
- `disconnect()`
- `healthCheck()`
- `discoverResources()`
- `sync()`
- `handleWebhook()`
- capability-specific methods

Unsupported methods are absent rather than stubbed as success.

## Authentication types

Supported connector auth patterns:

- OAuth 2.x / OIDC
- API token/key
- signed webhook-only
- local/mock
- service-account style credentials

OAuth is preferred whenever a provider supports a reasonable user authorization flow.

Secrets are stored server-side only through secure credential storage abstraction.

## Marketplace UX

Primary entry is capability-first.

Sections:

- Get paid
- Accounting
- Calendar
- Customer communication
- Maps & routing
- Files & storage
- Payroll
- Import existing customers
- Marketing
- AI and assistants
- More tools

Each connector card shows:

- what it lets the business do
- whether it is connected
- account/resource currently mapped
- connection health
- any action needed

Technical scope names and webhook configuration are hidden from ordinary users.

## Recommendation engine

Connector recommendations may use:

- Industry Pack recommended capabilities
- onboarding answers
- imported file/source
- currently missing capability
- organization size/modules enabled

Recommendations never silently install external services.

## Resource discovery

After authentication, automatically discover resources such as:

- payment business/location
- QuickBooks company
- calendar
- accounting organization
- messaging number/sender
- storage folder/drive

If one obvious resource exists, select it automatically and confirm.

If several meaningful choices exist, ask the user with business labels.

## Connection states

- not_connected
- authorizing
- connected
- needs_attention
- expired
- disabled
- error

Connection health includes:

- authorization validity
- provider reachability when checked
- required resource mappings
- last successful sync/action
- actionable errors

## Webhooks

Webhook endpoint design:

- provider/connector-specific route
- preserve raw request body when signature scheme requires it
- verify signature before trusting payload
- identify installation/tenant safely
- store provider event ID
- deduplicate before side effects
- persist received/processed/error state
- acknowledge provider according to documented retry contract

Heavy processing occurs in background jobs after verification.

## Sync

Sync directions:

- import
- export
- bidirectional

Each sync type defines:

- canonical source of truth per field/object
- conflict behavior
- cursors/checkpoints
- deletion/archive semantics
- mapping
- retry behavior

Do not promise generic bidirectional sync where provider semantics cannot safely support it.

## Normalized import pipeline

All customer-import connectors feed a shared staging pipeline:

1. discover/extract source records
2. normalize into import DTO
3. propose field mappings
4. deduplicate
5. show exceptions only
6. commit import transaction/batches
7. produce summary
8. retain import batch provenance

CSV uses the same pipeline.

## Capability selection

The tenant may have:

- zero connector for a capability: use mock/manual/platform behavior where supported
- one active connector
- multiple connectors when the capability permits it

Where exactly one provider must be authoritative, tenant settings designate the primary installation.

Example:
- one primary accounting export
- one primary payment processor per customer/location policy
- multiple calendars may coexist

## Mock connectors

Ship deterministic mocks for:

- payments
- email
- SMS
- routing/geocoding
- accounting
- calendar
- payroll export
- AI structured-content generation

Mocks must support forced success/error/expired/timeout cases.

## Initial real connector targets

The architecture should make these straightforward future/initial implementations, without making them prerequisites for local completion:

Payments:
- Stripe
- Square

Accounting:
- QuickBooks Online
- Xero

Calendar/email:
- Google
- Microsoft

Messaging:
- Twilio
- other future providers

Routing:
- Google Maps Platform
- Mapbox or compatible routing provider

Storage:
- S3-compatible

Payroll:
- export/API connectors as researched later

## Connector tests

Every connector package must pass shared contract tests for:

- manifest validity
- auth state transitions
- tenant isolation
- secret non-exposure
- idempotent webhook behavior
- health status
- normalized errors
- mocked failure handling
