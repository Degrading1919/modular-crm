# Industry Research Profile Template

Use one profile per distinct candidate business type. Research similar businesses separately before proposing any consolidation. Reuse this structure; do not fill gaps with generic service-business assumptions.

## Profile metadata

- **Industry key:** `<lower-kebab-case>`
- **Source name:** `<business type as listed>`
- **Source category:** `<category on candidate source>`
- **Candidate source:** <URL, exact inventory heading, and 1-based position within that heading>
- **Other exact/near duplicate labels:** `<labels and locations, or none>`
- **Research date:** `YYYY-MM-DD`
- **Geographic scope:** `<evidence coverage; do not imply universal practice>`
- **Research status:** complete | partial

## Executive summary

Describe the business model, customer, distinctive operational loop, and strongest product opportunity in 1–3 paragraphs. Separate well-supported findings from inference and open questions.

## Business model and customer segments

- What is sold, to whom, and through what channels?
- Typical residential, commercial, public-sector, property-manager, or other segments; contract/project mix and buyer roles.
- Common purchase triggers, urgency, seasonality, geographic limits, and repeat-work patterns.
- Operator size/structure variations that change workflow.

## Terminology and durable records

- Industry terms for customers, service sites, assets, jobs, crews, estimates, and completion.
- **Service-location data:** what must be known about each address, venue, vehicle, site, or facility?
- **Persistent customer assets:** equipment, animals, rooms, vehicles, structures, or other objects with service history; what fields/history matter?
- Sensitive, safety-critical, regulated, customer-visible, or technician-only data.
- Distinguish true persistent assets from one-time job inputs.

## Services, intake, quoting, and booking

- Common service/job types, add-ons, inspections, maintenance, emergency, and follow-up work.
- Lead sources and minimum intake data; photos, measurements, documents, and site visits.
- Quote/estimate behavior: fixed, menu, measured, diagnostic, time-and-materials, bidding, or quote-required; approval/deposit/permit flow.
- Booking commitments: exact time, arrival window, route/day, event date, on-call, or multi-visit project.
- Public site/signup needs and when self-service should hand off to office review.

## Pricing and commercial model

- Evidence-backed price inputs (labor, size, count, material, distance, urgency, condition, tiers, contract, minimum, tax, etc.).
- How pricing changes by geography, company size, segment, or job type.
- Recurrence, prepaid/postpaid, deposit, progress billing, membership, cancellation, warranty, refund, and change-order patterns.
- Record any observed prices with currency, date, geography, source, and whether they are customer service prices or software subscription prices.
- **Willingness-to-pay evidence for software:** actual operator statements or observed incumbent plan purchases only; do not infer CRM budget from service prices.

## Recurrence, scheduling, dispatch, and routing

- Recurrence patterns and exceptions; seasonal or weather-driven schedules.
- Capacity constraints, crew/skill/equipment matching, dependencies, appointment windows, multi-day work, route density, travel, and service-area logic.
- Dispatch board and customer/technician schedule-change behavior.
- Emergency, late, rescheduled, return-visit, and cancellation handling.

## Field workflow, safety, completion, and rework

- Ordered field lifecycle from arrival through closeout; offline/connectivity requirements if evidenced.
- Checklist, forms, measurements, before/after photos, signatures, readings, certificates, customer acceptance, and other proof.
- Safety/compliance steps, licensing, permits, environmental handling, or chain-of-custody requirements; note jurisdiction.
- Noncompletion reasons, billability, customer notice, return work, warranty/callback, dispute, and escalation.

## Customer communication and self-service

- What customers need before, during, and after service (reminders, arrival, delay, quote, proof, invoice, renewal).
- Email/SMS/phone/portal/form needs and preference/consent constraints.
- Self-service profile, site/asset history, quote approval, booking, payment, reschedule/change/cancel, documents, and support needs.
- Identify where automated communication can cause harm or needs human review.

## Equipment, inventory, suppliers, and workforce

- Job-specific equipment, consumables, parts, materials, vehicle/asset assignment, replenishment, procurement, and inventory relevance.
- Crew roles, skills/certifications, subcontractors, time capture, breaks, travel, mileage, piece rate, commission, tips, and payroll/export patterns.
- Separate demonstrated common patterns from company-specific practices.

## Reporting and operating measures

