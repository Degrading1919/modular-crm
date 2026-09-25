# Linen washing

## Profile metadata

- **Industry key:** `linen-washing`
- **Source name:** Linen washing
- **Source category:** Retail / Hospitality
- **Candidate source:** [Sweaty Startup candidate list](../SWEATY_STARTUP_INDUSTRY_CANDIDATES.md), Retail / Hospitality, position 4 of 6.
- **Other exact/near duplicate labels:** None established. This profile focuses on commercial pickup/delivery or rental laundry, not consumer laundromats or on-premise hotel laundry.
- **Research date:** 2026-09-24
- **Geographic scope:** North American examples, with healthcare hygiene and food-service requirements jurisdiction-specific.
- **Research status:** complete

## Executive summary

**Observed evidence:** Commercial linen work serves restaurants, hotels, healthcare, gyms, and other organizations through recurring pickup/delivery, laundering, and sometimes linen rental/maintenance. Rental models exchange clean product for soiled and must account for customer par levels, contract inventory, missing/damaged pieces, route delivery, and clean/soiled separation. Healthcare is a distinct regulated/quality-sensitive segment; restaurant towel/napkin service differs.

**Inference:** A differentiated CRM loop links account/service site → contracted item/quantity/par → recurring route stop → soiled pickup and clean delivery counts → plant processing status → shortage/damage/quality exception → reconciliation/invoice. Laundry plant production and textile inventory systems may be critical but are beyond generic field CRM. This is not a consumer wash-and-fold profile.

## Business model and customer segments

- Linen laundering can be customer-owned textile processing or rental/exchange. Products include tablecloths/napkins, towels/rags, mats, uniforms, bed linens, and healthcare textiles. Recurring account route work contrasts with per-piece consumer service.
- Buyers include restaurants, hotels, spas/gyms, care facilities, clinics and hospitals. These vary in par/usage, soil category, hygiene assurance, delivery frequency, item ownership, and service-level expectation.
- Operator scale ranges from local laundry with limited territory to large textile rental networks with industrial plants, route drivers, depots and service reps. A service account may have multiple delivery points and contract pricing.

## Terminology and durable records

- Records: customer account, service site, route stop, service schedule, contract, item/SKU, par level, delivered/returned/soiled/short/damaged quantity, soil category, wash/processing batch, invoice, and service exception.
- Site needs receiving access, linen room/storage, delivery window, clean/soiled staging, item count method, contact and route instructions. If customer-owned, linen ownership must be distinguished from operator rental stock.
- Persistent assets include reusable textiles, carts, hampers, washers/dryers, finishing equipment, delivery vehicles and possibly RFID/chip tracking. Linen piece counts, loss, wear and quality history may be financially material.
- Clean/soiled status and healthcare/food-contact classification are operational/safety data. Do not store patient identifiers as a routine laundry record.

## Services, intake, quoting, and booking

- Intake: facility type, site count, item categories/volumes, ownership/rental, par or weekly quantity, pickup days, turnaround window, soil/contamination separation, delivery access, inventory/count technology, and contract constraints.
- Price can reflect item count, flat weekly route minimum, rental/replace cost, item quality, frequency, delivery fees, soil type, emergency service, and contract. Do not infer public list pricing from isolated contract anecdotes.
- New account often needs a site survey/par setup and sample or inventory count; additions/site moves require contract and route changes. Customer portal may support invoices and shortage reports, but self-service intake should not bypass healthcare handling review.

## Pricing and commercial model

- **Observed evidence:** Reddit operator/customer discussions report contract term and rate escalation concerns; one restaurant owner describes about $90/week rising to $150/week over five years without proportionate product increase, then negotiating a shorter term and capped annual increase with another vendor. Other users report shifting to locally laundered customer-owned stock for cost control, with greater required par. These are anecdotes, not market prices.
- Common commercial dimensions include item replacement/loss charges, rental inventory, weekly delivery quantity, service frequency, term/renewal, annual price adjustment, fuel/delivery and minimums. Keep invoice and contract price history explicit.
- No reliable software subscription WTP evidence found. Linen rental rates are service contract prices, not CRM plan prices.

## Recurrence, scheduling, dispatch, and routing

