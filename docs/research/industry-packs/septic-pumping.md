# Septic service / pumping profile

## Profile metadata

- **Industry key:** `septic-pumping`
- **Source name:** Septic service / pumping
- **Source category:** Home services
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), Home services entry 70 of 78.
- **Other exact/near duplicate labels:** Septic tank install and service (Trades/construction); researched separately as `septic-installation`.
- **Research date:** 2026-09-24
- **Geographic scope:** US-oriented sources; federal EPA guidance plus commercial software and an operator discussion. Regulatory forms, disposal rules, licensing, and service intervals vary by state/county and system.
- **Research status:** complete

## Executive summary

**Observed evidence:** Septic pumping operators sell pump-outs, inspections/maintenance, and related repairs to homeowners, landlords, property managers, and commercial sites with onsite wastewater systems. The repeatable commercial loop is property/system record → route-ready work order → pump/inspect/document → haul/dispose or transfer waste under local rules → invoice and retain records → remind customer when inspection or pumping is due. EPA advises inspection every 1–3 years and pumping every 3–5 years as a general household benchmark, adjusted for tank size, household use, and solids; this is customer maintenance guidance, not a universal operator schedule.

The strongest pack opportunity is durable property/system history plus recurring reminders and route-based dispatch, with configurable pump/inspection forms and disposal/compliance records. The current IndustryPack can configure labels, assets, job flows, reminders, forms, reports, and connector recommendations. **Uncertain:** diverse jurisdiction-specific ticket fields and filing rules may exceed static pack defaults; research does not establish a shared core gap because no jurisdictions or operator panel were deeply sampled.

## Business model and customer segments

Operators charge for pump-outs and may add inspections, filter cleaning, riser/lid access, repairs, or emergency response. Residential properties create geographically clustered repeat work; commercial, municipal, rental, and multi-unit sites can require account-level scheduling and documentation. Failure, sale/inspection, odor/backup, or a reminder can trigger demand. The EPA’s 3–5 year pumping interval is broad guidance, not an automatic recurrence rule for every system. One-truck owner-operators and multi-truck pumper fleets differ in dispatch, disposal capacity, and office support. Pumping is often a distinct business from installation even when a firm offers both.

## Terminology and durable records

Use customer/property or service site, onsite wastewater system/septic system, tank, pump-out, inspection, pumper/truck, manifest or trip ticket where locally applicable, and disposal/receiving site. The durable record should be property-linked system profile: tank capacity/material/configuration where known, access/lid location, system type, last pump/inspection, measured sludge/scum or condition, and service history. Access instructions, buried lid location, and site constraints can matter to a driver. Job-only inputs include volume removed, condition observations, signatures, photos, and disposal destination/date. Sensitive access notes should not be exposed to customers by default. EPA and NOWRA materials support keeping maintenance records and field measurements; fields should be locally configurable.

## Services, intake, quoting, and booking

Common work: scheduled pump-out, inspection/maintenance, filter service, backup/emergency call, minor repair, and return visit. Intake needs address, access/lid location, system type/capacity if known, symptoms, occupancy/use, urgency, and parking/truck access; unknown records should be captured during service. Pricing may depend on base tank size, extra volume, access/digging, distance, urgency, and additional work; do not treat national example prices as a rate card. Appointment windows or route day are often more practical than exact times. A website should collect location, symptoms, requested service, and available system history, then permit office review for emergency, unknown access, or repair scope.

## Pricing and commercial model

EPA consumer-facing guidance says regular maintenance fees of **US$250–$500 every 3–5 years** (page accessed 2026-09-24), and compares this with much higher repair/replacement costs; it is national educational context, not a current local quote. Actual service prices vary by market, tank, access, volume, and added work. No evidence supports deriving SaaS willingness-to-pay from pump-out prices. Current vendor list prices observed 2026-09-24: PumpDocket advertises Starter at **US$99/month introductory (shown against $139)** for 1–3 trucks and Team at **US$230/month introductory (shown against $329)**; SepticCycle states **US$149/month** unlimited users/jobs; Septic BizMan starts at **US$250/month minimum** and advertises onboarding from **US$3,000**. These are vendor claims/list prices, not independently verified purchases or evidence of typical willingness to pay. Recurring service is reminder-driven, not necessarily a fixed recurring invoice/subscription.

## Recurrence, scheduling, dispatch, and routing

Multi-year customer reminders, scheduled route days, and route density are central; recurrence should be suggested, not forced, because EPA intervals vary by system and usage. Dispatch needs truck/tank capacity, route geography, job duration, disposal-site location/hours, and emergency insertion. Late jobs, inaccessible lids, frozen/landscaped sites, customer cancellation, and overloaded trucks can cause return work. Route optimization and maps are existing shared capabilities; connector needs include routing/geocoding, calendar, and customer communications.

## Field workflow, safety, completion, and rework

