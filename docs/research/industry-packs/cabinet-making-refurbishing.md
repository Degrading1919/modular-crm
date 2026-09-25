# Cabinet making / refurbishing

## Profile metadata

- **Industry key:** `cabinet-making-refurbishing`
- **Source name:** `Cabinet making / refurbishing`
- **Source category:** Home services
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), exact inventory heading `Home services`, 1-based position 43
- **Other exact/near duplicate labels:** Custom furniture refinishing; Closet build out; Home office build out; Furniture building. Distinct products/workflows; no aliases.
- **Research date:** `2026-09-24`
- **Geographic scope:** Primarily US operator/vendor material; one forum’s location is unspecified.
- **Research status:** complete

## Executive summary

Custom cabinet shops sell made-to-measure cabinetry, built-ins, refacing or refinishing to homeowners, remodelers, designers and commercial buyers. The operational loop is project-led: scope and site measure, drawing/specification approval, materials, fabrication/finishing, delivery, installation and punch list. Cabinetshop Maestro describes job tracking from lead to install, while an owner discussion describes coordination split across Google Calendar, Sheets, paper and shop staff. This supports a project visibility opportunity. **Inference:** shops that fabricate in-house need more production and material planning than installers/refinishers; do not make resource-level production scheduling a universal default.

## Business model and customer segments

Homeowners and remodelers are likely buyers; builders, designers and commercial customers may be referral or contract channels. These segments and their relative prevalence are not quantified. Custom projects dominate evidence; repair/refacing may create smaller jobs. Shop size and whether fabrication, finishing, delivery and install are in-house materially change workflow.

## Terminology and durable records

Terms include project/job, room, cabinet run, elevation, carcass/box, door/front, finish, hardware, drawing revision, delivery, install and punch list. Record property/room, dimensions, site photos, access, approved drawing/version, finish and hardware selections, material ETA and changes. Cabinets are a project specification; persistent individual asset tracking is not established.

## Services, intake, quoting, and booking

Lead → discovery/site measure → design/drawing → estimate/options → approval/deposit → final measure and procurement → fabrication/finish → delivery/install → punch list. Revision history and approved dimensions matter. A public form can gather project, room, photos and budget, with custom designs routed to human review. Drawings and changes need explicit approval.

## Pricing and commercial model

Dimensions, materials, finish, hardware, design complexity, installation and site conditions are plausible price inputs; no common price formula is established. Cabinetshop Maestro advertises $199/month for up to 20 active users and $399/month for up to 40, but this is software list pricing, not evidence of typical operator willingness to pay. Deposits, progress billing and warranty terms remain company-specific.

## Recurrence, scheduling, dispatch, and routing

Schedule by project milestones, shop capacity, material ETA, delivery and install crew. Multi-week jobs and multiple site visits are possible. Route density and recurrence are not core defaults. Resource-leveled production planning is relevant to some shops but not confirmed across the segment.

## Field workflow, safety, completion, and rework

Verify approved revision and site, protect the home, receive/inspect goods, install and adjust, document deviations, conduct walkthrough and capture punch list/acceptance. Safety and permit obligations depend on scope and location. Measurement, finish damage and fit issues are useful callback reasons; no standardized cabinet compliance checklist was found.

## Customer communication and self-service

Provide quote/drawing/finish approvals, production and material status, delivery window, changes, installation updates, punch list and invoice. Human review is needed before promising custom fit, finish availability or revised dates. No operator-stack survey was located.

## Equipment, inventory, suppliers, and workforce

In-house fabrication may require shop machinery, panels, hardware and finishes; install-only firms differ. Designers, fabricators, finishers, installers and subcontractors may participate. Job-specific material reservations and supplier ETA are useful options, not universal defaults.

## Reporting and operating measures

Suggested measures: stage aging, estimate vs actual margin, material lead-time variance, on-time install, backlog by stage and punch-list/rework. Sources establish general job tracking but not standard KPI use.

## Existing software and operator evidence

