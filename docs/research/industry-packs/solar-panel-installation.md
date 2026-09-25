# Solar panel installation

## Profile metadata

- **Industry key:** `solar-panel-installation`
- **Source name:** `Solar panel installation`
- **Source category:** Home services
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), exact inventory heading `Home services`, 1-based position 59
- **Other exact/near duplicate labels:** Electrical, Roofing and General Contractor are adjacent trades, not duplicates.
- **Research date:** `2026-09-24`
- **Geographic scope:** US residential PV evidence; commercial, state, utility and AHJ workflows may differ.
- **Research status:** complete

## Executive summary

Residential solar installers move a property from lead and site assessment through system design/proposal, contract/finance, engineering, permitting, utility interconnection, installation, inspection, corrections and permission to operate (PTO). The physical install can take days while external review takes weeks or months. NREL and DOE support this project-stage distinction; an operator discussion describes funding, engineering, interconnection, permits and install. This is distinct from Electrical and Roofing because the defining loop includes energy-system design and AHJ/utility dependencies. **Inference:** CRM value centers on long-lived project state, ownership, documents and customer updates. No universal financing, battery, commercial or software-stack default is justified.

## Business model and customer segments

Evidence centers on US homeowners and rooftop PV, with builders, commercial/facility owners, utilities and financiers as possible participants. Companies may sell cash, loan, lease or PPA arrangements; the balance of models was not measured. Storage and roof work are optional scope branches.

## Terminology and durable records

Lead, site survey, roof plane/shading, system size, module/inverter/storage, proposal, AHJ, permit, approval to build, inspection, interconnection and PTO. Store address, roof/site condition, utility/AHJ, survey, design revision, equipment serials, contract/disclosures, financing, permit and interconnection IDs/status, inspections, commissioning, PTO, monitoring and warranty records.

## Services, intake, quoting, and booking

Lead/qualification → utility bill/site data → survey and structural/electrical review → system design/proposal → contract/finance → engineering → AHJ permits and utility applications → installation → inspection/correction → PTO and customer handoff. Contract, site visit, roof shading or local reviews can change the project. Human review for technical and finance promises.

## Pricing and commercial model

Capacity/equipment, roof/site complexity, storage, electrical work, labor, financing and jurisdiction requirements affect project economics. NREL discusses acquisition, permitting, financing and installation costs but does not establish a CRM price book. No software WTP evidence. Deposits, loan/lease/PPA and cancellation terms remain tenant policy and legal scope.

## Recurrence, scheduling, dispatch, and routing

Project milestone scheduling is central. External AHJ/utility waits, finance, materials and inspection determine critical path; the install itself may be brief. Track the blocker, owner and next action. Route-based dispatch is secondary except for field surveys/service.

## Field workflow, safety, completion, and rework

Verify approved design/equipment, roof and electrical readiness, install per plan/manufacturer/code, capture serials/photos, inspection corrections, commissioning and PTO. Roles and permitting depend on jurisdiction. A CRM status must not imply external approval or PTO.

## Customer communication and self-service

Customers need explicit status through contract, finance, design, permits, inspection, utility interconnection and PTO. Human review for design/contract changes, cancellation windows, delay explanations and production claims. Provide final monitoring and warranty records.

## Equipment, inventory, suppliers, and workforce

Modules, inverters, racks, wiring, optional batteries, lifts and fall-protection equipment. Design/engineering, permitting, sales and installation may be separate teams or subcontracted; ownership differs by model. Serial capture and procurement matter when the installer controls equipment.

## Reporting and operating measures

Suggested measures: conversion/cancellation by project stage, days in permit/interconnection queues, correction rate, contract-to-install, install-to-PTO, blocked backlog and completed systems. NREL supports cycle-time study but not these exact company KPIs.

## Existing software and operator evidence

