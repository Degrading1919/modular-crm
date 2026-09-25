# Lighting rod installation

## Profile metadata

- **Industry key:** `lightning-rod-installation`
- **Source name:** `Lighting rod installation`
- **Source category:** Home services
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), exact inventory heading `Home services`, 1-based position 64
- **Other exact/near duplicate labels:** Interpreted as lightning protection, not lighting fixtures; distinct from Electrical, Roofing and solar.
- **Research date:** `2026-09-24`
- **Geographic scope:** US technical and trade sources; codes/adoption differ by jurisdiction, and sources mention international standards.
- **Research status:** partial

## Executive summary

The inventory's exact spelling is “Lighting rod installation.” This profile interprets it as lightning protection systems (LPS) for structures, not lighting fixtures. Such a project can include air terminals, conductors, bonding, grounding and surge protection with applicable design/installation standard and possible independent inspection. UL and Lightning Protection Institute sources establish specialized standards and certification evidence; apprenticeship material shows a specialist workforce pathway. Operator voice, market prevalence, pricing and software evidence remain sparse. Keep this separate from ordinary electrical, solar, and roofing project types.

## Business model and customer segments

Potential customers include building owners, architects/engineers, builders, institutions and structures requiring specified protection. New construction, retrofit, inspection and maintenance may exist, but source evidence does not quantify mix or residential prevalence.

## Terminology and durable records

Structure, air terminal, conductor, bonding, grounding electrode, surge protection, UL 96A, NFPA 780, LPI 175, listed installer/component, inspection, Master Label/nameplate, findings and deviations. Store structure/elevation, approved design/revision, standards edition, materials/marks, installer qualification, inspection scope/report, certificate and maintenance history.

## Services, intake, quoting, and booking

Specification/owner inquiry → structure/design review → applicable standard and inspection scope → quote → access/safety plan → installation → inspection/findings/corrections if specified → certificate/handoff → optional future inspection. Define full-system vs partial scope. Qualified specialist review governs technical design and claims.

## Pricing and commercial model

Structure size/complexity, roof access, conductors/terminals/grounding, engineering, standard, surge components, inspection scope and travel likely affect price, but no current contractor price source was found. No software WTP evidence. Separate installation, engineering and inspection scope in tenant-defined estimates.

## Recurrence, scheduling, dispatch, and routing

Coordinate construction stage, roof access, weather, lifts, grounded services, inspector availability and correction rounds. Maintenance or certificate follow-up exists in some programs, but a universal cadence is unsupported.

## Field workflow, safety, completion, and rework

Use qualified installers and applicable standard; capture component and layout evidence, bonding/grounding, deviations and inspection/test findings. Work at height is safety critical. Local code and inspection scope vary. Do not have software claim compliance or protection automatically.

## Customer communication and self-service

Explain standard and coverage scope, access, inspection and corrections, certificate/label, exceptions and future maintenance. Human review all technical assurance/compliance statements.

## Equipment, inventory, suppliers, and workforce

Roof access/fall protection, lifts, terminals, conductors, connectors, grounding/bonding components and test tools. Specialized training/certification may apply; ULPA describes a five-year apprenticeship pathway. Component listing/traceability may matter but needs business validation.

## Reporting and operating measures

Potential measures: stage time, inspection finding/correction, certificate completion, labor/material by structure and maintenance due. No standard KPI set was found.

## Existing software and operator evidence

