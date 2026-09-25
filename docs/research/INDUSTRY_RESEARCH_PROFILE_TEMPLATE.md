# Industry Research Profile Template

Use this template to research a prospective Modular CRM Industry Pack before implementation.

The purpose of this artifact is to preserve the evidence behind an Industry Pack, distinguish observed industry behavior from inference, and produce an implementation-ready mapping into the runtime `IndustryPack` contract.

## Output location

Create one completed profile per industry at:

`docs/research/industry-packs/<industry-key>.md`

Use a stable kebab-case industry key that can later become the Industry Pack key when appropriate.

This research profile is an evidence artifact. It does not grant product entitlement, define final pricing, or become authoritative runtime behavior until the relevant product decisions are accepted and implemented.

## Existing corpus and completion standard

The 191 profiles already in `docs/research/industry-packs/` use the earlier compact form of this template. They remain valid research records; do not mass-reformat them merely to match this more detailed prompt. Their sections map to this template as follows: metadata and executive summary to Industry identity/summary; terminology and durable records to 2–4; services, intake, pricing, recurrence, and field work to 5–12; communications, inventory, workforce, reporting, and growth to 13–18; capability and connector mapping to 19–20; evidence, core-gap classification, and handoff to 21–27.

For candidates from a source list, retain the exact source category, label, and 1-based position in profile metadata, and explicitly name any related or linked-label entries covered by the profile. A candidate list establishes the research pool; it does not count as industry evidence.

Use `complete` only when the material workflow and product-fit claims have sufficient evidence. Target at least four independent industry sources from at least three independent publishers/domains, including an operator voice and a primary industry, incumbent, manufacturer, or regulator source when practical. If that evidence or a coherent candidate scope is unavailable, mark the profile `partial`, explain why, and identify the research needed to close it. Do not count several pages from one vendor as independent evidence.

Use the existing IndustryPack feature keys when they fit. Capability recommendation values are `normally_recommended`, `optional`, `usually_unnecessary`, or `conditional`; keep connector capabilities separate and use current keys from the runtime contract. A candidate feature with no stable key must be explicitly labeled unconfirmed, not presented as an implemented capability. Research recommendations do not grant entitlement or change accepted product decisions.

---

# Research rules

## Evidence standard

Research the industry from several source types where available:

- owner/operator communities and forums
- current software reviews and complaint threads
- incumbent and niche-software product documentation
- industry associations
- manufacturer/vendor documentation
- government or regulatory sources when requirements matter
- service-business websites, pricing pages, intake forms, and customer FAQs
- job postings or technician training material when they reveal real workflow
- credible trade publications

Prefer direct evidence of how businesses actually operate over generic CRM advice.

For meaningful claims:

- provide source links
- record the date accessed when freshness matters
- distinguish facts from interpretation
- use multiple independent sources for contested or highly variable practices
- do not convert one company's workflow into an industry-wide rule without evidence
- explicitly record regional, company-size, residential/commercial, or specialty differences
- mark unknowns instead of inventing a convenient answer

## Confidence labels

Use:

- **High** — repeatedly observed across strong independent sources or supported by authoritative documentation
- **Medium** — supported by credible evidence but variable, incomplete, or based on a smaller sample
- **Low** — plausible inference or weak/limited evidence requiring validation

Every major section should state confidence where the conclusion materially affects pack behavior.

## Core-platform discipline

Do not assume every industry difference requires core code.

Classify each discovered requirement as one of:

- **Industry Pack configuration** — can be represented through the existing pack/data-driven system
- **Existing core capability configuration** — already supported by the horizontal platform but not necessarily represented directly in the pack
- **Candidate core-platform gap** — a real workflow that cannot be represented cleanly without changing shared platform behavior
- **Business-specific customization** — too company-specific to become an Industry Pack default

A core-platform gap requires evidence. Do not propose new shared architecture merely because a niche uses different terminology.

---

# 1. Industry identity

