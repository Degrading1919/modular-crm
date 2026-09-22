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
