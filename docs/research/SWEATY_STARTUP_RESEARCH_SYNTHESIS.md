# Sweaty Startup Industry Research Synthesis

**Source snapshot:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), checked 2026-09-24. The candidate page is an inventory source, not evidence that a market is large, profitable, or operationally validated.

## Coverage and evidence status

The snapshot contains **197 raw entries**, or **194 exact-distinct labels** after counting three repeated names once. The corpus has **191 individual profiles**: repeated exact labels and three linked same-article label pairs share profiles only where the profile names both entries and preserves their distinctions. All 197 source entries are mapped. **151 profiles are complete** and cover 157 entries; **40 are partial** and cover 40 entries. No candidate was left unresearched or excluded as unsuitable. The inventory and exact source positions are in [SWEATY_STARTUP_INDUSTRY_CANDIDATES.md](./SWEATY_STARTUP_INDUSTRY_CANDIDATES.md); the individual evidence records are under [industry-packs](./industry-packs/).

“Complete” means the public evidence supports a useful operating profile, not that the segment has been surveyed or its market validated. Partial profiles explain their open scope or evidence limits. Common reasons are an underspecified source label, several non-equivalent business models under one label, thin independent operator or software-use evidence, and local variation in licensing or practice. Partial entries are researched, but should not be treated as complete pack specifications.

## Patterns across industries

| Pattern | Evidence across profiles | Product interpretation for later validation |
|---|---|---|
| The durable record varies by business. | Vehicle and vessel profiles need fitment, serial, hours, service history, and access context ([mobile car mechanic](./industry-packs/mobile-car-mechanic.md), [mobile tire service](./industry-packs/mobile-tire-service.md), [boat repair](./industry-packs/boat-repair-maintenance.md)). Property and rental profiles center on units, temporary sites, and movable assets ([property management](./industry-packs/property-management.md), [photo booth rental](./industry-packs/photo-booth-rental.md), [mobile fencing](./industry-packs/mobile-fencing-festivals-construction-sites.md)). | Industry Packs should configure terminology, location fields, and assets. Some profiles raise asset history, dated reservations, or deployment state as candidates to test against existing shared records; research alone does not prove a core gap. |
| “Book the job” often requires qualification first. | Quotes depend on measurements, photos, condition, access, hazards, water/electrical supply, product fitment, permits, guest count, or a site survey. The intake and human-review boundary differs in [decorative retaining walls](./industry-packs/decorative-retaining-wall-design-build.md), [hot tub wiring](./industry-packs/hot-tub-wiring-installation.md), [catering](./industry-packs/catering.md), and [mobile tire service](./industry-packs/mobile-tire-service.md). | Packs should drive intake and approval questions. Online availability should not promise work that requires a technical or safety review. |
| Scheduling is not one generic calendar. | Evidence spans route-dense recurring service ([maid services](./industry-packs/maid-services.md), [linen washing](./industry-packs/linen-washing.md)), project milestones ([cabinet making](./industry-packs/cabinet-making-refurbishing.md)), appointments and capacity ([hiking tours](./industry-packs/hiking-tours.md)), rental periods and turns ([vacation rental management](./industry-packs/vacation-rental-management.md)), and event or weather windows ([event cleanup](./industry-packs/on-demand-event-cleanup-crews.md), [hurricane preparation](./industry-packs/hurricane-prep-service.md)). | Keep scheduling configuration conditional on recurrence, resources, location, service window, milestones, and customer approval. Similar labels may still need separate workflow research. |
| Pricing is an operator-specific combination of scope and risk. | Profiles identify dimensions/quantity, material and condition, labor/crew, travel, access, urgency, season, equipment, disposal, guest or unit count, contract terms, and add-ons as possible inputs. Deposits, progress billing, guarantees, cancellation, and payment timing vary by buyer and job ([catering](./industry-packs/catering.md), [boat repair](./industry-packs/boat-repair-maintenance.md), [carpet/flooring installation](./industry-packs/carpet-flooring-installation-refinishing.md)). | Prefer tenant-entered pricing and pack-configured dimensions. Do not encode a universal formula from isolated public quotes. |
| Completion evidence and recovery are part of the service. | Photos, customer approval, readings/tests, checklists, condition reports, signatures, punch lists, and noncompletion reasons recur, but the evidence differs for a house clean, a repair, a rental return, an inspection, or an event ([maid services](./industry-packs/maid-services.md), [fire damage restoration](./industry-packs/fire-damage-restoration.md), [boat repair](./industry-packs/boat-repair-maintenance.md)). | Model the required evidence in each Pack and retain history. Do not treat a generic “completed” flag as proof of regulatory compliance or customer acceptance. |
| Crew, inventory, and payroll needs are conditional. | Solo operators, subcontractors, seasonal crews, shop staff, drivers, event workers, and outsourced vendors have different controls. Some jobs consume serial or fitment-specific parts; others rent, stage, or return reusable assets. | Recommend workforce, inventory, and route-related capabilities from onboarding answers and operating model; do not assume every small business needs a full inventory or per-worker commercial model. |

