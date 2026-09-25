# Property Management

## Profile metadata

- **Industry key:** `property-management`
- **Source name:** Property manager
- **Source category:** Real estate transactions
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), Real estate transactions position 6 (1-based within heading); unlinked entry.
- **Other exact/near duplicate labels:** Vacation rental management and house staging are separate profiles and workflows.
- **Research date:** `2026-09-24`
- **Geographic scope:** US residential long-term rental emphasis; commercial, HOA, student, affordable and state/local variants differ.
- **Research status:** complete

## Executive summary

**Observed evidence.** A residential manager operates rental property/units for an owner, coordinating tenants/residents, applicants, staff and vendors. The lifecycle is owner onboarding → property/unit and listing setup → prospect/application/lease → recurring rent and tenant service → maintenance request/work order → inspections/renewal/turnover → owner accounting and reporting. NARPM defines the owner as the typical client and the tenant as the person/entity renting or occupying managed property, and emphasizes ethics/fair housing. Incumbent platforms center property accounting, leasing, resident portals, maintenance, inspections, owner statements and vendor workflows.

This is distinct from short-term vacation rental management: tenants occupy under leases with recurring rent and longer service cycles; STRs have nightly reservations and rapid turnovers. It also differs from house staging, a one-time sales preparation project with furniture installation/removal. **Inference:** shared CRM contacts, assets, forms, workflows, communication and reporting are useful, but specialist property accounting/ledger, trust controls, leasing/screening and legal compliance are not proven by generic CRM primitives.

## Business model and customer segments

- A management firm is retained by property owners; tenants are separate service recipients. Owners include individual investors, firms, and associations. Portfolios include single-family, multifamily, mixed-use/commercial, affordable/student housing and community associations.
- Services can include marketing vacancies, inquiry/tour, application/screening coordination, lease administration, rent collection, tenant service, maintenance triage/vendor dispatch, inspections, renewals, move-out/make-ready and owner statements. Leasing-only and partial-scope firms exist.
- Fee forms may include percentage of collected rent, per-unit monthly amount, leasing/renewal/setup fees, project/maintenance coordination and pass-through expense. Agreements and local conditions vary; no universal rate validated here.
- Work recurs by lease/rent period, with peaks around leasing season, move-in/out, renewal, emergency maintenance and acquisition. A small landlord may work in email/spreadsheets; larger firms use portfolios, staff and vendors.
- Fair housing, tenant protection, licensing, deposits, notice, habitability and privacy requirements vary. Pack defaults must not automatically decide legal eligibility or notices.

## Terminology and durable records

- Terms: owner/client, tenant/resident, applicant/prospect, property, building, unit, lease, rent ledger, work order, maintenance request, vendor, inspection, unit turn, owner statement, reserve.
- Location facts: legal address/unit, occupancy, access, utility responsibility, systems/appliances, common areas, lease dates, owner approval limits, emergency contact, jurisdiction and policy references.
- Property/building and rentable units are durable assets; appliances and building systems need age/serial/warranty/inspection/repair history. Lease, tenant, deposit, rent ledger and work order are associated records, not single person fields.
- Protect owner finances/statements from tenant/vendor view. Screening and tenant personal data need least access, retention limits and local handling rules. Owner and resident portals need distinct permissions.

## Services, intake, quoting, and booking

- Owner onboarding gathers management agreement, authorized property/unit list, approval matrix, ledger/bank and reserve setup, existing lease/deposits/balances, insurance, vendor list, emergency protocol and property documents.
- Leasing lifecycle: inquiry and unit → tour → application/consent → screening coordination → decision → lease/signatures → move-in condition/keys. Never encode prohibited selection criteria or infer screening eligibility.
- Tenant setup records lease/occupancy, contacts, relevant lawful household/access info, emergency contacts, payment setup, move-in condition and notice preference.
- Tenant self-service can support rent, maintenance with photos/availability, documents and status. Work orders may require site inspection/quote and owner authorization; cost depends on trade, urgency, vendor, materials and property condition. Emergency steps follow local policy.
- Tours are appointments; tenancy is a lease term with due dates. Do not model rent as service recurrence.

## Pricing and commercial model

