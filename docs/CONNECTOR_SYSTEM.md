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

Background message delivery rebuilds the tenant's connector scope from saved installations before sending. A connected live email provider takes precedence; broken live credentials fail closed instead of silently switching providers. Without a connected email provider, the platform sends through validated SMTP configuration with no owner connection setup. SMS still requires a texting service. The worker registers mocks only when `MOCK_CONNECTORS=true`; explicitly enabled development mocks retain their test behavior. Development SMTP is Mailpit, never a real relay in tests/CI. Message history records actual platform/connected/mock acceptance and environment; acceptance is not confirmation of delivery.

Platform email uses `<Business name> via <PLATFORM_NAME>` as the From display name, the verified platform sender address, and the branch/business contact email as Reply-To when present. Customer messages carry plain text and escaped simple HTML with the real business name and address when available; no address is invented. Auth verification/password setup and portal invitations use the same platform transport, with pending user-bound portal invitations branded for that business.

Message actions and templates declare `service`, `marketing`, or `account`. Service updates cover appointments/visits, on-my-way and completion notices, estimate/invoice sent or due, and payment notices. They retain the business-name footer without requiring an address or promotional unsubscribe. Marketing includes review requests, promotions, win-back and quote-follow-up nudges; it requires a linked customer, actual business street address, and signed opt-out URL with one-click headers. Account access is reserved for auth/portal mail, not a purpose ordinary custom rules can choose. The rule builder offers **Service update** and **Promotion or follow-up**, conservatively defaulting missing/unknown purpose to marketing. A promotional template cannot be downgraded by an action. Manual operational messages default to service; the legacy `transactional` API value remains an alias.

**Stop promotional emails** affects marketing only. Appointment reminders, invoices and other service updates continue (existing channel preferences and transactional suppression remain effective). A GET only confirms the choice; a `List-Unsubscribe=One-Click` POST records tenant/customer/message-bound consent idempotently. HKDF-SHA256 derives the signing key from `BETTER_AUTH_SECRET`, salt `modular-crm`, fixed info `email-unsubscribe-signing-v1`. For this one release, verification also accepts the previous direct-HMAC key under the same root secret; root rotation still invalidates both generations. Account outbox bodies are encrypted under a separate HKDF info label and excluded from operational message history. Pre-tenant auth has no tenant counter and retains Better Auth's entry-point rate limit; tenant-bound web account mail joins the worker's durable outbox.

The upgrade maps recognized service template/recipe keys, including saved queued execution plans, without changing execution identity or action ordering. Unknown/custom legacy rules become marketing rather than inferring purpose from their event name; existing explicit purposes are retained. Historical `transactional` messages become service; `automation` messages use tenant-bound plan purpose where available, otherwise recognized service template keys, otherwise marketing. No historical sent/failed/suppressed work is replayed by the classification migration.

Platform SMTP has tenant-isolated, database-backed UTC hour/day attempt counters, locked transactionally across instances. Defaults are 100/hour and 500/day; during the first seven days after tenant creation they are 25/hour and 100/day. Operators may configure all four bounds globally or override one tenant using the operator-only `platform_email_policies` table. Marketing may consume at most 80% of each absolute bound, reserving at least one attempt for service mail. Queue priority is account, then service, then marketing; delivery remains controlled by the existing worker, not uncontrolled parallel sends. Reservations count transport failures/crash recovery conservatively. Connected providers are exempt. Over-limit work remains queued with an hourly/daily Delivery note and a persisted next-send time; the durable sweep resumes it when the window opens without consuming counters for ineligible attempts. Job-bound reminders expire at the actual service-window start, or the end of the business calendar day if no window exists; canceled/started/finished or changed visits suppress stale reminders before transport, including work deferred beyond its deadline. No appointment time is invented. Missing marketing addresses produce one owner dashboard prompt linked to the affected branch's existing business profile; onboarding and service updates are not blocked.

Account verification, password and invitation mail is exempt from tenant sending caps, including before a tenant exists. A separate database-backed, global per-recipient limit permits five attempts per UTC hour, with normalized hashed addresses and transactionally locked reservations. Existing auth entry-point limits and link expiry remain intact; account exemptions are not available to ordinary automation rules.

Bounce/complaint delivery-webhook processing and recipient suppression are accepted future sender protections, explicitly **deferred** to the delivery-webhooks slice. Limits and SMTP acceptance are not substitutes for reputation monitoring or proof of inbox delivery.

SMTP acceptance and safe failures are persisted in the existing outbox/events. Retryable delivery failures remain eligible for the existing queue; permanent setup failures display a plain-language reason. Domain-event dispatch claims bounded batches of ten and processes them serially, so ordinary work bursts do not incur a polling delay per event before customer messages can be created; downstream claims and replay protection remain intact. A durable send claim prevents replay of completed records. A stable SMTP Message-ID aids diagnosis but does **not** guarantee exactly-once delivery across an ambiguous SMTP response or a crash between provider acceptance and database commit. Connected providers retain their existing ambiguous-send retry protections.

## Online invoice payments

Signed `account.updated` notifications refresh persisted collection readiness immediately without reconnecting an owner-disconnected installation. Disabled collection hides **Pay now**, blocks new checkout, and prompts the owner that Stripe needs attention.

