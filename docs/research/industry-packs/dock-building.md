# Dock building profile

## Profile metadata

- **Industry key:** `dock-building`
- **Source name:** Dock building
- **Source category:** Niche carpentry
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), Niche carpentry, position 13 of 20.
- **Other exact/near duplicate labels:** Patio building (#11) and fence building (#12) are separate; dock construction occurs at a regulated waterfront and may require marine equipment/engineering.
- **Research date:** 2026-09-24
- **Geographic scope:** U.S. examples from New York, Washington, Texas and New Jersey; shoreline/waterbody authorities and requirements vary substantially.
- **Research status:** complete

## Executive summary

**Observed evidence:** Dock projects include new/replacement residential docks, slips, walkways, lifts, repairs and commercial marinas. Durable workflow is site survey (shoreline, water depth/tides, soil, access) → design/engineering and materials → multiple permits/approvals → procurement/equipment scheduling → piling/frame/deck/utilities/lift → inspection/test and handover. Local shoreline or reservoir rules can prevent or reshape construction; permits are not a postscript. Firms range from local residential dock builders to marine contractors and marina builders, with different engineering and equipment needs.

The pack opportunity is site + waterbody/authority records and a permit/dependency timeline that connects approved plans, inspections, materials, subcontractors and final lift/electrical evidence. Source evidence is strong for workflow but weak for dock-builder software stack and verified CRM WTP; no unsupported niche-specific software budget should be inferred.

## Business model and customer segments

Customers include waterfront homeowners, HOAs/community dock owners, marinas, resorts and public/commercial waterfront operators. Types include fixed piling, floating, gangway, covered/slip, boat-lift integration, replacement/repair and storm damage. Buyer may be owner, HOA board or marina operator. A small lake contractor may specialize in docks, lifts and seawalls; coastal marine firms add engineering, barges, pile driving, permits and commercial projects. Construction season, water level, weather, access by land/barge and environmental windows affect geography and schedule.

## Terminology and durable records

Record waterfront parcel/shoreline, waterbody and authority, water depth/elevation/tide, bank/soil, setbacks, navigation/access, dock footprint, slips, pilings/frame/deck, lift capacity/model, utilities, drawings/revisions, permit application/status/conditions, inspection, materials, contractor/engineer, warranty and maintenance. Persistent assets include dock, piles/frame/deck, lift, gangway and electrical equipment; job inputs include water-level survey and permit drawings. Track each approval's jurisdiction, date, conditions and expiry; access-sensitive maps and owner data need privacy.

## Services, intake, quoting, and booking

Intake asks new/replacement/repair, waterbody/address/parcel, dock footprint/type/slips, boat and lift needs, depth/shoreline/access, existing permits/as-builts, utilities, HOA/authority contacts, materials, storm/wave/ice exposure and desired season. Site visit/survey and regulatory screening precede firm price. Proposal should split survey/design/engineering, permitting, pilings/frame/deck, lift/utilities, barge/equipment, disposal and inspection. Cost/permit acceptance and design revisions must be approved. Access Marine documents site survey, depths/tides, soil, engineering and NYS/local submissions; government resources confirm jurisdiction-specific approvals.

Workflow: lead → site visit → layout/engineering → permit submission/conditions → approvals → order materials/equipment and reserve weather/water window → construction → inspection/test lift/electrical → acceptance/warranty. Public quote forms cannot promise start dates before permit decisions.

## Pricing and commercial model

Drivers include footprint/shape, fixed vs floating, water depth/soil, pilings/material, decking, roof, slip/lift capacity, utilities, access/barging, dredging/bulkhead, engineering/permitting, environmental controls, season and travel. Washington Ecology explains that permit thresholds and exemptions vary by type/site and that certain construction remains regulated; New Jersey and New York authorities provide distinct rules. Those are not reusable nationwide thresholds. No reliable price benchmark or software WTP evidence was found. Project spend is not a proxy for CRM spend.

## Recurrence, scheduling, dispatch, and routing

Permit review may dominate schedule and is jurisdiction-dependent. Coordinate engineer, authority, materials, barge/crane/pile driver, crew, lift vendor and inspection. Water level, weather, environmental window, marina access and owner occupancy constrain work. Noncompletion includes permit denial/conditions, unsuitable depth/soil, access, weather, material/equipment, utility conflict or failed inspection. Separate external approval hold from contractor delay and customer change; notify owner promptly.

## Field workflow, safety, completion, and rework

Verify authorization/approved drawing → mobilize land/water equipment → protect shoreline/environment and locate utilities → set piles/foundation and frame → deck/gangway/roof/lift/utilities → verify dimensions, fasteners, stability, electrical/hoist operation → inspection and customer walkthrough → provide as-built, maintenance and warranties. Required evidence may include survey, approved plans/permit, inspection, submerged/waterline conditions, lift model/capacity, electrical work and photos. Marine construction adds fall/drowning, lifting, barge, pile-driving, power-tool, weather and environmental hazards; OSHA/agency and employer obligations vary. Rework can follow wrong datum, settlement, storm damage, incorrect lift fit, permit variance or unrecorded change.

## Customer communication and self-service

Owners need permit status, design review, start-window uncertainty, water/access preparation, daily progress, weather/authority delays, inspection, lift training, maintenance and storm preparedness. Portal can collect ownership/HOA docs and approve drawings; permit decisions require authority confirmation, not automated inference. Provide one accountable contact when authorities/trades are multiple.

## Equipment, inventory, suppliers, and workforce

Materials include timber/composite/steel piles, decking/frame, floats, gangway, hardware, boat lifts, electrical/water service and environmental controls. Major equipment can include barge, pile driver, crane, excavator and workboat; seasonal reservations are material. Workforce includes marine engineer/surveyor, permit coordinator, welders/carpenters, operators, electricians, lift installers and inspectors. Track equipment assignment, subcontract scope, licenses/authority-specific certification and worksite safety responsibilities.

## Reporting and operating measures

Inferred metrics: lead-to-site-survey, permit cycle/first-pass approval, approval-to-start, weather days, materials/equipment variance, schedule slip, inspection first-pass, callbacks/storm repair and margin by dock type. Slice by authority, waterbody, access method and residential/HOA/commercial. No operator-standard KPIs were found.

## Existing software and operator evidence

DockBuilder.io markets a niche design/takeoff/quote/permit-plan tool, illustrating specialist drawing/material estimation needs but not market adoption. Dock operators describe survey, engineering/permitting, construction and final inspection. Government portals/forms define permit data and thresholds. No direct dock contractor CRM stack complaint or verified software purchase/WTP source was identified. A niche drawing tool's marketing cannot prove a core platform gap; generic files/tasks may be enough for small firms.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Waterfront owner/HOA/marina, waterbody, dock, slip, pile, lift, permit, datum, inspection | Operator/regulatory language | High |
| `locationFields`, `assets` | Parcel/waterbody/authority, shoreline/depth/access; dock, lift and electrical assets | Permit/operator workflows | High |
| `services`, `recurrencePresets` | New, replacement, repair, lift, marina; no default recurrence | Scope diversity | Medium-high |
| `formSteps`, `website` | Waterbody, site/photos, type/size, lift, permits, consultation/site survey | Must qualify site | High |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Survey, design/permit, mobilization, build, test/inspection; approval/site/weather/equipment holds | Government + operator | High |
| `pricingTemplates` | Dimensions/type, materials, piles, lift, survey/engineering, permit, access/equipment | Cost drivers | Medium |
| `defaultAutomations` | Application receipts/status, approval conditions, procurement, weather, visit, final inspection/warranty | Inference; external approvals reviewed manually | Medium |
| `reports` | Permit cycle, approval variance, schedule, inspection, weather and margin | Inferred | Medium-low |
| `inventoryDefaults` | Optional lifts/hardware; project procurement and expensive equipment reservation | Business variation | Medium |
| `recommendationQuestions` | Authority/waterbody, type, size, lift, engineering, permit owner, access, environment, season | Mandatory scope discovery | High |
| `productCapabilityRecommendations` | `estimate_management`, `service_scheduling`, `field_job_tracking`, `invoicing` normally; `asset_management`, `inventory_tracking`, `time_tracking` conditional; candidate permit/GIS/drawing key unconfirmed | Existing keys and specialty ideas | Medium |
| `recommendedConnectorCapabilities` | `calendar`, `email`, `storage`, `accounting`, `payments`; `geocoding`, `routing`, `sms` conditional | Site and stakeholder workflow | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| Shared core: customer, site and job records | normally_recommended | Link property, approvals, drawings and work. | Workflow; high |
| `estimate_management` | normally_recommended | Site/engineering/material-dependent proposal. | Operators; high |
| `service_scheduling` | normally_recommended | Permit, weather, equipment and trade dependencies. | Government/operation workflow; high |
| `field_job_tracking` | normally_recommended | Construction, inspections, photos and closeout. | Operator workflow; high |
| `invoicing` | normally_recommended | Project payment and approval evidence. | Inference; medium |
| `asset_management` | conditional | Builder offering repair/maintenance of dock and lifts. | Service variation; medium |
| `inventory_tracking` | conditional | Dealer/equipment/parts stock; project builder may procure per job. | Business model; medium |
| `time_tracking` | conditional | Multi-crew/equipment job cost and payroll. | Scale-dependent; low |
| Candidate permit/GIS/drawing management (key unconfirmed) | conditional | Coastal/regulatory projects with repeated submittals; generic docs/tasks may suffice inland. | Tool vendor and agencies; medium |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Site/permit authority fields, approval stage and weather/equipment holds | Pack configuration | Agency and operator requirements | Waterfront contractors; high |
| Shared records, files, schedule, estimate and status workflow | Existing shared capability | General construction CRM | High |
| Permit/GIS drawing generation | Candidate core-platform gap for validation | Niche tool markets exportable plans; could remain specialized software/files | Waterfront work; low |
| Local permit conditions, environmental controls and equipment | Business-specific customization | Waterbody, authority and project determine rules | High |

## Evidence, disagreements, and uncertainty

Rules differ by shoreline, lake/reservoir and state/federal authority; permit thresholds are date/location-specific and need external current review. Operator pages are promotional. Government and trade references strongly support workflow; operator software, complaints and WTP evidence remains sparse. “Complete” applies to workflow mapping with that software limitation explicit.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [Access Marine dock process](https://accessmarineco.com/services/dock-builders-long-island) | Marine contractor/operator | Accessed 2026-09-24 | Long Island, New York | Survey, tide/depth/soil, engineering, permits, construction | Promotional/local |
| [Docktor Dock process](https://docktordock.com/services/dock-building/) | Dock builder | Accessed 2026-09-24 | Lake of the Ozarks, Missouri | Site assessment, design, certification, permits, construction | Local operator marketing |
| [Washington shoreline permits](https://www.ecology.wa.gov/regulations-permits/permits-certifications/shoreline-permits-enforcement) | State regulator | Accessed 2026-09-24 | Washington | Shoreline authorization and dock-specific thresholds | State/current thresholds; not nationwide |
| [NJ dock/pier common projects](https://dep.nj.gov/wlm/lrp/common-projects/dockpier/) | State regulator | Accessed 2026-09-24 | New Jersey | Waterway permits and project rules | State-specific |
| [Dock construction application](https://www.mwcd.org/wp-content/uploads/2026/02/Dock-Construction-Application.pdf) | Public water district form | Accessed 2026-09-24 | Ohio, Muskingum watershed | Required project data and permit categories | Local authority only |
| [Dock Builder guides](https://dockbuilder.io/guides) | Niche software vendor | Accessed 2026-09-24 | U.S.-oriented | Design/takeoff/quote/permit-PDF feature positioning | Marketing; no adoption/pricing/WTP proof |

## Handoff to a future pack implementer

At intake require site/waterbody/authority, existing permits, dock/lift type and site survey. Track each approval and condition separately, then connect drawing revision to procurement, equipment window, field inspection and handover. Keep rules external/jurisdictional and manually reviewed. Validate whether GIS/permit plan generation warrants a connector or remains in specialist CAD.