- Recurring route schedules depend on volume, pickup window, plant turnaround, vehicle capacity, account access, and clean inventory available. Seasonal hotel demand and event volume may shift par.
- Route driver scan/count records can establish what was picked up/delivered and discrepancies. Plant production schedule must reconcile route demand to clean goods inventory.
- Exceptions include holiday closures, account event/occupancy spikes, failed access, late delivery, shortage, contamination, and urgent replacements. A simple recurring appointment does not capture exchange quantities.

## Field workflow, safety, completion, and rework

- At stop: verify site and delivery window → handle clean and soiled goods separately → scan/count delivered clean and collected soiled goods → record shortages/contamination/damage → obtain customer signoff when used → route return to plant → process, inspect, finish, and prepare next delivery.
- FDA Food Code is a model adopted by state/local jurisdictions; its 2022 text says soiled linens must be contained/transported to prevent contamination of food, clean equipment/utensils, and single-use articles. Healthcare facilities rely on specialized textile hygiene/quality standards; the TRSA Hygienically Clean Healthcare certification is a trade-program signal, not a legal universal requirement.
- Distinguish missing return, damaged linen, contaminated load, insufficient par, quality failure, and missed delivery. Contract terms determine replacement/billing responsibility.

## Customer communication and self-service

- Account needs scheduled service confirmation, route change/holiday notice, shortage/quality exception, contract renewal, invoice, and site-level service history. Customer may confirm counts or report shortages.
- Keep route stop communications operational and specific; human review is appropriate for disputed loss/damage charges, contamination, healthcare quality incidents, and contract changes.

## Equipment, inventory, suppliers, and workforce

- Core inventory includes customer-owned and rental linen by item/size/quality, clean/soiled status, plant/route/site custody and par. Carts, bags, scales/scanners/RFID, delivery vehicles, washers/presses/folders are capital assets/plant equipment.
- Route drivers capture exchanges; plant staff sort/wash/dry/finish/inspect/pack. Healthcare processing may require documented quality systems and training. Schedules/roles vary by plant and segment.

## Reporting and operating measures

- **Observed:** Linen incumbent markets scheduled delivery and product management; healthcare quality programs emphasize textile cleanliness; customer posts identify discrepancies, price increases and disputed contracts.
- Inferred measures: delivery on-time/in-full, exchange variance, missing/damaged rate by site/item, par adequacy, rewash/reject, route stop duration, plant yield, service complaint resolution, contract profitability, and renewal.

## Existing software and operator evidence

- Alsco describes scheduled uniform/linen delivery, laundering, and maintenance. Commercial route software vendors target customer/routes/billing; available pages are vendor claims and do not establish market share. Healthcare systems may use linen tracking/RFID and plant quality records.
- First-person restaurant owner discussions show complaints about price escalation, long/unclear contract terms, incorrect quantity, customer service, and perceived loss billing. Some contrast poor national-vendor experience with better local service; others describe in-house/local laundry cost savings but larger on-hand inventory. Anecdotal experiences conflict, so service quality and economics vary by market and contract.
- No independently verified vertical software plan price or operator CRM purchase price was identified; WTP is unknown.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Customer account/site, route stop, par, exchange, clean/soiled, shortage | Commercial exchange model | High |
| `locationFields`, `assets` | Linen room/access/window, service site; linen pool/carts/vehicles | Route and inventory model | High |
| `services`, `recurrencePresets` | Weekly scheduled linen exchange, laundry-only, rental/maintenance, emergency replacement | Incumbent services vary | Medium |
| `formSteps`, `website` | Facility type, linen categories/volume, service frequency, ownership, access, hygiene segment | Needed to size route and par | High |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Clean/soiled separation, exchange count, signoff, exception, plant return/processing handoff | FDA handling and exchange workflow | High |
| `pricingTemplates` | Per-item/per-exchange + rental + route minimum/frequency + loss/replacement | Contract dimensions | Medium; tenant rates required |
| `defaultAutomations` | Service reminder, holiday schedule, shortage/renewal alert | Recurring route workflow | Medium |
| `reports` | On-time/in-full, exchange variance, loss, complaints, renewal | Operator/customer evidence | Medium |
| `inventoryDefaults` | Customer/rental-owned linens, bags/carts and optional tracking consumables | Inventory is core | High |
| `recommendationQuestions` | Rental or customer-owned? healthcare? item tracking? plant owned? multiple routes/sites? | Major workflow/security split | High |
| `productCapabilityRecommendations` | `service_scheduling`, `field_job_tracking`, `invoicing`, `inventory_management`; candidate `linen_exchange_reconciliation` key unconfirmed | Routes and exchange counts | Medium |
| `recommendedConnectorCapabilities` | `routing`, `geocoding`, `accounting`, `email`, `sms`, `storage`, `payroll` conditional | Route, billing, service and crew | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `service_scheduling` | normally_recommended | Recurring site pickup/delivery | High |
| `field_job_tracking` | normally_recommended | Driver delivery/exchange evidence | High |
| `inventory_management` | normally_recommended | Rental stock, customer par and exchange variance | High |
| `invoicing` | normally_recommended | Recurring contract and extras/adjustments | High |
| `route_planning` | normally_recommended | Route density and timed stops | Medium |
| `document_management` | optional | Contracts, healthcare quality/service documents | Medium |
| `payroll_inputs` | optional | Route/plant staff time handling | Low |
| `customer_portal` | optional | Site-level counts, invoice and shortage reporting | Low |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Recurring route stop, par, exchange count, shortage reasons | Pack configuration | Route and customer evidence | High |
| Schedules, field visits, asset lists, contracts/invoices | Existing shared capability | Current contract surfaces | Medium |
| Textile plant production, clean/soiled custody, healthcare validation | Business-specific customization or specialist laundry system | Plant and segment needs exceed generic field CRM | High |
| Exact piece-level chain of custody core gap | No gap established | Need shown; current platform boundaries not proven inadequate | Medium |

