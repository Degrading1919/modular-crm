# Private investigating

## Profile metadata

- **Industry key:** `private-investigating`
- **Source name:** Private investigating
- **Source category:** Home services
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), Home services, position 50 (between “Trophy animal mounting” and “Manned home security services”)
- **Other exact/near duplicate labels:** Manned home security services (#51) is separately researched as staffed security; security installation (#55) is electronic premises systems. No exact duplicate.
- **Research date:** 2026-09-24
- **Geographic scope:** U.S.-oriented software/operator material, with licensing variation expressly state/jurisdiction specific.
- **Research status:** complete

## Executive summary

**Observed evidence:** A private investigator sells discreet fact-finding, surveillance, records research, interviews, or related investigative assignments to a hiring client. The client is often an attorney, insurer, business, or individual; the person being investigated is a distinct subject. Work generates a sensitive case file, time/expense entries, field notes and media, then a factual report or evidence handoff. PI-specific software vendors explicitly organize cases, subjects, assignments, evidence, surveillance logs, reporting, billing, and access around that loop ([PI Core](https://butler.solutions/products/pi), [Tervalum](https://tervalum.com/products/investigator-professional/)).

**Inference:** Modular CRM could fit as a configurable case-and-assignment practice system, but ordinary service-location/job patterns are a poor analogy for investigations: the location may be incidental, the subject is not the customer, and secure evidence handling/access control is central. Confidentiality, lawful collection, preservation, retention, and disclosure policies require operator and jurisdiction review. Evidence is adequate to mark the workflow profile complete; it does not establish that the platform currently supports evidence chain of custody or any legal-specific controls.

## Business model and customer segments

- Work is sold as case/matter assignments: surveillance, background/locate research, insurance claims investigation, domestic/family matters, corporate due diligence, fraud, and legal support. **Observed evidence:** PI software and industry material describe variable cases, fieldwork, report delivery, evidence storage, and billing; the service mix varies by specialization ([PI Core](https://butler.solutions/products/pi), [Deelo workflow overview](https://www.deelo.ai/blog/private-investigator-case-management-software)).
- Buyer roles include counsel, claims professionals, employers, businesses, and private clients. The paying client may differ from both the subject and the person interviewed. Assignment authorization, scope, objective, deadline, and deliverable should be recorded separately.
- Sales arrive through referrals, attorney/insurer networks, repeat institutional buyers, and direct consumer inquiries. Matter duration ranges from a short surveillance deployment to prolonged corporate work; do not assume recurring subscription-like service.
- Solo investigators may handle intake, fieldwork, reports, and collections themselves; agencies add investigators, reviewers, subcontractors, and access segregation. Jurisdiction-specific licensing/agency rules vary; Iowa law, for example, distinguishes licensed agencies and protects certain regulatory investigation files ([Iowa Code ch. 80A](https://www.legis.iowa.gov/docs/code/2024/80A.pdf)).

## Terminology and durable records

- Terms: client, case/matter, assignment, subject, investigator, surveillance, field log, evidence item, exhibit, report, retainer, expense, and closeout.
- **Service-location data:** subject-associated addresses, observation locations, jurisdiction, safe/legal access notes, location timestamps, and possibly geospatial observations. Store only what is necessary and access-limit sensitive notes.
- **Persistent customer assets:** clients/organizations, matters, subjects/entities, investigators, and evidence references recur. Vehicles and locations can be case-specific; do not equate subject with customer.
- Sensitive records include personal identifying information, allegations, medical/employment/litigation context, location trails, photos/video/audio, source identities, and investigative methods. Retention and disclosure depend on contract, law, and client policy. Evidence provenance and original-file integrity can matter; PI-focused systems advertise hashes and field logs, but that alone does not establish admissibility ([PIwitness](https://www.piwitness.com/pricing)).
- One-time job inputs include authorized scope, observation windows, target identifiers, incident/field notes, and delivered report versions.

## Services, intake, quoting, and booking

- Service types are specialization-dependent: surveillance, background/locate research, interviews, records retrieval, fraud/corporate investigations, process-related work where licensed, and expert/report support. Do not assume every investigator offers all of them.
- Intake needs client identity/authority, purpose and scope, subject identifiers, known addresses/vehicles, jurisdiction, desired outcome, deadline, conflicts/safety checks, budget/retainer, and requested deliverable. Collect documents and media through a permissioned channel; avoid broad public booking for sensitive matters.
- Quote behavior may be hourly plus expenses, retainer/deposit, flat-fee research, day-rate surveillance, or staged authorization. **Observed evidence:** price structures vary by work type and investigator; an anonymous PI asks peers how to price desk research versus fieldwork, illustrating uncertainty rather than a market rate ([PI pricing discussion](https://www.reddit.com/r/PrivateInvestigators/comments/1hcf9dx/pricing/)).
- Scheduling commits to fieldwork windows, court/meeting deadlines, and investigator availability rather than recurring routes. Intake should hand off for conflict checks, legality, scope, and feasibility review.

## Pricing and commercial model

- Inputs include investigator grade, hours/days, travel, specialty tools or records fees, rush work, subcontractor expense, and report/testimony needs. The agreed scope, budget cap, retainer balance, expense approval, and change authorization should be visible.
- Fixed-fee desk research may coexist with hourly fieldwork; institution clients may use rate cards or vendor onboarding. Geography and law affect permitted services and rates.
- Invoicing may be periodic, milestone, or closeout; retainers and expense advances are common candidates but not universal. No universal recurrence, cancellation, warranty, or refund pattern established.
- Observed software prices: PIwitness lists Solo $49/month, Professional $99/month, Agency $199/month plus $29/investigator; ClearView PI lists $49 Solo / $129 Agency; these are advertised prices, accessed 2026-09-24 ([PIwitness pricing](https://www.piwitness.com/pricing), [ClearView PI pricing](https://clearviewpi.net/)). These provide direct WTP/packaging evidence only for those software offers; no general CRM budget inferred.

## Recurrence, scheduling, dispatch, and routing

- Case work is irregular, deadline-led, and often time-window-sensitive. Surveillance may need flexible field assignments and reserve coverage; desk research can be asynchronous. Follow-up depends on results and client authorization.
- Capacity requires investigator skills, jurisdiction/licensing, conflict clearance, safety, availability, and confidentiality compartmenting. Travel time and operational security matter more than dense route optimization for many practices.
- Reschedules, subject movement, weather, and case developments can change the plan. Dispatch should reveal only assignment-appropriate data, preserve changes, and avoid exposing one client's matter to another client or unauthorized staff.

## Field workflow, safety, completion, and rework

- Typical loop: screen inquiry/conflicts → verify authority and lawful scope → open matter/budget → assign investigator → prepare → conduct research or observation → log time, expenses, events, and media → supervisor/client review as appropriate → prepare factual report/evidence delivery → invoice and close/archive.
- Mobile/offline capture may help in low-coverage settings, but no source proves a universal offline requirement. Originals, timestamps, custody/provenance, edits, and secure upload require explicit policy.
- Safety includes situational awareness, lawful observation, privacy, recording/consent rules, firearms where relevant, and escalation to law enforcement rather than intervention. Licensing and recording rules vary by jurisdiction; consult local authorities. Iowa statute demonstrates that private-security/investigative company obligations and confidentiality provisions are jurisdictional, not a national default ([Iowa Code](https://www.legis.iowa.gov/docs/code/2024/80A.pdf)).
- Noncompletion may be no observation, subject not located, unsafe conditions, client cancellation, conflicting assignment, or insufficient authority. Record billable status per contract and request renewed authorization before scope expansion.

## Customer communication and self-service

- Clients need intake acknowledgment, scope/budget approval, material status updates, exception/escalation notices, factual findings, deliverables, expense statements, and invoice status.
- Email and phone remain plausible channels, but sensitive documents should use controlled delivery. PI software supports client portals and secure sharing ([PI Core](https://butler.solutions/products/pi); [Casewyze](https://casewyze.com/)).
- A client portal can support authorized intake, approvals, document exchange, status, and invoices. Do not expose subject-facing self-service, automated investigative updates, or case facts to broad audiences. Automated contact must be reviewed for safety, privilege, confidentiality, and client instructions.

## Equipment, inventory, suppliers, and workforce

- Cameras, recording devices, vehicles, computers, research subscriptions, and secure storage vary by specialty. Assign equipment and evidence media to a matter only as needed; avoid assuming stock inventory is central.
- Solo firms may have no employees; agencies need investigator qualifications, licenses, training, assignments, hours/expenses, reviewer roles, subcontractor records, and possibly payroll exports. Avoid building a regulated credential model from one jurisdiction's rules.

## Reporting and operating measures

- Software vendors expose active cases, pending reports, billable hours, expenses, case aging, and investigator assignment ([ClearView PI](https://clearviewpi.net/)). These are observed product measures, not proven universal KPIs.
- Candidate measures: intake-to-authorization time, deadline compliance, budget/retainer burn, utilization by investigator, assignment outcome, report turnaround, evidence completeness, invoice aging, and repeat-client mix. Quality and outcome definitions should be tenant-owned.

## Existing software and operator evidence

- PI-specific offerings include PI Core, PIwitness, ClearView PI, CaseCore, and Investigator Professional; product pages emphasize matter/case records, evidence, surveillance logs, reports, assignments, hours, billing, and permissioned collaboration. This is a vendor-market signal, not independent proof of adoption share.
- A first-person PI forum thread names report writing as a persistent annoyance and asks peers to compare workflows; one participant describes using a report format adapted from federal work for 20 years ([operator discussion](https://www.reddit.com/r/PrivateInvestigators/comments/1mui907/venting_thread_surveillance_reports_workflow/)). Another investigator asks for case software with secure chat, email/scheduling, invoices, case-linked communication, custom workflows, and client portal ([software recommendations](https://www.reddit.com/r/PrivateInvestigators/comments/1is5xtb/pi_case_management_software_recommendations/)). These are anecdotal and self-selected.
- Existing stacks may combine case software, office suite, encrypted file storage, maps, research databases, phone/email, accounting, and payment tools. Do not infer the most common vendor stack from marketing pages.
- No robust evidence establishes operator pricing complaints or willingness to pay beyond visible software offers. Handling migration, data ownership, export, and existing case history are material buying questions; PI Core advertises hands-on migration support ([PI Core](https://butler.solutions/products/pi)).

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Customer=Client; job=Case/Matter; field worker=Investigator; customer types: attorney, insurer, business, individual as tenant-editable labels | PI software centers client and case, with distinct subjects | High; buyer list varies |
| `locationFields`, `assets` | Case fields for jurisdiction, authorized scope, deadline; configurable Subject/entity and Evidence reference records; access-sensitive fields | Vendor workflows emphasize case, subject, evidence, logs | Medium; contract's assets may not safely model evidentiary relationships |
| `services`, `recurrencePresets` | One-time assignment types by tenant specialty; no default recurrence | Irregular matter work | High |
| `formSteps`, `website` | Private inquiry, authority/scope, conflicts, budget, documents; hand to staff before acceptance | Sensitive intake and legality review | High |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Authorization, assignment, field log, report review, delivery, close/archive; noncompletion reasons configurable | Case workflow evidence | Medium |
| `pricingTemplates` | Tenant-authored hourly/day/flat fees, expense and retainer rules; avoid default rates | Pricing varies, operator-reported | High |
| `defaultAutomations` | Internal deadline/retainer reminders; client-facing messages require review | Confidentiality and scope risks | Medium |
| `reports` | Case aging, billable time/expense, report queue, invoice aging | PI incumbents surface cases/reports/hours | Medium |
| `inventoryDefaults` | Omit | Equipment varies; no stable common consumable set | High |
| `recommendationQuestions` | Solo/team; specialties; field surveillance; institution clients; secure portal need; staff/subcontractors | Determines case, field, and access complexity | Medium |
| `productCapabilityRecommendations` | Conditional `field_job_tracking`, `estimate_management`, `customer_self_service`; candidate secure evidence/case management key unconfirmed | Field assignments, variable quoting, client portal evidenced; evidence custody not confirmed in contract | Medium |
| `recommendedConnectorCapabilities` | `storage`, `email`, `calendar`, `accounting`, `payments`; `routing` conditional | Case documents, client communication, deadlines, invoicing; provider tools vary | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| Case management and secure evidence handling (candidate key unconfirmed) | normally_recommended | Core recurring record is matter, subject, assignment, field log, media and deliverable | High workflow fit; contract support unverified |
| `field_job_tracking` | conditional | Recommended for agencies assigning mobile surveillance or site visits; less relevant to desk-only research | Medium |
| `service_scheduling` | normally_recommended | Coordinate investigators, windows, deadlines and follow-ups | Medium |
| `estimate_management` | conditional | Important where scope/time/expenses require written authorization; lighter fixed-fee practices may need less | Medium |
| `invoicing`, `payment_collection` | normally_recommended | Track authorized hours, expenses, retainer and balances | Medium |
| `customer_notifications` | conditional | Case status and deadline communication depend on contract/client preference; sensitive messages need review | Medium |
| `customer_self_service` | optional | Secure intake, approvals, and evidence delivery may benefit; some clients require their own systems | Medium |
| `route_planning` | usually_unnecessary | Surveillance movement is case-specific and operationally sensitive; do not route by default | Low-medium |
| `inventory_tracking` | usually_unnecessary | No common stock pattern established | Medium |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Client, case, subject, assignment, deadline labels and tenant-defined matter stages | Pack configuration | PI incumbents center these records | Medium |
| Files, tasks, calendars, contacts, invoices, and role-aware access | Existing shared capability candidate | Useful only if current shared modules can adequately isolate cases | Low-medium; verify implemented permission model |
| Evidence chain-of-custody and controlled disclosure | Candidate core-platform gap only if existing file audit/access controls cannot safely represent provenance, immutable originals, custody events and export | Multiple PI vendors emphasize evidence integrity; runtime pack has no explicit chain-of-custody primitive | Medium candidate; do not assert confirmed platform gap without code/security review |
| Client relationship, billable hours, authorization, and report formats | Business-specific customization | Varies by client contracts, court/insurer requirements, and specialization | High |

No confirmed core gap is asserted from this research alone; chain-of-custody is an explicit review question against shared file/audit controls.

## Evidence, disagreements, and uncertainty

PI-software sources agree on case-centered records, field notes/media, reporting, assignment, and billing. Sources vary in depth, and vendor feature claims are not evidence of universal practice. Licensing and privacy rules vary by jurisdiction. The operator complaints available are self-selected forum posts; confidence is medium for report/admin burden and low for its prevalence. Important open questions: which practice segments Modular CRM targets; whether current file storage has immutable/versioned provenance and granular matter-level access; and whether clients require integrations with legal/claims systems.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [PI Core](https://butler.solutions/products/pi) | Investigation software vendor | Accessed 2026-09-24 | U.S. | Case, assignment, subject, evidence, reports, attorney/client workflow, migration | Vendor description; not adoption study |
| [PIwitness pricing](https://www.piwitness.com/pricing) | PI software vendor/pricing | Accessed 2026-09-24 | U.S. | Case/report/team features; advertised software prices | Advertised list price, vendor claim |
| [Iowa Code ch. 80A](https://www.legis.iowa.gov/docs/code/2024/80A.pdf) | State legislature/regulation | 2024 | Iowa | Licensing/security/investigation distinctions, regulatory file confidentiality | One jurisdiction only |
| [PI report workflow discussion](https://www.reddit.com/r/PrivateInvestigators/comments/1mui907/venting_thread_surveillance_reports_workflow/) | First-person investigator forum | Accessed 2026-09-24 | Unspecified | Report-writing complaint and long-lived reporting template | Anonymous/self-selected |
| [PI software recommendations](https://www.reddit.com/r/PrivateInvestigators/comments/1is5xtb/pi_case_management_software_recommendations/) | Investigator forum | Accessed 2026-09-24 | Unspecified | Requested secure communications, case-linked billing/workflows/portal | Request, not evidence of current stack |
| [ClearView PI](https://clearviewpi.net/) | PI software vendor/pricing | Accessed 2026-09-24 | U.S. | Case/evidence/invoice/schedule features; advertised pricing | New vendor; testimonials unverified |
| [Tervalum Investigator Professional](https://tervalum.com/products/investigator-professional/) | PI software vendor | Accessed 2026-09-24 | U.S. | Evidence file integrity/hash, report and billing workflow | Vendor feature claims |

## Handoff to a future pack implementer

Prototype a private staff-only intake-to-case workflow with explicit client/subject separation, assignment deadlines, matter-scoped documents, hours/expenses, approvals, report review, and secure delivery. Keep specialties, billing basis, retention, disclosure, evidence treatment, and legal notices tenant-configurable. Ask whether field surveillance is performed, which client segments dominate, whether clients need portals, and which records may be shared with which roles. Verify core file provenance, permissioning, audit, export, and retention before claiming evidence chain-of-custody support.
