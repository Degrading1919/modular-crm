# Product-design source review

Reviewed on 2026-09-25. These exact source revisions were inspected. They are references for the Modular CRM-specific guidance in `SKILL.md`; no external source text or code was substantially copied into this repository.

| Source | Repository and reviewed revision | Material reviewed | License / attribution |
| --- | --- | --- | --- |
| Humanizer | [blader/humanizer](https://github.com/blader/humanizer/tree/9862685f575c65a8247f90369951df1b3416e3d6), `9862685f575c65a8247f90369951df1b3416e3d6` | `SKILL.md` and directly relevant supporting guidance | MIT. Copyright Siqi Chen. No source text vendored. |
| Vercel Web Design Guidelines skill | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278), `063bee94c3f4df8453406c830b0a7df0f2860278` | `skills/web-design-guidelines/SKILL.md` | No repository-level license file was present at the reviewed revision. Referenced, not copied. |
| Underlying Web Interface Guidelines | [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines/tree/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1), `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1` | Current guideline source in full | MIT, Vercel Labs. No source text vendored. |
| UI/UX Pro Max | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/dcc40ff5133ef78276117db0cc34e7b83cc8aeba), `dcc40ff5133ef78276117db0cc34e7b83cc8aeba` | Skill content, quick reference, design-system, tokens, component, state, UI styling, relevant UX/React/Next material, and browser-audit workflow/examples | MIT, Next Level Builder. No code, datasets, or skill text vendored. |
| Anthropic Frontend Design | [anthropics/skills](https://github.com/anthropics/skills/tree/33375500bcea98d610eb30ce10ac4e59b89c390d), `33375500bcea98d610eb30ce10ac4e59b89c390d` | `skills/frontend-design/SKILL.md` and directly relevant supporting material | Apache License 2.0; `skills/frontend-design/LICENSE.txt`. No source text vendored. |

The application also uses the installed Next.js 16.3.6 documentation bundled with `apps/web/node_modules/next/dist/docs/` for global CSS, fonts, forms, and accessibility behavior. That versioned framework guidance informed implementation choices; it is not an external design authority.

Where source guidance differs, Modular CRM uses its own operational-product and accessibility requirements. For example, an external recommendation for title case does not override the product's sentence-case voice.
