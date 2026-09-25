# Irrigation system installation

## Profile metadata

- **Industry key:** `irrigation-system-installation`
- **Source name:** `Irrigation system installation`
- **Source category:** Home services
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), exact inventory heading `Home services`, 1-based position 62
- **Other exact/near duplicate labels:** On demand irrigation (Home services position 13) and Irrigation service (profile); distinct service/install models.
- **Research date:** `2026-09-24`
- **Geographic scope:** US trade guidance and operator/customer discussions; license, backflow, water and permit rules vary locally.
- **Research status:** complete

## Executive summary

New irrigation installation is a design/build project: survey water source and landscape, lay out zones, install backflow protection/pipe/valves/heads or drip/controller, test coverage and hand off programming/as-builts. Seasonal startup/winterization or repairs may be added but must be separately selected. This differs from “On demand irrigation” and existing irrigation service profiles (repair/seasonal visits), and from general landscaping. Irrigation Association material and operator discussions support design, backflow and testing records. No assumption is made about one license scheme or standard pricing.

## Business model and customer segments

Residential landscape projects, landscape contractors/builders, commercial or public properties and property managers may buy installs. New system, zone expansion or redesign are possible; some firms additionally offer seasonal service. Design may be bundled or separate. Segment mix and repeat rate are not quantified.

## Terminology and durable records

Water source, meter, pressure/flow, backflow prevention assembly (BFP), zone, head/nozzle, dripline, valve/manifold, controller, rain/soil sensor, test report and as-built. Record planting/zone plan, source/pressure, components/models, BFP ID/test, controller program, permits/licensing as applicable and as-built map/photos. An installed irrigation system is a persistent service asset when aftercare is offered.

## Services, intake, quoting, and booking

Lead/site plan → survey/pressure-flow → zone design and quote → permit/backflow scope → utility locate → procurement → trench/pipe/valves/heads/controller → zone and BFP tests → programming, orientation and as-built → acceptance. Customer may buy design separately. Self-service gathers property/photos and desired coverage, then hands technical design to an operator.

## Pricing and commercial model

Zone count/area, water source and pressure, BFP, heads/pipe, trenching/soil/landscape restoration, controller/sensors, permits and design are plausible quote inputs. Customer threads show materially different examples; they are not price standards. An operator discussion asks how valuable automated design/parts lists would be but does not report a purchase or WTP.

## Recurrence, scheduling, dispatch, and routing

Install jobs are project-based and weather/landscape dependent. Seasonal start-up/winterization can create recurring work only for businesses offering it; this differs from installation workflow. Coordinate locate, water shutoff, landscape crews and any inspection.

## Field workflow, safety, completion, and rework

Confirm plan and locate, install components, verify zones and coverage, test backflow when required, program controller, provide as-built and orient customer. Cross-connection and licensing rules are jurisdiction-specific. Noncompletion may result from locate, permit, source pressure, weather, hidden condition or missing materials.

## Customer communication and self-service

Explain design, water shutoff/trenching/restoration, readiness, testing, programming, maintenance options and test reports. Human review for coverage changes and local backflow/permit questions.

## Equipment, inventory, suppliers, and workforce

Trencher, pipe/fittings, valves, heads/drip, BFP, controller/sensors and pressure/flow test equipment. Supplier takeoffs and material staging matter. Installer and certified backflow tester roles may differ; licensing varies.

## Reporting and operating measures

Suggested measures: cost variance by system/zone, first-pass test, coverage adjustment/callback, materials used, seasonal enrollment and water/leak complaints. Not verified standard KPIs.

## Existing software and operator evidence

