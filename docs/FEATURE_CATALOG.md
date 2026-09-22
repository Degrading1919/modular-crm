# Feature Catalog

This catalog preserves substantial Modular CRM feature concepts before or while they become formal requirements.

Accepted behavior should also be represented in the appropriate authoritative product or architecture document.

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
- **Behavior:** Configure terminology, fields, assets, workflows, forms, automations, recurrence, reports, website defaults, and recommended capabilities per industry on top of a shared core.
- **Industry scope:** Core
- **Dependencies:** Configuration model, shared CRM entities