- **Industry key:**
- **Industry display name:**
- **Research date:**
- **Researcher/model:**
- **Primary business model:**
- **Typical customer types:**
- **Typical company sizes observed:**
- **Residential/commercial split:**
- **Common specialties/subsegments:**
- **Seasonality:**
- **Geographic/regulatory variation worth modeling:**
- **Overall confidence:**

## Industry summary

Describe how a typical business makes money, what work it performs, how work reaches the schedule, and what operational constraints distinguish it from a generic service business.

## Important variants

Record variants that may require conditional defaults rather than separate Industry Packs.

| Variant | What changes operationally | Pack implication | Confidence |
| --- | --- | --- | --- |
|  |  |  |  |

---

# 2. Terminology

Identify language that should make the CRM feel native to the industry.

| Core concept | Industry-default label | Alternatives observed | Evidence / notes | Confidence |
| --- | --- | --- | --- | --- |
| Customer |  |  |  |  |
| Service Location |  |  |  |  |
| Customer Asset |  |  |  |  |
| Work Area |  |  |  |  |
| Job |  |  |  |  |
| Service Plan |  |  |  |  |
| Field Technician |  |  |  |  |

Add concepts only when they represent meaningful industry language.

### Runtime mapping

Target: `IndustryPack.terminology`

---

# 3. Customer and service-location model

## Customer structure

Research:

- residential vs commercial relationships
- property managers, HOAs, facilities, builders, landlords, fleets, or other account structures
- multiple contacts
- billing contact vs onsite contact
- parent/child customer relationships
- purchase orders, account numbers, net terms, or contract references
- whether one customer commonly owns/manages multiple service locations

## Service-location fields

List information that technicians, office staff, pricing, routing, or reporting genuinely need.

| Key | Label | Type | Required? | Sensitive? | Customer visible? | Reportable? | Why it matters | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |

Supported runtime field types currently include:

`text | number | boolean | date | enum | media | location`

### Runtime mapping

Target: `IndustryPack.locationFields`

---

# 4. Customer-owned assets / service objects

Identify persistent things associated with a customer or location that jobs operate on.

Examples could include an appliance, vehicle, septic system, HVAC unit, pool, tree, lawn zone, hood system, piece of equipment, or pet.

For each asset:

## Asset: <name>

- **Key:**
- **Singular label:**
- **Plural label:**
- **Why it should be persistent rather than job-only data:**
- **Confidence:**

| Field key | Label | Type | Required? | Sensitive? | Customer visible? | Reportable? | Options/default | Evidence / rationale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |

### Runtime mapping

Target: `IndustryPack.assets[]`

---

# 5. Services and revenue model

Inventory the services operators actually sell.

| Service key | Customer-facing name | Kind | Typical duration | Usually enabled? | Common pricing basis | Notes | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  | recurring / one_time / add_on / recovery |  |  |  |  |  |

Research:

- core recurring services
- one-time services
- inspections/diagnostics
- emergency work
- add-ons
- recovery/rework/warranty visits
- membership/maintenance plans
- commercial contract work
- services that commonly lead to follow-up work

### Runtime mapping

Target: `IndustryPack.services`

---

# 6. Recurrence and scheduling behavior

## Recurrence patterns

| Key | Customer-facing label | Typical recurrence | RRULE candidate | Common use | Confidence |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Scheduling model

Research whether the industry usually operates by:

- exact appointment
- arrival window
- service day
- route day
- on-demand dispatch
- project phase
- recurring route
- emergency priority
- return visit after parts/material arrival

Record:

- typical lead time
- technician/crew assignment constraints
- skill/certification matching
- equipment/vehicle constraints
- customer time-window constraints
- weather sensitivity
- geographic density importance
- locked/priority stops
- estimated-duration drivers

## Routing importance

- **Importance:** High / Medium / Low / Usually unnecessary
- **Why:**
- **When it becomes important:**
- **Confidence:**

### Runtime mapping

Target: `IndustryPack.recurrencePresets`, routing assumptions, recommendation questions, and capability recommendations.

---

# 7. Lead, estimate, booking, and conversion flow

Describe the paths from prospect to paid work.

Research:

