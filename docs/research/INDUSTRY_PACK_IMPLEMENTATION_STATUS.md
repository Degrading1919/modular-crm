# Industry Pack Implementation Status

This page records how the Sweaty Startup research corpus maps to the runtime registry. The candidate inventory and evidence profiles remain authoritative for candidate scope and industry findings; this is an implementation index, not a rewrite of that research.

## Coverage

- The inventory snapshot contains 197 source entries and 194 exact-distinct labels; repeated labels and three linked same-article pairs are mapped as documented in the candidate inventory and synthesis.
- All 191 research profiles map to the source inventory: 151 complete profiles and 40 partial profiles. No candidate is unresearched or excluded as unsuitable.
- All 151 complete profile keys are registered as separate runtime packs. The existing Pet Waste Removal reference pack is also registered, for 152 total runtime packs.
- No partial profile was implemented. Its profile-level scope or evidence limitation remains open and is linked below.

## Runtime implementation boundary

The static registry validates each pack and exposes it through owner onboarding. The selected pack key and version are persisted. The registry contains 152 packs: 151 complete research-derived profiles plus the Pet Waste Removal reference pack. Runtime maturity is tracked separately: the reference pack is `validated`; the other registered packs are `runtime_integrated`, which means compatible shared runtime consumers exist but their industry-specific lifecycles have not all been validated. Unregistered/research-only candidates report `research_only`. `configured` is reserved for a future state where a definition exists without runtime integration; no current registry entry uses that maturity.

The shared runtime consumes pack identity, terminology, service definitions, starting public copy, and standard website-section selections. Public intake renders supported declared location and asset fields (including types, labels, defaults, requiredness, enum options, sensitivity), stores them in shared location/asset records, and rejects undeclared fields. Sensitive values are encrypted in the existing service-access storage and are returned only in an assigned technician job view. Pack field and asset context can feed the existing shared pricing-rule evaluator, but `pricingTemplates` are not themselves translated into or executed as pricing rules.

Technician job views consume pack location/asset metadata, checklists, and noncompletion reasons. The server validates required checklist items and stores a completion-time snapshot with labels, requiredness, results, and pack key/version. Tenant Industry Pack settings support validated overrides for location/asset fields, checklist presentation/requiredness, and recurrence-preset availability; these affect current/future behavior and do not rewrite existing completion or financial history. They do not grant capability entitlements.

Public signup renders supported pack fields and recurrence presets. Signup defaults to office review. Only a pack explicitly configured for recurring activation can take the automatic path, which still requires a valid shared quote, supported recurrence rule, relevant entitlement, and payment configuration; currently that is the Pet Waste Removal reference pack. Service-plan creation checks the selected tenant preset against the pack, translates only the supported recurrence subset (`DAILY`, `WEEKLY`, or `MONTHLY`, interval 1–52; weekday lists only for weekly schedules), and snapshots pack key/version/preset. Unsupported custom rules stay in office review. The Connections experience now surfaces optional connector-capability suggestions for the tenant's selected pack and labels matching connector groups; these suggestions do not install connections or enable product capabilities.

The website still uses one shared page layout; pack copy and standard sections affect rendered content, but `classic`/`fresh` template values do not create distinct layouts. Form-step labels group declared fields, but non-field conceptual steps are not operational. Conditional field behavior and public media upload are not implemented.

The following contract properties remain descriptive or only partially consumed: pack workflow state sequences do not modify shared domain state machines; pack reports do not define executable report queries; inventory defaults do not provision inventory or link material usage to jobs; pricing templates do not execute; industry automation recipes are not generally translated/installed unless they match the existing event/action contract; nonstandard website sections are not rendered; conceptual intake-step keys without a typed field are not rendered. Capability recommendations remain separate from entitlements and do not themselves enable features.

Capability selection remains provider-neutral and reports `commercialTermsConfigured: false`. An owner's explicit capability selection creates an `owner_selection` grant in the current V1 self-service setup; there is no configured price or billing transaction attached to that selection. Commercial packaging and billing must be connected before treating those grants as paid subscriptions.

The research pressure areas around typed measurements with units, versioned approvals and issued records, reservable capacity, project change/milestone controls, and meter-triggered maintenance recurrence are not executable Industry Pack behavior in this pass. Generic fields and descriptive workflow labels do not provide their operational invariants, state transitions, or transactional handling. They remain candidates for separately justified shared-platform work; this implementation did not fabricate those behaviors in pack configuration.

