# Security Installation

## Profile metadata

- **Industry key:** `security-installation`
- **Source name:** Security installation
- **Source category:** Home services
- **Candidate source:** [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love), Home services, position 58.
- **Other exact/near duplicate labels:** Manned home security services, private investigating and gate/keypad entry installation appear separately. This profile covers electronic systems installed at a premises—alarms, cameras, access control/intercom and related networks—not guard staffing, investigations, or the physical gate/fence build.
- **Research date:** `2026-09-24`
- **Geographic scope:** US and UK operator/software examples; licensing, alarm permits, fire/life-safety codes, electrical work and false-alarm programs vary by jurisdiction.
- **Research status:** complete

## Executive summary

**Observed evidence:** Security installation can include site survey/design, intrusion/fire detection, cameras/video management, access control, intercom, wiring/network, commissioning, customer/admin training and later service or monitoring. Licensed roles differ by jurisdiction and system: Texas DPS separately lists alarm installers and access-control device installers and defines regulated scopes. Some municipalities require alarm registration and charge for false dispatch. NFPA 731 covers electronic premises security installation/testing/maintenance in editions adopted by relevant authorities. Operator/software sources describe separate site, asset, zone, credential, maintenance, recurring-account and monitoring handoffs.

**Inference:** A CRM should support quote-led installation plus asset/zone/system records, serials, sensor locations, permit/monitoring handoffs, signal-test evidence, maintenance schedules, service calls and controlled customer credentials. It must distinguish install completion from verified monitoring/dispatch activation and keep sensitive security data restricted. Current project, estimate, asset, field, schedule, recurring-service, notification and invoice capabilities appear applicable; no core gap is established.

**Uncertain:** The broad label may mean a small residential camera/doorbell installer, licensed alarm dealer with recurring monitoring, or commercial integrator for access/camera systems. These segments differ in license, monitoring contract, software and schedule. This profile focuses on electronic premises systems and excludes staffed guard service and physical gate construction.

## Business model and customer segments

Buyers include homeowners, small businesses, multifamily/HOA, retail, warehouses, offices, schools and property managers. Work may be a one-time camera/access/alarm installation, retrofit/upgrade, new-build prewire, monitored alarm subscription, annual maintenance or emergency repair. Revenue can include hardware and labor, recurring monitoring, service contracts, callouts, cloud storage and access-management fees. Monitoring often entails a separate central station/provider agreement and subscriber-account setup; do not merge those amounts with installer labor.

Triggers include break-in/property risk, construction, insurance/customer requirements, tenant access changes, camera coverage, alarm failure or false alarm reduction. Intake should ask property type, protected areas, objectives, existing systems/panel, wiring/network/power, monitored vs local alert, camera retention, users/doors, site access, municipality permit, schedule and whether fire/life-safety components are included. Quote should follow survey/design where coverage, wiring and rules are uncertain.

## Terminology and durable records

- **Site:** customer premises, building, floor, room, zone, door/entry, network closet, monitoring jurisdiction, access hours, wiring/network/power, hazard zones and emergency contacts.
- **Persistent assets:** control panel/communicator, sensors, cameras/NVR/cloud service, readers/keypads/locks, intercom, power supply, battery, software/site account and monitoring account. Record device model/serial, installed zone/room, test date, firmware, warranty, configuration reference, permit/registration and maintenance history.
- **Job inputs:** coverage/design drawing, zone/device schedule, cable route, existing system compatibility, network/cellular signal, user/access role roster, monitoring agreement, authority permit, client approval, signal/test results, account activation and user training.
- Alarm codes, admin credentials, camera views, access schedules, site security plan and response contacts are highly sensitive. Apply role-based access/secure vault pattern; do not store plaintext credentials in general CRM text or expose security layout in customer website.

## Services, intake, quoting, and booking

Potential offerings: camera/CCTV installation; intrusion alarm sensors/panel; electronic access control; intercom; detection devices; system integration; wiring/prewire; upgrades; commissioning; service/repair; maintenance; monitoring setup or resale. Clarify whether operator sells, installs, programs, monitors, dispatches, or maintains; separate fire alarm/life-safety, gate operator, locksmith/mechanical locks, guard staffing and private investigation if outside qualifications.

Quote inputs include property/area size, devices/zones/doors, wiring/cable runs, existing gear, coverage/camera storage, access platform, panel/communicator, network/power, permits, install complexity, labor, monitoring setup, subscription, service level and work hours. Survey may map camera field of view, sensor placement, alarm zones and access groups. Customer approval should record selected system, service/monitoring term, data retention, response contacts, training and responsibility for permits. Not every residential install uses monitoring or subscription.

