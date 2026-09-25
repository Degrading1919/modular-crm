# Hot tub wiring / installation

## Profile metadata

- **Industry key:** `hot-tub-wiring-installation`
- **Source name:** `Hot tub wiring / installation`
- **Source category:** Home services
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), exact inventory heading `Home services`, 1-based position 55
- **Other exact/near duplicate labels:** Pool / hot tub services is an ongoing service profile; Electrical is broader. No duplicate.
- **Research date:** `2026-09-24`
- **Geographic scope:** US homeowner/manufacturer sources; local code, licensing, permit rules and tub model differ.
- **Research status:** partial

## Executive summary

Interpreted as the electrical installation project to prepare/connect a hot tub, sometimes coordinated with tub retailer/delivery. It may involve model/manual review, site and panel survey, circuit route, conduit/trenching, disconnect/GFCI, permit/inspection, final hookup and handoff. This differs from the existing Pool / hot tub services profile, which covers water care and ongoing repair/maintenance. Manufacturer installation guidance and homeowner threads support model/site coordination and variable quotes; evidence on dedicated installer business models and software is thin. Code-sensitive details must remain with qualified trades and local authorities.

## Business model and customer segments

Homeowners buying a new tub are the evidenced customer; retailers, delivery firms, builders and electricians may refer or share scope. Work may be standalone electrical hookup or bundled with tub placement, trenching and delivery. Dedicated install-only operator size and segment mix are not established.

## Terminology and durable records

Customer/site, tub make/model/manual, panel/service, circuit route, disconnect, GFCI, conduit/trench, permit, inspection, site readiness, final connection. Capture site/panel photos, distance/access, tub spec, who handles trench, tub delivery date and permit/inspection owner. The tub is a durable customer asset only if the business also services it; hookup is a one-time project.

## Services, intake, quoting, and booking

Lead/referral → model/manual and photos → qualified site/load survey → quote/scope → permit → rough-in/trench/conduit → inspection if required → tub placement → final connection/test → handoff. Separate responsibility for pad, delivery and electrical work. Do not make technical/code advice a CRM default.

## Pricing and commercial model

Forum examples show run length, route difficulty, attic/crawl access, trenching, panel/service condition, disconnect, materials and permits affecting quotes. One homeowner reported widely divergent quotes for a 150-foot run and final $3,000 including permit and inspection correction; another thread contains different trip/material scenarios. These are dated local anecdotes, not price benchmarks. No software WTP evidence.

## Recurrence, scheduling, dispatch, and routing

One-off multi-visit project, coordinated around site readiness, permit/inspection and tub delivery. Panel upgrades, delayed delivery and inspection correction can extend critical path. Not a recurring route business by default.

## Field workflow, safety, completion, and rework

Review approved scope/manual, confirm qualified/licensed scope and site readiness, perform installation to applicable standard, record inspection/test and coordinate final tub handoff. Electrical safety and local rules are high stakes and jurisdiction/model specific. Rework may result from hidden panel constraints, missed coordination or failed inspection.

## Customer communication and self-service

Clarify who handles tub placement, electrical connection, permits, trench and inspection; confirm readiness and arrival windows, report changes, provide test/inspection documentation and invoice. Do not automatically book final hookup before tub/site is ready.

## Equipment, inventory, suppliers, and workforce

Electrical tools/test equipment, conductors, conduit and disconnect components; excavation can be subcontracted. Assignment should respect licensed/qualified staff. Parts and work methods vary by model and code. No common inventory or staffing configuration established.

## Reporting and operating measures

Suggested: survey-to-quote, permit wait, first-pass inspection, install-ready-to-complete lag, revisit reasons and referral source. Not verified incumbent KPIs.

## Existing software and operator evidence

