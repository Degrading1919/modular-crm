# Industry Packs

## Purpose

Industry Packs make the shared platform feel purpose-built for a niche without creating a separate application fork.

An Industry Pack should primarily be configuration.

## Industry Pack responsibilities

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

## Research before implementation

Prospective Industry Packs should be researched using [the canonical Industry Research Profile template](./research/INDUSTRY_RESEARCH_PROFILE_TEMPLATE.md) before runtime implementation.

Completed profiles belong under `docs/research/industry-packs/<industry-key>.md`. The profile preserves the evidence, uncertainty, competitor context, operator complaints, workflow realities, capability needs, and core-platform gaps behind the pack. The runtime Industry Pack should contain the resulting configuration, not the research corpus itself.

Research workers should map findings to the existing `IndustryPack` contract, explicitly distinguish Industry Pack configuration from candidate shared-platform gaps, and leave unsupported or irrelevant fields unknown rather than inventing defaults. Multiple industries may be researched in parallel as long as each worker produces an independent profile using the same template.

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
