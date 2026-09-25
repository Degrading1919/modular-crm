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

## Runtime registration and onboarding

Runtime packs are static, validated configuration registered through `packages/industry-packs/src/packs/index.ts` and the package registry. The onboarding experience enumerates the validated registry, so adding a pack cohort does not require industry-specific application routes or deployments. Keep each researched business type as its own pack unless the evidence and configuration clearly support sharing without erasing meaningful differences.

During onboarding, the owner selects a supported pack before capability setup. The selected pack supplies its service list, customer language, website starting copy, and capability recommendations; the tenant records the selected pack key and version. Recommendations remain suggestions: the capability setup and entitlement systems decide what the tenant can use. Do not copy unsupported pack fields into behavior the shared platform does not implement.

### Runtime behavior and tenant configuration

Pack data is executable only where a shared runtime consumer is documented below; registry presence alone does not mean every described workflow is implemented. Runtime maturity is exposed separately as `research_only`, `configured`, `runtime_integrated`, or `validated`. Unknown/unregistered keys are research-only; a registered definition is not considered validated merely because it passes structural validation. `runtime_integrated` means supported shared surfaces consume applicable metadata, not that every pack has passed an industry-specific lifecycle test. `validated` is reserved for packs whose important lifecycle has been exercised end to end. The Pet Waste Removal reference pack is the current validated reference; the other registered packs remain runtime-integrated pending representative lifecycle validation.

The shared public intake and field-job surfaces consume pack location and asset fields, including supported text, number, boolean, date, enum, defaults, requiredness, labels, and sensitivity. Media fields are not currently exposed for public upload/reference capture. Unknown fields are rejected. Sensitive intake values are stored in the existing encrypted service-access field and exposed only through an assigned technician job view; they are not included in public lead payloads or ordinary customer-visible asset fields. Existing shared customer, service-location, and asset records remain the storage model. Industry-specific labels and field definitions do not create industry-specific tables.

Owners can edit supported pack defaults through the tenant Industry Pack settings: field visibility/requiredness/labels, checklist visibility/requiredness/labels, and recurrence-preset availability. These overrides are tenant-scoped and validated against the selected pack. They do not grant capability entitlements. A field or checklist customization changes future presentation/validation; completion evidence stores the checklist labels, required flags, results, and pack key/version used at completion so later pack edits do not rewrite that history.

Public signup renders declared location and asset fields and supported recurrence choices. Signup behavior defaults to office review. Automatic recurring activation requires the pack to explicitly request it and still passes the shared quote, recurrence, entitlement, and payment-configuration checks. The current reference pack is the only pack configured for that path. The recurrence consumer accepts a deliberately limited RRULE subset (`DAILY`, `WEEKLY`, or `MONTHLY`, interval 1–52; weekday lists are supported only for weekly schedules); unsupported/custom schedules remain review-only. The service-plan flow snapshots the selected pack, version, and preset. Pack field values and asset counts can be supplied as context to the shared pricing rules, but the pack's pricing-template definitions are not themselves executed as pricing rules. Connector capability recommendations appear in the Connections experience as optional industry-based suggestions; they do not connect a provider or grant/enable a product capability.

The current execution boundary is narrower than the complete pack contract. `formSteps` provide grouping/headings for declared fields; conceptual form-step keys without a matching typed field, conditional field visibility, public media upload, nonstandard website section rendering, pack workflow state transitions, pack report definitions, inventory-default provisioning/material consumption, and generalized automation-recipe installation are not currently implemented. Pack workflow labels do not replace the shared domain state machines. Only recipes that are explicitly supported by the existing automation event/action contract can run. Treat these properties as descriptive until their shared consumers and lifecycle tests exist.

The current research-to-runtime coverage, complete pack keys, and profiles intentionally left research-only are recorded in the [Industry Pack implementation status](./research/INDUSTRY_PACK_IMPLEMENTATION_STATUS.md).

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
