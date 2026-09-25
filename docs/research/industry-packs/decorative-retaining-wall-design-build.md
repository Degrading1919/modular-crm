# Decorative retaining wall design / build

## Profile metadata

- **Industry key:** `decorative-retaining-wall-design-build`
- **Source name:** `Decorative retaining wall design / build`
- **Source category:** Home services
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), exact inventory heading `Home services`, 1-based position 57
- **Other exact/near duplicate labels:** Masonry, General Contractor, Patio building and landscaping; distinct candidates.
- **Research date:** `2026-09-24`
- **Geographic scope:** North American technical guidance and one Maryland operator; permits/engineering thresholds vary locally.
- **Research status:** complete

## Executive summary

This is a measured hardscape design/build project to retain grade, address erosion or create terraces/outdoor space. “Decorative” does not remove structural concerns: wall height, soil, drainage, surcharge, reinforcement and local engineering/permit thresholds change scope. Segmental block, natural stone and integrated steps/caps are possible variants. NCMA technical guidance and an installer process describe site measure, drainage, reinforcement, drawings, permitting and excavation. Keep this distinct from broad Masonry and General Contractor profiles. Product workflow should record approved designs and construction checkpoints, not prescribe engineering.

## Business model and customer segments

Homeowners, landscape clients, builders and property owners may buy wall projects or rebuilds. Triggers include slope usability, erosion or replacement of a failed wall. The Maryland operator provides design/build and integrated steps/caps; segmental systems and engineered projects differ. Buyer mix, contract values and operator scale are not surveyed.

## Terminology and durable records

Site/contour/elevation, retained height, wall face, base, drainage pipe/outlet, aggregate/backfill, geogrid/reinforcement, surcharge, cap/step, engineer, permit and inspection. Record survey/contours, segment heights, soil/water observations, adjacent loads/utilities, approved design/revision, product system, drainage destination, engineer/permit docs and progress photos. The installation is a project record; future asset maintenance is not established.

## Services, intake, quoting, and booking

Inquiry → site visit/measure → concept/design and engineering review as needed → quote/options → approval/permit → excavation/base → wall/reinforcement/drainage/backfill → inspection/evidence as required → caps/finish/cleanup → acceptance. Hidden conditions can require change orders and stop-work review. Site conditions and code thresholds are local.

## Pricing and commercial model

Plausible inputs include length/height, system/material, excavation/access/haul, soil/rock, reinforcement, drainage, steps/caps, engineering and permits. Sources establish these technical work components, not a standard quote formula or observed rates. No software WTP evidence.

## Recurrence, scheduling, dispatch, and routing

Design, permits, material delivery, excavation equipment, crew and engineer/inspector dependencies shape a multi-day critical path. Weather/site water also affect scheduling. Not route-based or recurring by default.

## Field workflow, safety, completion, and rework

Confirm approved plans and utility locate; verify excavation/base and drainage/reinforcement stages; record changed ground conditions; build to system/design; complete any required inspection and handoff as-builts. Engineering and permit needs vary by site and jurisdiction. Rework may follow drainage, settlement, soil or water-flow conditions; do not encode universal structural thresholds.

## Customer communication and self-service

Share measured design, scope, approvals, excavation impacts/access, permits, unexpected conditions/change orders, progress and completion. Human review is required for engineer/permit gates and claims of structural suitability.

## Equipment, inventory, suppliers, and workforce

Excavator/compact equipment, compactor, saws, wall blocks/stone, aggregate, pipe, geogrid and hauling. Material staging, delivery and spoil removal matter. Engineering, excavation and hauling may be subcontracted; practices vary.

## Reporting and operating measures

Suggested measures: labor/material/haul variance, stage duration, change orders, inspection/rework, margin and equipment utilization. These are not observed standard KPIs.

## Existing software and operator evidence

