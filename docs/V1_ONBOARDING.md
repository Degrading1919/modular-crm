# V1 Onboarding and First-Run Experience

The target user may have no technical background beyond Facebook, email, spreadsheets, and ordinary mobile apps. Setup should feel like creating a business profile, not deploying software.

## Goal

A new owner should reach a usable CRM, customer signup path, and business website without needing live assistance.

The system should prefer sensible defaults, progressive disclosure, and automatic discovery.

## Entry

### Create account

Collect only:

- name
- email
- password or supported authentication
- business name

Verify email without blocking exploration where security policy permits.

## Step 1 — What kind of business do you run?

Show searchable Industry Packs.

Initial production reference:

- Pet Waste Removal

Future packs may be unavailable/coming soon without changing onboarding architecture.

Selecting a pack installs its defaults into a tenant configuration version.

## Step 2 — Business basics

Collect:

- display name
- business phone
- business email
- business address/base location
- service timezone
- logo optional
- brand color optional

Automatically geocode the business base.

## Step 3 — Where do you work?

Simple choices:

- by ZIP/postal code
- radius around business
- draw/select area
- configure later

For Pet Waste Removal, service-area setup immediately feeds:

- website eligibility
- lead routing
- pricing zones
- route planning

Do not require GIS terminology.

## Step 4 — What do you offer?

Preselect Industry Pack services/frequencies.

Owner may:

- turn services on/off
- rename
- enter starting/base prices
- choose quote-required instead of public pricing
- accept recommended defaults

For Pet Waste Removal, ask simple questions such as:

- Which recurring frequencies do you offer?
- Do additional dogs change the price?
- Do you charge an initial cleanup fee?
- Do you offer one-time cleanups?

Translate answers into price-rule configuration.

## Step 5 — How do you get paid?

Present capability, not infrastructure:

`Accept card payments`

Actions:

- Connect a payment provider
- Use development/demo payments for now
- Skip and invoice manually

If providers exist, show recommended choices without forcing one.

Never ask the owner for webhook URLs/API architecture.

## Step 6 — How should customers hear from you?

Capabilities:

- email updates
- text-message updates

Allow:

- connect/provider setup
- use platform/default provider if offered by future business model
- demo mode locally
- disable channel

Preselect recommended notification events from Industry Pack.

## Step 7 — Bring your customers

Choices:

- I am starting fresh
- Upload CSV
- Connect another system
- Add customers later

CSV import:

1. upload
2. detect headings
3. auto-map confident fields
4. show only ambiguous mappings
5. preview first records
6. import with duplicate detection
7. produce import summary/error file

Connected import follows the same normalized import pipeline.

## Step 8 — Schedule and routes

Ask business-language questions:

- What days do you normally work?
- Where do technicians start/end?
- Do customers have fixed service days?
- How many technicians do you have right now?

For a solo operator, create the owner as an optional field worker automatically if selected.

Do not require advanced routing configuration to finish onboarding.

## Step 9 — Your website

Populate a live preview from data already collected.

Ask only missing high-value fields:

- short description
- service areas
- photos optional
- business hours
- contact preference
- testimonials optional

Industry Pack supplies default copy structure and FAQs.

Offer:

- publish to free/platform subdomain
- connect custom domain
- leave as draft

The owner should not re-enter services, pricing, phone, or service area already provided elsewhere.

## Step 10 — Review

Show outcome-oriented checklist:

- Business profile ready
- Services configured
- Service area configured
- Customer signup ready
- Payments: connected / manual / demo
- Email: connected / disabled / demo
- SMS: connected / disabled / demo
- Website: published / draft
- Staff: owner only / invited
- Existing customers: imported / starting fresh

Single action:

`Go to my dashboard`

## First dashboard

Use an empty-state/task rail that disappears as real data arrives.

Suggested tasks:

- Add/import first customer
- Invite technician
- Connect accounting
- Publish website
- Test customer signup
- Create first route

Do not show a wall of configuration warnings.

## Connector recommendations after onboarding

Recommendations are contextual and dismissible.

Examples:

- "You said you use QuickBooks. Connect it to keep invoices and payments in sync."
- "Connect Google Calendar if you want appointments copied to your calendar."

Do not ask every user to configure every connector.

## Progressive feature discovery

Modules such as:

- payroll
- inventory
- franchise management
- advanced automations
- advanced reports

exist in V1 but remain unobtrusive until:

- relevant onboarding answer
- user searches for them
- user enables module
- usage context suggests them

The application should not make a one-person operator feel like they purchased an ERP.

## Recommended capability setup

After the owner chooses an Industry Pack and answers outcome-oriented questions, offer a focused recommended setup with **Accept Recommended Setup** and **Customize My Setup** paths. Explain the subscription impact of changes in ordinary business language. The pack provides recommendations and defaults; a separate entitlement decision grants access.

For each capability, keep commercial entitlement, operational enablement/configuration, and UI prominence separate. Hiding navigation must never be the only access control. A one-person operator should see the work they chose first, while subscribed capabilities can be enabled later without changing applications or migrating records.

## Minimal-feedback principle

Whenever the system can confidently infer a value from existing data, connector discovery, Industry Pack defaults, or prior answers, it should do so.

Ask the user only when:

- there are multiple materially different valid choices
- financial/legal/customer-facing consequences require approval
- automatic mapping confidence is insufficient
- security authorization is required
