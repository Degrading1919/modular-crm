# College acceptance consultation

## Profile metadata

- **Industry key:** college-acceptance-consultation
- **Source name:** College acceptance consultation
- **Source category:** Training / Coaching / Consulting
- **Candidate source:** [Sweaty Startup candidate inventory](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Training / Coaching / Consulting, position 6 of 8.
- **Other exact/near duplicate labels:** None established; general tutoring/test preparation are related but distinct services.
- **Research date:** 2026-09-24
- **Geographic scope:** Primarily US college admissions; country, institution and admission cycle differ.
- **Research status:** complete

## Executive summary

**Observed evidence:** Independent educational consultants help students/families with college research, fit, application calendar, school list, essay/process coaching, interviews, and decisions. Work is deadline- and academic-cycle based, spans months, and involves student and parent communication. IECA standards require confidentiality, a client agreement delineating services and referring beyond competence; NACAC has ethical guidance for consultants.

**Inference:** CRM workflow centers on family/student intake → needs and fit assessment → scope/engagement agreement → application cycle and institution deadlines → advising sessions and task tracking → student-authored materials feedback → decisions/transition and next-cycle closeout. Consultants should support student work rather than write essays; do not promise admission outcomes. It is a consulting relationship, not field service.

## Business model and customer segments

- Students and families buy one-time list/essay/interview support or ongoing advising across application cycles. Clients may include high-school students, transfer, international, graduate or nontraditional applicants; the source label does not specify which.
- Calendar is driven by student year, application round, institution deadlines, test/visit periods and family availability. A solo consultant and firm/team have different caseload and assignment workflows.
- Consultation is often sensitive due to minors, educational records, family discussions and admissions expectations. Clear client and guardian roles matter.

## Terminology and durable records

- Records: student, guardian, engagement, target institutions, fit criteria, application, deadline, task, advising session, draft-review request, decision and transition. Store source/date for admissions requirements because they change.
- Location data is usually school/family/consultation or campus visit, not service dispatch. Persistent asset is student profile and application portfolio; do not claim the consultant owns student work.
- Minors' personal/academic data, essays, financial aid and family context are sensitive. Consent/guardian access should be explicit and jurisdictional privacy rules reviewed.

## Services, intake, quoting, and booking

- Intake: student grade/year, goals, academic interests, geography/budget, family expectations, target schools, application calendar, learning/accessibility needs, and desired scope. Clarify advising versus editing, tutoring or test prep.
- Quote by hourly session, application bundle, number of schools, essay/interview support, grade/year, and service term. IECA standards encourage sharing price range before contracting and written scope. Public price claims vary; do not infer a standard.
- Keep deadlines, application requirements and advisor deliverables explicit. Consultants may not write essays; student remains author. Human review needed for recommendation fit and exceptions.

## Pricing and commercial model

- One recent market report from Private Prep estimates comprehensive packages often around $6,500, with wide range and service-model variation; it is a vendor/research publisher's market estimate, not a verified transaction dataset. Some individual firms publish essay-only and multi-school packages; fees are service prices.
- Hourly/package billing and multi-year retainers can differ. No verified direct software WTP evidence; software list price is not consulting fee.

## Recurrence, scheduling, dispatch, and routing

- Repeat meetings align to admissions cycle, school deadlines and milestones. Track each application deadline independently, including local time zone and required materials.
- Consultant capacity is student caseload and deadline concurrency. Campus visits may happen but are optional and should not imply route dispatch.
- Student delays, changing school list, recommendation/test delays and late applications require human replanning and family communication.

## Field workflow, safety, completion, and rework

- Discovery → student goals and fit criteria → service agreement → milestone/application schedule → research/list decisions → student-owned essay/application review → interview/application support → submission/deadline completion check → decisions and next steps.
- IECA standards mention confidentiality, contracts/scope, professional ethics and referrals outside expertise. Admissions policies change; link to official institution sources and date assertions.
- Do not submit or represent work on behalf of student without explicit and appropriate scope; avoid guarantees and conflicts/referral commissions. Rework may result from new deadlines, school changes, or incomplete student material.

## Customer communication and self-service

- Family/student need calendar, session booking, agreed task list, research links, draft feedback, deadline reminders and decision updates. Separate guardian/student visibility and consent.
- Automation can remind about dates and missing material; consultant decides fit advice, application strategy and whether a deadline can be met.

## Equipment, inventory, suppliers, and workforce

- Little physical inventory. Consultant may use admissions reference/research tools, scheduling, video meeting, secure file storage and writing-review process.
- Firms may have multiple consultants, editorial/admin staff, and referral specialists. Credentials/membership are professional signals, not government license. Protect client confidentiality.

## Reporting and operating measures

- Useful measures: students by cycle, active applications, upcoming deadlines, advising utilization, turnaround for reviewed work, student task completion, referral, decision and renewal. Outcomes such as admission are influenced by many factors and should not be presented as consultant-controlled performance.

## Existing software and operator evidence

- IECA/NACAC provide standards/ethics rather than practice management software. Firms market service packages and use application-cycle advising. General consultant stack likely calendar, email/video, document collaboration, checklist, payment and CRM, but no operator stack was directly verified.
- No repeat operator complaint corpus or software plan purchase evidence found. Consultancies should not conflate public pricing reports or competitor menu fees with WTP.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| terminology, customerTypes | Student, guardian, consultant, application, institution, deadline | IEC standards and work model | High |
| locationFields, assets | Student school/time zone; no field assets | Consulting process | High |
| services, recurrencePresets | Fit consultation, cycle advising, essay feedback, interview prep | Operator/service models | Medium |
| formSteps, website | Student year/goals, scope, guardian permission, school targets | Intake inference | Medium |
| jobChecklist, noncompletionReasons, workflows | Application milestones and reminders, not field-job checklist | Deadline-based workflow | High |
| pricingTemplates | Hourly, school-count/package, cycle retainer; tenant price | Service evidence | Medium |
| defaultAutomations | Deadline and meeting reminders, missing-document follow-up | Cycle workflow | Medium |
| reports | Caseload, deadline risk, response turnaround and cycle closeout | Operational inference | Medium |
| inventoryDefaults | None | No physical service inventory | High |
| recommendationQuestions | Student grade, country, service scope, guardian access, consultant/team size | Workflow/legal privacy distinctions | High |
| productCapabilityRecommendations | service_scheduling, document_management, customer_portal; admissions_deadline_management is an unconfirmed candidate key | Student/family project and docs | Medium |
| recommendedConnectorCapabilities | calendar, email, sms, storage, payments | Deadlines, files, sessions, fees | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| service_scheduling | normally_recommended | Repeated student/guardian consults | High |
| document_management | normally_recommended | Applications and confidential drafts | High |
| customer_portal | optional | Shared deadlines, task and file handoff | Medium |
| field_job_tracking | usually_unnecessary | Advisory work is not field service | High |
| inventory_management | usually_unnecessary | No service stock | High |
| invoicing | normally_recommended | Hourly/package engagements | Medium |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Student/guardian and dated application milestone configuration | Pack configuration | Admissions cycle and consulting standards | Medium |
| Scheduling, docs, reminders, customer files and invoicing | Existing shared capability | Current contract | Medium |
| Application-specific research/essay workspace | Business-specific/education product scope | Existing education products likely handle it | Medium |
| Field-service pack fit | Low | No dispatched job or site asset loop | High |

## Evidence, disagreements, and uncertainty

Evidence is high for deadline, client-scope and confidentiality needs; medium for pricing and low for actual software stack/WTP. Admissions rules, deadlines, and consulting scope change by country, institution, client age and consultant ethics. Never promise admission or treat aggregate outcome as controllable.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [NACAC ethical practices](https://www.nacacnet.org/ethical-practices-for-independent-educational-consultants/) | Professional association | Accessed 2026-09-24 | US/international membership | Ethical consultant practice | Association guidance |
| [IECA Standards of Excellence](https://www.iecaonline.com/wp-content/uploads/2017/10/IECA-Standards-of-Excellence-2023.pdf) | Independent Educational Consultants Association | 2023 | US/international | Contracts, confidentiality, scope, essay role | Member standards, not law |
| [IECA overview](https://www.iecaonline.com/about-ieca/) | Professional association | Accessed 2026-09-24 | International | Independent consultant model | Association self-description |
| [Private Prep pricing report](https://privateprep.com/cost-of-college-admissions-consultants-2025-report/) | Consulting provider/research publisher | Accessed 2026-09-24 | US market | Package-model and price range estimate | Provider analysis, not audited transaction sample |
| [College Essay Advisors](https://www.collegeessayadvisors.com/) | Admissions consultant/operator | Accessed 2026-09-24 | US | Essay/application support scope | Operator marketing; rates may require quote |
| [ApplyingToCollege consultant discussion](https://www.reddit.com/r/ApplyingToCollege/comments/1c8dvpl) | Student/community | Accessed 2026-09-24 | US anecdotal | Consumer concerns and provider-selection signals | Individual discussion, not prevalence |

## Handoff to a future pack implementer

Ask country/admissions system, student cohort, service scope, family/guardian role, file-sharing model, deadline tracking and whether consultants review versus edit. Prototype student-centered engagement, school/application milestones, secure documents and reminders. Keep admissions advice human, preserve student authorship, and do not build a field-service workflow.