NCMA guides stress planning, drainage, construction procedure and site-specific design. King Cuts Landscaping describes consultation/measurement, firm itemized quote, excavation, drainage, geogrid and engineering/permitting. Other evidence is generic contractor scheduling and does not prove vertical-software use. Market complaints/WTP were not found.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Customer/property, site, wall segment; homeowner/property manager/builder configurable. | Operator process. | Medium. |
| `locationFields`, `assets` | Contours, access, soil/water, segment height, drainage; optional wall project/drawing record. | NCMA/installer. | High. |
| `services`, `recurrencePresets` | Design consult, new wall, rebuild/repair, steps/caps; no recurrence default. | Candidate/installer. | Medium. |
| `formSteps`, `website` | Site/grade intake, survey/design, engineering gate, quote, build and closeout. | Operator sequence. | High. |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Approved design, utility locate, drainage/reinforcement stage evidence, inspections; blocked by weather, permit, soil or materials. | Technical guides. | High. |
| `pricingTemplates` | Tenant amounts for length/height/material, excavation, access, drainage, reinforcement, engineer and permits. | Site-specific. | Medium. |
| `defaultAutomations` | Approval/material/readiness updates, with manual engineering and changed-condition gates. | Multi-party stages. | Medium. |
| `reports` | Stage/cost variance, change orders, quality/rework, margin. | Proposed. | Low. |
| `inventoryDefaults` | None; systems/materials differ. | Vendor/operator choices. | High. |
| `recommendationQuestions` | Wall types/heights, who designs/engineers, permit scope, excavation in-house? | Determines risk and workflow. | High. |
| `productCapabilityRecommendations` | Normally estimates, project tracking, scheduling, field tracking, docs/photos; conditional inventory/subcontract coordination. | Evidence-supported project workflow. | Medium. |
| `recommendedConnectorCapabilities` | `payments`, `accounting`, `calendar`, `storage`, `email`, `sms`; conditional `routing`, `payroll`. | Generic project coordination. | Low-medium. |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `customer_relationship_management` | `normally_recommended` | Project leads and property history. | Medium. |
| `estimates_and_quotes` | `normally_recommended` | Measured, site-specific scope. | High. |
| `project_job_tracking` | `normally_recommended` | Design, approvals, excavation, construction, inspection. | High. |
| `service_scheduling` | `normally_recommended` | Crew, equipment, deliveries and inspections. | High. |
| `field_job_tracking` | `normally_recommended` | Checkpoints and changed-condition evidence. | High. |
| `documents_and_photos` | `normally_recommended` | Survey, drawings, permits and progress. | High. |
| `inventory_management` | `conditional` | Depends on project scale/material procurement. | Medium. |
| `subcontractor_coordination` | `conditional` | Engineer, excavation or hauling may be external. | Medium. |
| `recurring_service_management` | `usually_unnecessary` | Evidence centers on discrete builds. | Medium. |
| `payment_collection` | `normally_recommended` | Quoted construction project collection. | Medium. |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Survey, drawings, construction checkpoints and blocked reasons | Pack configuration | Fields, forms, documents and workflows represent it. | Hardscape/construction; high. |
| Quotes, projects, schedule and photos | Existing shared capability | Current contract covers these. | Cross-industry; medium. |
| No core-platform gap established | No gap asserted | Technical evidence does not show a need that cannot be represented. | None proposed; medium. |
| Wall system, engineer and permit policy | Business-specific customization | Varies with height, site and jurisdiction. | High. |

## Evidence, disagreements, and uncertainty

NCMA technical materials and one regional installer agree on drainage, planning and site conditions. Permit thresholds and engineering responsibilities differ. Installer marketing does not prove typical practice, and no representative operator complaints, software WTP or price evidence were located. Confidence is high for technical workflow, medium for business workflow.

### Source log

Candidate page is metadata only and excluded from source count.

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [NCMA SRW installation guide](https://consumersconcrete.com/wp-content/uploads/2022/09/NCMA-Segmental-Retaining-Wall-Installation-Guide.pdf) | Trade technical guide | Accessed 2026-09-24 | North America | Planning, design, drainage and installation. | Hosted PDF; verify current edition. |
| [King Cuts retaining wall process](https://kingcutslandscaping.com/retaining-walls/) | Regional installer | Accessed 2026-09-24 | Maryland | Measure, quote, drainage, reinforcement, engineering. | One firm's scope. |
| [NCMA residential SRW guide](https://shoreloc.com/wp-content/uploads/2023/11/NCMA-SRW-Residential-Apps-BOOKLET-FNL-PRINTER.pdf) | Trade technical publication | Accessed 2026-09-24 | North America | Drainage/design considerations. | Hosted publication; system-specific. |
| [OctopusPro contractor scheduling](https://octopuspro.com/contractor-scheduling-software) | Incumbent baseline | Accessed 2026-09-24 | General | One-off/multivisit contractor jobs. | Not wall-specific. |

## Handoff to a future pack implementer

Prototype survey/drawing revision, engineering/permit gate, drainage/reinforcement checkpoints, hidden-condition change workflow and closeout photos. Ask who designs, engineers, excavates and secures permits. Keep technical criteria and material catalogue tenant-specific; do not create universal height/code defaults.
