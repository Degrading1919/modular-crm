---
name: modular-crm-product-design
description: Human-centered product design and UX implementation guidance for Modular CRM's owner, office, field, customer, onboarding, and public experiences.
---

# Modular CRM Product Design

Use this skill for every user-facing product change, review, or redesign. Read `docs/V1_UX_DESIGN.md` for the current design-system source of truth and applicable flow requirements. Repository product rules, permissions, tenant boundaries, Industry Pack contracts, and accepted decisions remain authoritative.

## Product standard

Design operational software for people who use it for hours each day. Optimize for clear hierarchy, quick scanning, dependable interactions, useful density, and low cognitive load. Keep one shared platform, with differences in language and workflow supplied by validated Industry Pack configuration. A business owner should not need to understand implementation details to use ordinary workflows.

Every screen should make the user's current task and the next useful action clear. Keep secondary detail available without making routine work harder to scan. Delete redundant explanation, decoration, and controls when doing so does not hide useful information or remove functionality.

## Before changing a surface

1. Read this skill and the relevant part of `docs/V1_UX_DESIGN.md`.
2. Inspect the existing workflow, permissions, loading/error/success states, responsive behavior, tests, and Industry Pack inputs before changing presentation.
3. Identify the user's goal, the highest-value information, the common next action, and what belongs behind progressive disclosure.
4. Use the existing shared tokens and primitives. If they fail a genuine workflow need, improve the shared system with an explicit rationale instead of adding a competing local pattern.
5. Keep ownership of shared styles/components with the design-system maintainer during coordinated work. Do not edit shared primitives outside an assigned scope.

## Interface rules

- Use a restrained, neutral visual system with the established brand accent reserved for important actions and navigation state. Let hierarchy come from type, alignment, spacing, and dividers before adding containers.
- Prefer page titles, section headings, compact lists, tables, and grouped form sections over stacks of generic cards. A surface may use a container when it has a clear boundary or distinct interaction.
- Use sentence case, specific business language, short labels, and direct actions. Keep necessary industry terms. Remove filler, repeated descriptions, inflated claims, artificial enthusiasm, and implementation jargon.
- Use icons when they communicate a recognizable action or object. Icon-only controls need accessible names; do not add icons to every heading or label.
- Make forms reflect the user's task, not a database table. Group related questions, sequence them in the order users know the answers, prefill safe defaults, reveal conditional details only when relevant, preserve input after errors, and place actionable errors next to the field and in an understandable summary when needed.
- For provider setup, lead with the business outcome. Reveal manual credentials only when the owner chooses setup, explain who can provide them, mask secrets, and never show saved values again. Keep unavailable integrations honest without presenting fake connection actions.
- Keep tables/list views useful at realistic density. Support long names, narrow screens, keyboard access, and clear empty, loading, failure, and no-results states.
- Keep status legible without color alone. Use native controls and semantics where possible. Associate labels/errors, preserve visible keyboard focus, respect reduced motion, and avoid horizontal page overflow at 375, 768, 1024, 1440, and 1920 CSS pixels.
- Motion is brief and tied to a state change. Do not animate for decoration or make success depend on animation.
- Never create fake controls, fake data, misleading success, or UI that suggests an action the backend does not support.
- Never weaken authorization, tenant isolation, capability/entitlement enforcement, validation, or historical integrity for presentation convenience.

## Product voice

Write like a competent office manager explaining what happened and how to proceed. Say what is saved, what failed, and what the user can do next. Prefer “Save changes”, “Assign technician”, “Send estimate”, or “Try again” over generic “Manage” or “Continue” when the destination/action is known. Avoid promotional copy in operational screens and avoid asking users to confirm routine reversible edits.

## Review and evidence

Verify changed workflows in the running product when possible, not only from component code. Test realistic populated and empty states, validation, loading, success/failure, destructive actions, long content, keyboard interaction, mobile/tablet reflow, and console/network health. Use automated accessibility checks to find likely defects, then manually inspect labels, focus order, dialogs, status announcements, and task flow. Automated audits do not establish usability or visual quality by themselves.

Report the surfaces reviewed, workflow preserved, major UX changes, shared patterns added, conflicts, unresolved weaknesses, and checks performed. Do not claim a viewport, role, Industry Pack, or workflow was tested unless it was actually exercised.

## Source provenance

This original project guidance synthesizes the pinned references and licenses recorded in `references.md`. It summarizes applicable ideas; it does not vendor their skill text, design assets, or code. Use the project-specific rules here and in `docs/V1_UX_DESIGN.md` as the primary authority where external recommendations conflict with Modular CRM's product, accessibility, or workflow requirements.