Jacuzzi's installation page identifies site/overhead and special delivery planning. Homeowner discussions detail permit questions, long routing, quote variation and retailer referrals. Specialist hot-tub software sources largely target retail/service/maintenance rather than this electrical installation niche. Therefore source evidence is partial.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Homeowner, retailer/referral partner, project/site. | Manufacturer and forum sources. | Medium. |
| `locationFields`, `assets` | Panel/site photos, route, tub spec, access; optional spa asset if aftercare offered. | Manufacturer guidance/forum. | Medium. |
| `services`, `recurrencePresets` | Survey, hookup, disconnect, trench coordination, final connection; no recurrence. | Candidate-specific interpretation. | Low-medium. |
| `formSteps`, `website` | Tub/site intake, survey, quote, permit, rough-in, delivery, hookup, closeout. | Forum-described sequence. | Medium. |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Manual/scope, readiness, permit/inspection record, test/handoff; blocked by permit, site, delivery, panel issue. | Manufacturer and owner threads. | Medium. |
| `pricingTemplates` | Tenant-defined distance, access, materials, trench, panel change and permit. | Anecdotal quote scope only. | Low. |
| `defaultAutomations` | Readiness and visit reminders with manual readiness gate. | Multi-party appointment sequence. | Low. |
| `reports` | Permit wait, revisit and inspection outcome. | Proposed. | Low. |
| `inventoryDefaults` | None; model/code-specific materials. | Variation. | High. |
| `recommendationQuestions` | Tub retailer or electrician? Who owns permits, trench, delivery, connection? Jurisdictions/models? | Critical scope uncertainty. | High. |
| `productCapabilityRecommendations` | Normally CRM, quotes, project tracking, scheduling, field work and documents; conditional asset history/partner coordination. Safety-record key unconfirmed. | Sources support project, not software use. | Medium. |
| `recommendedConnectorCapabilities` | `payments`, `accounting`, `calendar`, `email`, `sms`, `storage`; conditional `payroll`. | Generic project workflow. | Low-medium. |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `customer_relationship_management` | `normally_recommended` | Homeowner and retailer referral history. | Medium. |
| `estimates_and_quotes` | `normally_recommended` | Site route and scope affect quote. | High. |
| `project_job_tracking` | `normally_recommended` | Permits, delivery, rough-in and hookup. | High. |
| `service_scheduling` | `normally_recommended` | Survey/install/inspection coordination. | High. |
| `field_job_tracking` | `normally_recommended` | Site evidence and closeout. | High. |
| `documents_and_photos` | `normally_recommended` | Manual, site photos and permits/inspection. | High. |
| `safety_compliance_records` | `conditional` | Depends on jurisdiction and licensed scope. | Medium. |
| `inventory_management` | `conditional` | Useful when installer stocks parts. | Low. |
| `recurring_service_management` | `usually_unnecessary` | Install-only workflow is one-off; aftercare is optional. | Medium. |
| `customer_portal` | `optional` | Could share readiness and documents; adoption unknown. | Low. |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Survey, scope, permit, readiness and closeout | Pack configuration | Fields, project stages, docs and checklists can represent workflow. | Electrical/installation trades; medium. |
| Quotes, schedule, project and field records | Existing shared capability | Current contract supports these. | Cross-industry; medium. |
| No core-platform gap established | No gap asserted | Evidence is too thin to claim an unrepresentable need. | None proposed; low. |
| Code, qualification, permit and scope splits | Business-specific customization | Local/model and partner-dependent. | High. |

## Evidence, disagreements, and uncertainty

**Uncertain:** evidence addresses hookup projects, not a validated dedicated “hot tub installation company” segment. Forum quotes disagree widely and lack controlled scope/geography. No software WTP or universal wiring requirement is inferred. This profile is partial because specialist operator/incumbent evidence for wiring installers remains thin.

### Source log

Candidate inventory page is metadata only and excluded from evidence count.

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [Jacuzzi installation FAQ](https://www.jacuzzi.com/hot-tub-installation.html) | Manufacturer primary | Accessed 2026-09-24 | US | Site access, overhead clearance and special delivery. | Not an electrical code manual. |
| [Hot tub electrical quote thread](https://www.reddit.com/r/hottub/comments/1ioumaj) | Homeowner voice | 2025-02-13; accessed 2026-09-24 | US | Route/material/permit quote inputs, corrections and cost variation. | One job and local anecdote. |
| [Hot tub hookup cost thread](https://www.reddit.com/r/hottub/comments/1nnihm6) | Homeowner/electrician discussion | 2025; accessed 2026-09-24 | US/Canada | Multiple site visits, materials and retailer referral. | Anonymous; rules vary. |
| [Ceejay hot tub software](https://ceejay.com/hot-tub-software) | Specialist incumbent | Accessed 2026-09-24 | Unspecified | Retail/install plus ongoing service-record model. | Not focused on electrical hookups. |

## Handoff to a future pack implementer

Ask whether the operator sells tubs, installs them, wires them, or coordinates specialist electricians; capture jurisdiction, model, permit owner, delivery and site-readiness dependencies. Prototype quote-to-permit-to-install status and documents. Keep technical requirements, price and qualification rules tenant/jurisdiction controlled. Validate the niche with more electricians before treating it as a complete profile.
