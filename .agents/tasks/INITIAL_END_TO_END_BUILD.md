# Initial End-to-End Codex Build

Build Modular CRM end to end from this repository.

The repository already contains the product definition, architecture, domain model, schema target, state machines, business rules, UX, connector model, Pet Waste Removal reference Industry Pack, seed scenarios, and acceptance criteria. Read `AGENTS.md` and `docs/INDEX.md`, then use the linked documents as the source of truth.

## Mission

Produce a complete locally runnable V1 that the project owner can actually operate as a pet-waste-removal business: business/admin app, office workflows, technician experience, customer portal, public website/signup, backend, worker, database, routing, billing, communications, automations, payroll/time, inventory, reporting, multi-location/franchise support, connector marketplace, import/export, public API/webhooks, seed data, and tests.

This is an implementation task, not a planning or scaffolding task.

## Autonomy

Make the implementation decisions needed to deliver the product.

Do not stop for routine approval, split the work into owner-gated milestones, or ask questions that can be resolved from the repository, reference implementations, provider documentation, or reasonable engineering judgment.

If the documentation leaves a minor detail open, choose the simplest coherent solution and continue. If implementation exposes a better technical approach that preserves the documented product behavior, use it and update the affected documentation.

Use subagents, tools, repository research, and reference implementations as useful. The projects in `docs/REFERENCE_IMPLEMENTATIONS.md` are architectural references; do not copy code whose license is incompatible with this project.

## Hard guardrails

- Keep the application portable and locally runnable without production third-party credentials.
- Use the documented mock/test connector path so every core workflow can be exercised locally.
- Keep provider-specific behavior behind connector/capability boundaries.
- Preserve tenant isolation, permissions, auditability, idempotency, and historical financial/state integrity.
- Do not leave required V1 behavior as fake buttons, static mock screens, dead navigation, or TODO placeholders.
- Do not narrow the documented V1 scope merely to finish faster.
- Do not invent a separate architecture or product when the repository already defines one.

## Completion standard

Keep implementing, running, inspecting, and correcting the application until it is genuinely usable locally and the intent of `docs/V1_ACCEPTANCE_CRITERIA.md` is satisfied.

Run the relevant build, type, lint, unit, integration, and end-to-end checks; exercise the seeded owner, office, technician, customer, and public-signup workflows; fix failures you find; and leave the repository in a coherent runnable state.

Only stop early for a genuine blocker that cannot be solved with the repository, available tools, public documentation, mocks, or reasonable engineering judgment.

At the end, provide a concise evidence-based handoff describing what was built, what was actually verified, and any genuine remaining limitation.

Begin.