The Irrigation Association handbook covers system verification, backflow and installation plans; its BMP includes post-install testing. Operator and customer discussions describe zone design, permits, BFP and scope/payment expectations. Jobber markets install and maintenance quoting/scheduling but does not establish widespread adoption or fit. No software WTP evidence.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Customer/site, zones, system; residential/commercial configurable. | IA terminology. | High. |
| `locationFields`, `assets` | Source/pressure, zone map, controller and BFP/test; Irrigation System asset. | IA handbook/BMP. | High. |
| `services`, `recurrencePresets` | New system, expansion/redesign; optional seasonal services only if offered. | Keep separate from on-demand/service profiles. | High. |
| `formSteps`, `website` | Site/water intake, design, permit/backflow, install/test/as-built. | Trade workflow. | High. |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Locate, plan, component, zone test, BFP report, orientation; blocked by locate/water/permit/weather. | IA technical guidance. | High. |
| `pricingTemplates` | Tenant amounts for zones/area, BFP, materials, trench/restoration and design. | No universal amount. | Medium. |
| `defaultAutomations` | Install readiness, test report follow-up; seasonal reminder only if selected. | Optional repeat services. | Medium. |
| `reports` | Variance by zone, test/callback, materials and seasonal retention. | Proposed. | Low. |
| `inventoryDefaults` | None; tenant supplier/part catalog. | Components vary. | High. |
| `recommendationQuestions` | Install vs service? Design in-house? Water source? BFP install/test owner? Seasonal service? | Scope changes defaults. | High. |
| `productCapabilityRecommendations` | Normally CRM, quotes, project, scheduling, field tracking, docs/photos; conditional assets/recurrence/inventory. | Workflow sources. | Medium-high. |
| `recommendedConnectorCapabilities` | `payments`, `accounting`, `calendar`, `routing`, `geocoding`, `storage`, `email`, `sms`; conditional `payroll`. | Install/service scheduling. | Medium. |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `customer_relationship_management` | `normally_recommended` | Project lead and installed system record. | High. |
| `estimates_and_quotes` | `normally_recommended` | Zone design and material choices. | High. |
| `project_job_tracking` | `normally_recommended` | Design, locate, install, test and handoff. | High. |
| `service_scheduling` | `normally_recommended` | Crew, locate, landscape and inspection dependencies. | High. |
| `field_job_tracking` | `normally_recommended` | Component/test/as-built capture. | High. |
| `documents_and_photos` | `normally_recommended` | Design map, test reports and photos. | High. |
| `inventory_management` | `conditional` | Parts takeoff/stock matters to self-performing volume installs. | Medium. |
| `recurring_service_management` | `conditional` | Seasonal service only if offered. | High. |
| `route_planning` | `conditional` | More useful for seasonal/repair routes. | Medium. |
| `payment_collection` | `normally_recommended` | Project quoting and invoicing. | Medium. |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Zone/system fields, tests, maps and handoff | Pack configuration | Existing configurable records and forms fit. | Landscape/water trades; high. |
| CRM, estimates, schedule and field records | Existing shared capability | Contract includes these functions. | Cross-industry; medium. |
| No core-platform gap established | No gap asserted | Sources do not prove a need unrepresentable by contract. | None proposed; medium. |
| Design software, license/backflow rules and product catalog | Business-specific customization | Varies by operator and jurisdiction. | High. |

## Evidence, disagreements, and uncertainty

Association guidance is technical; operator/customer forum accounts are anecdotal and local. Design can be bundled or separate, and backflow responsibility differs. No prevalence, standard price or software WTP is inferred. Confidence is high for installation stages, medium for operator practice.

### Source log

Candidate page is metadata only and excluded from evidence count.

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [IA Certified Irrigation Contractor handbook](https://www.irrigation.org/IA/FileUploads/IA/Certification/CertificationCandidateHandbook.pdf) | Trade association | Accessed 2026-09-24 | US | Design plans, requirements, BFP, verification. | Certification material, not law. |
| [IA/ASCI design/install BMP](https://bendoregon.gov/wp-content/uploads/2025/12/Irrigation-Assc.-BMPDesign_Install_Manage.pdf) | Trade guidance | Accessed 2026-09-24 | US | Test and backflow guidance. | Local host; check current edition. |
| [Irrigation contractor design discussion](https://www.reddit.com/r/landscaping/comments/1lfz1nh/irrigation_contractors_how_do_you_handle_system/) | Operator voice | 2025; accessed 2026-09-24 | US/unspecified | Zone plans, parts lists and tool-value question. | Limited discussion, no purchase evidence. |
| [Irrigation system design thread](https://www.reddit.com/r/Irrigation/comments/1ngxjad/system_design/) | Customer/operator discussion | 2025; accessed 2026-09-24 | US/unspecified | Design/permit/BFP/payment expectations. | One project, location-specific. |
| [Jobber irrigation software](https://www.getjobber.com/industries/irrigation-service-software/) | Incumbent/vendor | Accessed 2026-09-24 | North America | Estimates, scheduling, install and seasonal service positioning. | Marketing. |

## Handoff to a future pack implementer

Ask install vs ongoing service, design responsibility, water source, backflow testing role and seasonality. Prototype zone/system asset, design map, locate gate, test evidence, controller handoff and optional seasonal recurrence. Keep licensing, templates and parts configurable. Avoid merging with irrigation service or on-demand candidates.