- Fee drivers include units/type, collected rents, vacancy/turnover, geography, scope (leasing, maintenance, inspections, accounting), after-hours coverage and vendor volume. Agreements set fee basis, leasing/renewal, pass-throughs, spend authority, reserve, termination and records custody.
- Rent, deposits, late charges, reimbursements, manager fee, vendor bills and owner distributions are separate flows. IRS Publication 527 covers rental income/expenses by property; local trust/fiduciary/accounting rules are separate.
- **Software WTP evidence:** Buildium advertises Essential **$62/month**, Growth **$192/month**, Premium **$400/month**, accessed 2026-09-24; transaction/screening/signature fees depend on tier. AppFolio pricing is quote-only and its public page states 50-unit minimum plus minimum spend. These are list/package signals, not evidence of a particular small firm's purchase or CRM budget.

## Recurrence, scheduling, dispatch, and routing

- Rent cycle follows lease, typically monthly but not universally; renewals and expiration create tasks. Recurrence presets may suit inspections/preventive service, not rent itself.
- Maintenance triage distinguishes emergency/safety, habitability, routine repair, preventive work and unit turns. Assignment uses trade/skill, availability, access, urgency, property and owner approval.
- Turn sequence: vacate → inspection → scope/quote → approval → repairs/cleaning → reinspection → ready → lease. Leasing includes tours, move-in/out and renewal dates.
- Schedule vendor, resident availability/access, parts, owner approval and deadlines. Route planning is conditional; many firms dispatch work orders rather than dense routes.
- Reschedule/no access, vendor no-show, parts delay, weather emergency, approval delay and dispute require logged owner, next step and notice.

## Field workflow, safety, completion, and rework

- Maintenance: resident request → triage → entry/access permission → owner/vendor decision → work order/quote → approval → work → notes/evidence/invoice → tenant update → property ledger/reconciliation → close/follow-up.
- Inspection/turn: notice/access → checklist/photos/readings → safety/repair issue → owner decision → work → reinspect → ready or escalate. AppFolio markets work orders, inspections, unit turns and purchase orders; Buildium markets work-order management and unit-turn automation.
- Proof: request narrative/photos, entry/notice record, estimate/approval, timestamped work/parts, invoice and tenant update. Escalate gas/fire/electric/water/structural hazards under local protocol; this profile is not a legal checklist.
- Noncompletion: no access, resident reschedule, vendor delay, parts, owner declined, unsafe, duplicate or issue not reproduced. Record chargeability and follow-up.

## Customer communication and self-service

- Owners need vacancy/lease status, rent collected, expense approvals, reserve, statements, inspection reports, renewal/turn forecasts and emergencies. Residents need leasing/payment history, maintenance intake/status, entry notices, documents and emergency contacts.
- Buildium markets resident portals; AppFolio documents resident payment, photo maintenance requests and documents, plus owner and vendor portals. Manager configuration affects availability.
- Use email/SMS/call/portal or legally required written notices by event and jurisdiction; distinguish notices from marketing and log delivery/acknowledgment where required.
- Do not automate adverse application decisions, entry/eviction notices, deposit disposition or emergency judgments without approved local rules and human review.

## Equipment, inventory, suppliers, and workforce

- Building systems/appliances are durable assets. Parts may be vendor-supplied or manager-stocked. Purchase orders, vendor insurance/licensing, bids and access records can matter.
- Roles include leasing agent, portfolio manager, maintenance coordinator, accountant, inspector, in-house technician and contractor. Time/payroll/certification needs vary.
- AppFolio lists purchase orders/inventory, vendor portal, staff calendar/time tracking and maintenance. Buildium lists work orders, staff calendar/time tracking and maintenance. Product availability is not proof of universal adoption.

## Reporting and operating measures

- Useful measures: rent roll/collections, delinquency, vacancy, leasing pipeline, renewals, maintenance response/close time, turn days/cost, spend by property/unit/category, vendor performance, owner cash/statement, staff workload and inspection outcomes.
- Incumbents market property accounting/reporting, maintenance reports and business analytics. Define KPI calculations with operators.
- Cut by owner, property, unit, tenant, lease, vendor, urgency, territory and period. Owner statements reconcile property income and expenses; rent roll is not company revenue.

## Existing software and operator evidence