## Operator complaints and willingness-to-pay signals

The strongest recurring complaints in this public corpus are **examples, not prevalence estimates**:

- **Manual handoffs across tools.** Caterers describe BEO/order revisions circulating by print, email, text, or in-person updates, with kitchen and service views drifting ([catering](./industry-packs/catering.md)). Photo booth operators describe WhatsApp, spreadsheets, email, and equipment coordination alongside failures of printers, drivers, and cables ([photo booth rental](./industry-packs/photo-booth-rental.md)).
- **Scheduling and status communication.** Maid-service operator accounts mention recurring schedule and team-access needs, unresolved software bugs/support, and customer reminders; boat owners report delayed updates and difficulty finding repair availability ([maid services](./industry-packs/maid-services.md), [boat repair](./industry-packs/boat-repair-maintenance.md)). These are small, self-selected samples.
- **Cost, caps, and restrictions.** One cleaning operator reports per-user cost as a blocker; one photo-booth operator describes available software as expensive or restrictive ([maid services](./industry-packs/maid-services.md), [photo booth rental](./industry-packs/photo-booth-rental.md)). These anecdotes do not establish a segment-wide price ceiling or justify a particular subscription model.
- **Scope, approval, and rework.** Catering counts and menu changes, cleaning scope disputes, and repair diagnosis/parts approval create repeat communication and history needs ([catering](./industry-packs/catering.md), [maid services](./industry-packs/maid-services.md), [boat repair](./industry-packs/boat-repair-maintenance.md)).

Published incumbent prices in some profiles describe list pricing only. The research found little evidence of realized software spend or systematic willingness to pay. Treat operator pricing signals as questions for owner interviews, not as a basis for capability packaging.

## Core-platform questions, not asserted gaps

Across the profiles, no cross-industry core-platform gap is established solely by this research. Several candidate families deserve implementation-level validation before pack authors add repeated custom conventions:

1. **Versioned approvals and issued records:** signed estimates, customer-approved scope changes, inspection/test reports, sealed professional documents, and durable revision history appear in projects and regulated work ([catering](./industry-packs/catering.md), [civil engineering](./industry-packs/civil-engineering.md), [chimney cleaning](./industry-packs/chimney-cleaning.md)). Confirm that shared documents, permissions, and audit history can preserve exactly what was approved and by whom.
2. **Capacity and dated asset reservation:** tour seats plus correctly sized equipment, rental availability, temporary deployments, and turnover deadlines ([hiking tours](./industry-packs/hiking-tours.md), [party rentals](./industry-packs/party-rentals.md), [mobile fencing](./industry-packs/mobile-fencing-festivals-construction-sites.md)). Test conflict prevention and concurrent booking against the actual scheduling and inventory services.
3. **Project cost and scope control:** material/labor estimates, deposits or progress billing, change authorization, purchase orders, and job-specific cost ([cabinet making](./industry-packs/cabinet-making-refurbishing.md), [catering](./industry-packs/catering.md), [commercial furniture installation](./industry-packs/commercial-institutional-furniture-installation.md)). Existing estimates, invoicing, inventory, workflow, and audit behavior may suffice; validate before proposing a new shared object.
4. **Asset-driven maintenance:** vehicle mileage, engine hours, condition, and site-specific preventive work ([mobile car mechanic](./industry-packs/mobile-car-mechanic.md), [boat repair](./industry-packs/boat-repair-maintenance.md)). Establish whether generic asset fields and date-based recurrence cover real operator needs before treating meter-triggered scheduling as a gap.

These are validation questions, not accepted architecture changes. Pack configuration should remain the default when tenant fields, workflows, services, checklists, and onboarding answers adequately represent a niche. Business-specific legal, technical, or production systems may remain external or tenant-defined.

## Differentiated and similar candidates

### Especially differentiated

- [Fire damage restoration](./industry-packs/fire-damage-restoration.md): emergency mitigation, contents handling, insurance documentation, reconstruction, and occupant conditions create a distinct multi-party lifecycle.
- [Septic pumping](./industry-packs/septic-pumping.md) and [septic installation](./industry-packs/septic-installation.md): one is route/asset-maintenance work, the other is a site and construction project.
- [Civil engineering](./industry-packs/civil-engineering.md) and other regulated professional services: credential scope, approved deliverables, and issued-record integrity differ from ordinary work orders.
- [Catering](./industry-packs/catering.md), [photo booth rental](./industry-packs/photo-booth-rental.md), [tour operations](./industry-packs/hiking-tours.md), and [property turnover](./industry-packs/vacation-rental-management.md): date-bound capacity, guest/customer promises, reusable assets, and deadline-specific staffing are central in different ways.
- Vehicle candidates remain differentiated by service inputs and safety/evidence: [mobile car mechanic](./industry-packs/mobile-car-mechanic.md), [mobile oil change](./industry-packs/mobile-oil-change.md), [mobile tire service](./industry-packs/mobile-tire-service.md), and [mobile glass repair](./industry-packs/mobile-glass-repair.md).