Cabinetshop Maestro markets workflow boards, scheduling, tasks, drawings, estimates and punch-list tracking; its founder says he operated a custom cabinet shop for over 20 years. A WOODWEB owner thread reports using Google Calendar, a Gantt chart in Sheets and paper updates, with a reply distinguishing project tracking from production scheduling. Treat vendor positioning and individual operator accounts as qualitative evidence, not prevalence.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Customer/client, property, project; homeowner, remodeler, builder/designer configurable. | Project/job sources. | Medium; segment mix unknown. |
| `locationFields`, `assets` | Room/run, dimensions, access, photos; optional cabinetry project spec and drawing revision. | Cabinetshop Maestro job folders. | Medium. |
| `services`, `recurrencePresets` | Custom build, refacing/refurbishing, finish repair, delivery/install; no recurrence default. | Candidate label and vendor scope. | Medium; offerings vary. |
| `formSteps`, `website` | Project intake → measure/design → spec approval; collect address/photos then hand custom work to staff. | Workflow sources. | Medium. |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Approved revision, materials, site protection, install, acceptance/punch list; delays, access, material changes. | Vendor and owner workflow. | Medium. |
| `pricingTemplates` | Tenant-defined material, dimension, finish/hardware, delivery/install and change-order inputs. | No universal formula. | Low-medium. |
| `defaultAutomations` | Quote follow-up and configured milestone notices. | Generic incumbent workflow. | Low. |
| `reports` | Stage aging, backlog, estimate/actual, lead time, rework. | Proposed measures. | Low-medium. |
| `inventoryDefaults` | None; configurable panels, hardware and finishes. | Shop model varies. | High. |
| `recommendationQuestions` | In-house fabrication? Install/refurbish? Active jobs/crews? Drawing approvals? | Changes workflow materially. | High. |
| `productCapabilityRecommendations` | Normally CRM, estimates, project tracking, scheduling, docs/photos; conditional inventory/job costing for fabrication, field tracking for installation. | Workflow evidence; functional keys remain research suggestions. | Medium. |
| `recommendedConnectorCapabilities` | `payments`, `accounting`, `calendar`, `email`, `storage`; conditional `payroll`, `crm_import`. | Generic contractor needs; no provider prescribed. | Low-medium. |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `customer_relationship_management` | `normally_recommended` | Leads and project history. | Medium. |
| `estimates_and_quotes` | `normally_recommended` | Custom scope and approvals. | High. |
| `project_job_tracking` | `normally_recommended` | Multi-stage work through installation. | High. |
| `service_scheduling` | `normally_recommended` | Shop milestones and site install. | Medium. |
| `field_job_tracking` | `conditional` | Install crews need job records; supply-only firms less so. | Medium. |
| `inventory_management` | `conditional` | In-house fabrication/material purchasing. | Medium. |
| `job_costing` | `conditional` | Useful where actual labor/material costs are captured. | Low. |
| `recurring_service_management` | `usually_unnecessary` | Evidence is project-led. | Low. |
| `payment_collection` | `normally_recommended` | Quotes, invoices and collections. | Medium. |
| `documents_and_photos` | `normally_recommended` | Drawings, specifications, site measures. | High. |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Project, drawing revision and install defaults | Pack configuration | Representable with fields, forms, documents and workflow. | Remodel/build trades; medium. |
| CRM, estimates, schedule and documents | Existing shared capability | Current contract supports these functional needs. | Cross-industry; medium. |
| No core-platform gap established | No gap asserted | Evidence does not show a need that cannot be modeled with existing contract; absence of evidence is not proof of absence. | None proposed; medium. |
| Shop capacity, fabrication and warranty terms | Business-specific customization | Varies by operator and service mix. | Low-medium. |

## Evidence, disagreements, and uncertainty

Vendor claims and individual forum accounts are not representative. Shop size and in-house manufacturing determine whether inventory and production planning matter. No software WTP is established; advertised SaaS plans are not operator purchase evidence. Confidence is medium for the project lifecycle and low for market-wide prevalence/pricing.

### Source log

The candidate page is metadata only and is not counted as evidence.

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [WOODWEB project management discussion](https://woodweb.com/cgi-bin/forums/business.pl?read=854757) | Cabinet shop owner thread | 2021; accessed 2026-09-24 | Unspecified | Calendar, Sheets, paper handoffs; production scheduling nuance. | Small self-selected thread. |
| [Cabinetshop Maestro](https://cabinetshopsoftware.com/) | Incumbent/vendor; cabinetmaker founder | Accessed 2026-09-24 | US | Lead-to-install workflow; $199/$399 monthly list plans. | Marketing and prices do not establish WTP. |
| [WOODWEB custom cabinetry discussion](https://www.woodweb.com/cgi-bin/forums/business.pl?read=862327) | Cabinet shop owner discussion | Accessed 2026-09-24 | Unspecified | Small-shop model and production/sales advice. | One owner's advice. |
| [Jobber fence software](https://www.getjobber.com/industries/fence-software/) | Incumbent baseline | Accessed 2026-09-24 | North America | Generic quote/schedule/customer workflow. | Not cabinetry-specific. |

## Handoff to a future pack implementer

Prototype project stages, drawing/specification version, material ETA, install scheduling and punch list. Ask whether the tenant fabricates, installs or refurbishes and who approves drawings. Keep pricing, recurrence and inventory tenant-configurable. Resource-leveled shop scheduling remains an open question; no core gap is proposed.