No application-specific database tables or migrations were added for these packs.

## Stable capability keys

Runtime recommendations use keys from the existing stable capability catalog. Candidate profile terms such as `document_management` and `asset_management` are preserved as research concepts but are not emitted as runtime recommendations because the current capability catalog does not define those features. Connector recommendations remain separate from product feature recommendations.

## Implemented complete profiles

- `aquarium-installation`
- `architecture`
- `asphalt-concrete`
- `awning-installation`
- `bartending-catering`
- `beer-line-cleaning-keg-tap-services`
- `biking-tours`
- `boat-cleaning`
- `boat-repair-maintenance`
- `boat-shrink-wrapping`
- `bookkeeping`
- `bridge-painting`
- `business-videography`
- `cabinet-making-refurbishing`
- `carpentry`
- `carpet-cleaning`
- `casino-tables-dealer-rentals-events`
- `catering`
- `chimney-cleaning`
- `civil-engineering`
- `cleaning`
- `college-acceptance-consultation`
- `credit-repair-consulting`
- `custom-closet-build-outs`
- `custom-furniture-refinishing`
- `custom-lighting-installation`
- `custom-wallpaper-installation`
- `deck-staining`
- `decorative-retaining-wall-design-build`
- `deep-kitchen-cleaning`
- `dock-building`
- `dog-underground-fence-installation`
- `door-window-installation`
- `drone-pilot`
- `dumpster-rental-services`
- `efficient-food-truck`
- `egress-window-framing-installation`
- `electrical`
- `epoxy-flooring`
- `event-dj`
- `event-management`
- `event-videography`
- `excavation`
- `exterior-painting`
- `fence-installation`
- `fire-damage-restoration`
- `fireplace-building`
- `firewood-delivery`
- `foundation-repair`
- `garage-door-service`
- `gate-keypad-entry-installation`
- `general-contractor`
- `golf-cart-service-repair`
- `graffiti-removal`
- `green-home-consultation`
- `gutter-cleaning`
- `hiking-tours`
- `home-appliance-repair`
- `home-bar-building`
- `home-cinema-installation`
- `home-deodorization-perfuming`
- `home-office-build-out`
- `house-staging`
- `hunting-dog-training`
- `hunting-guides`
- `hvac-service`
- `hvac-system-cleaning`
- `insulation-installation`
- `interior-design`
- `interior-painting`
- `irrigation-service`
- `irrigation-system-installation`
- `junk-removal`
- `laundry-services`
- `lawn-care-landscaping`
- `limo-transportation-services`
- `linen-washing`
- `locksmith`
- `maid-services`
- `masonry`
- `mirror-installation`
- `mobile-car-detailing`
- `mobile-car-mechanic`
- `mobile-decal-wrap-services`
- `mobile-dent-repair-paintless`
- `mobile-glass-repair`
- `mobile-hair-styling`
- `mobile-haircuts`
- `mobile-headshots`
- `mobile-makeup`
- `mobile-massage`
- `mobile-mechanic`
- `mobile-oil-change`
- `mobile-pedicure-nails`
- `mobile-retail-pop-ups`
- `mobile-tire-service`
- `mold-remediation`
- `moving-services`
- `murphy-bed-building-installation-nyc`
- `off-premise-bartending`
- `on-demand-holiday-decorations`
- `on-demand-junk-removal-hauling`
- `party-rentals`
- `patio-building`
- `personal-style-consulting`
- `pest-control`
- `pet-care-walking-boarding`
- `pet-grooming`
- `pet-training-domestic`
- `photo-booth-rental`
- `photography`
- `plumbing`
- `pool-hot-tub-service`
- `porta-potty-rental-events`
- `porta-potty-rentals-b2b`
- `pressure-washing-concrete-cleaning`
- `privacy-fence-installation`
- `private-investigating`
- `property-management`
- `putting-green-installation`
- `realtor`
- `remote-athletic-coaching`
- `residential-painting`
- `restaurant-deep-cleaning`
- `roofing`
- `rv-boat-winterizing`
- `rv-cleaning`
- `rv-pickup-delivery`
- `sauna-building`
- `secure-package-delivery-box-installation`
- `security-installation`
- `septic-installation`
- `septic-pumping`
- `siding`
- `smart-home-installation`
- `solar-panel-installation`
- `specialty-food-truck`
- `storm-shutter-installation`
- `structural-engineering`
- `surveying`
- `tent-party-rental`
- `thermal-imaging-home-inspection`
- `training-video-creation`
- `tree-care-arborist`
- `trim-staining`
- `trophy-animal-mounting`
- `vacation-rental-management`
- `warehouse-storage-rack-installation`
- `water-damage-remediation`
- `window-cleaning`
- `wine-cellar-building`

