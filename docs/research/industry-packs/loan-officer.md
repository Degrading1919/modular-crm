# Loan officer

## Profile metadata

- **Industry key:** `loan-officer`
- **Source name:** Loan officer
- **Source category:** Real estate transactions
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), Real estate transactions, position 5 (after “Appraiser”; before “Home inspection”).
- **Other exact/near duplicate labels:** Realtor (position 2) and Appraiser (position 4) are separate roles in the same transaction chain. The broad title can include commercial real estate lending; this profile distinguishes it from US consumer residential mortgage origination rather than assuming every loan is residential.
- **Research date:** 2026-09-24
- **Geographic scope:** US CFPB/FTC rules, SAFE Act licensing guidance and mortgage broker/vendor/operator sources. State and institution rules, product types and commercial loan practices vary.
- **Research status:** partial

## Executive summary

**Observed evidence:** In a US consumer residential mortgage workflow, a loan officer (LO/MLO) works for a depository lender, mortgage broker or nonbank lender to develop an application, compare products, coordinate disclosures and borrower documentation, shepherd underwriting/conditions, appraisal/title/insurance and closing. The CFPB's six application data points trigger a Loan Estimate deadline for covered transactions; Regulation Z constrains compensation tied to loan terms. Covered nonbank originators generally have state license and NMLS registration requirements, while bank employees generally register under a separate path. Mortgage origination software bundles LOS, point of sale (POS), product/pricing engine (PPE), disclosures, e-sign and lender connections.

**Inference:** Modular CRM can support referral/lead nurturing, status reminders and broker relationships around a specialist loan origination system. It should not store or disclose full sensitive underwriting files unless it meets lender security and data governance requirements. **Uncertain:** the candidate “Loan officer” may mean commercial real estate or other lending roles as well as consumer mortgage. This profile focuses on the well-documented residential mortgage case and labels commercial scope as unresolved; marked partial until that market is separately researched.

## Business model and customer segments

Consumer mortgage LOs originate purchase, refinance and other dwelling-secured loans for borrowers, sometimes sourced by real estate agents, builders, financial institutions, past clients or direct digital marketing. Mortgage broker LOs shop wholesale lender products and may self-pay per-seat LOS/PPE; bank/nonbank retail LOs operate inside employer systems and lead, compensation, disclosures and underwriting support are institution-controlled. Reverse mortgages, HELOCs, manufactured/mobile-home lending and assistance-program loans can follow different disclosure paths. Commercial real estate loan officers work with business entities/investors, property cash flow, rent rolls, sponsors, collateral and credit committee rather than the standard consumer TRID process; exact commercial pipeline is not established here. Loan officer is not the loan underwriter, appraiser, real estate agent, title company or servicer, though those parties coordinate.

## Terminology and durable records

Keep lead/referral, borrower/co-borrower, business entity, property/collateral, loan opportunity/application, lender/investor, product/pricing option, disclosures, documents/conditions, underwriting, lock, appraisal/title/insurance, closing and funded loan as linked records. Consumer mortgage intake may include name, income, SSN for credit, property address, estimated value and requested loan amount; CFPB defines these six pieces for covered Loan Estimate duty. This is highly sensitive personal/nonpublic financial information. Record status, consent, document checklist metadata, disclosure dates, contacts and secure LOS reference; avoid copying full SSN, tax returns, bank statements, credit report or complete underwriting documents into a general CRM. Property is collateral associated with a loan, but borrower financial profile and application are primary. Commercial loan records can involve sponsor/entity owners, business financials, property operating statements/rent roll and guarantors; separate from consumer file fields.

## Services, intake, quoting, and booking

Services may include initial financing conversation, prequalification/preapproval, application assistance, scenario comparison, application/disclosure delivery, document/condition follow-up and closing coordination. Intake distinguishes inquiry from application: under CFPB/Regulation Z, for covered TRID loans receipt of the six listed data elements triggers Loan Estimate timing; lender cannot require additional documents as condition for that Loan Estimate. The LE does not approve/deny the loan. After the consumer elects to proceed, additional verification and underwriting docs are collected. Compare offers using lender product/PPE and present eligibility/assumption limits; do not promise approval or rate lock. Booking is consultation, document session or milestone call; application/disclosure clocks cannot be treated as ordinary sales nurture. Commercial real estate LO intake needs entity, guarantors, project/asset, loan purpose, financing structure and cash-flow documents under lender-specific process and remains outside the residential preset.

## Pricing and commercial model

**Observed consumer service pricing/compensation:** Loan costs consist of lender/broker/third-party fees, interest and other terms disclosed in required forms; LO compensation may be employee salary/incentive or broker compensation. Regulation Z prohibits covered originator compensation based on a transaction term or proxy and includes rules on dual compensation/steering; do not configure a deal-based percentage of interest rate or a marketing fee that influences loan terms. Do not equate borrower loan amount, APR or closing costs with LO revenue. Commercial loan fees/compensation can use different institutional arrangements and are not established here.