Booking may be straightforward for plug-in cameras or multi-stage for commercial systems: survey → proposal → permit/material procurement → wire/install → program/test → monitoring/account handoff → training → maintenance. Availability of licensed technician, network vendor, property downtime and customer access constrain schedule. Online instant booking is unsuitable until system and jurisdiction are clear.

## Pricing and commercial model

No comparable installation price list across electronic security scope was verified. Quotes depend on hardware/device count, cabling, power/network, property size, access, retention, panel compatibility, monitoring, permits, commissioning, labor and service agreement. Alarm monitoring/service may recur monthly; distinguish it from install labor and software subscription. Some platforms have dealer account and monitoring charges; terms are often customer/account/volume-specific. Do not use customer product prices to estimate installer WTP.

No transparent, independent operator CRM WTP evidence was verified. WorkHorse markets custom pricing for alarm-company software; Joblogic and other vertical vendors describe workflows but do not publish a directly comparable standalone list price in the cited pages. One current practitioner thread asks for software handling of alarm/access data and reports general FSM tools can feel cumbersome for security-specific records; it is anecdotal. Mark common stack and WTP as low-confidence/unsupported rather than fabricate a benchmark.

## Recurrence, scheduling, dispatch, and routing

Installation and service calls coexist with recurring monitoring and maintenance where sold. Track service-level response, scheduled inspections/battery replacement, permit renewal and agreement start/renewal dates. Match licensed/qualified worker, system type, access, tools and vendor platform. Multi-site commercial and maintenance work may benefit from routing; new installs are project/milestone driven. Alarm trouble calls, loss of signal, false alarms or access failure can be urgent; triage safety and service contract before dispatch. Delays may be due to permits, construction, parts, network, monitoring account, client availability or authority inspection.

## Field workflow, safety, completion, and rework

1. Confirm scope, site/areas, system type, user/monitoring responsibility, permit status and access.
2. Survey device/zone/door placement, power/network, cable paths, environmental conditions and existing equipment; document plan.
3. Verify locally required license/qualifications; install wiring and devices according to manufacturer and adopted codes/standards.
4. Program zones/users/cameras/access, configure monitoring and event routing if sold; protect credentials and privacy.
5. Test sensors, alarm signal/communication path, alerts, camera views/retention, access events, power backup and all user workflows.
6. Provide client/admin training, device inventory/as-built, response instructions, permit/account/monitoring details, acceptance and service schedule.

Texas DPS sources illustrate distinct licensing and prewire rules in that state; other jurisdictions must be checked. NFPA 731 describes electronic security system installation/testing/maintenance; the local adopted edition/code is controlling. San Antonio's official guidance is one example of permit and false-alarm fees, not a national rule. Common failure concerns include false activations, incompatible devices, missing permit, signal/monitoring not activated, credential administration and account handoff. Do not close a monitored installation before the alarm transmission and central-station handoff are confirmed where monitoring is contracted.

## Customer communication and self-service

Communicate survey, quote, permit requirement, install window, temporary coverage/disablement during work, monitoring activation, user roster, test results, training, invoice and maintenance/renewal. A customer portal may support service requests, site contacts and approved user access, but system credentials and security drawings need strict access. Automations must not send alarm codes by SMS/email, change access roles or claim monitoring activation without verified state. False alarm instructions and response contact validation should be explicit.

## Equipment, inventory, suppliers, and workforce

Equipment includes panel/communicator, sensors, camera/recorder, network switch, reader/keypad/intercom, cable/conduit, battery, mounting hardware, test instrument and configuration software. System and serial inventory is central to service; truck stock and procurement depend on vendor and job volume. Alarm/access technicians may require state license, manufacturer training and customer/monitoring platform credentials. Separate branch-circuit electrician and fire-alarm specialties when required. Security configuration files, user lists and replacement parts must be tracked under controlled access.

## Reporting and operating measures

Potential measures include quote-to-install, permit completion, signal-test pass, time to monitoring activation, installation callbacks, false-alarm/service calls, maintenance completion, recurring account retention, SLA response, device failures by model, and margin/revenue by install vs monitoring/service. Vertical vendors advertise job, customer, site, asset, maintenance and recurring-billing reports. Definitions differ; police dispatch and false-alarm outcomes depend on local authorities.

## Existing software and operator evidence

