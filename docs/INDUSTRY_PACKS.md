# Industry Packs

## Purpose

Industry Packs make the shared platform feel purpose-built for a niche without creating a separate application fork.

An Industry Pack should primarily be configuration.

## Industry Pack responsibilities

Pet-waste pack 1.2 offers two additional recipes, both drafts until an owner enables them: **Follow up on unanswered quotes** (default seven days after estimate.sent, configurable waiting period) and **Ask for a review after a completed visit** (the following day). Existing delayed actions express these; no scheduled stale-estimate trigger is needed. Quote status, expiration and current revision are rechecked at execution and again at delivery after quiet-hours deferral. Both recipes require promotional consent, honor preferences/unsubscribe, and defer during business-timezone quiet hours (default 8pm–8am; tenant quietHours start/end may configure them). Existing pack tenants receive drafts without changing active rules, overrides or archived choices.

A pack may define:

- terminology
- customer/location labels
- asset types
- custom fields
- job types
- status workflows
- recurring service defaults
- forms and checklists
- reports
- automations
- dashboard defaults
- structured product capability recommendations, including conditional recommendations based on onboarding answers
- recommended connector capabilities
- website copy/content defaults
- website template preferences
- inventory/part defaults where relevant
- route/service-duration assumptions

## Runtime service-field contract

Public signup renders the selected pack's ordered `formSteps`, assets and location fields. Text, number, boolean, ISO date and enum values are validated against that same pack on the server; unknown fields and cross-pack asset types are rejected. Pack intake metadata identifies the pricing quantity (asset count or a numeric location field). Shared quoting, records, imports, customer profile and assigned-job screens do not assume a particular asset or property vocabulary.

`customerVisible` permits portal reads; `customerEditable` separately permits portal changes and requires visibility. Sensitive fields cannot be customer-editable, never enter pricing context, public submission history, import history, ordinary record/portal responses or logs, and use the existing encrypted service-access envelope. Only the authorized assigned service team receives decrypted instructions. Existing tenant/customer/location boundaries remain mandatory.

Compatibility aliases and storage keys belong to the pack. Pet Waste Removal 1.3 retains the legacy signup/quote input shapes and stored property keys without rewriting seeded customer rows. Pack-defined checklist and skip reasons drive field completion, with neutral defaults for businesses without a selected pack.

Read views show recorded field values only; defaults prefill input forms and schemas, never invent historical facts. Pack `displayAs: "warning"` renders recorded warning text prominently in staff records and assigned jobs while respecting portal visibility. Pet Waste Removal 1.3.1 maps the stored `safetyFlag` key, including legacy string warnings. Pack-owned `noncompletionReasonAliases` normalize older queued skip keys to current keys before validation and storage, while retaining the original payload fingerprint for offline replay. Its `customer_requested` and `address_issue` aliases target `customer_skip` and `address_problem`; no customer-data migration is required.

Industry selection is an initial-setup choice, not a migration tool. Switching before customers exist retires the previous pack's service choices and recipes without deleting them; completed setup or existing customers prevents a pack switch. New pack recipes start as drafts.

House Cleaning 1.0 is the second executable reference: room assets, property details of all five field types, room-count pricing and private entry instructions. The separate Tidy Home fixture demonstrates signup, quoting, owner records, portal editing, CSV import and technician completion without replacing existing demo businesses. See [its research profile](./research/industry-packs/house-cleaning.md). No new industry-specific table is introduced.

## Research before implementation

Prospective Industry Packs should be researched using [the canonical Industry Research Profile template](./research/INDUSTRY_RESEARCH_PROFILE_TEMPLATE.md) before runtime implementation.

Completed profiles belong under `docs/research/industry-packs/<industry-key>.md`. The profile preserves the evidence, uncertainty, competitor context, operator complaints, workflow realities, capability needs, and core-platform gaps behind the pack. The runtime Industry Pack should contain the resulting configuration, not the research corpus itself.

Research workers should map findings to the existing `IndustryPack` contract, explicitly distinguish Industry Pack configuration from candidate shared-platform gaps, and leave unsupported or irrelevant fields unknown rather than inventing defaults. Multiple industries may be researched in parallel as long as each worker produces an independent profile using the same template.

### Preferred candidate pool

Use The Sweaty Startup's [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love) list as the preferred starting pool when generating prospective service-business industries to research.

Research as many viable candidates from the source pool as practical, including industries that appear redundant, adjacent, or operationally similar. Do not pre-collapse similar candidates before research. Each candidate should receive its own evidence-backed profile so similarities and differences are measured rather than assumed.

The completed research may later conclude that several candidates should share one runtime Industry Pack, use a common pack with variants, remain separate packs, or are poor fits for the platform. That consolidation decision belongs after the evidence exists, not before it. Parallel research batches should therefore optimize for coverage of the candidate pool rather than representative sampling alone.

## First reference Industry Pack: Pet Waste Removal

Pet waste removal is the first complete reference implementation and should prove that the shared platform can support a route-dense recurring service business end to end.

The pack should cover at minimum:

- residential and commercial customers
- service addresses
- yards/work areas
- pets/dogs, including names, photos, and safety flags
- gate/access instructions
- recurring service frequencies
- one-time/initial cleanups
- route-oriented scheduling
- service-day assignment
- completion proof/photos
- skip/missed/reclean handling
- weather or operational bulk changes
- zone/service-area pricing
- payment method capture
- recurring billing
- customer notification preferences
- on-the-way and completion notifications
- customer pause/change/cancel requests
- technician notes
- time/mileage tracking
- tips
- customer ratings/comments
- referral source tracking
- cross-sells/add-on services
- commercial multi-location support
- pet-waste-specific website signup/onboarding defaults

The reference pack should demonstrate Industry Pack configuration rather than introduce pet-waste-specific tables unless a shared configurable entity cannot reasonably represent the requirement.

Default automation recipes must use emitted domain events and recipient-bearing payloads. The pet-waste pack distinguishes completed customer signups from requests needing office review; route reminders trigger from each dispatched job rather than a route-wide event without a customer; and pause-review tickets filter change-request events to `type=pause`. Payment receipts use `payment.succeeded` and its customer identity, and remain drafts until the business enables them. Pack setup supplies the ticket type required by its plan-change review recipe.

## Future examples

### Septic service

Possible configuration:

- Asset: Septic System
- Fields: tank size, tank material, system type, number of lids, last pump date
- Recurrence: multi-year service reminders
- Job types: pump, inspection, repair
- Recommended capabilities: payments, accounting, SMS reminders, maps, calendar, photo storage

### Appliance repair

Possible configuration:

- Asset: Appliance
- Fields: appliance type, manufacturer, model, serial number, warranty status
- Workflow: diagnose -> parts needed -> parts received -> return visit -> completed
- Recommended capabilities: payments, calendar, email/SMS, accounting

## Design rule

Do not create industry-specific database tables unless a real product requirement cannot reasonably be modeled through the shared platform.

Industry Packs should remain easy to add and revise without destabilizing the core product.

Packs configure available functionality and recommend a small, relevant starting stack. They do not grant commercial entitlement or define fixed prices. A recommendation can be normally recommended, optional, usually unnecessary, or conditional; the tenant can accept it or customize the setup. The subscription system determines which modules the tenant owns, and capability enforcement remains outside the pack.