When canonical financial work reduces an invoice's collectible balance (manual payment, credit or closure), mark excessive open/creating payment pages for expiry under the invoice lock, then attempt processor expiry after commit. A failed expiry never rolls back money and blocks a competing page until closure is confirmed; an in-flight creation response is also closed before returning an obsolete link. Existing V1 staff actions expose manual payments, not new credit/void/write-off editing features; the shared invalidation contract handles those ledger states without expanding billing UI. A processor success racing expiry still records the real payment once. Staff invoice/dashboard views identify the extra amount and link to the existing owner refund form; customers see a non-error receipt explanation that their service team will contact them.

Stripe Checkout omits an explicit expiration parameter, using the provider's 24-hour default and persisting its returned deadline. This keeps response-lost retries identical without submitting an expiration less than 30 minutes away; an ambiguous request beyond the 23-hour idempotency safety window requires review, never a fresh collection key.

Refund reconciliation has a durable **needs review** state when a previously confirmed refund later fails or a confirmation would exceed recorded payment funds. Preserve confirmed ledger money, acknowledge and deduplicate the notification, retain audit history, and show the owner a plain review message that blocks further refunds of that payment. Do not manufacture a successful refund or retry a permanent conflict forever.

After checking the payment service, the Owner resolves the review as **The refund went through** or **No refund happened**. Record that outcome and its before/after money in audit history under the invoice lock, without requesting another processor refund. Repeated resolution and delayed notifications cannot duplicate effects or overwrite the checked outcome. Release review blocking/reservations, retaining ordinary refund amount limits. A confirmed external excess refund is real returned money: preserve gross collection, record the full refund and resulting balance (including negative net collection), never invent an offsetting payment.

Changing an existing visit's date suppresses queued/retry reminders for its previous date and emits `job.rescheduled` in the same locked edit transaction. Dispatch-reminder actions may replay only when an actual reminder was suppressed; if the job is returned to scheduling, the next real route publication sends the replacement instead. Editing scheduled work must never send an early dispatch reminder or duplicate the new publication's reminder. Stable event/action keys prevent duplicate effects; stale delayed plans stay suppressed. A date-only edit clears the previous date's service window rather than inventing a new time. Cancellation suppresses obsolete reminders; configured `job.canceled` rules receive the real customer and reason. Dropped pre-tenant account mail logs one fixed operational warning without recipient, subject or account-link data.

When recording a checked refund outcome would exceed the original payment, the confirmation must explicitly state the excess amount, that the invoice balance may exceed its original total, and the need to rule out duplicate recording. Recording a verified outcome never sends another processor request or invents collection.

The payments capability has a provider-neutral hosted-payment contract: onboarding, verified account readiness, checkout, signed neutral notifications, and refunds. Core billing never imports a processor SDK or accepts card details. The initial Stripe adapter uses Standard accounts with Connect Account Links and direct, card-only Checkout Sessions. Standard lets the merchant retain its own Stripe account and direct-charge responsibility; current Stripe guidance favors hosted onboarding over legacy Standard OAuth for new integrations. Platform credentials are operator-owned; connected-account IDs use the existing tenant/installation/provider-bound credential envelope, with only a hash in the business-to-account lookup. Owners see **Set up online payments**, readiness and partial-payment settings, not credentials.

Bind one payment account to the actual invoice business within its tenant, not a browser-selected account or tenant-wide runtime default. Preserve customer and staff location/object access. Eligible issued invoices use their server-calculated open balance; partial amounts require explicit owner opt-in and cannot exceed that balance. Portal links and eligible service invoice emails open the authenticated invoice confirmation and then its hosted page. Promotions do not acquire invoice action links. Existing enabled automation rules send invoice emails; this feature does not silently enable draft recipes or send unsolicited messages.

Checkout requests are saved before contacting the processor and reuse a stable key, amount, currency and expiration. A declined card keeps its hosted page recoverable; a replacement must expire that page, and a different amount cannot overtake a still-pending creation response. Returning from checkout is never proof of collection. Public notifications verify bounded raw UTF-8 bytes with timestamped HMAC, reject timestamps outside five minutes, and bind the signed account to the persisted tenant/business. Invoice locks, persisted event IDs, and payment identity prevent replayed effects. A durable checkout request reference recovers a notification arriving before its response is saved; refunded-before-paid events remain retryable until their payment exists. Later failure cannot undo confirmed money. Balance, allocation, card provenance, optional fees, audit/domain history, receipt documents and existing receipt automation use the same canonical financial calculation as manual recording.

Owner-authorized partial refunds reserve their amount durably before calling the capability and remain pending until a verified final notification. Failed/canceled confirmations release the reservation without changing money; successful confirmations reconcile once, preserving gross-paid history. Never replay a response-lost refund after the processor's idempotency retention window: an unresolved request older than 23 hours requires processor review, not a new key. Disconnect disables new checkout while retaining the encrypted account binding for late confirmations and refunds of historical payments; this financial-history exception does not change other connectors' credential-clearing disconnect contract. Switching an already-bound business to another processor is not implemented by this slice.

Local `mock-payments` implements the same account, hosted page and signed confirmation/refund path, with no card entry, network request or real money. Its `/test-checkout/` action is authenticated, tenant/object-scoped and unavailable in production or with mocks disabled. Tests use fixtures/Mailpit only. Live onboarding, processor account requirements and external delivery remain operator acceptance work before deployment.

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
