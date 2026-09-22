# V1 Connector Catalog

The first build should demonstrate a broad connector marketplace without requiring production credentials to run locally.

## Connector maturity levels

### Mock-complete
Fully functional deterministic local/test adapter.

### Credentials-ready
Real provider adapter includes authorization/setup path, token handling, capability method boundaries, webhook/sync hooks, environment placeholders, and graceful "not configured" behavior. It can be activated when the developer registers an app and supplies credentials.

### Production-verified
Requires real provider credentials/accounts and live validation. This is not required for the initial local Codex build unless credentials are available.

## Required V1 mock-complete capabilities

- payments
- accounting
- email
- SMS
- calendar
- geocoding
- routing/optimization
- object storage
- payroll export
- AI structured-content generation
- external customer import

Mocks must support success, authorization-expired, provider-error, timeout/retry, and webhook/event simulation where relevant.

## Credentials-ready provider targets

### Payments

#### Stripe
Capabilities:
- payment-method setup/reference
- payments
- refunds
- payment status/webhooks
- connected-account pattern where appropriate

Setup:
- application/platform credentials via environment
- tenant authorization/connection flow where required

#### Square
Capabilities:
- delegated seller connection
- payments
- refunds
- customer/payment references
- webhooks

Square publicly supports OAuth for seller accounts, so the connector should follow delegated authorization rather than asking customers to paste long-lived seller credentials.

### Accounting

#### QuickBooks Online
Capabilities:
- connect company
- customer sync
- invoice sync
- payment sync
- tax/account mapping where practical
- sync status/logs

Use OAuth and provider sandbox patterns. Keep field ownership/conflict rules explicit.

#### Xero
Capabilities:
- connect organization
- contact sync
- invoice sync
- payment sync
- account/tax mapping

Use OAuth authorization-code flow for customer organizations. Connector documentation should note provider certification/connection-limit considerations as an operational launch concern rather than exposing them to ordinary users.

### Google Workspace

One Google connector installation may expose separate capabilities depending on granted scopes:

- Google Calendar
- Gmail send capability
- Google Drive/file integration when enabled later

Request only the scopes needed for capabilities the user turns on.

Do not request broad Gmail access merely to send outbound messages.

### Microsoft 365

Use Microsoft Graph for supported capabilities:

- Outlook calendar
- Outlook email send
- OneDrive/SharePoint file capability when enabled later

Capabilities/scopes are enabled progressively.

### Messaging

#### Twilio
Capabilities:
- SMS send
- delivery events
- opt-out/suppression event hooks where supported

Support authorization patterns provided by Twilio. If product strategy later includes platform-provided messaging, that can be another installation model without changing MessagingCapability.

### Routing

#### Google Maps Platform
Capabilities:
- geocoding
- route matrix
- route optimization

The current Route Optimization API supports fleet/field-service style optimization with route constraints.

#### Mapbox
Capabilities:
- geocoding/maps support as applicable
- route calculation
- optimization

Keep Mapbox optimization-version limitations behind the connector. Do not design core routing around a provider's waypoint limits.

### Storage

#### S3-compatible
Capabilities:
- object put/get/delete
- protected/signed access

Production targets may include:
- AWS S3
- Cloudflare R2
- other compatible services

This is an infrastructure connector/capability and normally not a tenant marketplace choice unless customer-owned storage is later supported.

### AI

#### OpenAI
Optional capability:
- conversational onboarding
- structured website-copy proposal
- field-mapping assistance
- workflow/automation drafting assistance

AI output must validate against domain schemas and never become required for core operation.

A deterministic mock is the default local provider.

## Marketplace-visible future targets

These can appear only as "coming later" if intentionally shown; they should never appear connectable before implementation exists.

Potential categories:

Payments:
- PayPal
- additional merchant processors

Accounting:
- FreshBooks
- Wave where integration access permits

Storage:
- Dropbox
- OneDrive
- Google Drive

Marketing:
- Mailchimp
- Constant Contact
- GoHighLevel

Automation:
- Zapier
- Make
- n8n

Payroll:
- providers selected after API/partner-access research

Industry systems/import:
- Jobber
- Housecall Pro
- ServiceTitan
- Sweep&Go
- other vertical CRMs where export/API access permits

## Provider choice UX

Users should not be forced through this entire catalog during onboarding.

Example:

`Accept card payments`

If no provider is connected:
- Recommended provider cards
- "I already use Square"
- "I already use Stripe"
- "Skip for now"

If the user says they already use a supported provider, prioritize it.

## Real-connector implementation rules

- provider SDK isolated to connector package
- environment/app-registration requirements documented in connector README
- localhost callback supported when provider permits
- callback verifies state
- refresh/revocation implemented where applicable
- encrypted credential storage
- health check
- normalized errors
- no provider tokens in client storage
- mocked contract tests
- webhook verification/idempotency
- disconnect path
- minimum necessary permission scopes

## Initial build completion standard

Codex does not need live provider accounts to call V1 complete.

It does need:

1. connector marketplace and registry fully functional
2. every critical capability usable through a mock
3. credentials-ready implementations for the named high-priority providers where public APIs permit normal application registration
4. clear environment placeholders and setup documentation
5. no core workflow that crashes because a real connector is absent