- where leads commonly come from
- whether online booking is realistic
- whether a quote/estimate is normally required
- whether estimates can be remote or require inspection/diagnosis
- deposits
- financing
- service-area eligibility
- price confidence vs quote-required behavior
- contract/signature requirements
- recurring-plan enrollment
- what causes manual review

## Common lifecycle paths

Document the dominant paths, for example:

`Website request -> Estimate -> Approval -> Schedule -> Job`

or

`Online booking -> Payment method -> Recurring plan -> Job generation`

Include alternate paths where materially common.

---

# 8. Pricing model

Identify pricing dimensions rather than attempting to establish final tenant prices.

| Pricing dimension | What it changes | Common in industry? | Pack field/input needed | Evidence | Confidence |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

Research potential dimensions such as:

- service type
- asset type/size/count
- labor time
- frequency
- property size
- distance/zone
- condition/severity
- parts/materials
- disposal
- equipment usage
- emergency/after-hours
- minimum visit
- commercial volume
- add-ons
- discounts/promotions
- taxes/fees

## Pricing templates

| Key | Name | Stage | Input fields | Intended effect | Tenant amount required? | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
|  |  | base / quantity / zone / add_on / promotion / bounds |  |  |  |  |

### Runtime mapping

Target: `IndustryPack.pricingTemplates`

Do not hard-code market prices into the pack unless the product explicitly decides to provide market guidance separately.

---

# 9. Public website and onboarding

## Website priorities

What must a prospective customer understand before converting?

- primary value proposition
- major trust signals
- licensing/insurance claims where relevant
- service area
- services
- pricing guidance
- before/after proof
- reviews
- FAQs
- emergency availability
- warranties/guarantees
- financing
- booking or quote CTA

## Recommended website sections

Ordered list:

1.
2.
3.

## Signup / request flow

Define the minimum customer-facing steps and fields needed for a qualified lead or self-service signup.

| Step key | Customer-facing label | Fields/data collected | Can be skipped conditionally? | Why |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Default hero

- **Headline direction:**
- **Description direction:**

### Runtime mapping

Target: `IndustryPack.formSteps` and `IndustryPack.website`

---

# 10. Field workflow

Describe what a technician or crew actually does from arrival through completion.

## Default checklist

| Key | Technician-facing label | Required by default? | Why | Evidence / confidence |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

Research:

- required pre-work inspection
- safety checks
- access information
- diagnosis
- measurements
- photos/video
- materials/parts
- customer signature
- regulatory forms
- before/after proof
- technician notes
- upsell opportunities
- completion conditions

### Runtime mapping

Target: `IndustryPack.jobChecklist`

---

# 11. Noncompletion, return visits, and recovery

Identify reasons work cannot be completed and whether they are normally billable.

| Key | Customer-facing/office label | Billable by default? | Typical next step | Confidence |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

Research:

- no access
- customer no-show
- unsafe conditions
- weather
- parts/material unavailable
- wrong diagnosis
- permit/regulatory issue
- equipment failure
- technician issue
- property/site condition
- warranty/rework
- follow-up inspection

Describe how the original job and follow-up should relate historically.

### Runtime mapping

Target: `IndustryPack.noncompletionReasons`, services of kind `recovery`, and workflows.

---

# 12. Workflow/state requirements

Identify industry-specific workflow sequences that should be expressed through configuration rather than new core state machines where possible.

| Workflow key | Typical stages | Trigger/entry point | Exit/outcome | Notes |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

Flag any workflow that the current core state model cannot represent cleanly.

### Runtime mapping

Target: `IndustryPack.workflows`

---

# 13. Communications and automation

## Common customer communications

Research the messages customers actually expect:

- booking confirmation
- estimate sent
- estimate reminder
- appointment reminder
- technician en route
- delay/reschedule
- job completion
- proof/report
- invoice/receipt
- failed payment
- maintenance reminder
- review request
- warranty/follow-up

## Default automation candidates

| Source key | Name | Trigger/event | Filters/conditions | Actions | Default enabled? | Evidence / rationale |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

Only propose automations that can use emitted domain events and supported actions, or explicitly flag the required core gap.

### Runtime mapping

Target: `IndustryPack.defaultAutomations`

