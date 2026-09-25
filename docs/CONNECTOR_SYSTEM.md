# Connector System

## Principle

Connections are **capability-first, not provider-first**.

A nontechnical business owner should see what they want to accomplish:

- Accept payments
- Send appointment reminders
- Sync accounting
- Connect my calendar
- Import customers
- Connect email
- Store files and photos
- Use maps and routing
- Add online booking

They should not be required to choose technical infrastructure before understanding the outcome.

## Connector marketplace

The product should expose an integration marketplace similar in spirit to an app/plugin directory.

Providers may satisfy one or more capabilities.

Examples:

### Payments
- Stripe
- Square
- PayPal
- future providers

### Accounting
- QuickBooks Online
- Xero
- FreshBooks
- future providers

### Calendar
- Google Calendar
- Microsoft Outlook / Microsoft 365
- future providers

### Email and communication
- Gmail / Google Workspace
- Outlook / Microsoft 365
- Twilio
- future providers

### Storage
- Google Drive
- Dropbox
- OneDrive
- future providers

## Connector contract

Each connector should declare metadata such as:

- connector ID
- display name
- provider
- category
- capabilities
- authentication method
- required permissions/scopes
- supported webhooks
- sync direction
- configuration fields
- connection status
- health status
- last successful sync
- error state
- supported tenant/account discovery

Tenant API-key and service-account setup is enabled only for an explicitly opted-in `credentials_ready` provider. Manifests declare stable credential field keys, plain-language labels, input types, help text, and maximum lengths; the server accepts exactly those fields. Real adapters receive validated values through a separate server-side configured-scope factory; generic mock authorization cannot connect a credentials-ready definition. `local_ready`, mock, and planned connectors cannot accept real credentials. Credential values are encrypted server-side with a dedicated `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, and the authenticated payload is bound to the tenant, installation, and connector. Owners can replace or remove a credential; responses, audit records, and operational history contain no credential material. Disconnect removes the stored credential while retaining the installation and related sync, import, and event history. Marketplace status reports `live_setup` and a safe `credentialConfigured` boolean plus field metadata, keeping it distinct from mock and local behavior.

Infrastructure-owned connectors may declare `platformManaged: true`. Their credentials come from server environment/configuration and never pass through tenant setup APIs. They are excluded from the tenant connector marketplace and installed into each tenant's runtime scope by the platform. S3-compatible storage uses `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ACCESS_KEY`, and `OBJECT_STORAGE_SECRET_KEY`. The tenant-separated filesystem adapter remains registered when S3 is configured so existing local-file installations can still hydrate; tenants without a connected local-file installation use the configured S3 adapter. Without S3 configuration, local development uses the filesystem adapter.

OAuth implementations use durable, single-use transactions. Persist only a hash of the random state, bind it to tenant, actor, connector, and installation, expire it promptly, and consume it atomically. Store a PKCE verifier only as an encrypted, context-bound value and erase it when state is consumed. Do not expose OAuth callback routes until a provider has a complete authorization implementation.

Email acceptance is distinct from delivery confirmation. An email provider may accept a send without returning a message identifier or delivery event; the shared capability result permits a missing external reference, and the CRM records provider acceptance without inventing a provider ID. Delivery status is reported only when the provider supplies a reliable event or status check.

Background message delivery rebuilds the tenant's connector scope from saved installations before sending. A connected live provider takes precedence over test delivery; if a configured provider needs attention, the worker records a failure instead of silently switching to a mock. With no installed messaging service, local development may use the test connector only when `MOCK_CONNECTORS=true`; otherwise the worker records a missing-connection failure. The message history records the installation and reports its actual test or live mode after send; queued messages have no delivery mode yet.

## Setup experience

Prefer:

1. User chooses a capability or selects a tool they already use.
2. User signs in to that service.
3. OAuth authorization occurs.
4. The platform discovers relevant accounts/calendars/locations automatically.
5. Data is mapped automatically when confidence is high.
6. The platform asks only when ambiguity matters.
7. The connection is tested immediately.
8. The UI reports Connected, Needs Attention, or Not Connected.

Do not require users to manually configure webhooks, copy scopes, enter API keys, or design field mappings unless a provider makes that unavoidable.

## Industry Pack relationship

Industry Packs may recommend capabilities, but they should not require specific providers.

Example: a septic Industry Pack may recommend payments, accounting, SMS reminders, maps/routing, calendar, and photo storage.

The connector marketplace determines which installed provider satisfies each capability.
