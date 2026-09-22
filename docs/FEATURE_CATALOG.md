# Feature Catalog

This catalog preserves substantial Modular CRM feature concepts before or while they become formal requirements.

Accepted behavior should also be represented in the appropriate authoritative product or architecture document.

### V1 product spine

- **State:** Accepted
- **Problem:** Codex needs a stable set of actors and primary workflows before it can build the backend schema and frontend navigation end to end without repeated clarification.
- **Behavior:** Center V1 on the complete small-service-business lifecycle: owner signup and guided setup, customer creation/import, lead intake, estimate/approval, scheduling, routing/dispatch, job execution, invoice/payment, recurring follow-up, reporting, operations, and customer self-service.
- **Industry scope:** Core
- **Dependencies:** Authentication, tenancy, permissions, CRM entities, jobs, scheduling, routing, billing, communications, automations, website capability, customer portal

### Routing and dispatch

- **State:** Accepted
- **Problem:** Route-dense field-service businesses need more than a calendar and technician assignment.
- **Behavior:** V1 includes route optimization, maps, technician stop ordering, and drive-time planning.
- **Industry scope:** Core
- **Dependencies:** Geocoded locations, routing provider abstraction, jobs, scheduling, staff

### Outbound communications

- **State:** Accepted
- **Problem:** Businesses need automated customer updates without requiring a full support-inbox product.
- **Behavior:** V1 supports outbound email and SMS notifications. A unified omnichannel conversation inbox is not required for V1.
- **Industry scope:** Core
- **Dependencies:** Connector system, templates, automation engine

### Automation engine

- **State:** Accepted
- **Problem:** Businesses need useful automation immediately while still being able to model their own workflows.
- **Behavior:** V1 ships both predefined automation recipes and a configurable trigger-condition-action rule builder.
- **Industry scope:** Core
- **Dependencies:** Event model, job queue/execution history, connector actions

### Time, payroll, inventory, and advanced reporting

- **State:** Accepted
- **Problem:** An operational CRM becomes less valuable if owners must maintain separate basic systems for field labor, parts, and business visibility.
- **Behavior:** V1 includes time tracking, payroll inputs/reporting, inventory/parts tracking, and advanced operational/financial reporting.
- **Industry scope:** Core
- **Dependencies:** Staff, jobs, locations, service catalog, reporting model

### Multi-location and franchise operation

- **State:** Accepted
- **Problem:** The platform should serve growing operators without forcing migration to another system.
- **Behavior:** V1 supports multiple operating locations and parent/franchise structures with scoped permissions and rolled-up reporting.
- **Industry scope:** Core
- **Dependencies:** Organizational hierarchy, permissions, reporting

### Connector marketplace

- **State:** Accepted
- **Problem:** Small business owners should not need to understand APIs, OAuth scopes, or provider-specific infrastructure to connect the tools they already use.
- **Behavior:** Present connections by business capability, support multiple providers per capability, use guided OAuth/discovery where possible, and automatically configure sensible mappings with minimal user input.
- **Industry scope:** Core
- **Dependencies:** Connector registry/SDK, tenant integration state, OAuth/webhook infrastructure

### Template-driven business website

- **State:** Accepted
- **Problem:** Many small operators need a professional website and lead-capture path in addition to CRM functions.
- **Behavior:** Generate a public business website from structured tenant data and industry-aware templates. Website forms, bookings, payments, and future chat capabilities should feed directly into the CRM.
- **Industry scope:** Core
- **Dependencies:** Tenant content model, website templates, domain/publishing system

### Industry Packs

- **State:** Accepted
- **Problem:** Generic field-service software does not model niche workflows well, while maintaining a separate codebase for every niche would not scale.
- **Behavior:** Configure terminology, fields, assets, workflows, forms, automations, recurrence, reports, website defaults, and recommended capabilities per industry on top of a shared core. Pet waste removal is the first complete reference pack.
- **Industry scope:** Core
- **Dependencies:** Configuration model, shared CRM entities
