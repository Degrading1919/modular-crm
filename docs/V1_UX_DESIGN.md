# V1 UX and Design System

## Product character

The application should feel:

- simple
- calm
- trustworthy
- operational
- modern
- mobile-friendly
- designed for a local business owner rather than an enterprise IT team

Avoid visual density that makes a five-person company feel like it is operating SAP.

## Design principles

### Progressive disclosure

Show the next useful action first.

Advanced configuration is available but not constantly visible.

### Business language

Prefer:

- Customers
- Jobs
- Routes
- Get Paid
- Send Reminder
- Connect QuickBooks
- Publish Website

Avoid:

- entities
- mutations
- schemas
- OAuth scopes
- webhook endpoints

except in developer/advanced settings.

### Actionability

Dashboards prioritize exceptions and actions:

- 4 jobs need assignment
- 2 payments failed
- route has a conflict
- 1 customer requested a pause

Avoid decorative metrics without operational value.

### Consistency

Use shared patterns for:

- list -> detail
- create/edit drawer or page
- state badges
- timeline
- filters
- bulk action
- confirmation
- destructive action
- error/retry
- connector state

## Layout

Desktop business app:

- collapsible left navigation
- top context bar
- primary content area
- optional right-side detail/activity panel where useful

Mobile technician app:

- bottom or compact primary navigation
- large touch targets
- one primary action per work state
- minimal typing

Customer portal:

- simplified top/bottom navigation
- no internal terminology
- prominent next service/balance/actions

## Tables

Operational tables support:

- search
- filters
- sort
- column visibility
- saved views where useful
- bulk actions
- keyboard-friendly desktop interaction
- responsive card/list fallback on narrow screens

## Forms

- label inputs clearly
- defaults from Industry Pack/context
- inline validation
- do not clear user input on failed submit
- autosave drafts for long forms where appropriate
- group advanced options behind expandable sections

## Status

Use consistent semantic status presentation.

Do not rely on color alone.

Every status has text and accessible semantics.

## Errors

Errors answer:

- what happened
- what the user can do
- whether data was saved
- retry action when safe

Provider errors are translated into business language.

Example:

Bad:
`invalid_grant`

Good:
`QuickBooks needs to be reconnected. Your CRM data is safe.`

## Empty states

Empty states teach the next action.

Example:

`No routes yet. Assign jobs to a technician, then create today's route.`

Do not fill screens with fake charts outside seeded/demo mode.

## Confirmations

Require stronger confirmation for:

- destructive archive/delete
- refund
- void invoice
- cancel recurring plan
- bulk schedule changes
- disconnect connector
- payroll approval/export
- franchise-impacting changes

Routine reversible edits should not require modal confirmation.

## Accessibility

Target WCAG 2.2 AA behavior as a product quality baseline:

- keyboard navigation
- visible focus
- semantic labels
- adequate contrast
- reduced-motion respect
- form error association
- screen-reader-friendly status

## Responsive behavior

Business admin must remain usable on tablets/phones, but field technician and customer surfaces receive first-class mobile treatment.

## Design tokens

Keep theme tokens centralized:

- color roles
- spacing
- typography
- radius
- shadows
- status semantics

Tenants may customize limited brand tokens for customer-facing site/portal without altering operational accessibility.

## Demo quality

The first Codex build should look intentionally designed, not like raw shadcn examples stitched together.

Use consistent navigation, spacing, typography, empty/loading/error states, and realistic seeded content throughout.