- Buildium bundles rental listing/prospect/application, resident experience, accounting, maintenance, unit turns, communication and reporting. AppFolio includes property accounting/reports, leasing, work orders, inspection/unit turns, integrated communication and owner/resident/vendor portals; tiers are quote based with unit/spend minimums.
- Likely connected stack includes PMS, listings, bank/accounting, screening, e-signature, payments, maintenance vendors, forms, spreadsheets, email and calendar. This is inferred from incumbent scope; not a measured prevalence estimate.
- First-person complaint evidence is mixed and anecdotal. A Reddit property-management user said owner-originated maintenance intake was unavailable in their AppFolio setup and email was a workaround; another operator thread objects to changing portal payment fees. A separate operator praises centralized accounting/maintenance/communication. These are not representative and indicate different workflows/company contexts.
- Buildium's public plans are $62/$192/$400 monthly; AppFolio quote-only with 50-unit minimum. Payment, screening and document fees may be additional. Exact AppFolio spend is not public on the cited page.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Owner/client, tenant/resident, applicant, vendor. Separate owner, occupant and prospect. | NARPM definitions and incumbent portals. | High. |
| `locationFields`, `assets` | Property/building, unit count/type, jurisdiction, occupancy, access, systems/appliances, emergency and approval facts; leases associate to units. | PMS product scope. | High; lease is not a first-class contract type. |
| `services`, `recurrencePresets` | Leasing, inspection, preventive work, maintenance, turn, renewal; monthly rent is ledger obligation. | Incumbents. | High. |
| `formSteps`, `website` | Owner portfolio intake; inquiry/tour/application and tenant maintenance are separate paths. | Buildium leasing/resident surfaces. | Medium; compliance-sensitive. |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Request → triage → quote/approval → dispatch → proof/invoice/ledger; unit turn stages. | Buildium/AppFolio maintenance products. | High. |
| `pricingTemplates` | Management fee, leasing/renewal, per-unit monthly, admin/pass-through, minimum/reserve. | Common commercial options, contract-specific. | Medium/low; local pricing needed. |
| `defaultAutomations` | Request receipt/status, urgency escalation, renewal reminder, owner approval, statement-ready; legal notices reviewed. | Incumbent communication/automation. | Medium. |
| `reports` | Vacancy, lease/renewal, rent/AR, repair response/cost, turn, vendor and owner statement. | Incumbent reporting. | High. |
| `inventoryDefaults` | Optional filters, bulbs, detector batteries, maintenance supplies. | AppFolio lists inventory. | Low; tenant-specific. |
| `recommendationQuestions` | Units/segment/states, who holds funds, in-house maintenance, leasing/screening, existing PMS, approval level. | Changes workflow and compliance. | High. |
| `productCapabilityRecommendations` | Reuse `service_scheduling`, `payment_collection`, `invoicing`, `customer_notifications`, `customer_self_service`, `online_booking`, `estimate_management`, `automation_workflows`, `field_job_tracking`, `time_tracking`, `payroll_inputs`, `inventory_tracking`, `multi_location_management`, `advanced_reporting`. | Existing functional keys. | Medium; accounting/compliance exceed generic CRM. |
| `recommendedConnectorCapabilities` | `payments`, `accounting`, `email`, `sms`, `calendar`, `storage`, `geocoding`, conditional `routing`, `crm_import`. | Current connector keys. | High at category level. |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `property_lease_management` (candidate key, unconfirmed) | normally_recommended | Lease, term, unit occupancy, renewal, applicant pipeline. | High need; key unconfirmed. |
| `property_accounting_owner_ledger` (candidate key, unconfirmed) | normally_recommended | Rent, expense, deposit/reserve, owner statement and distribution. | High need; controls unverified. |
| `maintenance_work_orders` (candidate key, unconfirmed) | normally_recommended | Resident intake through vendor completion and bill. | High. |
| `tenant_screening` (candidate key, unconfirmed) | conditional | If manager performs screening; compliant third-party workflow required. | High function; local regulation varies. |
| `service_scheduling`, `customer_self_service` | normally_recommended | Inspections/work orders and separate owner/resident portal. | High. |
| `estimate_management` | conditional | Repair bids or owner approval before work. | High. |
| `payment_collection`, `invoicing` | normally_recommended | Rent, fees and vendor bills require reconciled flows; funds held for owners need specialist accounting integration. | High; trust accounting design open. |
| `field_job_tracking` | conditional | In-house techs/inspectors or dispatched vendor work. | High. |
| `route_planning`, `inventory_tracking` | conditional | Many field visits or manager-stocked supplies. | Medium. |
| `website_publishing`, `online_booking` | optional | Market vacancies/tours; applications need review. | Medium. |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Owner/resident/applicant/vendor terms, property/unit intake, maintenance, turn, escalation and report defaults | Pack configuration | Vertical defaults map to generic IndustryPack fields/workflows. | Industry-specific; high. |
| Tenant-scoped contacts/assets, forms, work scheduling, messaging, workflows, connectors | Existing shared capability, subject to app implementation | Current contract expresses these generic structures. | Cross-industry; medium. |
| Property-level trust accounting, owner reserves/distributions and audit controls | Candidate gap or external PMS/accounting integration; unconfirmed | Generic payment/invoice recommendations do not establish owner-fund segregation, ledger reconciliation or trust controls; incumbents position property accounting centrally. | Real estate/associations; medium need, low build-vs-integrate evidence. |
| Lease/application/screening and controlled notices | Specialized capability/integration; no core gap established | Workflow labels cannot prove legal compliance, screening or document signatures. | Rental housing; medium. |
| Fee, approval limit, maintenance model, lease/notice policies and vendors | Business-specific customization | Varies by contract, portfolio, role and location. | High. |