### Similar, but researched independently

- Cleaning candidates include [maid services](./industry-packs/maid-services.md), [carpet cleaning](./industry-packs/carpet-cleaning.md), [deep kitchen cleaning](./industry-packs/deep-kitchen-cleaning.md), and [restaurant deep cleaning](./industry-packs/restaurant-deep-cleaning.md). They differ in scope, recurrence, surface/equipment, site access, food-safety context, and completion evidence.
- Carpentry and installation candidates include [carpentry](./industry-packs/carpentry.md), [cabinet making](./industry-packs/cabinet-making-refurbishing.md), [closet build-out](./industry-packs/closet-build-out.md), [fence building](./industry-packs/fence-building.md), [fence installation](./industry-packs/fence-installation.md), and [custom closet build-outs](./industry-packs/custom-closet-build-outs.md). Fabrication, measurement, permit responsibility, and installation-only models remain open differences.
- Movement and waste candidates include [moving services](./industry-packs/moving-services.md), [junk removal](./industry-packs/junk-removal.md), [on-demand hauling](./industry-packs/on-demand-junk-removal-hauling.md), and [liquidation services](./industry-packs/liquidation-services.md). Customer-owned goods, discarded materials, and resale inventory imply different records and custody.
- Rental candidates include [party rentals](./industry-packs/party-rentals.md), [tent/party rental](./industry-packs/tent-party-rental.md), [photo booth rental](./industry-packs/photo-booth-rental.md), [event porta-potty rental](./industry-packs/porta-potty-rental-events.md), and [B2B porta-potty rentals](./industry-packs/porta-potty-rentals-b2b.md). Asset type, servicing, delivery, cleaning, event timing, and contract term differ.

The candidates may later become separate Packs, variants, or no Pack. Similarity is evidence for later comparison, not a reason to erase profiles now.

## Research template weaknesses

- The template is thorough and prompts explicit evidence, uncertainty, contract mapping, and implementation handoff. Its source rule asks for four independent industry sources and an operator voice when practical, but it does not define independence well enough to distinguish four pages from one publisher from four independent evidence sources.
- The source log names claims supported, but the narrative does not require stable per-claim citation markers. A later reviewer can still have to infer which cited row supports a particular assertion.
- `complete` / `partial` is an honest but coarse status. It does not separately record scope confidence, operator-voice coverage, incumbent coverage, regulation coverage, or a prioritized next-research action. Some uncertainty is therefore embedded in prose and repeated in the handoff.
- Public sources rarely reveal representative software spend, adoption, or operator complaints. The template correctly permits uncertainty, but future research should not equate a vendor feature page or list price with operator demand.

## IndustryPack abstraction observations

The current contract usefully separates Pack recommendations from commercial entitlement and connector recommendations. It exposes configurable fields, assets, services, recurrence presets, forms, checklists, workflows, automations, reports, pricing templates, and onboarding questions. That gives profile authors a concrete shared vocabulary and discourages a separate CRM per niche.

The profile corpus also exposes limits to test before accepting repeated workarounds:

- `PackField` supports primitive text, number, boolean, date, enum, media, and location values, but has no declared units, typed measurement sets, repeatable groups, source/provenance, or explicit revision semantics.
- `PackService.kind` has four values; the contract does not name projects, reservations, rentals, inspections, or milestone work as distinct service lifecycles. They may be representable through configuration, but that has not been demonstrated across packs.
- Workflows and checklist items are strings/simple required flags; they do not express conditional, ordered, approval, evidence, or resource-capacity semantics directly. Pricing template `effect` and report `coreMetric` are strings rather than typed rules/formulas.
- Inventory defaults describe names and units, not serial history, condition, warehouse position, dated allocation, supplier ETA, or return/inspection cycles. Generic assets and workflows may still suffice for some businesses.
- Product capability feature keys are open strings, while connector capabilities use a current fixed key list. This is flexible but creates spelling and taxonomy drift risk. Profiles should reuse known keys and explicitly label unconfirmed candidates.
- Only the Pet Waste Removal Pack is currently registered at runtime. Research profiles cannot prove that other niches work end to end, and candidate details should not be turned into platform gaps until actual shared behavior is exercised.

These are abstraction observations for later implementation and audit, not instructions to expand the contract now. Test representative workflows against the runtime before proposing a new primitive.

## Preservation note

The strongest result is the independent research of similar candidates before consolidation, paired with explicit uncertainty and a default preference for Pack configuration over core-platform expansion. Preserve that discipline when profiles become implementation work orders. The complete evidence remains in each profile's source log; this synthesis is a navigation and comparison aid, not a replacement for those sources.