---

# 14. Customer portal requirements

Research what customers reasonably need to view or change themselves.

| Portal capability | Essential / useful / unnecessary | Conditions | Evidence / rationale |
| --- | --- | --- | --- |
|  |  |  |  |

Consider:

- upcoming appointments
- service history
- completion proof
- asset information
- estimates
- invoices/payments
- saved payment method
- plan/membership details
- pause/reschedule/cancel
- support/rework
- documents
- photos
- notification preferences
- service-location/access information

Record which changes require office approval.

---

# 15. Inventory, parts, equipment, and procurement

## Inventory relevance

- **Importance:** High / Medium / Low / Usually unnecessary
- **Why:**
- **Confidence:**

## Default inventory items

| Key | Name | Unit | Technician-carried? | Reorder importance | Notes |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

Research:

- serialized parts
- consumables
- truck stock
- warehouse stock
- special-order parts
- purchase orders
- vendor relationships
- return/core charges
- material usage tied to jobs

### Runtime mapping

Target: `IndustryPack.inventoryDefaults` plus capability recommendations.

---

# 16. Employees, time, payroll, and permissions

Research:

- owner-operator prevalence
- technician/crew structure
- office/dispatcher roles
- crew leaders
- subcontractors
- salespeople/estimators
- certification-restricted work
- time-clock expectations
- job time vs shift time
- mileage
- commission/bonus/tips
- piece-rate or per-job compensation

Record implications for:

- default capability recommendations
- role visibility
- field-user economics
- future role templates

Do not assume each worker is a paid software seat.

---

# 17. Reporting and KPIs

Identify metrics owners actually use to run this type of business.

| Report key | Report name | Core metric | Dimensions | Why operators care | Evidence / confidence |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

Consider:

- revenue/collection
- recurring revenue
- customer growth/churn
- estimate conversion
- utilization
- jobs/hour
- revenue/hour
- route density
- first-time-fix rate
- return/rework rate
- average ticket
- material usage
- technician performance
- service-plan renewal
- asset age/type
- lead source
- seasonality
- location profitability

### Runtime mapping

Target: `IndustryPack.reports`

---

# 18. Multi-location, franchise, and growth-stage behavior

Research when the operating model changes as the company grows.

| Business stage | What changes operationally | Capabilities that become important |
| --- | --- | --- |
| Owner-operator |  |  |
| Small team |  |  |
| Multi-crew |  |  |
| Multi-location |  |  |
| Franchise / large regional |  |  |

Record whether franchise or branch-level defaults are genuinely relevant.

---

# 19. Capability recommendation model

Research the minimum practical stack for this industry rather than recommending every available feature.

## Onboarding questions

Only include questions whose answers can materially change the recommended stack.

| Key | Plain-language prompt | Answer type | Options if enum | What recommendation it changes |
| --- | --- | --- | --- | --- |
|  |  | boolean / number / enum |  |  |

## Capability recommendations

Use only stable feature keys that exist in the platform capability catalog.

| Feature key | Default recommendation | Rationale | Conditional rule | Growth-stage note | Confidence |
| --- | --- | --- | --- | --- | --- |
|  | normally_recommended / optional / usually_unnecessary / conditional |  |  |  |  |

Distinguish product capabilities from connector capabilities.

### Runtime mapping

Targets:

- `IndustryPack.recommendationQuestions`
- `IndustryPack.productCapabilityRecommendations`

---

# 20. Connector requirements

Determine what external functions matter, not which provider must be used.

Current connector-capability keys include:

- payments
- email
- sms
- accounting
- calendar
- routing
- geocoding
- storage
- payroll
- crm_import
- ai

| Connector capability | Recommended? | Why | Common providers observed | Industry-specific requirement? |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

### Runtime mapping

Target: `IndustryPack.recommendedConnectorCapabilities`

Do not hard-code a provider into core product behavior.

---

# 21. Current software stack and competitors

## Major incumbent products

| Product | Target customer | Strengths for this industry | Common complaints / gaps | Pricing/packaging observations | Sources |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

Include both generic field-service/CRM products and niche-specific software where relevant.

