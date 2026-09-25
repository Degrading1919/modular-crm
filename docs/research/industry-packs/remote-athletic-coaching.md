# Remote athletic coaching

## Profile metadata

- **Industry key:** remote-athletic-coaching
- **Source name:** Remote athletic coaching
- **Source category:** Training / Coaching / Consulting
- **Candidate source:** [Sweaty Startup candidate inventory](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Training / Coaching / Consulting, position 5 of 8.
- **Other exact/near duplicate labels:** High end athletic coaching / training is adjacent, not an alias; remote delivery is distinct.
- **Research date:** 2026-09-24
- **Geographic scope:** International online coaching examples; credentials and data/privacy duties vary.
- **Research status:** complete

## Executive summary

**Observed evidence:** Remote coaching sells coach expertise through individual plans, workout delivery/logging, feedback/check-ins, messaging and adjustments rather than dispatching to a service location. Trainerize and TrueCoach position tools for programming, client roster, messaging, progress and business administration; a running coach advertises one-to-one remote plans with regular feedback. This has low fit with field-service CRM assumptions.

**Inference:** Operating loop: lead/assessment → goals and event calendar → agreement/payment → plan assignment → athlete completion data/video/feedback → coach review and adjustment → renewal. A future CRM pack should not claim to replace athlete program delivery or health-data platforms without validated scope.

## Business model and customer segments

- Individual runners/cyclists, teams, clubs or remote athletes buy monthly coaching, a one-off plan, event prep or hybrid consult. Coach capacity is review time and active roster, not vehicle/route capacity.
- Remote removes travel but adds time-zone, data capture, adherence and digital support expectations. Sports require different metrics and equipment.
- Solo coach and team/agency models differ in client assignment, templates, assistant permissions and revenue share.

## Terminology and durable records

- Records may include athlete, coach, sport, goals, competition calendar, program/block, workout, completion/metrics, feedback/check-in, adjustment, agreement and payment. Wearable/device data may be controlled by a separate provider.
- Location is optional training location, time zone, or competition venue. Athlete-owned equipment is not operator inventory.
- Health, body, nutrition, injury and performance data can be sensitive. Collect only what is needed; separate coaching from diagnosis/treatment.

## Services, intake, quoting, and booking

- Intake: sport/discipline, level, goals, event dates, history, equipment, schedule/time zone, feedback cadence, injury/medical referral status, data sources, and minor/team permission.
- Deliverables may be plan, asynchronous review, video feedback, scheduled call, or hybrid appointment. State response times and exclusions.
- Rates may be monthly, program-based, or tiered; price varies with sport, experience, review frequency and calls. No cross-sport benchmark found.

## Pricing and commercial model

- Coaching software is not coach service pricing. Trainerize pricing page lists a free 1-client tier and paid plans starting at $9/month for up to two clients; TrueCoach also lists plans by active-client count. USD vendor list prices accessed 2026-09-24 and subject to change.
- Coach forum discussions describe consumer coaching charges, but anecdotes vary and do not establish market rate or WTP.

## Recurrence, scheduling, dispatch, and routing

- Cadence follows sport plan and athlete calendar. Weekly asynchronous check-ins and program changes recur without appointments; calls may need time-zone scheduling.
- Capacity is coach review time and active roster. Competition, missed workouts, travel, illness and missing data can affect plans; coach decides changes.
- Physical routes are not typical. Calendar and notifications support check-ins, competition dates and calls.

## Field workflow, safety, completion, and rework

- Intake/plan agreement → assign program → athlete logs completion and metrics → coach reviews/messages/annotates → adjust → periodic goal review → renewal or exit. Store plan version and adjustment notes.
- Coaching apps expose workout delivery, tracking and messaging. Remote data can be self-reported/incomplete. Coach judgment remains essential for fatigue/load; health or injury concerns need appropriate referral.
- Noncompletion may be skipped workout, late feedback, absent data, or athlete pause; it is not a failed field job.

## Customer communication and self-service

- Athlete needs mobile program access, clear workouts, logging, feedback, check-ins, reminders, messaging, progress, payment and renewal. Coach needs a roster view of athletes who need a response.
- Automations may remind/check in, but should not make injury, medical or readiness decisions. Wearable/video access needs explicit permission.

## Equipment, inventory, suppliers, and workforce

- Coach tools include programming library, communication, calendar, possible wearable integration and payment. Athlete supplies sport equipment. No common operator inventory.
- Team models may need coach assignment and permissions; credentials/safeguarding are sport specific.

## Reporting and operating measures

- Incumbent platforms expose program, workout, habit/nutrition tracking, progress, messaging and client counts. Useful measures include adherence, feedback turnaround, renewal, response backlog and coach hours per client. Sport metrics are not universal.

## Existing software and operator evidence

- Trainerize and TrueCoach publish client-based software plans and tools. Trainerize supports online and in-person coaching, showing product adjacency.
- Coaches discuss fragmented payment, programming, tracking, nutrition, check-ins and communication tools; other posts defend value or complain of pricing/workflow friction. These are anonymous and not representative.
- Posted plan rates are vendor list price, not observed operator purchase or WTP.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| terminology, customerTypes | Athlete, coach, program, workout, check-in, feedback | Coaching platform features | High |
| locationFields, assets | Time zone, optional sport location; no field site/asset default | Remote delivery | High |
| services, recurrencePresets | Remote assessment, monthly coaching, plan review, video consult | Coach/platform examples | Medium |
| formSteps, website | Sport/goals/event dates, history, feedback cadence, device consent | Intake inference | Medium |
| jobChecklist, noncompletionReasons, workflows | Program assignment, completion/feedback/review/adjustment; not field closeout | App workflow | High |
| pricingTemplates | Monthly coaching/plan tier and optional check-in frequency | Service model; tenant prices | Medium |
| defaultAutomations | Workout/check-in prompts and coach response queue | Coaching app evidence | Medium |
| reports | Adherence, feedback turnaround, roster and retention | Platform features | Medium |
| inventoryDefaults | None | Athlete supplies gear | High |
| recommendationQuestions | Sport? async vs calls? minors/team? wearable/data? referral protocol? | Determines delivery and privacy | High |
| productCapabilityRecommendations | customer_portal, document_management optional; athlete_program_delivery is unconfirmed candidate key | Specialized apps already deliver programs | Medium |
| recommendedConnectorCapabilities | calendar, payments, email, sms, storage; wearable keys absent from current registry | Communication/artifacts | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| customer_portal | normally_recommended | Athlete program and feedback | High |
| service_scheduling | optional | Live consult and review calls | Medium |
| invoicing | normally_recommended | Retainer/program billing | Medium |
| field_job_tracking | usually_unnecessary | Remote service is not field dispatch | High |
| inventory_management | usually_unnecessary | Coach does not generally own athlete gear | High |
| document_management | optional | Programs, consent and reviews | Medium |

AI-assisted drafting is a possible future provider integration, not a product capability recommendation. Adoption and privacy needs are unverified; any draft should remain coach-reviewed and must not make health decisions.

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Client roster, reminders, billing shell | Existing shared capability or configuration | Contract plus coaching platforms | Medium |
| Workout programming, adherence and wearables | Business-specific/coaching-product scope | Incumbents explicitly target these | High |
| Field-service IndustryPack | Low fit | No dispatched location workflow | High |
| Core gap in athletic program delivery | Not established | Third-party products exist; scope undefined | High |

## Evidence, disagreements, and uncertainty

Evidence is high for digital coaching and low fit with field-service CRM; medium for incumbent features and low for complaints/WTP. Sport, athlete level, team/individual and hybrid delivery change metrics. No universal readiness metric or coach credential should be encoded.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [TrueCoach pricing](https://truecoach.co/pricing/) | Coaching software incumbent | Accessed 2026-09-24 | USD product | Active-client tiers, programs and messaging | Vendor list price |
| [Trainerize pricing](https://www.trainerize.com/pricing/) | Coaching software incumbent | Accessed 2026-09-24 | USD product | Client tiers and program delivery | Vendor list price/add-ons |
| [Trainerize features](https://www.trainerize.com/features/) | Coaching software incumbent | Accessed 2026-09-24 | Product docs | Client/program tracking and business tools | Vendor marketing |
| [Cardy Coaching](https://cardycoaching.com/) | Remote running coach | Accessed 2026-09-24 | International | One-to-one plan, feedback and support | Single coach; no rate on page |
| [Coach software workflow discussion](https://www.reddit.com/r/personaltraining/comments/1n2i4yu) | Coach/community | Accessed 2026-09-24 | Anecdotal | Payment/program/tracking/communication needs | Not sport-specific |
| [Online coaching experience](https://www.reddit.com/r/personaltraining/comments/ytdpy4) | First-person coach/community | Accessed 2026-09-24 | Anecdotal | Coach-reported roster and customer rate | One coach; unverified |

## Handoff to a future pack implementer

Ask the sport, program type, plan/logging source of truth, feedback cadence, coach ratio, minors, device integrations, and whether CRM should own program delivery. Default toward integration with coaching software while handling agreements, billing, calendar and follow-up. Do not force field-site, inventory or dispatch features into this profile.
