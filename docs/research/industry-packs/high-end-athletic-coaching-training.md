# High-end athletic coaching / training

## Profile metadata

- **Industry key:** high-end-athletic-coaching-training
- **Source name:** High end athletic coaching / training
- **Source category:** Training / Coaching / Consulting
- **Candidate source:** [Sweaty Startup candidate inventory](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Training / Coaching / Consulting, position 4 of 8.
- **Other exact/near duplicate labels:** Remote athletic coaching is adjacent, not an alias; it is kept distinct by delivery model.
- **Research date:** 2026-09-24
- **Geographic scope:** US and international examples; sport-specific credentials/rules vary.
- **Research status:** partial

## Executive summary

The label describes a market position (“high-end”) and broad service domain rather than a defined sport, customer, or coaching model. It could mean private sport skill coaching, strength/conditioning, elite team support, or remote programming. Partial status is appropriate until the discipline and scope are specified. This is low-fit for a field-service IndustryPack: coaching is an ongoing client delivery/education relationship, not principally dispatching jobs to locations.

**Observed evidence:** USATF coaching registry references sport education, SafeSport and background screening for eligibility. An Athletics Ireland high-performance role emphasizes individualized annual plans, testing, monitoring, readiness and reviews. A cycling coach offers ongoing individualized monthly coaching. These are sport-specific examples, not one “high-end coaching” standard.

## Business model and customer segments

- Potential buyers include competitive amateurs, youth/family, professionals, clubs, schools, teams, or federations. Revenue may be hourly session, camp, retainer, athlete/team contract, or program.
- “High end” may mean coach reputation, individual attention, facilities, data, or price. No stable segment or floor is inferable.
- In-person and remote coaching are different operations. Teams add rosters, calendars, assistant coaches and support staff; solo coaches serve individuals.

## Terminology and durable records

- Possible records: athlete, guardian/team, sport/event calendar, coach, annual plan, session/workout, test, performance/readiness data, review, goal, contract and payment.
- Facility may be gym, pool, track, field, court or competition venue. Athlete health/performance information is sensitive; apply consent and access controls. Equipment is sport-specific.
- Do not mix performance coaching with medical diagnosis. Injury/return-to-play should be handled by qualified clinicians and human coach judgment.

## Services, intake, quoting, and booking

- Before pack design identify sport, age/level, individual vs team, season/competition targets, in-person/remote/hybrid, credentials, testing/support scope and consent if minors.
- Services could include assessment, planning, technique, strength/conditioning, camps, competition preparation and review. Human consultation should precede a high-touch program.
- Quote may reflect coach reputation, contact level, testing, facility, travel and multidisciplinary support, but evidence is insufficient for a general model.

## Pricing and commercial model

- One cycling coach public offer, reported in sports trade coverage, costs £120/month for developing riders and £160/month for adults, including individualized coaching and frequent feedback. This is a single provider, not a cross-sport benchmark.
- Software list prices are separate from coaching fees; no operator software WTP for this undefined candidate.

## Recurrence, scheduling, dispatch, and routing

- Training plans recur by training cycle and competition calendar. In-person appointments and remote async reviews have different capacity models.
- Coach review hours/client, athlete roster, team sessions and event schedule determine capacity; travel matters only for on-site/private coaching.
- Competition, facility closure, weather, recovery, illness or coach availability can cause rescheduling. Human coach adjusts load.

## Field workflow, safety, completion, and rework

- Intake/goal setting → baseline/test → agreed plan → session or program delivery → athlete logs completion/feedback → coach reviews and adjusts → periodic performance review → next cycle.
- USATF registry eligibility cites SafeSport and background requirements in its context. Safeguarding, health information, injury, concussion and load decisions require sport/location policy and qualified human oversight.
- There is no generic field-job completion. Record sessions and reviews delivered; never auto-advance from an athlete metric.

## Customer communication and self-service

- Athlete needs program/calendar, feedback, videos/data, accountability, event changes and billing; guardian/team may need separate access. Human review matters for load and injury concerns.
- Coaching platforms offer messaging, workout delivery and progress tracking, but this is an adjacent software category rather than evidence that all high-end coaches use one stack.

## Equipment, inventory, suppliers, and workforce

- Equipment/facility is sport specific, so no inventory default is justified. A high-performance model may coordinate assistant coaches and physiologists; this is not universal.
- Track relevant credential and safeguarding status; roles differ across amateur, professional, club and school contexts.

## Reporting and operating measures

- The Athletics Ireland role description explicitly includes annual plans, testing, monitoring, readiness and performance reviews. Potential measures include athlete retention, adherence, test progress, adjustments, coach utilization and event preparation; metric definitions must be sport-specific.

## Existing software and operator evidence

- USATF is a credential registry. Trainerize and TrueCoach provide client, programming, messaging and tracking functions with public client-tier plan prices.
- No complaints specific to high-end athlete coaching were verified. General coach forums mention fragmented payment/program/tracking/communication tools, but evidence is anecdotal and broad.
- Posted SaaS rates are list prices, not purchase behavior or proof of this candidate's WTP.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| terminology, customerTypes | Athlete, coach, team, session, program, review | Governing body/coaching software | Medium |
| locationFields, assets | No default until sport/facility chosen | Sport specific | High |
| services, recurrencePresets | Assessment, session, program/retainer after sport selected | Coaching models | Low |
| formSteps, website | Sport/level, goals, events, delivery, minor safeguarding | Intake inference | Medium |
| jobChecklist, noncompletionReasons, workflows | Session delivery, program review, athlete feedback; not field-job template | Coaching relationship | Medium |
| pricingTemplates | None until sport and service level selected | No uniform rate | High |
| defaultAutomations | Session reminder/check-in after modality choice | Platform features | Low |
| reports | Sport-defined adherence/performance reviews | Elite role example | Low |
| inventoryDefaults | None until sport defined | No universal gear | High |
| recommendationQuestions | Sport, level, delivery, team/individual, minors, credential regime | Defines workflow | High |
| productCapabilityRecommendations | service_scheduling conditional; athlete_program_delivery is an unconfirmed candidate key; no default pack recommendation | More like coaching software than field CRM | Medium |
| recommendedConnectorCapabilities | calendar, payments, email, storage; wearable capability not in current connector keys | Communication/programs | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| service_scheduling | conditional | In-person sessions, not core for async plans | Medium |
| customer_portal | normally_recommended | Program, feedback and communication | Medium |
| document_management | optional | Contracts, consent, plans and tests | Medium |
| field_job_tracking | usually_unnecessary | Not generally dispatched service work | High |
| inventory_management | usually_unnecessary | Sport equipment not shown as service inventory | Medium |
| invoicing | conditional | Independent coach/session billing | Medium |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Coach-client relation, sessions, reminders | Possible pack configuration | General coaching operations | Low |
| Customer, scheduling, documents, connectors | Existing shared capability | Current contract | Medium |
| Athlete program delivery/readiness metrics | Business-specific or coaching-product scope | Existing coaching platforms target it | High |
| Dedicated “high-end” pack | Low-fit/unproven | No sport or field operation specified | Medium |

## Evidence, disagreements, and uncertainty

Partial status because sport and business model are unspecified. USATF and Irish federation sources are not universal; one cycling offer is not a benchmark. “High-end” is positioning rather than a durable workflow.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [USATF Coaches Registry](https://www.usatf.org/programs/coaches/coaches-registry) | US governing body | Accessed 2026-09-24 | US track and field | Registry and eligibility/safeguarding context | Sport/role-specific |
| [Athletics Ireland high-performance role](https://www.athleticsireland.ie/wp-content/uploads/2026/01/2026_Pathway-Strength-Conditioning-Lead-1.pdf) | National body role description | Accessed 2026-09-24 | Ireland | Plans, monitoring, readiness, reviews | Single job description |
| [Deignan Performance launch/pricing](https://www.cyclingweekly.com/racing/fancy-being-coached-by-a-world-champion-lizzie-deignan-launches-cycling-training-service-with-husband) | Cycling trade press/operator launch | 2026 | UK/international | Example monthly coaching scope and rate | One cycling coach; secondary report |
| [Trainerize pricing](https://www.trainerize.com/pricing/) | Coaching software incumbent | Accessed 2026-09-24 | USD product | Client tiers and features | Vendor list price |
| [TrueCoach pricing](https://truecoach.co/pricing/) | Coaching software incumbent | Accessed 2026-09-24 | USD product | Client tiers and tools | Vendor list price |
| [Coach software workflow discussion](https://www.reddit.com/r/personaltraining/comments/1n2i4yu) | Coach/community | Accessed 2026-09-24 | Anecdotal | Need spanning payments, workout, tracking and communication | Not high-performance-specific |

## Handoff to a future pack implementer

Clarify sport, athlete level, delivery mode, individual/team buyer, minors, competition calendar, credentials and whether the product should own coaching delivery. If remote programming is primary, assess integration with coaching software instead of forcing a field-service pack. Keep health/readiness decisions human and sensitive data restricted.