**Software price/WTP:** ARIVE's official US pricing currently lists Broker Core at $49.99 per originator seat/month billed yearly or $59.99 monthly; Pro is $69.99 yearly-billed or $79.99 monthly, with separate support seats and non-delegated tier. It packages LOS/POS/PPE, Realtor portal, call reports, and depending on tier, API, built-in e-sign and disclosures. In a first-person loan-originator forum thread, one commenter says their shop pays for ARIVE and they personally pay about $46/month; another operator reported $70/month and $35/month assistant seat in older 2024 discussion. Vendor list price is authoritative at access date; Reddit is anecdotal actual operator spend, and amounts may be old/discounted or employer arrangements. Many retail/bank LOs use employer-provided systems, so individual WTP may be zero even when lender software spend is substantial. Software payment is distinct from consumer loan fees and compensation.

## Recurrence, scheduling, dispatch, and routing

Pipeline steps run from referral and consultation to application, disclosure, underwriting, conditions, clear-to-close and funding; files can stall for borrower docs, appraisal, title, insurance, eligibility or rate-lock expiry. Loan officers carry concurrent files and appointments; processors/underwriters handle many tasks. Reminder cadence is product and law-sensitive; statutory/business-day deadlines need LOS/compliance calculation and human oversight. Purchase closings depend on contract deadlines and counterparties; refinances, HELOC and reverse loans have distinct timelines. Commercial lending can have longer sponsor/data/credit committee stages, but no residential event schedule should be auto-applied. Rescheduled/fallen-through files require documented reasons and borrower communication.

## Field workflow, safety, completion, and rework

Referral/lead intake → explain role/products and consent → capture application data in approved POS/LOS → trigger required Loan Estimate based on covered application/date → borrower elects to proceed → collect/verify docs and provide required disclosures → submit to underwriting/product eligibility → coordinate appraisal/title/insurance and conditions → update borrower and partners → clear to close and ensure Closing Disclosure timing/receipt → close/fund and complete post-close quality/recordkeeping. CFPB gives covered closing disclosure delivery at least three business days before closing and exceptions exist; use current LOS/compliance rules. SAFE Act registration/licensure varies by institution and state. FTC Safeguards Rule applies to covered financial institutions, including many mortgage lenders/brokers, and requires a written information-security program appropriate to nature/size/sensitivity; data minimization, access controls, secure file exchange and vendor oversight are critical. Do not rely on CRM checkbox automation as legal compliance. Noncompletion: borrower withdraws, ineligible/denied, documents missing, appraisal/collateral issues, rate/terms change, title/insurance issue, lock expires, property contract fails or fraud concern. Rework includes corrected disclosures/application fields, updated docs, changed loan terms requiring new disclosures, re-underwriting and closing reschedule.

## Customer communication and self-service

Borrowers need clear next step, product/fee/rate comparison, request list, document receipt, disclosure explanation, timeline, appointment and closing reminders. Use the lender's approved portal for upload/identity-sensitive content; ordinary email/text should not carry full SSN or financial documents. Automated marketing and rates need compliance review and permission/consent. Communications can contact agent/LO partners with consent, but borrower status access must follow lender identity and privacy policy. Keep a human in charge of explaining estimates, changes, denial and borrower-specific conditions; the Loan Estimate is not approval.

## Equipment, inventory, suppliers, and workforce

Core operational system is LOS plus POS/PPE, credit provider, automated underwriting system (AUS), e-disclosure/e-sign, lender/investor/product connections, secure borrower portal and quality/compliance. Other tools include CRM, email/text, Realtor partner portal, pricing presentations, tasking and accounting. Roles can include licensed/registered originator, loan officer assistant, processor, underwriter, closer, compliance and branch manager. ARIVE sells separate originator/support seats; this is evidence that permissions/users differ. Inventory is not physical; the relevant “catalog” is product, rate/fee, lender overlays and pricing eligibility maintained by vendor/LOS and changes frequently. Do not put a locally maintained static loan-program catalog in an industry pack.

## Reporting and operating measures

LOs and managers may track lead source/contact conversion, applications, disclosures on time, lock/pull-through, approval-to-fund, cycle time, outstanding conditions, fallout reason, loan volume, quality/repurchase/early payment default measures and compliance exceptions. Lending institutions have specialized financial/quality reporting beyond CRM. Compensation and reporting metrics must respect Regulation Z and employer policy; never reward loan terms prohibited by law. Definitions and dashboards vary by channel/employer; no universal benchmark is claimed.

## Existing software and operator evidence