No additional core gap is established. Current contract can express vertical defaults, but not prove specialized accounting/compliance exists.

## Evidence, disagreements, and uncertainty

Evidence agrees on separate owner/tenant roles and property/unit, lease/rent, maintenance, leasing and owner reporting workflows. Product tiers vary by portfolio size and add-on fees. Operator anecdotes disagree on fit and fees; they do not represent the market. This profile focuses on residential long-term management because the source's “property manager” is broad. Validate small landlords vs institutional, HOA/commercial needs, state licensing, funds custody and the PMS/accounting system of record.

Confidence is high for lifecycle and actor distinction; medium for pack fit; low for fee ranges, stack prevalence and build-vs-integrate accounting choices.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love) | Candidate list | Accessed 2026-09-24 | US-centric | Candidate listed under real estate transactions. | No linked workflow detail. |
| [NARPM Code of Ethics](https://www.narpm.org/code-of-ethics/) | Trade association standard | Accessed 2026-09-24 | US | Client/tenant definitions, ethics/fair housing. | Members' code, not law or all firms. |
| [Buildium pricing](https://www.buildium.com/pricing/) | Incumbent product/pricing | Accessed 2026-09-24 | US | Tier price, accounting/leasing/maintenance/resident functions and transaction charges. | Vendor claims; fees/add-ons vary. |
| [AppFolio pricing](https://www.appfolio.com/pricing) | Incumbent product/pricing | Accessed 2026-09-24 | US | Core/Plus/Max, owner/resident/vendor operations, quote-only and minimum units/spend. | No exact public price. |
| [AppFolio owner portal](https://www.appfolio.com/help/owner-portal) | Incumbent help | Accessed 2026-09-24 | US | Owner statements/reports. | Product documentation. |
| [AppFolio online portal](https://www.appfolio.com/help/online-portal) | Incumbent help | Accessed 2026-09-24 | US | Resident payment, maintenance with photos, documents. | Manager controls some functions. |
| [IRS Publication 527](https://www.irs.gov/publications/p527) | Federal authority | 2025 ed.; accessed 2026-09-24 | US | Rental income/expense records and reporting. | Not individualized tax or trust-law guidance. |
| [HUD Fair Housing guide](https://www.hud.gov/sites/dfiles/PIH/documents/PHOG_Fair_Housing_Nondiscrimination_Requirements.pdf) | Federal housing agency | Accessed 2026-09-24 | US | Fair Housing Act coverage includes managers and owners. | Public housing guide, not exhaustive legal advice. |
| [Owner maintenance discussion](https://www.reddit.com/r/PropertyManagement/comments/ws1p8h) | Anonymous first-person operator discussion | 2022; accessed 2026-09-24 | Unknown US market | One AppFolio owner-request email workaround. | Old, isolated anecdote. |
| [AppFolio payment discussion](https://www.reddit.com/r/appfolio/comments/141r69c) | Anonymous first-person operator discussion | 2023; accessed 2026-09-24 | US | Payment-fee change concern. | Anecdote; terms differ by account. |

## Handoff to a future pack implementer

Prototype durable property/building and unit records; separate owners, tenants, applicants, vendors and staff; connect leasing, work orders, inspections, turns and renewals. Ask segment/unit count, states, funds/accounting system, leasing/screening scope, maintenance model, owner approval thresholds and existing PMS. Keep accounting, screening, legal notices, access and local rules under explicit tenant/jurisdiction control. Validate with small and institutional operators before proposing a core ledger.