## Research-only partial profiles

- [`acoustic-insulation-installation`](./industry-packs/acoustic-insulation-installation.md)
- [`appraiser`](./industry-packs/appraiser.md)
- [`asbestos-removal`](./industry-packs/asbestos-removal.md)
- [`auger-boring`](./industry-packs/auger-boring.md)
- [`building-gun-safes-into-walls`](./industry-packs/building-gun-safes-into-walls.md)
- [`carpet-flooring-installation-refinishing`](./industry-packs/carpet-flooring-installation-refinishing.md)
- [`ceramic-tile-installation`](./industry-packs/ceramic-tile-installation.md)
- [`cistern-water-gatherer-installation`](./industry-packs/cistern-water-gatherer-installation.md)
- [`closet-build-out`](./industry-packs/closet-build-out.md)
- [`commercial-institutional-furniture-installation`](./industry-packs/commercial-institutional-furniture-installation.md)
- [`countertop-epoxy-design`](./industry-packs/countertop-epoxy-design.md)
- [`cubical-building`](./industry-packs/cubical-building.md)
- [`custom-beekeeping-builds`](./industry-packs/custom-beekeeping-builds.md)
- [`customer-service`](./industry-packs/customer-service.md)
- [`elevator-installation-service`](./industry-packs/elevator-installation-service.md)
- [`epoxy-flooring-countertops`](./industry-packs/epoxy-flooring-countertops.md)
- [`equipment-operation`](./industry-packs/equipment-operation.md)
- [`fence-building`](./industry-packs/fence-building.md)
- [`fire-sprinkler-detector-installation`](./industry-packs/fire-sprinkler-detector-installation.md)
- [`hidden-safes-secret-entry-construction`](./industry-packs/hidden-safes-secret-entry-construction.md)
- [`high-end-athletic-coaching-training`](./industry-packs/high-end-athletic-coaching-training.md)
- [`home-sound-room-studio-build`](./industry-packs/home-sound-room-studio-build.md)
- [`home-stairlift-installation`](./industry-packs/home-stairlift-installation.md)
- [`hot-tub-wiring-installation`](./industry-packs/hot-tub-wiring-installation.md)
- [`hurricane-prep-service`](./industry-packs/hurricane-prep-service.md)
- [`lightning-rod-installation`](./industry-packs/lightning-rod-installation.md)
- [`liquidation-services`](./industry-packs/liquidation-services.md)
- [`loan-officer`](./industry-packs/loan-officer.md)
- [`manned-home-security-services`](./industry-packs/manned-home-security-services.md)
- [`mobile-brick-and-mortar`](./industry-packs/mobile-brick-and-mortar.md)
- [`mobile-fencing-festivals-construction-sites`](./industry-packs/mobile-fencing-festivals-construction-sites.md)
- [`on-demand-event-cleanup-crews`](./industry-packs/on-demand-event-cleanup-crews.md)
- [`parking-lot-power-cleaning`](./industry-packs/parking-lot-power-cleaning.md)
- [`pipe-fitting`](./industry-packs/pipe-fitting.md)
- [`pool-safety-alarm-installation`](./industry-packs/pool-safety-alarm-installation.md)
- [`slushy-machine-servicing`](./industry-packs/slushy-machine-servicing.md)
- [`special-needs-pet-training`](./industry-packs/special-needs-pet-training.md)
- [`steam-shower-installation`](./industry-packs/steam-shower-installation.md)
- [`urban-farming-systems`](./industry-packs/urban-farming-systems.md)
- [`welding`](./industry-packs/welding.md)

A profile is intentionally research-only when its own status is `partial`, most often because its candidate scope is ambiguous, independent operator/software evidence is thin, business models under the source label differ materially, or important defaults vary too much by jurisdiction or provider. Read the linked profile for the industry-specific limitation and follow-up questions.