## Common stitched-together stack

What do operators use when one product does not cover the workflow?

Examples:

- CRM
- scheduling
- invoicing
- accounting
- spreadsheets
- forms
- maps
- texting
- inventory
- payroll
- website/booking

This helps identify where Modular CRM can reduce tool sprawl.

---

# 22. Operator complaints and unmet needs

Record repeated complaints rather than isolated preferences.

| Problem / complaint | Who experiences it | Existing workaround | Frequency of evidence | Modular CRM implication | Sources |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

Specifically look for:

- excessive CRM complexity
- paying for unused features
- poor mobile UX
- weak recurrence
- routing limitations
- pricing model limitations
- missing industry fields
- duplicate data entry
- accounting/payment pain
- customer communication pain
- inventory/parts friction
- reporting gaps
- migration/import pain
- per-seat pricing complaints

---

# 23. Willingness to pay and packaging signal

Do not invent a final price.

Research evidence that helps product packaging:

- current software spend
- competitor price ranges and pricing units
- per-user sensitivity
- job/volume-based pricing
- add-on purchasing behavior
- willingness to pay for niche-specific automation
- tools operators pay for separately today

## Capability value signals

| Capability group | Evidence of willingness to pay | Price sensitivity | Notes / sources | Confidence |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

---

# 24. Core-platform gap analysis

This is one of the most important outputs.

For every workflow that does not fit the current platform cleanly:

| Requirement | Evidence it is common/important | Why existing core + pack cannot model it | Proposed classification | Suggested direction | Confidence |
| --- | --- | --- | --- | --- | --- |
|  |  |  | Industry Pack / existing core config / candidate core gap / business-specific |  |  |

Do not solve candidate core gaps in this research artifact. Document them for architectural review.

A prospective Industry Pack is especially valuable when it exposes a reusable gap shared by several industries.

---

# 25. Proposed Industry Pack mapping

Produce an implementation-ready summary after the research is complete.

## Identity

- `key`:
- `version`: initial recommendation
- `displayName`:
- `customerTypes`:

## Runtime sections

Summarize the proposed values for:

- `terminology`
- `locationFields`
- `assets`
- `services`
- `recurrencePresets`
- `formSteps`
- `jobChecklist`
- `noncompletionReasons`
- `workflows`
- `defaultAutomations`
- `reports`
- `pricingTemplates`
- `recommendationQuestions`
- `productCapabilityRecommendations`
- `recommendedConnectorCapabilities`
- `inventoryDefaults`
- `website`

Do not generate TypeScript in the research profile unless specifically requested. The profile should be reviewable by a human or implementation agent before conversion to runtime code.

---

# 26. Validation summary

## What appears to fit the existing platform well

-

## What requires conditional Industry Pack behavior

-

## Candidate core-platform gaps

-

## Business-specific behavior that should NOT become a pack default

-

## Highest-risk assumptions requiring owner/operator validation

-

## Recommended next step

Choose one:

- Ready to implement as an Industry Pack
- Ready after targeted follow-up research
- Requires core-platform decision before implementation
- Poor fit / insufficient evidence

Explain briefly.

---

# 27. Sources

Maintain a source register so later agents can revisit evidence without repeating the research.

| # | Source | Type | Date/accessed | What it supports | Reliability / caveat |
| --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |

---

# Worker completion standard

A research worker is not finished because every heading contains text.

A completed profile should:

1. explain how the industry actually operates;
2. provide evidence for material workflow claims;
3. identify the minimum, optional, and growth-stage capability stack;
4. capture niche workflows generic CRMs fail to model well;
5. document the current software/tool stack and repeated operator complaints;
6. map research findings into every relevant `IndustryPack` field;
7. explicitly mark irrelevant runtime fields rather than inventing content;
8. identify genuine core-platform gaps separately from Industry Pack configuration;
9. preserve uncertainty and conflicting practices;
10. be detailed enough that an implementation agent can create the pack without conducting the industry research again.

The goal is not to make every Industry Pack large.

The goal is to make each pack evidence-based, deeply relevant to its niche, and as simple as the industry allows.
