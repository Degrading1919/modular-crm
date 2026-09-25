# Biking tours

## Profile metadata

- **Industry key:** `biking-tours`
- **Source name:** Biking tours
- **Source category:** Entertainment
- **Candidate source:** [Sweaty Startup candidate list](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Entertainment, position 3 of 5.
- **Other exact/near duplicate labels:** None established; hiking tours, bike rentals, and event cycling are distinct.
- **Research date:** 2026-09-24
- **Geographic scope:** US examples, with operator and park-specific conditions.
- **Research status:** complete

## Executive summary

**Observed evidence:** A guided bike tour combines a route/departure and guide with appropriately sized bicycle, helmet, safety briefing, and sometimes water or accessories. Operators document early arrival for fit/check-in, severe-weather cancellation, and differentiated refund/credit rules. Commercial bicycle tours in some national parks require a CUA with activity, season, group-capacity, and safety conditions.

**Inference:** CRM needs to coordinate participant roster and fit against available bike sizes/types, route/guide capacity, permit, maintenance/readiness, weather decision, field departure, and return. The mode matters: city sightseeing, road/gravel, mountain, and e-bike tours have different equipment and risk. No general certification, helmet law, or cancellation policy is inferred.

## Business model and customer segments

- Guided open-seat tours and private groups serve visitors, locals, organizations, and sometimes schools. Products vary by ride duration, terrain, pace, themes, and bicycle type; tours may be bundled with bicycle rental.
- Tourism, season, weekends, events, and weather shape demand. Private groups need crew and equipment reserved as a block; seat-based departures need remaining-seat counts.
- Small owner-guide businesses may own a small rental fleet; larger operators may staff multiple guides and run concurrent departures. Bike repair/rental are adjacent but separate service scope.

## Terminology and durable records

- Durable records: tour/departure, route, participant, bike assignment/size, guide, permit/access, waiver, incident, maintenance/service history, and return check.
- Store route, meeting point, road/trail type, elevation/distance, transfer/parking, and hazard notes. Persistent bikes should track size/type, serial/asset id, condition, service, battery where e-bike, and current assignment.
- Participant fit, ability, age/guardian, and emergency details are sensitive or safety-critical; collect minimally and restrict access.

## Services, intake, quoting, and booking

- Ask route/pace/duration, date and departure, rider count/ages/heights for bike sizing, experience/ability expectations, e-bike/manual or terrain preference, transport, and accessibility/special accommodation. Confirm operator-provided vs guest bicycles and helmet/accessory policy.
- Price by seat/private booking, duration, bike class, private guide, transport, and premium add-ons. Public booking can reserve available bikes/size capacity; custom route and large-group requests require human review.
- Confirmation should give check-in lead time, fit, closed-toe/clothing guidance, route/difficulty, weather contact, and operator-specific cancellation terms.

## Pricing and commercial model

- No comparable public pricing sample established. Price dimensions and deposits/refund rules vary by location, bike fleet, and tour length.
- Routes Bicycle Tours' terms show a bike, helmet, bottled water, and safety instruction included; it may cancel for unsafe weather, and customer cancellation/no-show treatment differs by tour and notice window. This illustrates policy detail, not a universal norm.
- Software subscription prices and direct operator software WTP were not verified. Tour ticket values do not establish SaaS budget.

## Recurrence, scheduling, dispatch, and routing

- Capacity is jointly constrained by seats, bike type/size/condition, guide ratio, route permit, daylight, and start location. Reserve asset and participant seat together; a booked “seat” alone can oversell an uncommon size or e-bike.
- Route/guide sequence may be fixed for public departure or custom for a private party. Weather and closures lead to route change/cancel/credit/refund by policy. Record the decision and affected roster.
- E-bike charging and vehicle shuttle dependencies are conditional on fleet and route model.

## Field workflow, safety, completion, and rework

- Check roster and rider fit → inspect/assign bike and helmet → safety/route briefing → departure/headcount → route deviation/incident updates → return, equipment condition and post-ride maintenance. No-show/late arrival handling is an operator rule.
- Routes Bicycle Tours asks riders to arrive 15 minutes early for fitting and safety instructions and describes cancellation for severe weather. Mount Rainier NPS CUA lists bicycle tours and seasonal capacity; park conditions can add group/permit limits. These do not prove universal requirements.
- Track maintenance, puncture, mechanical failure, weather, participant fatigue, and closure as return/noncompletion reasons. Offline emergency logging may be useful, but no source establishes a common software implementation.

## Customer communication and self-service

- Booking page should state route type/distance/difficulty, duration, included bike/helmet, rider restrictions/size availability, meet point and check-in time, weather/cancellation policy, and what to bring.
- Automated reminders are useful; actual unsafe-weather cancellation and participant suitability need human judgment. Rider waivers and age/guardian requirements must match operator and local law.

## Equipment, inventory, suppliers, and workforce

- Bikes, helmets, locks, lights/reflective gear, water, repair tools, and support vehicle may be assigned/consumed/maintained. Serial, size, type, condition, battery/charge, and last service are useful fleet data.
- Guides need route familiarity and group-control ability; formal qualifications vary by route/land manager. Model availability/assignment without claiming one credential standard.

## Reporting and operating measures

- Observed operator terms explicitly identify fit, included equipment, attendance, weather cancellation, and customer cancellation/no-show. NPS permit programs publish tour authorizations/capacity.
- Useful inferred KPIs: departure fill, bike utilization/downtime, size/type stockout, late/no-show, cancellations by reason, maintenance costs, incidents, and repeat business.

## Existing software and operator evidence

- Operator pages show online reservation and policy-based booking; no dominant vertical CRM or repeated complaints were verified. A booking engine, calendar, rental fleet list, maps, payment provider, and email/SMS are plausible, not established universal stack.
- Operator complaints are not adequately represented in available first-person business sources; do not claim common pain. WTP for CRM unverified.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Rider, party, tour, departure, route, guide | Operator tour terms | Medium |
| `locationFields`, `assets` | Route/meeting point/terrain; bike fleet with type/size/condition/service | Bike fit and fleet assignment | High for rental fleet operators |
| `services`, `recurrencePresets` | City, road, trail, e-bike guided departure; private ride | Operator offerings vary | Medium |
| `formSteps`, `website` | Date/route/riders, size/type, difficulty, transport, weather/refund terms | Fit and capacity constraints | Medium |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Fit, bike/helmet check, safety brief, roster/headcount, return inspection | Operator terms and safety workflow | Medium |
| `pricingTemplates` | Seat/private group + bike type + duration/transport | Price inputs | Medium |
| `defaultAutomations` | Booking, check-in and packing reminders; weather status | Operator policies | Medium; safety cancel needs human |
| `reports` | Departure fill, fleet utilization, bike downtime, incidents/cancellations | Operational inference | Medium |
| `inventoryDefaults` | Bike, helmet, lock, light, repair supplies; configurable fleet | Equipment assignment | Medium |
| `recommendationQuestions` | Own fleet? e-bike? public lands/permit? open departures? provide transport? | Changes capacity and safety setup | High |
| `productCapabilityRecommendations` | `service_scheduling`, `inventory_management`, `field_job_tracking`; `rental_fleet_maintenance` key unconfirmed | Departure and bike assignment | Medium |
| `recommendedConnectorCapabilities` | `payments`, `calendar`, `email`, `sms`, `routing`, `geocoding`; `storage` optional | Booking, route and documents | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `service_scheduling` | normally_recommended | Departure, guide, route, rider capacity | High |
| `inventory_management` | conditional | Operator provides or rents bicycles/accessories | High |
| `field_job_tracking` | normally_recommended | Departure roster, safety and return condition | Medium |
| `estimate_management` | optional | Custom/private group tours and transport options | Medium |
| `route_planning` | conditional | Custom route/shuttle; not a substitute for guide route decisions | Medium |
| `document_management` | optional | Waivers, permits, incident attachments | Medium |
| `customer_portal` | optional | Self-service seat/size booking and updates | Low |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Bike size/type assignment and safety checklist | Pack configuration | Tour terms and asset use | Medium |
| Calendar, customer records, docs, field closeout | Existing shared capability | Current contract | Medium |
| Bike stock by size, route limits, helmet/legal rules | Business-specific customization | Fleet and local conditions differ | High |
| Atomic booking of roster seat plus sized bike | Candidate core-platform gap only if current reservation primitives cannot express it; evidence points to need but not current inability | Operator fit workflow | Low; verify implementation before asserting gap |

## Evidence, disagreements, and uncertainty

Evidence is medium for fit/equipment/weather booking workflow, low for software and operator complaint prevalence. One tour's 15-minute arrival and one park's CUA conditions are examples. City tours and technical mountain rides should not share unqualified risk defaults.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [Routes Bicycle Tours guided-tour terms](https://routesrentals.com/contact/faq/guided-tour-terms/) | Tour operator primary | Accessed 2026-09-24 | New Mexico | Bike/helmet/water, fitting, briefing, weather and cancellation | Single operator |
| [Mount Rainier CUA](https://www.nps.gov/mora/getinvolved/cua.htm) | NPS primary | Accessed 2026-09-24 | Washington | Bicycle tours are an authorized activity; permit cycles/capacity | Park-specific |
| [Great Smoky Mountains CUA overview](https://home.nps.gov/grsm/getinvolved/cua-overview.htm) | NPS primary | Accessed 2026-09-24 | TN/NC | Commercial tour authorization categories | Park-specific |
| [JD's Joyrides](https://jdsjoyrides.com/) | e-bike operator | Accessed 2026-09-24 | Colorado | E-bike/helmet/water, unsafe weather refund/reschedule | Single operator |
| [Central Park bike tour](https://astrabikerentalsnyc.com/tours/central-park-bike-tour/) | Tour operator | Accessed 2026-09-24 | New York | Equipment and weather terms | One urban tour |

## Handoff to a future pack implementer

Ask public-seat vs private tours, terrain, bike types/sizes owned, rider screening, guide model, route/park permits, and transport. Prototype departures that reserve both seats and assets; track pre/post ride condition and maintenance. Keep route and weather decisions human controlled and distinct from hiking tour defaults.
