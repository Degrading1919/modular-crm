# Mobile brick and mortar

## Profile metadata

- **Industry key:** `mobile-brick-and-mortar`
- **Source name:** Mobile brick and mortar (any brick and mortar business, except mobile)
- **Source category:** Retail / Hospitality
- **Candidate source:** [Sweaty Startup candidate list](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Retail / Hospitality, position 3 of 6.
- **Other exact/near duplicate labels:** None established. The wording is internally ambiguous: “mobile” conflicts with “any brick and mortar business, except mobile.”
- **Research date:** 2026-09-24
- **Geographic scope:** General US examples; no single vertical or jurisdiction is defined.
- **Research status:** partial

## Executive summary

The candidate is **not researchable as one distinct business type**. “Brick and mortar” names a sales channel or physical operating presence that spans retail, restaurants, personal services, healthcare, entertainment, and other industries; the parenthetical simultaneously excludes mobile businesses while the label says mobile. These categories have different customers, assets, regulated workflows, scheduling, inventory, and incumbent software.

**Observed evidence:** SBA guidance treats brick-and-mortar as one broad business model category and points to location/zoning and startup cost considerations. Retail POS vendors support storefront checkout, inventory and multi-location records. These sources establish generic physical-premise concerns, not one reusable industry pack. This profile therefore remains partial and recommends resolving the candidate into a specific vertical before implementation.

## Business model and customer segments

- Physical premises alone do not identify what is sold, who buys, or how revenue is earned. Storefront retail may sell stocked goods; restaurants serve food; salons schedule services; clinics manage regulated care. Combining them would falsely imply common purchase and delivery loops.
- Stable shared traits can include a fixed service/sales location, opening hours, staff shifts, facilities/lease records, customer access, local zoning and possibly point-of-sale. They are platform workflow candidates, not industry-specific defaults.
- No single seasonality, customer segment, service area, business size, or repeat-work pattern is justified by the candidate phrase.

## Terminology and durable records

- Generic terms such as business location, operating hours, facility, staff, customer, appointment, order, and transaction are not enough to define durable business assets.
- A physical address may need zoning/use classification, occupancy, lease, utilities, accessibility, parking, opening hours, and emergency contacts. Which fields are material depends on vertical and jurisdiction.
- Persistent product stock is core in retail, ingredients in food service, rooms/equipment in hospitality, and customer/patient assets elsewhere. These cannot be modeled as one asset schema from this label.

## Services, intake, quoting, and booking

- No common service or intake form can be defined. Retail purchases may be walk-in without quote/booking; a restaurant uses menu and table/ordering workflows; an appointment business books capacity; other premises sell memberships or admission.
- Public self-service and human review requirements depend on the actual business. A generic “brick-and-mortar appointment” would be an unjustified assumption.

## Pricing and commercial model

- The label does not specify a saleable service. Rent, utilities, staffing, inventory, and fit-out may be costs, but there is no common customer pricing model.
- No customer prices or software WTP can be responsibly synthesized. Keep software subscription fees separate from product/service revenue if a narrower vertical is later selected.

## Recurrence, scheduling, dispatch, and routing

- Store hours and employee shifts are common at a very abstract level; appointment calendars are not universal. Dispatch/routing can be irrelevant for a fixed shop or central for deliveries, mobile teams, or multi-site operations.
- No universal route, capacity, recurrence, or cancellation behavior is supported.

## Field workflow, safety, completion, and rework

- The fixed facility may require opening/closing, maintenance, cleanliness, security, and emergency tasks, but specific safety, permits, inspections, regulated materials, and completion evidence depend on vertical and local authority.
- SBA states zoning may affect physical business property, while exact applicable licenses and inspections depend on location and activity. Do not encode permit/legal rules as defaults.

## Customer communication and self-service

- Customer needs could include store hours/location, appointment booking, reservations, menu, product availability, patient communications, order status, or membership. There is no single portal/signup flow.
- Communication automations require the actual business type, customer relationship, consent rules, and operational consequence of missed messages.

## Equipment, inventory, suppliers, and workforce

- Physical premises need facilities/fixtures and staffing, but inventory ranges from no goods to thousands of SKUs or perishable food. Staff credentials, shift, payroll and training needs likewise vary.
- No operator complaints or WTP evidence can be aggregated responsibly across unrelated verticals.

## Reporting and operating measures

- Generic measures such as revenue, labor, occupancy, utilization, inventory loss, and customer return are not universally applicable or consistently defined. Choose only after vertical is named.

## Existing software and operator evidence

- **Observed:** SBA describes brick-and-mortar as a business model distinct from online/service businesses and points to property/zoning. Square and Shopify document physical retail POS, locations, sales and inventory features; these are retailer solutions, not universal “brick-and-mortar software.”
- No representative operator community or complaints can be selected without knowing whether this means a store, restaurant, salon, clinic, lodging, or something else. No common vertical stack or willingness-to-pay claim is justified.
- Published POS plan/processing prices are product-specific and can change; they would not establish this candidate's software budget.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Keep industry-neutral; no distinct customer types supported | Phrase names location/channel, not vertical | High |
| `locationFields`, `assets` | Generic business address/location only; facility fields should be chosen by actual vertical | SBA physical property/zoning | Low |
| `services`, `recurrencePresets` | None justified | No specific offering | High |
| `formSteps`, `website` | Do not define industry signup or sales website | No buyer/workflow defined | High |
| `jobChecklist`, `noncompletionReasons`, `workflows` | No industry default; generic open/close/facility checklist only if platform offers it | Vertical-specific | High |
| `pricingTemplates` | None | No customer sale specified | High |
| `defaultAutomations` | None | No universal workflow evidence | High |
| `reports` | None beyond existing platform-level business reporting | KPI definitions vary | High |
| `inventoryDefaults` | None | Could be goods, ingredients or no inventory | High |
| `recommendationQuestions` | First ask business vertical and whether fixed storefront, mobile location, or both | Resolves contradiction and workflow | High |
| `productCapabilityRecommendations` | No vertical recommendation; candidate `fixed_location_operations` key unconfirmed | Not enough evidence to recommend product capabilities | High |
| `recommendedConnectorCapabilities` | None at profile level; determine after vertical/channel clarification | POS/payment/accounting needs vary | High |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `service_scheduling` | conditional | Appointment or service-based business, not general retail | Low |
| `inventory_management` | conditional | Retail/food/stocked-goods operator | Medium |
| `payment_collection` | conditional | Only where the eventual business type handles direct customer payment in the CRM; a POS/payment connector may be sufficient for retail sales | Medium |
| `field_job_tracking` | usually_unnecessary | A fixed location alone does not imply field work | Medium |
| `customer_portal` | unsupported by evidence | No vertical/customer journey established | High |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| A generic fixed business location may be common | Existing shared capability | Current CRM customer/location concepts; exact schema not evaluated | Medium |
| Vertical-specific services, fields, forms, and workflows | Business-specific customization pending scope | Storefront label covers unrelated industries | High |
| Single “brick and mortar” IndustryPack | Not recommended by evidence; candidate requires clarification | No coherent operational loop established | High |
| Core platform gap | No gap established | Broad label cannot prove missing capability | High |

## Evidence, disagreements, and uncertainty

The candidate wording is contradictory and under-specified. **Observed evidence** supports physical premises and broad channel category only. **Inference** that shared location/operating-hour fields may be useful is deliberately weak and should not be treated as a pack scope. It is unknown whether the source author intended conventional storefronts, mobile vendors, or both. This profile is partial by design.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [SBA plan your business](https://www.sba.gov/counseling/plan-your-business/) | US Small Business Administration | Accessed 2026-09-24 | US | Brick-and-mortar business model category, startup planning | General guidance, not industry profile |
| [SBA launch your business](https://www.sba.gov/counseling/launch-your-business/) | US Small Business Administration | Accessed 2026-09-24 | US | Physical property and zoning considerations | General guidance; local rules govern |
| [Square retail inventory tracking](https://api.squareup.com/help/us/en/article/7746-tracking-your-inventory-with-square-for-retail) | POS incumbent primary | Accessed 2026-09-24 | US product docs | Physical retail inventory/POS workflow | Retail example only |
| [Shopify POS](https://help.shopify.com/en/manual/sell-in-person/shopify-pos) | POS incumbent primary | Accessed 2026-09-24 | Product docs | Storefront checkout, locations and channel inventory | Retail example only |

## Handoff to a future pack implementer

Do not implement a dedicated pack until the source owner specifies a vertical (for example, apparel store, convenience store, restaurant, salon, or clinic) and resolves whether “mobile” means a mobile seller or a fixed premises. Then research that vertical's durable records, operational loop, regulatory sources, incumbent stack, pricing and owner evidence independently. In the meantime, keep reusable location, opening-hours, task, and connector behavior in the shared platform only where already supported.