ARIVE describes LOS, POS, PPE, lender integrations, instant preapproval, application, digital docs, income analysis, disclosures and call reports. LendingPad terms show per-user LOS fees; vendor page uses contract terms, so not all software is per-seat. Reddit loan-originator threads mention ARIVE, LendingPad, Encompass, Calyx, credit pulls, CRM, LoanSifter/LenderPrice pricing tools, Homebot/MortgageCoach and employer-specific systems. One LO favors LendingPad's price; another describes systems provided by broker, while retail/bank LOs may have little choice. Common complaints include speed/data-entry ergonomics, incomplete application resending, disparate lender portals and data/doc workflow, but evidence is anecdotal. Security, LOS integration and licensing make a generic CRM a companion rather than a replacement for origination/compliance tools.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Lead/referral, borrower/co-borrower, MLO/LOA, application, loan opportunity, property/collateral, LOS/POS, disclosure, condition, lock, close; residential borrower and commercial sponsor kept distinct | CFPB, SAFE Act, LOS vendors | High for consumer mortgage; commercial partial |
| `locationFields`, `assets` | Property/collateral address/use/value plus transaction link; business property/entity separate | CFPB application fields; commercial distinction | Medium |
| `services`, `recurrencePresets` | Purchase/refi/HELOC/reverse/manufactured-financing inquiry types; no automatic service recurrence | CFPB exceptions and workflow | Medium-high |
| `formSteps`, `website` | Consent/lead intake; route to secure LOS for six application fields and documents; CRM stores minimal status/reference | CFPB timing/privacy risk | High |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Lead → application/LE timing → proceed/docs → underwriting/conditions → closing disclosure → funding; missing info, ineligible, borrower withdraws, collateral issue | CFPB/ARIVE | High for US covered consumer mortgage |
| `pricingTemplates` | No consumer loan offer pricing in CRM; connect to licensed LOS/PPE, quote via approved disclosure process; commercial parameters tenant/lender-specific | Reg Z/ARIVE | High |
| `defaultAutomations` | Consent-based lead reminder, appointment, secure doc request/status, LOS milestone sync; disclosure clock/calculation remains in system of record | CFPB/LOS vendor | Medium-high |
| `reports` | Lead conversion, application, on-time disclosures, conditions/fallout and funding per employer policy | LOS and operator evidence | Medium |
| `inventoryDefaults` | None; changing lender products/rates remain LOS/PPE data | ARIVE workflow | High |
| `recommendationQuestions` | Consumer residential or commercial? bank/broker/nonbank? license/registration? LOS/PPE and portal? covered disclosure type? employer security policy? | Channel and jurisdiction differ | High |
| `productCapabilityRecommendations` | Existing `customer_notifications`, `automation_workflows`, `customer_self_service`, `website_publishing`; conditional `online_booking`, `advanced_reporting`, `invoicing` only for allowed business model; candidate secure lending pipeline key unconfirmed | CRM supports lead communication; LOS owns regulated origination | Medium |
| `recommendedConnectorCapabilities` | `calendar`, `email`, `sms`, `crm_import`, `accounting`, `storage`; LOS/credit/AUS/PPE/disclosure connectors not in current key list and remain unconfirmed | Current stack is highly integrated | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `customer_notifications` | normally_recommended | Borrower and referral partner need case status/next steps through approved channel | CFPB/ARIVE; high |
| `automation_workflows` | normally_recommended | High-volume follow-up and condition reminders; compliance clocks must remain in LOS | ARIVE workflow; medium-high |
| `customer_self_service` | conditional | Borrower portal for secure intake/doc upload only if institution-approved and securely integrated | ARIVE; medium |
| `website_publishing` | optional | Broker/LO lead generation varies by employer and marketing policy | Operator/vendor evidence; medium |
| `online_booking` | optional | Consultation scheduling; not loan approval or disclosure timing | Workflow; medium |
| `advanced_reporting` | conditional | Branch/brokerage volume, pipeline and quality analytics; staff LO may not control reporting | ARIVE call reports; medium |
| `service_scheduling` | usually_unnecessary | Meetings and milestones use calendar/LOS; field-service dispatch is not core | Workflow; medium-high |
| `invoicing`, `payment_collection` | usually_unnecessary | Consumer lender fees/disclosures/compensation are controlled through lender/closing systems; independent CRM payment may be inappropriate | CFPB rules; high |
| Candidate secure borrower-document intake, lending application pipeline or compliance-timeline capability; keys unconfirmed | conditional | CRM could handle low-risk leads/status only; secure underwriting docs/deadlines require LOS controls | FTC/CFPB and vendor stack; core gap not proven |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Lead source and borrower/referral labels, consultation and communication defaults | Pack configuration | LO and referral workflow | Mortgage sales / medium-high |
| Contact records, tasks, calendar, notifications, web forms and reporting | Existing shared capability for CRM-adjacent work | Modular CRM shared features support lead relationship workflow | Medium-high |
| LOS/POS/PPE, credit/AUS, disclosure generation, secure borrower doc vault and NMLS compliance | Specialist software/integration boundary; connector keys unconfirmed | ARIVE markets integrated LOS/POS/PPE; CFPB/FTC require specialist-controlled process/data safeguards | Mortgage industry / high |
| Candidate core-platform gap | Not established by current research | Need for regulated LOS does not prove shared CRM has a cross-industry platform gap; safe integration may be enough, but no technical assessment performed | None proven / low |