Confirm property/system and access → locate/expose access if needed → inspect condition and measurements → pump contents and perform requested maintenance → record volume/condition and any photos/signature → handle/transport waste to permitted destination per jurisdiction → close out work, flag repairs, invoice, and set follow-up. NOWRA operational guidance describes tank access and inspection measurements. Waste destination, manifests, and environmental reporting are jurisdiction-dependent. OSHA excavation/confined-space/sanitation rules may be relevant to particular work but require site-specific compliance; this profile is not a safety procedure. Noncompletion reasons include no access, unsafe conditions, customer absent, truck/equipment issue, or weather; billability is a tenant policy.

## Customer communication and self-service

Useful communication: due-soon reminders, appointment window, en-route/delay, access preparation, completion/inspection summary, invoice/payment, and next inspection/pumping reminder. Portal should show service history and shared documents, support requests, quote approvals, and payment. Do not auto-diagnose system failure from limited field observations or promise compliance. Obtain SMS/email preferences and honor local messaging rules.

## Equipment, inventory, suppliers, and workforce

Vacuum trucks, hoses, pumps, PPE, locating tools, replacement filters/lids/risers, and fuel/disposal capacity matter. Route dispatch should identify truck and crew; inventory relevance is moderate for consumables/parts but disposal capacity and truck maintenance can be more operationally important than a conventional stockroom. Crew size and subcontracting vary. Capture time, mileage, truck assignment, and disposal/volume records where useful; payroll/export is optional.

## Reporting and operating measures

Incumbent claims emphasize dispatch, recurring work, customer/system records, trip tickets, invoices, and end-of-day reports. Useful measures: completed pump-outs by route/truck, revenue and average ticket by service, overdue reminders, noncompletion/return rate, disposal volume/site, and accounts receivable. Some are evidence-backed product categories; exact KPI definitions are unverified and should be tenant-configurable.

## Existing software and operator evidence

Purpose-built offerings include PumpDocket, SepticSync, SepticCycle, and Septic BizMan; they advertise recurring scheduling, tank/property records, dispatch, field closeout, forms/compliance records, accounting, and mobile workflows. A Reddit septic-services thread includes a contractor seeking tools and a commenter saying their subcontracted pumping company uses Housecall Pro; it is a small anonymous sample. The assortment of vertical products itself indicates vendors position regulatory paperwork and tank history as a differentiator, but vendor pages are marketing evidence, not proof of adoption or complaints. Pricing and integration depth vary substantially by fleet/team size.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Customer/property, septic system, pump-out, inspection; residential, commercial, property manager, public | EPA/NOWRA, vertical products | Medium; local terms differ |
| `locationFields`, `assets` | Property access/lid location; septic system tank size/material/type, last pump date | EPA maintenance guidance; NOWRA guide/form | High for history, lower for mandatory fields |
| `services`, `recurrencePresets` | Pump-out, inspection, filter service, repair; suggested 3–5 year reminder with custom interval | EPA says household guideline, varies by usage | High; never force preset |
| `formSteps`, `website` | Intake/property/system, field condition/measurements, closeout; emergency handoff | EPA/NOWRA records; vendor workflows | Medium |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Access/identify, inspect, pump, document, close; inaccessible/unsafe/absent | NOWRA report and operational guidance | Medium |
| `pricingTemplates` | Base + capacity/volume + access/distance + add-on | Pricing factors plausible and supported by vendor configurable pricing; exact local prices absent | Low-medium |
| `defaultAutomations` | Due reminder, dispatch notice, completion/invoice, review/next due | EPA interval guidance and vendor recurring features | Medium; consent and interval user-controlled |
| `reports` | Pump/inspection due, route, service/site history, volume/disposal, revenue | Vendor feature claims | Medium |
| `inventoryDefaults` | Filters, lids/risers, hose/consumables only as tenant-selected | Service category evidence | Low; many pumpers mainly track truck/equipment |
| `recommendationQuestions` | Fleet/truck count, commercial/public work, disposal reporting needs, recurring service share | Different product packaging observed | Medium |
| `productCapabilityRecommendations` | Normally: scheduling/dispatch, recurring follow-up, job forms/photos, invoicing/payments; optional: inventory, payroll, website; conditional: advanced reporting/multi-location by fleet | Core lifecycle plus incumbents | Medium |
| `recommendedConnectorCapabilities` | `payments`, `sms`, `email`, `accounting`, `calendar`, `routing`, `geocoding`, `storage` | Vendor integrations and dispatch need | Medium; only suggest when relevant |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| Shared core: customer, property, system and job history | normally_recommended | Durable asset/site history uses shared records; no corresponding reference feature key. | EPA/NOWRA; high |
| `service_scheduling` | normally_recommended | Coordinate dispatch and recurring service. | Vertical software; high |
| `route_planning` | normally_recommended | Plan clustered routes and truck capacity. | Vertical software; high |
| `recurring_service_management` | normally_recommended | Manage multi-year due dates; service interval varies. | EPA; high |
| `customer_notifications` | normally_recommended | Remind customers of due service and schedule. | EPA/workflow; high |
| `field_job_tracking` | normally_recommended | Capture forms, photos and closeout evidence. | NOWRA; medium-high |
| `invoicing` | normally_recommended | Bill field-completed work. | Vendor products; medium |
| `payment_collection` | normally_recommended | Support payment after field completion. | Vendor products; medium |
| `inventory_tracking` | optional | Relevant for repair/filter work and larger fleet. | Vendor feature claims; low-medium |
| `time_tracking` | optional | Useful as crew/fleet complexity grows. | Vendor claims; medium |
| `payroll_inputs` | optional | Useful where crews require tracked payroll inputs. | Vendor claims; medium |
| `website_publishing` | optional | Support customer lead intake. | Vendor claims; medium |
| `customer_self_service` | optional | Provide customer scheduling and history access where desired. | Vendor claims; medium |
| `advanced_reporting` | conditional | More useful for several trucks/sites or high volume. | Vendor plan tiers; medium |
| `multi_location_management` | conditional | Relevant when the business has multiple operating locations. | Vendor plan tiers; medium |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Tank/property fields, due-date reminders, pump/inspection checklist, workflow | Pack configuration | EPA, NOWRA, vertical FSM features | Other inspection/maintenance trades; high |
| Customer/location/asset records, recurring work, routing, forms, invoices/payments | Existing shared capability | Current Product Scope and contract | Broad service businesses; high |
| Variable local disposal manifests or mandatory jurisdiction filing | Business-specific customization pending research | Vendor claims support profiles/forms; laws differ | Other regulated field services possible; low; no core gap substantiated |
| Truck capacity and disposal operations | Business-specific customization | Fleet/process differs; current pack has no specialized vehicle data type | Waste-hauling and pumping firms; medium; assess tenant-configurable fields before gap |