- KPIs operators or incumbents actually expose (include definitions when available).
- Useful cuts by service, site/asset, crew/technician, territory, lead source, customer segment, contract, and time.
- Financial, utilization, quality, safety, recurrence/retention, and route measures; distinguish observed from inferred.

## Existing software and operator evidence

- Incumbent vertical software and relevant horizontal tools; what each appears to handle.
- Common stitched-together stack (CRM, scheduling, maps, accounting, payments, forms, spreadsheets, communication, etc.).
- Repeated operator complaints, workarounds, migration concerns, missing features, and support/pricing friction. Include contrasting experiences and company-size differences.
- Software product prices and packaging signals, citing current pages and recording access date. Distinguish advertised list price from negotiated or user-reported price.

## Mapping to Modular CRM's current IndustryPack contract

Use only evidence supported by the profile. Suggested pack behavior is provisional research, not an accepted product decision.

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | | | |
| `locationFields`, `assets` | | | |
| `services`, `recurrencePresets` | | | |
| `formSteps`, `website` | | | |
| `jobChecklist`, `noncompletionReasons`, `workflows` | | | |
| `pricingTemplates` | | | |
| `defaultAutomations` | | | |
| `reports` | | | |
| `inventoryDefaults` | | | |
| `recommendationQuestions` | | | |
| `productCapabilityRecommendations` | | | |
| `recommendedConnectorCapabilities` | | | |

### Capability fit

For each relevant functional capability, classify `normally_recommended`, `optional`, `usually_unnecessary`, `conditional`, or `unsupported by evidence`. Explain conditional triggers. These are capability recommendations, not entitlement, paid-module names, or assumptions about final commercial packaging.

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|

For connectors, use current keys from `packages/industry-packs/src/index.ts` when applicable; distinguish a provider integration from a product capability.

Use exactly one of the listed recommendation values per row. For a capability that is normal in one operating model but unnecessary in another, use `conditional` and explain both cases in the trigger/rationale column. `unsupported by evidence` is a research classification for this table only; it is not a runtime `ProductCapabilityRecommendation` status. In the contract mapping table, use only statuses supported by the runtime type (`normally_recommended`, `optional`, `usually_unnecessary`, `conditional`) and omit recommendations where evidence is insufficient. Keep provider connector recommendations in the `recommendedConnectorCapabilities` contract row; do not treat connectors as product capabilities in this table.

For product capabilities, reuse functional `featureKey` values already present in the reference Industry Pack when they fit (for example `service_scheduling` or `field_job_tracking`). The runtime contract does not currently publish a closed registry of product feature keys. If research suggests a capability with no known key, describe it as a candidate capability and mark the key as unconfirmed; do not imply it is already implemented or accepted.

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|

- **Pack configuration:** industry-specific defaults representable by the current contract.
- **Existing shared capability:** supported by the platform already; note configuration needed.
- **Candidate core-platform gap:** use only when a meaningful recurring need cannot be represented or safely enforced by the current shared capability/IndustryPack contract. Cite multiple independent sources where practical, identify affected industries if known, and state why fields/forms/workflows/connectors are insufficient. Do not propose architecture changes.
- **Business-specific customization:** varies by operator or local policy; do not make it a pack default without evidence.

If evidence does not support a core gap, say so explicitly. Do not turn an absent source or feature into proof of absence.

## Evidence, disagreements, and uncertainty

State where sources agree and disagree, including regional, regulatory, business-size, or business-model variation. List important unanswered questions and confidence (`high`, `medium`, `low`) with a reason. Tag material statements in the profile as **Observed evidence**, **Inference**, or **Uncertain** where the distinction might otherwise be unclear.

### Source log

Use direct links. Prefer primary operator documentation, incumbent product documentation/pricing, trade associations, regulators, and first-person owner/operator discussions. Search-result pages and the Sweaty Startup candidate page do not count toward the four independent industry sources. Seek at least four independent useful sources where practical, including at least one operator voice and one primary industry/incumbent source; state explicitly when that is not practical. Do not overstate anonymous or anecdotal posts. Use `complete` only when the material workflow and product-fit claims have enough evidence or are explicitly marked unsupported; use `partial` when source scarcity or unresolved scope prevents that standard, and explain why.

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|

## Handoff to a future pack implementer

Summarize the highest-value defaults to prototype, inputs that must remain tenant-configurable, required onboarding answers, critical workflow distinctions, and unresolved questions. Do not write runtime code or represent research suggestions as accepted decisions.