## Evidence, disagreements, and uncertainty

**Observed evidence:** CFPB defines a consumer mortgage application trigger and required disclosure timing; SAFE Act requirements distinguish licensed non-depository originators and registered covered-bank originators; FTC Safeguards Rule covers many mortgage institutions and sensitive borrower data. ARIVE sells tiered per-user LOS/POS/PPE software, and operators describe both self-paid broker arrangements and employer-provided stacks. **Inference:** a CRM IndustryPack should not duplicate application/disclosures or copy sensitive documents by default; record minimal lead and milestone information, then hand off securely. **Uncertain:** candidate may include CRE loan officers, institutional banking officers or private lending; commercial workflow and pricing were not investigated deeply. Jurisdiction, product exceptions, employer approvals, consent, GLBA/Safeguards applicability and compensation policy need confirmation. Partial status reflects unresolved scope and diversity of commercial lending.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [CFPB: Loan Estimate application data](https://www.consumerfinance.gov/ask-cfpb/what-information-do-i-have-to-provide-a-lender-in-order-to-receive-a-loan-estimate-en-1987/) | US consumer financial regulator | Accessed 2026-09-24; reviewed Apr. 3, 2024 | US covered mortgage | Six data points and three-business-day Loan Estimate | Exceptions for product/transaction types |
| [CFPB Regulation Z §1026.36](https://www.consumerfinance.gov/rules-policy/regulations/1026/36/) | US regulator, current regulation | Accessed 2026-09-24; part amended Apr. 8, 2026 | US covered dwelling credit | Loan originator compensation restrictions | Scope/exceptions require legal/compliance review |
| [CFPB SAFE Act licensing FAQs](https://www.consumerfinance.gov/compliance/compliance-resources/mortgage-resources/secure-fair-enforcement-for-mortgage-licensing-act/secure-fair-enforcement-mortgage-licensing-act-faqs/) | US regulator | Accessed 2026-09-24 | US | Registered versus state-licensed originators | FAQ last updated 2019; confirm current statute/state rules |
| [FTC Safeguards Rule guide](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know) | US regulator | Accessed 2026-09-24 | US covered financial institutions | Security program and nonpublic customer data | Applicability/small-entity details vary |
| [ARIVE pricing](https://www.arive.com/pricing) | Current mortgage LOS/POS/PPE vendor pricing | Accessed 2026-09-24 | US | Per-seat tier list prices and product packaging | Vendor pricing; excludes institution-specific ancillary costs |
| [ARIVE platform description](https://www.arive.com/) | Incumbent software vendor | Accessed 2026-09-24 | US | LOS/POS/PPE, digital docs, AUS/lender integrations and disclosures | Marketing description |
| [LendingPad terms of service](https://lendingpad.com/terms-of-service) | Mortgage LOS vendor terms | Accessed 2026-09-24 | US | Broker edition per-user monthly fees, contract payment | Terms may not reflect every plan/customer |
| [LO software/WTP discussion](https://www.reddit.com/r/loanoriginators/comments/1whbg30/mortgage_los/) | First-person originator forum | Accessed 2026-09-24 | US, unclear | Operator mentions shop-paid ARIVE and self-paid monthly amount | Anonymous, anecdotal, may be negotiated |
| [Mortgage LOS and software stacks](https://www.reddit.com/r/loanoriginators/comments/1ryochf/what_is_your_tech_stack_what_programssoftware_do/) | Originator forum | Accessed 2026-09-24 | US, unclear | LOS/PPE/CRM and adjacent software variation | Self-selected answers; not prevalence data |

## Handoff to a future pack implementer

Ask residential consumer vs commercial/other lending, bank vs broker/nonbank, employer-selected LOS, secure portal, license/registration state, products, application/disclosure responsibility and what lead/status data CRM may store. Prototype referral/lead records, communication consent, consult appointments and a minimal LOS-linked milestone status. Keep application, rate/fee comparison, disclosure dates, personal financial documents and compensation rules in institution-approved systems. Validate with compliance officer and commercial originators before broadening the candidate pack.