Vertical service software pages describe enquiries, estimates, customer sites/assets, engineer dispatch, maintenance and invoicing. Alarm dealer/account platforms may separately manage subscribers, account status and monitoring services. One practitioner forum participant says general field-service applications were cumbersome for alarm/access complexity and asks peers for recommendations; other replies mention dealer/security tools. A software vendor publishes custom pricing. Evidence is narrow and partly vendor-authored; it does not establish typical stack, general complaints or WTP. Software list prices should be recorded only when shown for a specific product/plan, and monitoring plan prices must not be mislabeled as CRM prices.

## Mapping to Modular CRM's current IndustryPack contract

| Contract area | Candidate configuration or behavior | Evidence / rationale | Confidence / open question |
|---|---|---|---|
| `terminology`, `customerTypes` | Customer/site, building/floor/zone, alarm system, device, user/admin, installer; residential, commercial, multifamily, retail, property manager | Operator and regulator contexts | High |
| `locationFields`, `assets` | Permit jurisdiction, monitoring status, emergency contacts, access hours; panels/sensors/cameras/readers with zone/model/serial/test/warranty | Service and safety record | High; secure access essential |
| `services`, `recurrencePresets` | Survey, install, upgrade, test/commission, repair, maintenance, optional monitoring handoff; tenant-defined service terms | Operator/vertical software offerings | High |
| `formSteps`, `website` | Property/system scope → areas/devices → wiring/network → monitored/local → permits/quote review | Regulated site-specific sales | High |
| `jobChecklist`, `noncompletionReasons`, `workflows` | Credential/permit/qualification, install, zone/device test, signal/monitoring activation, customer training; permit/site/network/parts blockers | DPS/municipal/NFPA and operator flows | High |
| `pricingTemplates` | Hardware/devices, area/wiring, labor, integration, permit, monitoring/service plan separated | Quote model varies | Medium |
| `defaultAutomations` | Appointment/update, permit reminders, test/handoff checklist, maintenance/renewal notices; never auto-send credentials | Recurring and customer comms | Medium |
| `reports` | Install/test/callback, false-alarm/service, monitored account/renewal, SLA, margin by install/service | Vertical tool reporting and candidate measures | Medium |
| `inventoryDefaults` | No defaults until target segment known; optional common panels/sensors/cameras/credential devices by operator | Device ecosystem varies | Medium |
| `recommendationQuestions` | Alarm vs camera vs access? Monitoring? Fire/life safety? Jurisdiction? Number of technicians/sites? Maintenance plans? | Scope affects licensure/software | High |
| `productCapabilityRecommendations` | `estimate_management`, `service_scheduling`, `field_job_tracking`, `inventory_tracking`, `recurring_service_management`, `customer_notifications`, `invoicing` normally for a full-service integrator; conditional by small install-only model | Vertical software and recurring workflow | Medium |
| `recommendedConnectorCapabilities` | `calendar`, `sms`, `email`, `payments`, `accounting`, `storage`, `routing`; access/security/monitoring integrations are vendor-specific, no current key | Generic management functions | Medium |

### Capability fit

| Functional capability | Recommendation | Trigger / rationale | Evidence / confidence |
|---|---|---|---|
| `estimate_management` | normally_recommended | Survey, devices, wiring, monitoring and permits shape scope. | Vendor install workflow / high |
| `service_scheduling` | normally_recommended | Install, service calls and maintenance require assignment. | Joblogic and operator offerings / high |
| `field_job_tracking` | normally_recommended | Device/zone/site test and closeout records matter. | Standards/regulatory/vertical workflow / high |
| `inventory_tracking` | conditional | Stronger for multi-tech integrators carrying serial-numbered equipment; less for install-only subcontractor. | Operator size difference / medium |
| `recurring_service_management` | conditional | Needed when monitoring, maintenance or recurring service is sold; not all security installers monitor. | Segment variation / high |
| `customer_notifications` | normally_recommended | Appointment, outage and activation status affect security service. | Workflow inference / medium-high |
| `customer_self_service` | conditional | Useful for approved service requests/contacts, but credential permissions and alarm codes require care. | Security sensitivity / medium |
| `route_planning` | conditional | Relevant for multiple service technicians/maintenance routes; install projects may be local but low-density. | Operating model / medium |
| `website_publishing` | optional | Useful for trust, scope and service-area intake; no evidence it differentiates security installation. | Candidate discovery model / low |

## Pack configuration vs core-platform gap vs business-specific customization