UL describes UL 96A/NFPA 780 and its inspection/master-label process; LPI publishes installation/inspection guidance. ULPA describes specialized installer training. One electrician-forum discussion mentions field use of UL inspection. No dedicated incumbent or WTP evidence located, so profile remains partial.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Owner/specifier, structure, LPS job. | UL/LPI terminology. | Medium. |
| `locationFields`, `assets` | Structure/elevation, design, standard, components and certificate; LPS asset for inspection history. | UL inspection records. | High. |
| `services`, `recurrencePresets` | New install, retrofit, inspection/maintenance if qualified/offered. | Sources describe install and inspection. | Medium. |
| `formSteps`, `website` | Structure/spec intake, design scope, access, install, inspection/corrections, handoff. | UL process. | Medium. |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Standard/revision, qualified staff, safety, components, bonding evidence, findings. | UL/LPI. | High. |
| `pricingTemplates` | Tenant-defined structure, access, engineering, components and inspection. | No price evidence. | Low. |
| `defaultAutomations` | Document and inspection follow-up only when scope requires. | Process inference. | Low. |
| `reports` | Findings, correction, certificate and maintenance due. | Proposed. | Low. |
| `inventoryDefaults` | None; use tenant-approved listed-component catalog. | Specific systems vary. | High. |
| `recommendationQuestions` | Is “lighting rod” LPS? Who designs/installs/inspects? Which standard and jurisdiction? | Essential scope clarification. | High. |
| `productCapabilityRecommendations` | Normally project tracking, estimates, schedule, field evidence and docs; conditional LPS asset maintenance. Compliance key unconfirmed. | Technical sources. | Medium. |
| `recommendedConnectorCapabilities` | `payments`, `accounting`, `calendar`, `storage`, `email`, `sms`; conditional `payroll`. | Generic project work. | Low. |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `customer_relationship_management` | `normally_recommended` | Structure owner/specifier history. | Medium. |
| `estimates_and_quotes` | `normally_recommended` | Structure-specific scope. | Medium. |
| `project_job_tracking` | `normally_recommended` | Install, inspection and corrections. | High. |
| `service_scheduling` | `normally_recommended` | Site access and inspection windows. | Medium. |
| `field_job_tracking` | `normally_recommended` | Installation evidence and findings. | High. |
| `documents_and_photos` | `normally_recommended` | Design, standards, inspection/certificates. | High. |
| `safety_compliance_records` | `normally_recommended` | Specialist standards/qualification and work-at-height safety. | High. |
| `asset_maintenance_history` | `conditional` | If inspections/maintenance are offered. | Medium. |
| `inventory_management` | `conditional` | Component traceability depends on operator workflow. | Medium. |
| `recurring_service_management` | `unsupported by evidence` | Some follow-up exists, but cadence/customer norm is unclear. | Low. |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Structure/design/standard/certificate fields | Pack configuration | Current contract supports fields, documents and checklists. | Safety/install trades; medium. |
| Projects, schedule and file records | Existing shared capability | Shared contract supports common flow. | Cross-industry; medium. |
| No core-platform gap established | No gap asserted | Research scarcity is not proof of a gap. | None proposed; low. |
| Standards, inspection and qualification scope | Business-specific customization | Varies by jurisdiction/contract. | High. |

## Evidence, disagreements, and uncertainty

Standards and certification sources give strong technical evidence but little business-operations detail. One trade forum post is anonymous. UL Master Label is not established as required for every job. No software, price, WTP or prevalence claim is made. Partial status reflects thin operator/software evidence and uncertainty in label interpretation.

### Source log

Candidate page is metadata only and excluded from evidence count.

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [UL installer and Master Label program](https://www.ul.com/services/lightning-protection-installer-and-master-label-certificate-program) | Primary testing/certification | Accessed 2026-09-24 | US | Standards, installer listing, inspection scope/certificate. | Provider perspective; not every job requires label. |
| [UL LPS application guide](https://www.ul.com/thecodeauthority/knowledge/lightning-protection-application-guide) | Primary technical guide | Accessed 2026-09-24 | US/international | System components, bonding and inspection. | Verify current standard/local code. |
| [LPI 175](https://lightning.org/downloads/lpi-175-2026-standard-for-the-design-installation-inspection-of-lightning-protection-systems/) | Trade association standard | Accessed 2026-09-24 | US | Design/install/inspection reference. | Full standard may be paywalled. |
| [ULPA apprenticeship](https://ulpa.org/apprenticeship-program/) | Trade workforce program | Accessed 2026-09-24 | US | Five-year specialist training path. | One program, not universal. |
| [Electrician discussion](https://www.reddit.com/r/electricians/comments/1leqcuw/lightning_rod_installations/) | Trade voice | 2025; accessed 2026-09-24 | US/unspecified | Practitioner references standards/inspection. | Anonymous and brief. |

## Handoff to a future pack implementer

Confirm intended meaning of the inventory label with operators. Ask which standards, structures, inspection/certificate scope and maintenance are used. Prototype versioned design, qualification, field evidence and inspection findings only after this validation. Keep code and assurance decisions outside automatic CRM claims.
