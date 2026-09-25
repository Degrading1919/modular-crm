# Hiking tours

## Profile metadata

- **Industry key:** `hiking-tours`
- **Source name:** Hiking tours
- **Source category:** Entertainment
- **Candidate source:** [Sweaty Startup candidate list](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Entertainment, position 2 of 5.
- **Other exact/near duplicate labels:** None established; hunting guides and biking tours remain distinct.
- **Research date:** 2026-09-24
- **Geographic scope:** US examples, with park and operator conditions varying by site.
- **Research status:** complete

## Executive summary

**Observed evidence:** Hiking tour products range from short interpretive/frontcountry outings to permitted backcountry trips. Route, terrain, group size, guide ratio, weather, access/permit, participant readiness, food/water, and emergency communications shape delivery. Park CUAs can impose approved trails, capacity, insurance, safety briefings, first aid, water, and advance application requirements.

**Inference:** A useful workflow links a tour product and route to date-specific roster/capacity, guide assignment, permit, participant readiness, weather decision, field check-in, and closeout. This is not interchangeable with a generic appointment: capacity and safety gates are integral. Evidence does not support one universal permit, guide certification, or cancellation rule.

## Business model and customer segments

- Sell public scheduled tours or private/custom guided walks to travelers, local residents, schools, and organizations; multi-day backpacking may add lodging/food/transport and gear. Interpretation, nature education, and strenuous outdoor guiding are distinct service tiers.
- Demand follows destination tourism, weekends, season, daylight, and weather. Private group and scheduled-seat economics differ: one books a group, the other fills roster capacity.
- Operators may be owner-guides or employ seasonal guides/transport staff. Park-authorized service is one market segment, not a universal pattern.

## Terminology and durable records

- Durable records: tour/route, departure, participant/party, guide, permit/access, capacity, weather decision, waiver, emergency plan, equipment issue/return, and trip report.
- Location data need trail/route, meeting point, access/parking, turnaround point, evacuation options, and permitted area. Track routes/land access as operational records with restricted edit rights.
- Persistent assets can include radios/satellite communicators, first-aid kits, water/food gear, vehicles, and rental gear. Participant medical/emergency details are sensitive and should be minimized.

## Services, intake, quoting, and booking

- Intake: route/duration/elevation/surface, public or private departure, party size and ages, fitness/accessibility expectations, transport, language, equipment supplied, dietary needs for longer trips, and emergency contact. Avoid guaranteeing trail conditions.
- Price by seat/private group, duration, guide ratio, transport, meals/gear, permit cost, and custom itinerary. Public tour booking may be self-service for a standard route; backcountry/custom departures need operator screening.
- Keep waiver acknowledgement separate from safety suitability; a waiver does not replace participant screening or guide judgment.

## Pricing and commercial model

- No representative operator price series established in this research; price inputs vary with route, duration, guide count, private vs seat-based booking, transport/gear/food and permit costs.
- Deposits and cancellation windows are operator policy. Adirondack Mountain Club, as a nonprofit program example, posts a three-week cancellation cutoff with a small nonrefundable processing fee and refunds if the organization cancels for weather/safety/low enrollment. This is one operator's policy, not an industry standard.
- Software list pricing and direct operator WTP were not verified. Do not infer CRM budget from outdoor trip ticket prices.

## Recurrence, scheduling, dispatch, and routing

- Schedule by route, daylight, season, permit quota, group-size cap, guide qualification, and transit. Tour departures need roster-level capacity and seat inventory; private trips need crew/route capacity.
- Weather and closures trigger route substitution, delayed departure, cancellation, or refund/reschedule according to policy. Record decision and communications, not just appointment status.
- Backcountry itineraries may require multi-day plan, campsite permits, and communication check-ins; frontcountry city/park walks can be simpler.

## Field workflow, safety, completion, and rework

- Before departure: confirm access/permit and forecast, roster and readiness, guide/ratio, route and turnaround decision, water/food, first aid, communications, emergency contact and briefing. During trip, record check-ins/incidents and route changes; on return, close roster and gear.
- NPS park examples require commercial authorization and impose site-specific constraints. Zion's 2025 operating plan requires hazard/safety information, appropriate emergency medical kit, water/nourishment planning, group/site capacity, and compliance with approved park conditions. Canyonlands' conditions show approved trails and group limit as another local example.
- **Uncertain:** Formal guide certifications and wilderness protocols vary with activity, land manager, and operator. CRM should record tenant policy and credentials, not declare all guides certified.

## Customer communication and self-service

- Send booking details, meeting point, route/difficulty, packing list, water/food, weather status, timing, and cancellation/change options. Self-service is suitable for standard tours if seats and eligibility are current; custom/backcountry inquiry goes to a person.
- Human review is needed for severe weather, participant readiness/accessibility, and route closure. Capture consent and minimum necessary emergency information.

## Equipment, inventory, suppliers, and workforce

- A guided walking tour may need little rentable stock; longer/wilderness operators may supply packs, poles, tents, radios, first aid, water, or transport. Track only equipment actually issued by operator.
- Match guide skills and local knowledge to terrain and group. Guide-to-participant ratios are site/activity-dependent; NPS examples have explicit caps. Record certifications only when relevant to the operator's actual activities.

## Reporting and operating measures

- Observed park reports/permits center on permitted activity and capacity; operator policies show enrollment, cancellations, waitlists, and weather safety.
- Useful inferred measures: seats sold/available, departure fill rate, guide utilization, cancellations by condition, trip completion, incidents, and repeat booking by route/segment.

## Existing software and operator evidence

- Reviewed operator and regulator pages establish permit/booking/safety workflows, but not a dominant vertical CRM. Web booking/waiver, maps, email/SMS and spreadsheet roster are plausible tools; no universal stack established.
- Adirondack Mountain Club's waitlist and weather/cancellation policy demonstrates customer-facing exception handling. No repeated owner complaints or verified subscription purchase evidence found; WTP remains open.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Participant, party, tour, departure, route, guide; traveler, private group, school/org | Tour and park documentation | Medium |
| `locationFields`, `assets` | Trail/route, meet point, permitted area, evacuation/turnaround; guide equipment assets | NPS conditions | Medium; routing map support uncertain |
| `services`, `recurrencePresets` | Interpretive walk, day hike, private guided hike, multi-day/backpacking | Operator and permit categories | Medium |
| `formSteps`, `website` | Route/difficulty, date/party, gear/transport, readiness and emergency contact | Tour terms and safety planning | Medium |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Access, forecast, roster, guide, water/first aid, briefing, check-in/return | NPS requirements | High for park model, configurable elsewhere |
| `pricingTemplates` | Seat/private group + duration/guide/gear/transport | Common quote dimensions | Medium |
| `defaultAutomations` | Booking confirmation, roster/packing reminders, weather update | Operator policy evidence | Medium; require human safety decision |
| `reports` | Capacity/fill, trip completion, cancellation reason, incidents | Ops inference | Medium |
| `inventoryDefaults` | First aid/comms/water/rental gear, optional | Operator-specific | Low |
| `recommendationQuestions` | Frontcountry/backcountry? park permit? seats vs private? transport/gear supplied? | Determines permit/workflow complexity | High |
| `productCapabilityRecommendations` | `service_scheduling`, `estimate_management` optional, `field_job_tracking`, `document_management`; candidate `roster_capacity` key unconfirmed | Date/roster/capacity and trip safety | Medium |
| `recommendedConnectorCapabilities` | `payments`, `calendar`, `email`, `sms`, `storage`; `routing` conditional | Bookings, reminders, permits | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `service_scheduling` | normally_recommended | Departures and guide/route availability | High |
| `field_job_tracking` | normally_recommended | Roster, safety checks and trip closeout | Medium |
| `document_management` | normally_recommended | Waivers, permits, participant packing details | Medium |
| `payment_collection` | normally_recommended | Pre-booked seats/private outings | Medium |
| `inventory_management` | conditional | Operator supplies rental or backcountry gear | Medium |
| `customer_portal` | optional | Self-service standard departures/documents | Low |
| `route_planning` | conditional | Multi-route/remote operations; map routing cannot replace guide decisions | Medium |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Route, departure, roster, safety checklist defaults | Pack configuration | Park/operator terms | Medium |
| Scheduling, documents, messaging, payment | Existing shared capability | Current contract can model core loop | Medium |
| Permit, ratio, weather, route and guide criteria | Business-specific customization | Site and activity rules differ | High |
| Outdoor map/offline check-in core gap | No gap established | Sources show need but not inability to model with current pack | Medium |

## Evidence, disagreements, and uncertainty

Evidence is medium for safety/capacity gates and low for market prevalence, software stack, and willingness to pay. NPS requirements are specific examples; casual urban walks, private-land hikes, wilderness guiding, and park tours differ materially.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [NPS Commercial Use Authorizations](https://www.nps.gov/noca/getinvolved/commercialuseauthorization.htm) | National Park Service primary | Accessed 2026-09-24 | North Cascades, US | CUA process/timeline for commercial guided activities | Park-specific |
| [Zion 2025 guided interpretive hiking plan](https://www.nps.gov/zion/getinvolved/upload/Final_2025-Operating-Plan-Commercially-Guided-Interpretive-Hiking-Level-II-Updated-11-11-24.pdf) | NPS primary | 2025 | Zion, Utah | Capacity, hazards briefing, emergency kit, water | Park-specific, 16–50-person category |
| [Canyonlands hiking authorization conditions](https://www.nps.gov/cany/getinvolved/upload/2022-CANY-Guided-Hiking-Conditions_508web-2.pdf) | NPS primary | Accessed 2026-09-24 | Canyonlands, US | Approved trails, 15-person limit, insurance | Park-specific document |
| [Adirondack guided trips](https://adk.org/programs-events/guided-trips/) | Operator/nonprofit program | Accessed 2026-09-24 | New York | Enrollment, waitlist, eligibility, weather and cancellation | One operator policy |
| [Olympic Hiking Co. guided backpacking](https://www.hikeolympic.com/guided-backpacking-trips) | Tour operator | Accessed 2026-09-24 | Olympic Peninsula | Route/date/permit, packing session and cancellation details | One operator and trip type |
| [Guiding policies](https://deliberatepaceguiding.com/policies/) | Hiking guide operator | Accessed 2026-09-24 | US/operator-specific | Group size, weather cancellation and risk/participation terms | One operator's policies; not a universal practice |

## Handoff to a future pack implementer

Ask tour format, route/land manager, permit needs, participant/seat capacity, private vs open booking, gear/transport supplied, and weather decision owner. Prototype roster-capacity and readiness fields with route-specific checklist templates. Keep park conditions and safety rules tenant-configurable; do not bundle hiking with hunting or biking workflows.
