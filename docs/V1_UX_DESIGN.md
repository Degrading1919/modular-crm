# V1 UX and design system

This is the design-system source of truth for the web application. Frontend contributors should also read [the Modular CRM Product Design skill](../.agents/skills/modular-crm-product-design/SKILL.md). Shared tokens and primitives live in `apps/web/app/globals.css` and `apps/web/components/ui.tsx`; keep this document synchronized when those conventions change.

## Product character

Modular CRM is operational software for owners, office staff, field workers, and customers. It should feel calm, direct, dependable, and efficient during repetitive daily use. Use a restrained visual language. Information, not decoration, should carry a screen.

One shared platform should adapt to a business through validated Industry Pack configuration and tenant settings. Personalization can change terminology, relevant data, workflow emphasis, form sequence, and customer copy. It must not introduce industry-specific application forks or bypass permissions, entitlements, or server behavior.

## Hierarchy and density

- Give each page one clear title and one primary action where a primary action exists.
- Start operational pages with the information needed to act now: upcoming work, exceptions, owner, customer, status, and next action.
- Prefer aligned sections, dividers, compact rows, and purposeful tables to nested cards. Use a bordered surface only when it marks a true group, independent region, or overlay.
- Keep list and work screens information-dense enough to compare records without opening them. Keep customer and field views simpler where the user's context calls for it.
- Use progressive disclosure for infrequent settings and advanced options, without hiding required status or safety information.
- Avoid decorative metrics, giant headings, repeated descriptions, generic “Manage…” copy, and whitespace that makes routine scanning slower.

## Visual system

Centralize tokens in `globals.css`. The intended roles are:

| Role | Guidance |
| --- | --- |
| Canvas | Quiet, near-white neutral that distinguishes the page from working surfaces. |
| Surface | White or a restrained neutral, with a thin border where separation is needed. |
| Text | High-contrast charcoal for primary content; muted gray only for supporting content. |
| Brand | Deep evergreen for primary actions and selected navigation. Use sparingly. |
| Semantic status | Distinct success, warning, danger, and informational colors with readable text and labels. Color never carries status alone. |
| Lines | Thin, low-contrast borders for grouping and table rows. |
| Elevation | No shadow for ordinary content; reserve a restrained shadow for menus, dialogs, and overlays. |
| Radius | Small and consistent (roughly 4–8px) for controls and working surfaces; larger only for public/customer moments that need clear separation. |

Use one readable sans-serif family with a dependable local system fallback. Body text should remain comfortable at 14–16px; operational table text may be compact but should remain readable. Page titles should establish hierarchy without dominating work. Use tabular numerals for money, counts, and times when comparison matters. Avoid using color, font weight, or badges to make every datum equally loud.

Use a 4px base spacing rhythm, with 8px increments for common gaps. Controls should be consistent in height and padding; compact dense table rows should remain comfortably targetable by pointer and keyboard. Keep content width appropriate to the work: do not stretch forms or long text across a very wide desktop canvas.

## Shared components and interaction

- **Buttons:** Primary, secondary, quiet, and destructive variants. One dominant primary action in a context. Names describe the outcome. Keep focus, hover, active, disabled, and pending states visible; prevent duplicate submits while saving.
- **Forms:** Persistent labels; correct input type and autocomplete; clear optional/required status; useful defaults; inline errors connected to inputs; preserve values after failed saves; show save outcome. Separate advanced or conditional fields only when they are genuinely optional.
- **Tables and lists:** Clear column labels, aligned values, readable row hover/focus, status text, stable empty/no-results states, and deliberate narrow-screen behavior. Do not hide important actions or data behind horizontal page overflow.
- **Connections:** Explain the business outcome first. Keep unavailable setup honest and non-actionable; put manual account credentials behind an intentional disclosure, explain who can provide them, mask secret input, and never show saved values again.
- **Status:** Reuse status presentation and wording across the product. Pair color with text or an accessible label; use live regions for updates that require announcement.
- **Navigation:** Show the current location clearly; group by job to be done; avoid exposing unsupported or unavailable product areas as actionable destinations.
- **Dialogs and drawers:** Use semantic dialog naming, Escape behavior when safe, focus containment and restoration, scroll containment, and explicit accessible close controls. Never rely on a backdrop click as the only exit.
- **Empty/loading/error/success:** Keep each state close to its content. Say what happened and the next safe action. Use skeletons only when they preserve expected layout and reduce perceived waiting; do not animate unnecessarily.
- **Icons:** Use the established icon family only for recognizable actions or objects. Decorative icons are hidden from assistive technology; icon-only controls have an accessible name.
- **Motion:** Short, purposeful transitions only; respect `prefers-reduced-motion` and do not make information depend on animation.

## Role-specific layouts

- **Owner and office:** Desktop navigation plus a compact context bar; list/detail workflows; actionable exceptions; fast search and editing. Tablet and phone remain usable for common urgent work.
- **Field:** Mobile-first job context, address/access details, customer assets, checklist, notes, proof, and one clear next action for the current job state. Minimize typing and support touch and poor connectivity where existing behavior allows.
- **Customer and public:** Plain language, short forms, clear totals/status, expected response, and obvious payment/approval/request actions. Do not expose internal labels or staff-only detail.
- **Onboarding and setup:** Ask business-language questions in a useful sequence; preselect evidence-based defaults without implying a capability is commercially entitled; show progress and explain only decisions that affect setup.

## Forms and product writing

Forms reflect a user task rather than a database schema. Group fields by the decisions the user is making, sequence known answers first, and reveal conditional questions only when needed. Do not use a giant undifferentiated form for onboarding or operational work.

Use sentence case, familiar words, specific field labels, and direct action text. Preserve meaningful industry terminology. Remove filler, redundant confirmation text, verbose helpers, promotional copy in operational screens, and vague labels. An error explains what failed, whether data was saved when that is known, and the next safe action. Do not claim a send, booking, connection, or payment succeeded until the system confirms it.

## Responsive behavior and accessibility

Target WCAG 2.2 AA as a product baseline. Use semantic HTML and headings, explicit form labels, accessible names, adequate contrast, keyboard operability, visible focus, logical focus order, and status semantics that do not depend on color. Dialogs manage and restore focus. Errors are associated with the relevant inputs; announce asynchronous results where useful.

Check reflow around 375, 768, 1024, 1440, and 1920 CSS pixels. No viewport should have accidental horizontal page scrolling, clipped actions, overlapping text, or controls too small for touch; target a 44px minimum height for common touch actions. Data-dense desktop views may use intentional scrolling within a labeled region or a mobile-specific list/detail composition when the tradeoff is clear. Respect user zoom and long/unbroken content.

## Verification expectations

For a meaningful UI change, exercise the changed workflow in a running application when practical. Check realistic populated and empty data, validation, loading, success/error, destructive actions, long strings, keyboard flow, responsive reflow, and browser console/network behavior. Run automated accessibility checks, then manually inspect focus, names, errors, dialogs, and task comprehension. Record exactly which roles, Industry Packs, viewports, and workflows were tested. A passing automated scan or screenshot alone is not evidence of a usable design.

During a redesign, preserve domain behavior, tenant scoping, permissions, capability enforcement, Industry Pack behavior, validation, historical information, and available actions. Extend tests when interaction behavior changed or was previously unverified.