NREL's dataset aggregates milestone information contributed by 23 small-to-large PV installers and notes it may not be comprehensive. DOE explains local permit/inspection timelines. CPUC guidance shows state-specific contracts and documents. A solar-business participant describes deal flow and a company-specific 50% contract payment; do not generalize the deposit. Specialized design/finance software is visible in the market, but no representative stack survey was found.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Property owner, commercial owner, builder/referral configurable. | DOE/NREL adoption process. | Medium. |
| `locationFields`, `assets` | Roof/site survey, utility/AHJ; PV System asset with equipment, commissioning, PTO, warranty. | NREL/CPUC project records. | High. |
| `services`, `recurrencePresets` | PV design/install, battery, repair/monitoring only when offered. | Scope varies. | Medium. |
| `formSteps`, `website` | Lead/bill intake, survey, proposal, contract, permit/interconnection, install, PTO. | Primary process sources. | High. |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Design/equipment revision, permit gates, install/inspection/commissioning; blocked by finance, AHJ, utility, material. | NREL/DOE. | High. |
| `pricingTemplates` | Tenant-configured system/equipment, roof, storage, electrical, financing and local costs. | No standard public formula. | Low-medium. |
| `defaultAutomations` | Stage-owner and customer status reminders; never auto-assert approval. | Long milestone loop. | Medium. |
| `reports` | Stage conversion, queue age, correction rate, time to PTO. | NREL cycle-time work. | Medium. |
| `inventoryDefaults` | None; module/vendor-specific catalog. | Design variation. | High. |
| `recommendationQuestions` | Residential/commercial? Finance model? Who owns design, permits, interconnection, installation and PTO? Battery/roof work? | Changes workflow. | High. |
| `productCapabilityRecommendations` | Normally CRM, estimates/contracts, project tracking, docs/photos, scheduling and customer communication; conditional inventory/job costing. | Sources establish stages, not vendor choice. | Medium. |
| `recommendedConnectorCapabilities` | `payments`, `accounting`, `calendar`, `email`, `sms`, `storage`, `crm_import`; conditional `payroll`, `routing`, `geocoding`. Utility/finance connectors lack confirmed keys. | Functional, provider-neutral mapping. | Medium. |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `customer_relationship_management` | `normally_recommended` | Long sales and customer update cycle. | High. |
| `estimates_and_quotes` | `normally_recommended` | System design/proposal and revisions. | High. |
| `project_job_tracking` | `normally_recommended` | Many stages through PTO. | High. |
| `service_scheduling` | `normally_recommended` | Surveys, crew installs and inspections. | High. |
| `field_job_tracking` | `normally_recommended` | Install evidence and serials. | High. |
| `documents_and_photos` | `normally_recommended` | Designs, contracts, permits, inspections, warranty. | High. |
| `inventory_management` | `conditional` | Relevant where company controls procurement/serials. | Medium. |
| `job_costing` | `conditional` | Relevant where acquisition, equipment and labor economics are controlled. | Low-medium. |
| `customer_portal` | `normally_recommended` | Long external waits make status/document access useful. | Medium; adoption unverified. |
| `recurring_service_management` | `conditional` | Monitoring/maintenance only if sold. | Medium. |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Project stages, site/equipment docs and status | Pack configuration | Industry defaults map to fields, forms, assets and workflows. | Construction/energy projects; high. |
| CRM, projects, documents, scheduling | Existing shared capability | Current contract covers common records. | Cross-industry; medium. |
| No core-platform gap established | No gap asserted | Research does not establish a need unrepresentable by configuration/connectors. | None proposed; medium. |
| Finance, jurisdiction and utility application variation | Business-specific customization | Model and local processes differ. | High. |

## Evidence, disagreements, and uncertainty

Primary sources and NREL research support the lifecycle; one anonymous operator provides workflow detail but not prevalence. California requirements are not universal. No software WTP or market-wide financing mix is inferred. Confidence is high for milestone complexity and medium/low for company-specific operations.

### Source log

Candidate page excluded as evidence.

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [NREL residential adoption report](https://www.nrel.gov/docs/fy22osti/80626.pdf) | Primary research | 2022; accessed 2026-09-24 | US | Acquisition, engineering, permitting, interconnection and cancellation. | Sampled residential adoption. |
| [NREL installer dataset](https://data.nlr.gov/submissions/160) | Primary dataset | Accessed 2026-09-24 | US | 23 installers, cycle-time stages, dataset limits. | Limited sample/jurisdictions. |
| [DOE solar walkthrough](https://www.energy.gov/cmei/systems/articles/walk-me-through-it-step-step-guide-consumers-going-solar) | Government primary | 2021; accessed 2026-09-24 | US | Installer and permit/inspection process; time scales. | Consumer-facing. |
| [CPUC Solar Consumer Protection Guide](https://www.cpuc.ca.gov/solarguide/) | Regulator primary | Accessed 2026-09-24 | California | Contract/disclosure and site survey context. | California only. |
| [Solar business deal-flow thread](https://www.reddit.com/r/Solarbusiness/comments/16qx7ln/describe_your_deal_flow_process/) | Operator voice | 2023; accessed 2026-09-24 | US/unspecified | Example funding, engineering, permit and install sequence. | Anonymous single company. |

## Handoff to a future pack implementer

Prototype explicit milestone ownership, blocked reason, design revision, permit/interconnection document, inspection/correction and PTO records. Ask residential vs commercial and who owns finance, engineering, AHJ, utility and install. Keep contract and equipment choices configurable. External status must remain distinct from CRM-confirmed status.