No substantiated core-platform gap established. Absence of universal manifest handling in the contract is not evidence of a gap; jurisdiction-specific requirements need case studies.

## Evidence, disagreements, and uncertainty

EPA’s suggested interval and cost guidance are household-oriented and explicitly conditional; contractor schedules and state rules may differ. Vendor pages agree on records, dispatch, recurring follow-up, field closeout, and accounting, but their claims are commercial positioning. Anonymous operator evidence is sparse. Confidence is high for the basic recurring route loop and medium for exact software workflow priorities; low for nationally reusable disposal fields and typical pricing.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love) | Sweaty Startup candidate list | accessed 2026-09-24 | US/general | Candidate label/category | Inclusion is not market validation |
| [Frequent Questions on Septic Systems](https://www.epa.gov/septic/frequent-questions-septic-systems) | US EPA, regulator/technical public guidance | accessed 2026-09-24; page published ~2021 | US | 1–3 year inspection, 3–5 year pumping guideline and factors | Homeowner guidance; not operator rule |
| [Why Maintain Your Septic System](https://www.epa.gov/septic/why-maintain-your-septic-system) | US EPA, public guidance | accessed 2026-09-24 | US | Maintenance cost context, records and service value | Broad public estimate; not a quote |
| [Residential Onsite Wastewater O&M Service Provider Program Manual](https://www.nowra.org/Customer-Content/www/CMS/files/OMSP_Manual-Final_Oct2025.pdf) | NOWRA, trade/professional manual | 2025; accessed 2026-09-24 | US | Service provider measurements and access needs | Program/manual scope; not every state |
| [Septic Service Business software discussion](https://www.reddit.com/r/septictanks/comments/1o0bwm4/septic_service_business_looking_for_a/) | Reddit operator/contractor discussion | 2025; accessed 2026-09-24 | US (unspecified) | Housecall Pro observed at a subcontracted pumping company; tool-seeking behavior | Anonymous, very small sample; some replies are self-promotional |
| [PumpDocket Pricing](https://www.pumpdocket.com/pricing) | Incumbent vendor pricing/product page | accessed 2026-09-24 | US | Pump/route/compliance features and $99/$230 intro pricing | New vendor marketing; promotional list price |
| [SepticSync Pricing](https://www.septicsync.net/pricing) | Incumbent vendor pricing/product page | accessed 2026-09-24 | US, county-level forms | $125/$349/$599 plans, county forms/recurrence/routes | Vendor claims; not verified purchase |
| [Septic BizMan](https://www.septicbizman.com/) | Incumbent vendor product/pricing page | accessed 2026-09-24 | US-oriented | Waste/disposal workflows; $250 min and onboarding fee | Vendor claims and potentially atypical ERP positioning |

## Handoff to a future pack implementer

Prototype property-linked system history, a pump/inspection job flow, field measurement/photo/signature capture, configurable due reminders, route-day scheduling, and an optional disposal closeout form. Keep interval, tank fields, pricebook, billability, and local form requirements tenant-controlled. Ask whether the company pumps only or also repairs/installs, fleet/truck count, service territory, customer mix, recurring-work share, and whether jurisdictional manifests are required. Keep pumping separate from septic installation because route/service history, multi-year reminders, and waste handling are not the installation project lifecycle.
