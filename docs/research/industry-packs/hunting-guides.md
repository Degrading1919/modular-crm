# Hunting guides

## Profile metadata

- **Industry key:** `hunting-guides`
- **Source name:** Hunting guides
- **Source category:** Entertainment
- **Candidate source:** [Sweaty Startup candidate list](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Entertainment, position 1 of 5.
- **Other exact/near duplicate labels:** None established; other outdoor tour candidates remain separate.
- **Research date:** 2026-09-24
- **Geographic scope:** Primarily United States; permit examples are jurisdiction-specific.
- **Research status:** complete

## Executive summary

**Observed evidence:** Guided hunts sell a scarce, date-bound trip combining guide labor with access/logistics, scouting, transportation or lodging, and sometimes meals and field processing. Deposits, detailed client agreements, species/season/location qualification, and capacity limits are prominent. Federal land use can require a Forest Service outfitter/guide special-use permit; state licensing and tags are separate jurisdictional questions.

**Inference:** The high-value CRM loop is inquiry qualification → hunt/party/date/area proposal → signed terms and staged payment → permit/season readiness → guide and equipment assignment → field-day log and harvest/incident closeout → repeat-season follow-up. Hunting requires its own concepts and safety/compliance handling; do not fold into hiking tours. Evidence does not establish a universal license, harvest, or cancellation model.

## Business model and customer segments

- Guided day hunts, multi-day outfitted hunts, and specialized species/terrain experiences may be sold to individuals or parties. An outfitter may bundle lodging, meals, transport, gear, and processing; a guide-only operation may sell labor and expertise while the hunter supplies the rest.
- Customers book around season dates, draw/tag results, travel, and scarce guide capacity. Search/referral and repeat hunters are plausible channels; repeat behavior is an inference, not quantified here.
- Crew models range from a solo guide to multiple guides, camp staff, packers, cooks, and contractors. A booking record should distinguish the seller/outfitter from the assigned guide and land manager.

## Terminology and durable records

- Useful records: hunter/client, party, hunt package, species, season/date, hunt area/land access, guide, deposit/payment schedule, license/tag responsibility, and trip closeout.
- A service location is a named hunt unit, access point, camp, or rendezvous—not merely a street address. Persistent assets may include outfitter-owned vehicles, trailers, camps, optics, radios, and pack animals; client firearms and tags should not be treated as operator-owned inventory.
- Safety-critical and sensitive fields include emergency contacts, relevant medical/accessibility information, firearm handling/orientation status, incident notes, and location details. Limit access and retention appropriately. Harvest/animal information is a job outcome, not a substitute for official wildlife reporting.

## Services, intake, quoting, and booking

- Intake should establish species, requested season/date, party size, experience/fitness, desired service level, target area, accommodation/transport needs, tag/draw status, and whether operator or client arranges licenses. Ask about relevant mobility, medical, and dietary needs through a privacy-conscious process.
- Quotes vary by species, days, party size, lodging/meals, guide ratio, transport/pack support, travel, and included gear. Do not make a legal eligibility conclusion from a form.
- The operator agreement and deposit are durable records. One first-person Reddit account describing an outfitter's policy reports a non-refundable 20% booking deposit and later balance timing; the poster also notes actual flexibility. This is anecdotal, not an industry norm.
- Public booking may collect an inquiry/deposit but should route season, access, tag, and safety exceptions to human review.

## Pricing and commercial model

- **Observed:** Operator package prices are not consistently public in the reviewed sources; exact quote inputs should be configurable. Contract terms commonly define deposit, payment timing, cancellation/rebooking, included services, and hunter responsibilities.
- Deposits and staged balances protect scarce seasonal capacity; no general rule can be inferred from one operator voice. Tag/license costs, gratuities, processing, transport, and lodging inclusion vary.
- No reliable public software willingness-to-pay evidence found. Do not infer CRM budget from the large consumer price of an outfitted hunt.

## Recurrence, scheduling, dispatch, and routing

- Capacity is constrained by season, guide availability, species/area, permits, and concurrent party limits. Track preferred and confirmed dates separately, and hold a capacity slot only under an explicit tenant policy.
- Pre-season work may include scouting and guide/vehicle/camp assignment; day-level route planning is terrain and weather dependent. Closures, wildfire, unsafe conditions, animal movement, and client cancellation create reschedule or noncompletion events.
- Reminders should cover meet point, packing list, readiness, payment, weather decision, and local rules; a human should approve safety-driven changes.

## Field workflow, safety, completion, and rework

- Typical lifecycle: verify participants and emergency contact → safety/communications briefing → confirm route/access/weather and equipment → conduct guided hunt → record departure/return/check-in and incidents → close out deliverables and any official reporting that remains the hunter's responsibility.
- Field tools may include first aid, navigation, satellite/radio communications, optics, vehicle/ATV/boat, and camp/pack equipment, depending on hunt. Offline capture and reliable emergency communications are important in remote areas (inference supported by land-manager permit/safety concerns).
- **Observed jurisdiction limit:** Forest Service temporary outfitter/guide permit materials require guide identification and may request state licenses where the state requires them; this does not establish national licensing. Local wildlife agency rules, landowner permissions, federal permits, and hunting tags are separate.
- Record noncompletion as weather/closure, access, client readiness, safety incident, or operator capacity; do not auto-mark a trip successful based on a calendar appointment.

## Customer communication and self-service

- Before: written inclusions/exclusions, date/area, what to bring, license/tag responsibilities, payment and cancellation terms, readiness, and rendezvous. During: delayed start, route/weather decisions, emergency contact. After: invoice, trip summary, photo/harvest-related records where consented, and next-season inquiry.
- Booking portal should support document delivery and deposit payment while requiring operator review of qualifications, permits, and exceptions. Avoid automating legal or harvest compliance advice.

## Equipment, inventory, suppliers, and workforce

- Assign gear and vehicles to trip/guide, distinguish consumables from durable assets, and check condition/readiness. If outfitter provides lodging, transport, pack stock, or meals, those become material availability constraints.
- Guide credentials/experience and land/area familiarity need traceable assignment; subcontractor, cook, packer, and seasonal guide records may be needed. Payroll, tips, and contractor status are business-specific; no common practice verified.

## Reporting and operating measures

- **Observed:** Federal permit applications/conditions center on authorized use, guides, and insurance; reviewed operator contract evidence centers on bookings and deposits.
- **Inferred useful measures:** inquiry-to-book rate, capacity by season/species/area/guide, deposit aging, cancellation/rebook reason, trip completion, incidents, repeat-client rate, and revenue/cost by package.

## Existing software and operator evidence

- Reviewed sources show direct operator booking/agreement documents and online listing/discussion channels, but no independently validated dominant hunting-guide CRM. Spreadsheets, email, phone, accounting, and booking forms are plausible but not evidenced as a universal stack.
- A first-person guide/outfitter discussion describes deposit policy flexibility and filling late cancellations with a discounted hunt. Anonymous hunting forums also describe complaints about guide quality and mismatch between promised/private-land access and actual experience. These are isolated accounts and do not measure prevalence; they support clear written scope, guide assignment, and access notes.
- No verified incumbent software list pricing or operator purchase statements found. WTP remains unknown.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Hunter/client, party, outfitter, guide; private client and group | Operator agreement and permit language | Medium; terms vary by region |
| `locationFields`, `assets` | Hunt area/access point, rendezvous, camp; vehicle/gear/pack-stock assets | Permits and outfitter bundles | Medium; asset mix varies |
| `services`, `recurrencePresets` | Day hunt, multi-day outfitted hunt, scouting, add-on lodging/transport | Operator model | Medium; package-specific |
| `formSteps`, `website` | Species/date/area inquiry; party size and service level; document review | Scarce date/area capacity and contract | Medium |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Readiness, permit/access/weather, safety brief, departure/return check-in, incident/closeout | Federal permit/safety and trip logistics | Medium; no automatic compliance determination |
| `pricingTemplates` | Base package + days/party + lodging/transport/gear add-ons + deposit milestones | Operator contract variables | Medium; local rate cards needed |
| `defaultAutomations` | Inquiry acknowledgment, payment reminder, packing/readiness reminders | Booking workflow inference | Low; require tenant review |
| `reports` | Seasonal capacity, bookings/deposits, trip completion, incidents, repeat clients | Operationally useful inference | Medium |
| `inventoryDefaults` | First-aid/communications/field gear check candidates; tenant-defined assets | Field needs vary widely | Low |
| `recommendationQuestions` | Guides/crew? multi-day? lodging/transport? federal land? client or outfitter handles tags? | Splits materially different operations | High |
| `productCapabilityRecommendations` | `service_scheduling` normally; `estimate_management`, `field_job_tracking`, `invoicing`, `document_management` optional; candidate capability `permit_and_trip_readiness` key unconfirmed | Booking, field execution, agreements | Medium; readiness may need tenant workflow |
| `recommendedConnectorCapabilities` | `payments`, `email`, `sms`, `calendar`, `storage`; `routing` conditional | Deposits, reminders, records, remote trip routing | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `service_scheduling` | normally_recommended | Scarce date/guide/season bookings | Medium |
| `estimate_management` | normally_recommended | Package inclusions and staged deposit terms | Medium |
| `field_job_tracking` | normally_recommended | Trip check-in/closeout and safety record | Medium |
| `document_management` | normally_recommended | Agreements, permits, readiness documents | Medium |
| `invoicing` | normally_recommended | Deposit/balance collection | Medium |
| `inventory_management` | conditional | Outfitter supplies shared gear, vehicles, camps or pack assets | Medium |
| `route_planning` | conditional | Multi-stop or remote area operations; route safety remains human-controlled | Low |
| `customer_portal` | optional | Frequent document and readiness exchanges | Low |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Hunt package, species, season, guide, area, and contract defaults | Pack configuration | Operator and permit records | Low to medium |
| Scheduling, estimates, documents, payments, field notes | Existing shared capability | Current IndustryPack surfaces | Medium |
| Permit/tag eligibility and local hunting-law validation | Business-specific customization | Laws and responsibility vary by species, state, land manager | High |
| Dedicated official harvest/license integration gap | No gap established | Sources do not establish a recurring integration requirement | High |

## Evidence, disagreements, and uncertainty

Confidence is medium for seasonal booking, contract, and access needs; low for prevalence and software stack. Guide services differ from outfitter bundles and from state to state. Do not default legal rules, firearm practice, or tag responsibility.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [Temporary Outfitter & Guide Permit application](https://www.fs.usda.gov/media/89663) | US Forest Service primary | Accessed 2026-09-24 | US federal land | Guide identification; state license if applicable; special-use application | One permit packet; not all districts |
| [Hunting Outfitter Guide permit checklist](https://www.fs.usda.gov/media/242463) | US Forest Service primary | Accessed 2026-09-24 | US federal land | Temporary permit process | Local Forest Service process |
| [Booking agreement](https://www.trailswestoutfitters.com/forms/booking_agreement.pdf) | Outfitter primary | Accessed 2026-09-24 | Operator-specific | Agreement terms and booking records | Single operator |
| [Guide discussion of deposits](https://www.reddit.com/r/Hunting/comments/1ixd3a9) | First-person operator/community | Accessed 2026-09-24 | US, anecdotal | Deposit, cancellation and reselling open dates discussed | One anecdote; not a benchmark |
| [Outfitter complaint](https://www.reddit.com/r/CanadaHunting/comments/yexijb) | Customer/community | Accessed 2026-09-24 | Canada | Example of experience/access mismatch complaint | Unverified, one customer report |
| [Hunt price/booking discussion](https://www.reddit.com/r/bowhunting/comments/17s9jg0) | Customer/community | Accessed 2026-09-24 | US, anecdotal | Expectations and service dissatisfaction after paid hunt | Individual post, no prevalence |
| [Big Game Commercial Services Board forms and contracts](https://www.commerce.alaska.gov/web/cbpl/ProfessionalLicensing/BigGameCommercialServicesBoard/ApplicationForms) | Alaska licensing authority | Accessed 2026-09-24 | Alaska only | Guide/outfitter/transporter licensing and written client contract requirements | Jurisdiction-specific; not a national rule |
| [Outfitter license information](https://boards.bsd.dli.mt.gov/outfitters/license-information/outfitter) | Montana licensing authority | Accessed 2026-09-24 | Montana only | Experience, examination, first aid, operating plan and insurance requirements | State-specific; confirm current rules and land manager requirements |
| [Hunting disclaimer and terms](https://wtxoutfitter.com/hunting-disclaimer/) | Hunting outfitter operator | Accessed 2026-09-24 | Texas/operator-specific | Client responsibilities, licensing and hunt terms | One operator's policy; not a standard contract or market norm |

## Handoff to a future pack implementer

Prototype a booking record that relates client party, hunt package, season/date, hunt area, assigned guide, agreement, payment milestones, gear, readiness, and trip closeout. Keep permit/tag answers tenant-configurable; ask whether the operator sells guide-only or bundled outfitter service, uses public/federal/private land, supplies lodging/transport/gear, and requires client licenses. Validate relevant state/land rules before any compliance automation.