## Evidence, disagreements, and uncertainty

Confidence is medium-high for recurring route/exchange and contract concerns, medium for healthcare/food handling examples, and low for software prevalence/WTP. Rental versus customer-owned laundry changes custody, stock and pricing substantially; hotel, healthcare and restaurant operations should not share unqualified defaults.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [Alsco commercial laundry](https://alsco.com/) | Incumbent/operator | Accessed 2026-09-24 | Multi-region | Recurring scheduled delivery, laundry and maintenance | Vendor marketing |
| [TRSA Hygienically Clean Healthcare](https://www.trsa.org/certification/hygienically-clean/healthcare/) | Textile Rental Services Association | Accessed 2026-09-24 | North America | Healthcare linen quality certification program | Voluntary certification, not all segments |
| [FDA Food Code page](https://www.fda.gov/food/retail-food-protection/fda-food-code) and [2022 code](https://www.fda.gov/media/184685/download) | FDA primary | Accessed 2026-09-24 | US model code | Soiled linen containment/transport principle | Local adoption/amendments; 2026 edition now current |
| [Restaurant contract/rate experience](https://www.reddit.com/r/restaurant/comments/1ndvfh5/recent_cintas_experience_rate_increases/) | First-person operator/community | 2025 | US anecdotal | Contract length and reported price escalation | One restaurant account, unverified |
| [Switch to in-house linen](https://www.reddit.com/r/restaurantowners/comments/1tkuesb/switch_to_in_house_linen/) | First-person operator/community | 2026 | US anecdotal | Cost/service tradeoff, added inventory and pickup frequency | Single operator experience |
| [Service complaint discussion](https://www.reddit.com/r/restaurantowners/comments/1bxrktj) | Restaurant-owner community | 2024 | US anecdotal | Complaints, local/in-house workarounds and reliability tradeoffs | Informal thread; mixed providers |
| [Route Loop linen services](https://routeloop.io/industries/linen-services) | Route software vendor | Accessed 2026-09-24 | Product/vendor | Route, driver, account and billing software positioning | Marketing; no market-share evidence |

## Handoff to a future pack implementer

Ask whether this is commercial pickup laundry or linen rental/exchange, customer segment, customer-owned vs operator-owned stock, item/barcode/RFID count, plant ownership, route frequency and hygiene controls. Prototype site-level par and exchange reconciliation with exception evidence. Leave textile processing, healthcare quality certification, local food-code adoption, and disputed loss/price terms configurable; confirm whether field CRM or specialist laundry software remains system of record.