| Finding | Classification | Evidence and affected workflow | Cross-industry candidate / confidence |
|---|---|---|---|
| Site/system/zone/device inventory, test and monitoring handoff | Pack configuration | Electronic premises security defaults | Fire systems, access control, low-voltage / high |
| Customer, projects, estimates, schedules, assets, maintenance, files, notifications and billing | Existing shared capability | Verticals expose these core workflows | Cross-industry / medium-high |
| No core-platform gap established | Candidate core-platform capability to verify | Security-specific credentials/accounts may need secure integrations; not evidence of unsupported core capability | Medium |
| License, permit, false-alarm policy, monitoring agreement, response plan and sensitive access | Business-specific customization | Local jurisdiction, vendor and customer/site | High |

## Evidence, disagreements, and uncertainty

Official sources demonstrate local regulation and permit differences; vertical vendors describe common install-plus-service records, while operator chatter identifies friction fitting security specifics into generic field software. The complaints are not representative; software vendors have commercial incentives. **High confidence:** site/device/zone, verified test and monitoring handoff should be explicit where applicable. **Medium:** recurring-service management varies by monitoring model. **Low:** most common vendors, adoption, and paid CRM WTP. Confirm whether target is residential alarms, electronic access, cameras, fire/life safety, or commercial integrator; local licensing and false-alarm rules must be verified.

### Source log

| Source | Publisher / type | Published or accessed date | Geography | Claims supported | Source limits |
|---|---|---|---|---|---|
| [Businesses I Love](https://www.sweatystartup.com/blog/businesses-i-love) | Candidate list | Accessed 2026-09-24 | US-oriented | Candidate label/position | Candidate evidence only |
| [Texas DPS license types](https://www.dps.texas.gov/section/private-security/types-individual-licenses) | State regulator | Accessed 2026-09-24 | Texas | Alarm installer, monitor and access-control installer are distinct regulated roles | Texas only; verify other jurisdiction rules |
| [Texas DPS alarm prewiring guidance](https://www.dps.texas.gov/section/private-security/alarm-system-installation-builders-and-pre-wiring) | State regulator | Accessed 2026-09-24 | Texas | Licensed supervision and alarm-specific prewire scope | Official interpretation for Texas statute |
| [NFPA 731 overview](https://webstore.ansi.org/standards/nfpa/nfpa7312017) | NFPA standard listing via ANSI | Accessed 2026-09-24 | US standard | Electronic premises security installation, testing and maintenance purpose | 2017 listing is historical; 2020 supersedes; local adoption varies |
| [San Antonio false alarms](https://www.sanantonio.gov/Portals/0/Files/SAPD/Forms/brochure-AlarmPermits.pdf) | City police/permit guidance | Accessed 2026-09-24 | San Antonio, Texas | Permit and local false-alarm charge example | City-specific, dated brochure |
| [Installation and integration services](https://core-security.com/service/installation-and-integration-services/) | Security integrator | Accessed 2026-09-24 | Tennessee/operator territory | Alarm, camera and access-control installation and quote-led scope | Single operator |
| [PAX Security](https://www.paxsecurity.com/) | Security operator | Accessed 2026-09-24 | New York/New Jersey | Camera/access/intercom/alarm portfolio, service plans and platform integrations | One operator marketing page, not stack survey |
| [Security installer software discussion](https://www.reddit.com/r/accesscontrol/comments/1kw013u/whats_the_best_software_youve_used_for_a/) | Installer/operator community | Published 2025; accessed 2026-09-24 | Unspecified | Reported fit concerns with general FSM and specialized alarm/access software examples | Anonymous, limited responses, not representative |
| [WorkHorse alarm-company software pricing](https://workhorsescs.com/software-for-alarm-companies/pricing/) | Vertical software vendor | Accessed 2026-09-24 | Vendor market | Custom-pricing model for alarm company software | Vendor page; no public amount or purchase proof |
| [Security company management software](https://www.joblogic.com/en-us/industries/security-company-management-software/) | Vertical software vendor | Accessed 2026-09-24 | US-facing | Site/assets, engineer dispatch, estimates, service calls and invoices | Marketing claims; no disclosed price on cited page |

## Handoff to a future pack implementer

First ask what electronic systems are installed, whether work is monitored, what contracts recur, and which licenses/jurisdictions apply. Prototype a survey-to-test-to-monitoring handoff with restricted security data and explicitly separated install, activation, monitoring and maintenance states. Keep authority permits, codes, standards, monitoring, access roles and customer-response policy tenant-configurable. Do not treat a generic closeout or payment event as proof that a protective system is commissioned.
