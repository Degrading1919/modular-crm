# Credit repair consulting

## Profile metadata

- **Industry key:** credit-repair-consulting
- **Source name:** Credit repair consulting
- **Source category:** Training / Coaching / Consulting
- **Candidate source:** [Sweaty Startup candidate inventory](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Training / Coaching / Consulting, position 7 of 8.
- **Other exact/near duplicate labels:** None established; credit counseling/debt settlement are separate services and may have different regulation.
- **Research date:** 2026-09-24
- **Geographic scope:** US, with federal and state legal requirements; high regulatory sensitivity.
- **Research status:** complete

## Executive summary

**Observed evidence:** Credit repair firms assist consumers with review/dispute workflows around credit reports. The FTC says the Credit Repair Organizations Act (CROA) restricts deceptive promises and advance fees, and contracts must include service detail, timing/guarantees and cancellation language. A specialist CRM vendor advertises lead capture, agreements, client onboarding, dispute letters, secure access, tasking, messaging, invoicing and client-count software plans. This is a regulated document/case-management business, not a field service.

**Caution:** No profile should automate dispute validity, promise score improvement, or replace counsel/compliance review. State laws may add requirements. Consumer-protection risk and sensitive financial data justify human review and careful source/versioning.

## Business model and customer segments

- Consumers hire a credit repair organization to review report information and help challenge inaccuracies. Some firms market education or monitoring; distinguish those services from debt relief, credit counseling, or legal representation.
- Client intake is sensitive and often remote; revenue may be subscription/program or service milestone-based, but CROA timing restrictions materially constrain billing. Do not assume monthly upfront fee is lawful.
- Solo consultants and multi-agent firms differ in file volume, dispute operations, team permissions and partner/referral arrangements.

## Terminology and durable records

- Records: consumer/client, bureau/report source and date, account/item being reviewed, client authorization, service agreement, disclosure/cancellation window, dispute action, evidence/document, correspondence, response/deadline and invoice.
- No physical service location is required. Secure client access and protected document exchange are common incumbent product claims.
- Credit reports, account numbers, identity documents, financial hardship, dispute correspondence and SSN are highly sensitive. Minimize storage and use access controls; do not expose full identifiers in CRM notes.

## Services, intake, quoting, and booking

- Intake should collect only needed contact/authorization data, service description, goals, credit report source/date and desired consulting scope. Avoid promising removal of accurate negative information or score results.
- CROA obligations include required contract disclosures and three-business-day cancellation opportunity; FTC guidance says credit repair organizations cannot collect before promised services are performed under federal law. Requirements and exceptions should be verified by counsel before product workflow.
- Quote, service progress, billing trigger and contract must align with applicable rules. Human compliance review before onboarding and each billing process.

## Pricing and commercial model

- Public fee model examples cannot be generalized; federal law materially affects advance collection. Treat service pricing and legal billing trigger as separate fields.
- **Observed software list pricing:** Credit Repair Cloud help page accessed 2026-09-24 lists Personal $49/month, Start $179, Grow $299, Scale $399, Enterprise $599, with different client/user caps. These are vendor prices for software, not consumer credit repair service rates or independent WTP.
- Direct consumer software WTP evidence is limited. Vendor packaging by active client and seats is observable price positioning, not proof of purchase/conversion.

## Recurrence, scheduling, dispatch, and routing

- Cases recur through evidence requests, disputes, responses and follow-up timing; track item-level status and service milestone. Deadlines differ by bureau, statute and dispute type; validate legal requirements externally.
- Capacity is case-manager workload and number of open client records, not field routing. Missed client documents or bureau response should create review tasks.
- Pause/close/cancel needs clear reason and contract/cancellation state.

## Field workflow, safety, completion, and rework

- Compliance-screened lead → disclosure/agreement and cancellation period → authorized data collection → report/item review → accurate dispute/service action → maintain copy/evidence and communication → review responses → report completion and billing per lawful contract → close or continue case.
- FTC warns against claims that accurate negative data can be removed; CROA prohibits deceptive claims and up-front fees, and requires contract information. This is federal baseline discussion, not a full compliance checklist.
- Rework includes insufficient evidence, consumer identity/authorization issue, mistaken account, bureau response, creditor dispute, complaint or legal escalation. No automated claim about score outcome.

## Customer communication and self-service

- Client needs clear scope, legally required disclosures/cancellation instructions, document upload, status, action performed, required consumer next steps and billing. Use secure portal and retain acknowledgement/timestamps.
- Marketing language must not guarantee results. Sensitive automated notices should avoid disclosing financial details on an unverified channel.

## Equipment, inventory, suppliers, and workforce

- No field equipment/inventory. Specialist software includes dispute-letter libraries, document generation, client access, billing, tasking, client messaging and team seats.
- Case managers should understand limits and escalation rules. State licensing/registration and telemarketing requirements require current jurisdiction-specific review; profile does not make legal determination.

## Reporting and operating measures

- Incumbent advertises active-client capacity, client onboarding, tasks/events, team, invoices and case workflows. Useful measures: time to authorization, missing-document age, open items/case, action turnaround, cancellation, complaint, billing milestones, collections and retention.
- Avoid ranking consultants by score change, which is not fully controlled by provider.

## Existing software and operator evidence

- Credit Repair Cloud is an incumbent product with publicly documented service workflows and plan pricing. Its vendor support docs show feature and client/user limits; this confirms packaging but not adoption.
- Owner discussions ask for client/workflow software and mention Credit Repair Cloud/DisputeFox. This is anecdotal and may include promotion. A separate FTC/consumer environment has complaints/scam allegations about promised outcomes and billing; do not characterize every firm from one complaint.
- No reliable owner-reported willingness-to-pay beyond list pricing was found.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| terminology, customerTypes | Consumer/client, authorized account item, dispute case, bureau response | FTC and software workflows | High |
| locationFields, assets | None for field service; secure account/document collection | Remote case work | High |
| services, recurrencePresets | Report review/dispute assistance/follow-up; legally reviewed case stages | Specialist software | Medium |
| formSteps, website | Service scope, consent, required contract disclosures, secure intake | CROA and vendor flows | High; legal counsel review |
| jobChecklist, noncompletionReasons, workflows | Contract/disclosure/cancel window, authorization, action evidence, response tracking | FTC requirements | High, but no legal automation |
| pricingTemplates | Service billing milestones only after compliance validation | Federal advance-fee restriction | High caution |
| defaultAutomations | Secure document reminder and case follow-up; suppress sensitive content | Workflow inference | Medium |
| reports | Active caseload, response/missing-doc age, complaint, cancellation, lawful billing status | Product features and legal lifecycle | Medium |
| inventoryDefaults | None | No physical stock | High |
| recommendationQuestions | State(s), service scope, legal review, billing model, secure storage, team size | Compliance differs | High |
| productCapabilityRecommendations | document_management, workflow, customer_portal; credit_dispute_case_management is an unconfirmed candidate key | Regulated document workflow | Medium |
| recommendedConnectorCapabilities | storage, email, sms, payments, accounting; integrations require privacy/security review | Case communication and billing | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| document_management | normally_recommended | Reports, authorizations, contracts and evidence | High |
| customer_portal | normally_recommended | Secure client file/status access | High |
| service_scheduling | optional | Consults and case review milestones | Medium |
| invoicing | conditional | Only after legally compliant service is performed | High caution |
| field_job_tracking | usually_unnecessary | Remote consulting | High |
| inventory_management | usually_unnecessary | No field stock | High |

The source material does not establish a need for AI provider integration. Any future use for drafting would require human review and legal/privacy controls; no AI connector is recommended from this evidence.

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Client stages, documents, service milestones and secure messages | Pack configuration | Current specialist incumbent offers these | High |
| Customer, document, task, messaging and billing primitives | Existing shared capability | Current CRM contract | Medium |
| CROA-compliant billing and disclosures | Business-specific legal configuration and human review | FTC guidance and state variation | High |
| Specialized bureau/letter integrations | No core gap established | Incumbent niche tools exist; requirements not independently validated | Medium |

## Evidence, disagreements, and uncertainty

Evidence is high for federal consumer-protection constraints and an incumbent software product; medium for case workflow; low for direct operator complaints/WTP. Federal guidance is not exhaustive and state law may impose more. Legal review is required before operationalizing contract/billing defaults.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [FTC consumer credit repair guide](https://consumer.ftc.gov/sites/default/files/articles/pdf/pdf-0034-credit-repair.pdf) | Federal Trade Commission | Accessed 2026-09-24 | US | CROA restrictions and consumer guidance | Federal overview, not exhaustive legal advice |
| [FTC credit repair company guidance](https://www.ftc.gov/business-guidance/blog/2019/06/ftc-says-credit-repair-company-en-croa-ched-consumer-rights) | FTC enforcement guidance | 2019 | US | Deception, advance fee, contract disclosures/cancellation | Enforcement example, not complete checklist |
| [Credit Repair Cloud pricing/features](https://help.creditrepaircloud.com/en/articles/13943532-credit-repair-cloud-pricing-plans-features-and-client-limits) | Niche software incumbent | 2026 | US product | Client/user tiers, secure access, case tools and prices | Vendor documentation/list prices |
| [Credit Repair Cloud product](https://www.creditrepaircloud.com/) | Niche software vendor | Accessed 2026-09-24 | Product | CRM and dispute workflow positioning | Marketing |
| [Credit repair workflow question](https://www.reddit.com/r/gohighlevel/comments/1r0xa8m) | Business community | Accessed 2026-09-24 | US anecdotal | Owner seeking workflow software | Promotional reply disclosed |
| [FTC consumer warning](https://consumer.ftc.gov/consumer-alerts/2024/08/only-scammers-say-theyll-remove-all-negative-information-your-credit-report) | FTC consumer advice | 2024 | US | Do not promise removal of accurate negative information | Consumer warning, not software evidence |

## Handoff to a future pack implementer

Before implementation confirm service scope, states served, counsel-reviewed contract/billing rules, required disclosures/cancellation tracking, security/data retention, and connected bureau/letter system. Prototype secure case records and auditable milestones, but leave legal interpretation and billing release to human compliance review. This should be a specialized case-management workflow, not field service.
