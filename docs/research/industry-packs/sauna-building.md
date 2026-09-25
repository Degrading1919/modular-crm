# Sauna building profile

## Profile metadata

- **Industry key:** `sauna-building`
- **Source name:** Sauna Building
- **Source category:** Niche carpentry
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), Niche carpentry, position 7 of 20.
- **Other exact/near duplicate labels:** Steam shower installation (#8) is a distinct wet-area/plumbing/electrical system; do not merge with sauna room or kit installation.
- **Research date:** 2026-09-24
- **Geographic scope:** U.S. operator and product guidance, including Florida and California; permit, electrical and building requirements vary by jurisdiction and product.
- **Research status:** complete

## Executive summary

**Observed evidence:** “Sauna building” covers at least two materially different offerings: assembling a manufactured indoor/outdoor cabin or kit, and constructing a custom sauna room with heater, controls, ventilation, insulation, benches and finish. Installation requirements depend on heater type, product model, location, power, clearances and ventilation. An installer may coordinate licensed electrical work and a GC, while a manufacturer may sell a readiness guide to the homeowner/contractor.

The pack opportunity is to qualify system type and construction scope early, preserve model/manual and electrical/site readiness, then record installation, testing, customer briefing and warranty. **Inference:** a specialty installer with recurring maintenance or multiple crews may benefit from service scheduling and asset records; no direct operator WTP evidence establishes subscription demand.

## Business model and customer segments

Customers include homeowners adding indoor basement/bathroom or outdoor barrel saunas, builders/remodelers, wellness/spa businesses, hotels and gyms. Small jobs may only assemble a prefabricated kit; custom builds may add framing, insulation, vapor layers, benches, cladding, lighting, heater, controls and ventilation. Infrared, electric heated traditional, wood-fired and commercial saunas differ in equipment, fuel and service needs. A sales/install dealer may deliver a product while electricians or other contractors perform regulated portions. Geography, outdoor access, weather and local electrical inspection affect work.

## Terminology and durable records

Record customer/site/room, sauna type/model/serial, heater and controls, capacity, cabin dimensions, clearances, supply voltage/circuit, ventilation configuration, substrate/floor, access, outdoor foundation/weather exposure, installer, inspection, commissioning, warranty and care. The installed sauna/heater is a persistent asset; room readiness, assembly steps, readings and photos are job records. Access constraints, household use and indoor photos require privacy controls. Manufacturer configuration is not safely interchangeable across models.

## Services, intake, quoting, and booking

Intake: prefabricated kit vs custom room, manufacturer/model, indoor/outdoor, heater/fuel, dimensions/ceiling, existing floor/foundation, distance to panel, dedicated circuit status, ventilation, access/stairs, electrical contractor, permit/inspection, delivery and customer timeline. Kohler's readiness guide identifies level/nonabsorbent surface, clear work area, dedicated electrical supply and configuration-specific ventilation; it is for its product, not a universal sauna specification. Site review is important before firm install quote. Pricing may split product, freight, assembly, base/site work, electrician, ventilation, finish and commissioning.

Flow: inquiry/model selection → site readiness/measure → quote and responsibility approval → product order/delivery → base/electric/vent readiness → assembly/custom room construction → heater/control check → test/commission → customer briefing and handover. Keep kit assembly distinct from custom construction, and do not promise that installer handles electrical unless agreed/licensed.

## Pricing and commercial model

Inputs include kit vs custom, cabin size, indoor/outdoor foundation, heater type/power, electrical panel/circuit and distance, ventilation, insulation/cladding, bench design, glazing, access, delivery, demolition and permitted subcontract work. Payment can follow product deposit, installation milestone and completion; terms vary. Public operator pages describe packages but do not establish representative prices. **Software WTP:** no direct installer software purchase or verified spend found. Generic field-service subscription prices are only package availability, not evidence of adoption or willingness to pay.

## Recurrence, scheduling, dispatch, and routing

Schedule equipment delivery, site completion, electrical/permit readiness, installer and electrician, ventilation/finish, commissioning and inspection. Weather affects outdoor construction; custom woodwork requires shop lead time. Small kit installation may be one visit; custom room several trades/milestones. Noncompletion reasons: wrong model/dimensions, inadequate circuit, unlevel/wet site, blocked access, missing ventilation or trade delays. Track readiness holds and who must resolve them.

## Field workflow, safety, completion, and rework

Verify approved model/site → protect occupied space → confirm clearances/base/access → assemble or construct to product documentation → qualified electrical hook-up/inspection as required → verify ventilation/control/heater operation and safety interlocks per manufacturer → explain operation/care → photos, serial/warranty, acceptance and invoice. Evidence can be site photos, model/manual, circuit/inspection sign-off and operational check; do not treat app-based checklists as electrical certification. Hazards include lifting, power tools, hot components, electrical work, heat exposure and outdoor work. Licensing/code and OSHA responsibilities are jurisdiction/task/employer dependent. Rework includes mounting/clearance errors, incorrect wiring, ventilation imbalance, damaged kit or unlevel base.

## Customer communication and self-service

Provide selection guidance, accurate preparation checklist, delivery window, room/power prerequisites, access prep, delay updates, test and safety briefing, warranty/manual and service contact. Forms can collect room photos and product details, with staff review of electrical/site suitability. Automated confirmation must not imply code approval.

## Equipment, inventory, suppliers, and workforce

Product kits, heaters, stones, controls, doors, benches, cladding, insulation, vents, wiring, protective floor and fasteners; installation tools and handling aids. Dealers may stock products/parts; custom builders order per project. Crew can be installer/carpenter, electrician, ventilation/finish sub and project coordinator. Track product supplier, serial/lot and qualified trade responsible for each task.

## Reporting and operating measures

Inferred: quote-to-install time, delivery/permit/site-readiness holds, first-visit completion, install callback, commissioning result, warranty contact, labor/material variance and margin by kit/custom and heater type. No standard KPI set or operator dashboard evidence was identified.

## Existing software and operator evidence

Clearwater Sauna Builders advertises assembly, site prep, leveling, electrical coordination, ventilation and commissioning in Clearwater. Lutz Plumbing SF describes equipment planning and GC/trade coordination. Kohler publishes model readiness/installation documentation. These show workflow and product-specific requirements, not software stack adoption. No operator software complaint or actual SaaS WTP testimony found. A generic FSM may manage quote/calendar/payment; product manuals remain authoritative.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Homeowner, builder, spa operator; kit, custom room, heater, control, readiness, commissioning | Operator/product docs | High |
| `locationFields`, `assets` | Indoor/outdoor room, dimensions, floor/base, circuit, ventilation; sauna/heater model and warranty | Product readiness guides | High |
| `services`, `recurrencePresets` | Kit assembly, custom sauna construction, heater/control replacement; no assumed recurring cadence | Scope types | Medium |
| `formSteps`, `website` | Type/model, room/site, access, circuit, photos, consultation/site check | Quote readiness | High |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Verify site, product/assembly, qualified electric, ventilation, test, handover; site/model/circuit/permit holds | Operator + manufacturer | High |
| `pricingTemplates` | Kit, freight, assembly, room construction, power, ventilation, access and permit | Inputs | Medium |
| `defaultAutomations` | Delivery, site/electric readiness, appointment, briefing and warranty follow-up | Workflow inference | Medium |
| `reports` | Readiness delay, install time, callbacks, commissioning and margin by kit/custom | Inferred | Low-medium |
| `inventoryDefaults` | Optional kits, heaters and parts/serials by dealer; per-job sourcing otherwise | Business variation | Medium |
| `recommendationQuestions` | Kit vs custom; heater type; indoor/outdoor; circuit readiness; own electrician; permit; crew size | Necessary segmentation | High |
| `productCapabilityRecommendations` | `estimate_management`, `service_scheduling`, `field_job_tracking`, `invoicing` normally; `asset_management`, `inventory_tracking`, `time_tracking` conditional; candidate commissioning key unconfirmed | Feature keys map to job loop | Medium |
| `recommendedConnectorCapabilities` | `calendar`, `email`, `accounting`, `payments`; `sms`, `storage` optional | Scheduling, records and billing | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| Shared core: customer, site and job records | normally_recommended | Capture site readiness and product handover. | Workflow; high |
| `estimate_management` | normally_recommended | Kit/custom and site-dependent scope. | Operator process; medium-high |
| `service_scheduling` | normally_recommended | Coordinate delivery, electrical, assembly and inspection. | Operator process; high |
| `field_job_tracking` | normally_recommended | Evidence readiness, serial, test and acceptance. | Product warranty/handover; medium-high |
| `invoicing` | normally_recommended | Project billing and deposit balance. | Inference; medium |
| `asset_management` | conditional | For firms maintaining installed heaters/saunas; pure kit assemblers may not need lifecycle records. | Scope variation; medium |
| `inventory_tracking` | conditional | Dealer/parts stock vs per-project orders. | Business model; medium |
| `time_tracking` | optional | Useful with crews/subcontract cost capture. | Inference; low |
| Candidate commissioning/certification capability (key unconfirmed) | conditional | Only if vendors/inspectors require structured proof; validate local requirements. | Sources do not show common CRM use; low |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Kit vs custom scope, readiness checklist and model/serial fields | Pack configuration | Manufacturer and installer workflows | Specialty installs; high |
| Shared estimate, schedule, job evidence and customer asset | Existing shared capability | General job/asset records | High |
| Product-specific readiness rule engine | Candidate core-platform gap | Manuals differ; links/files and tenant checklist might suffice | Regulated/safety install work; low |
| Electrical circuit, ventilation, permits and trade responsibilities | Business-specific customization | Product and local code dependent | High |

## Evidence, disagreements, and uncertainty

Prefabricated kits and custom rooms are distinct scopes. Manufacturer guides govern model-specific requirements; local code governs trades and inspection. Operator evidence is regional/promotional and does not establish prevalence, service pricing, software complaints or WTP. Workflow is adequately supported, hence complete; software adoption remains low confidence.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [Installation service](https://clearwatersaunabuilders.com/services/installation) | Sauna installer | Accessed 2026-09-24 | Clearwater, Florida | Site prep, assembly, electrical/ventilation, commissioning | Operator marketing |
| [Sauna planning and coordinated installation](https://lutzplumbingsf.com/services/sauna-installation) | Plumbing/sauna operator | Accessed 2026-09-24 | San Francisco, California | GC/trade, power, equipment and scope coordination | Operator marketing |
| [Kohler indoor sauna readiness guide](https://www.kohler.com/content/dam/kohler-com-NA/Lifestyle/PDP-PDF/202510_US_Kohler_ReadinessGuide-C1IndoorSauna_en-US.pdf) | Manufacturer primary guide | Accessed 2026-09-24 | U.S.; specific product | Level surface, circuit, ventilation/site requirements | Product-specific |
| [Home sauna room requirements](https://tahoesaunacompany.com/home-sauna-room-requirements) | Sauna designer/operator | Accessed 2026-09-24 | Tahoe, U.S. | Custom room dimensions, power, ventilation and structure | Vendor claims; verify technical details by model/code |
| [Jobber pricing](https://www.getjobber.com/pricing/) | Incumbent software pricing | Accessed 2026-09-24 | USD | Generic package signal | Not evidence of sauna business adoption/WTP |

## Handoff to a future pack implementer

Ask kit vs custom room, indoor/outdoor, heater/model, installation responsibility, electrical readiness, permits and service offering. Separate qualified electrical work from assembly. Capture model-specific manual, site readiness, serial, acceptance and warranty. Keep all clearance and circuit requirements tied to manufacturer/jurisdiction rather than universal pack defaults.
