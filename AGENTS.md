# AGENTS.md

## Project

Modular CRM is a reusable SaaS platform for niche service businesses. It should not become a collection of separately maintained CRMs.

## Development model

The project owner prefers end-to-end implementation after scope is well defined.

Do not default to architecture-only scaffolding, placeholder pages, or repeated stop-and-confirm loops. When a task authorizes implementation, carry the requested slice through to a usable local result, test the primary flows, and document how to run it.

Human evaluation happens by operating the product locally or live, identifying friction, and iterating from real use.

## Product constraints

1. Keep the core platform industry-neutral.
2. Express industry differences through Industry Packs wherever reasonable.
3. Do not hard-code the CRM around one provider such as Stripe, Twilio, QuickBooks, Google, Microsoft, or Supabase.
4. Treat integrations as discoverable connectors grouped by user-facing capability.
5. A nontechnical owner should never need to understand OAuth scopes, webhooks, API keys, database schemas, or sync tables when a guided flow can hide them.
6. Prefer OAuth and provider discovery over manual credential entry where supported.
7. Automatically map imported data when confidence is high; ask the user only when ambiguity matters.
8. External services must degrade gracefully. Local development should work with mock/test implementations.
9. Keep infrastructure portable. Prefer TypeScript, standard web APIs, PostgreSQL, Docker-compatible services, and explicit boundaries around proprietary services.
10. Protect tenant data at the data-access layer, not only in the UI.

## UX standard

Design for an owner whose technical baseline may be Facebook, email, and spreadsheets.

Prefer language such as:

- Accept payments
- Send appointment reminders
- Import my customers
- Sync accounting
- Connect my calendar
- Publish my website

Avoid exposing provider or implementation terminology unless needed.

## Research standard

When implementing a major capability:

- Study current provider documentation for API correctness.
- Study mature production applications that already solve a similar problem.
- Prefer concepts proven in real products over invented abstraction for its own sake.
- Check license compatibility before copying any code.

Current reference applications are documented in `docs/REFERENCE_IMPLEMENTATIONS.md`.

## Documentation discipline

Every meaningful product concept, proposed feature, accepted decision, superseded decision, architecture change, connector rule, industry-pack rule, or UX requirement must be recorded in the repository as part of the same work.

Use `.agents/skills/modular-crm-decision-sync/SKILL.md` as the deterministic routing and update procedure.

- Accepted or superseded decisions must be summarized in `docs/DECISION_LOG.md`.
- Substantial unaccepted feature concepts belong in `docs/FEATURE_CATALOG.md`.
- Update the appropriate authoritative document rather than creating duplicate prose.
- Do not interrupt normal product discussion with unnecessary documentation confirmations.

## Source of truth

Repository documentation and accepted code supersede older chat assumptions when they conflict. Update documentation when a product decision changes.
