# Personal style consulting

## Profile metadata

- **Industry key:** personal-style-consulting
- **Source name:** Personal style consulting
- **Source category:** Training / Coaching / Consulting
- **Candidate source:** [Sweaty Startup candidate inventory](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Training / Coaching / Consulting, position 8 of 8.
- **Other exact/near duplicate labels:** Image consulting and personal styling overlap; no shared candidate article establishes aliasing. Keep candidate distinct pending scope.
- **Research date:** 2026-09-24
- **Geographic scope:** UK operator examples and international professional association; service norms vary.
- **Research status:** complete

## Executive summary

**Observed evidence:** Personal style/image consultants sell an advisory service that can include style discovery, wardrobe audit, color/body-shape analysis, outfit planning, personal shopping, digital lookbooks, and seasonal refreshes. Some work in a client's home, some virtually, and some accompany shopping. AICI defines the broader image-consulting profession and maintains ethics guidance around fees/conflicts; individual consultants offer fixed-duration packages and price lists.

**Inference:** Workflow: discovery and client preferences → consultation/measurements/wardrobe review → agreed style brief and budget → outfit/lookbook or shopping plan → optional shopping/wardrobe session → follow-up/seasonal refresh. This is project/advisory work with a low fit to field-service CRM. Personal photographs, sizes, budgets and identity preferences require discretion.

## Business model and customer segments

- Consumers may seek wardrobe refresh, life/career transition, event style, capsule wardrobe, shopping assistance, or personal branding. Corporate/executive image work is an adjacent B2B service but not the same buyer.
- One-off sessions can lead to seasonal refreshes or ongoing shopping support. Virtual and in-person models have different geography and time needs.
- Solo consultant, personal shopper, stylist team and fashion retailer partnership may have different referral/commission arrangements; disclose conflicts.

## Terminology and durable records

- Records: client, style goals, context/occasion, preferences, wardrobe audit/inventory, measurements/sizes, color/style notes, budget, outfit/lookbook, shopping list, session, follow-up and consented images.
- In-home closet, shop/retail route, studio or virtual meeting are possible locations. Wardrobe items belong to client; do not track as operator inventory. Optional wardrobe catalog is a customer-facing artifact.
- Photos, size/body data, identity/cultural preferences and budgets are personal. Explicit consent is needed for images/marketing; limit access and retention.

## Services, intake, quoting, and booking

- Intake: goals, use cases/lifestyle, budget, existing wardrobe, fit/accessibility preferences, sizes if required, preferred brands, shopping constraints, location/virtual choice and image consent.
- Public service packages include wardrobe consultations, closet reset, personal shopping, style/image consultations, digital lookbooks and yearly/seasonal plans. Example price list: one London image consultant lists a 3-hour wardrobe consultation from £450; another UK provider lists wardrobe edit at £50/hour plus travel. These are operator-specific service prices.
- Quote by duration, prep/research, wardrobe size, shopping trip, travel, sourcing and deliverable. For purchases, separate stylist fee from clothes budget and retailer commission.

## Pricing and commercial model

- **Observed prices:** £450 starting price for three-hour medium wardrobe consultation from a London provider; £50/hour plus travel from one East Sussex consultant (accessed 2026-09-24). Distinct providers and scopes; not a market average.
- Other operators offer packages rather than hourly billing; travel, shopping accompaniment, number of lookbook outfits and seasonal follow-up can alter price.
- No direct software WTP evidence. Service rates are not software subscription prices.

## Recurrence, scheduling, dispatch, and routing

- Consultations, home wardrobe work and shopping appointments need calendar blocks; preparation and sourcing work may happen asynchronously before the visit.
- Route matters only for home visits or escorted shopping; virtual clients may be international/time-zone based. Shopping availability and returns affect rework.
- Seasonal refresh or life-change follow-up is optional, not universal recurrence.

## Field workflow, safety, completion, and rework

- Discovery → agree goals/budget/privacy → review current wardrobe or style inputs → consultation → create recommendations/lookbook → optionally shop or edit closet → confirm deliverables and next steps.
- Capture client preference, source links, sizes and shopping budget; do not represent consultant taste as objective or guarantee confidence/acceptance outcomes. Rework includes unavailable product, fit/return, changed budget or client preference.
- No regulated permit or field safety requirement established beyond normal home-visit policy and image/privacy consent.

## Customer communication and self-service

- Client needs appointment prep, clothing/photo request, budget agreement, links/lookbook, purchase/return notes and follow-up. Self-service intake and digital deliverables are appropriate; styling decisions remain collaborative.
- Personal photographs must not be published/shared without consent. Automated shopping recommendations should be reviewed and avoid unauthorized purchases.

## Equipment, inventory, suppliers, and workforce

- Consultant may use measuring tools, camera, closet inventory/lookbook, shopping platform and transport. No owned product inventory necessary; if goods are resold, that is a different retail model.
- Track stylist expertise and referral relationships. Associations provide professional ethics; no universal license is established.

## Reporting and operating measures

- Useful measures: inquiry-to-consult, prep hours, session duration, deliverable turnaround, shopping conversion/returns, repeat seasonal refresh, client satisfaction and referral. These are proposed rather than incumbent benchmark measures.

## Existing software and operator evidence

- AICI describes image consulting and professional conduct; personal stylists advertise packages and price lists. No dominant CRM or repeated stylist-owner complaint source found. Likely supporting tools include calendar, forms, client photo/file share, email, shopping links and invoicing; not verified universal stack.
- No operator software pricing/WTP found. Public service price pages do not establish what a stylist will pay for CRM.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| terminology, customerTypes | Client, style consultation, wardrobe review, lookbook, shopping appointment | Operator menus | Medium |
| locationFields, assets | Home/studio/shopping route or virtual; client-owned wardrobe items | Service delivery | Medium |
| services, recurrencePresets | Style consultation, wardrobe edit, personal shopping, seasonal refresh | Operator offers | High |
| formSteps, website | Goal, budget, occasion, size/preferences, location, photo consent | Intake/privacy inference | Medium |
| jobChecklist, noncompletionReasons, workflows | Prep, consult, lookbook delivery, shopping/returns, follow-up | Project lifecycle | Medium |
| pricingTemplates | Session duration + travel/prep/shopping and deliverable package | Published rates | Medium |
| defaultAutomations | Appointment prep, deliverable reminder, optional refresh | Workflow inference | Low |
| reports | Project margin, prep time, deliverable turnaround, repeat/return | Useful but not observed incumbent metrics | Low |
| inventoryDefaults | None; client wardrobe is not business stock | Ownership distinction | High |
| recommendationQuestions | Virtual/in-person? wardrobe audit? shopping? resale/commission? image consent? | Defines scope and conflict handling | High |
| productCapabilityRecommendations | service_scheduling, estimate_management, document_management; wardrobe_catalog is unconfirmed candidate key | Appointment and client deliverables | Medium |
| recommendedConnectorCapabilities | calendar, email, sms, storage, payments | Scheduling, lookbooks, photos and billing | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| service_scheduling | normally_recommended | Consults, home visits and shopping sessions | High |
| estimate_management | optional | Custom package and travel/prep quote | Medium |
| document_management | normally_recommended | Lookbooks, photo consent and shopping links | Medium |
| customer_portal | optional | Client access to wardrobe/lookbook deliverables | Low |
| field_job_tracking | usually_unnecessary | Small advisory visits, not technician dispatch | High |
| inventory_management | usually_unnecessary | Wardrobe belongs to client | High |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Consultation packages and deliverable follow-up | Pack configuration | Operator service offers | Medium |
| Customer, schedule, documents, estimate/invoice | Existing shared capability | Current contract | Medium |
| Client wardrobe catalog and outfit planning | Business-specific customization or adjacent consumer product | Specialized stylist workflow | Medium |
| Core gap | No gap established | Current sources do not show shared tools are inadequate | High |

## Evidence, disagreements, and uncertainty

Evidence is medium for service menu and pricing examples, high for professional ethical framework, low for software stack/WTP. “Personal style consulting” may be virtual coaching, image consulting, personal shopping, wardrobe organization, or retail resale; scope should be clarified at onboarding.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [AICI image consulting](https://www.aici.org/page/Image_Consulting) | Professional association | Accessed 2026-09-24 | International | Image consulting scope and professional context | Association description |
| [AICI Code of Ethics](https://www.aici.org/page/coe-handbook-text) | Professional association | Accessed 2026-09-24 | International | Fees, conflicts and ethical practice | Applies to members |
| [Talking Image consultation](https://talkingimage.co.uk/en/image-consultation/) | Operator | Accessed 2026-09-24 | UK | Consultation, wardrobe and annual-plan services | Single consultant |
| [Davidson Image and Style pricing](https://stylemanagement.co.uk/pricing/) | Operator | Accessed 2026-09-24 | London, UK | Example fixed-duration price | One provider; rates change |
| [Alison Brown price list](https://alisonbrown.uk/prices-for-wardrobe-consultant/) | Operator | Accessed 2026-09-24 | East Sussex, UK | Hourly wardrobe edit plus travel | One provider |
| [Stylist rates discussion](https://www.reddit.com/r/NYCbitcheswithtaste/comments/1qtqb81/nyc_personal_stylist_rates_expectations/) | Stylist/community | Accessed 2026-09-24 | NYC anecdotal | Service scope and pricing uncertainty | Informal discussion, no market benchmark |

## Handoff to a future pack implementer

Ask virtual vs in-person, home wardrobe audit, personal shopping, reselling/commission, deliverables, image consent and client data preferences. Prototype consultation scheduling and secure style brief/lookbook delivery; do not create inventory defaults for client clothing. Treat client aesthetic choices as subjective and keep purchases under explicit approval.
