# ClipForge Studio — Repository Instructions for Codex

## Mission
Build and maintain **ClipForge Studio — Personal Edition**, a premium local-first professional clipping and short-form video editor. Primary workflow: user-authorized video import -> manual or eventually AI-selected highlights -> editable vertical video -> real watermark-free MP4 export. Single user and Windows-first; future SaaS-readiness without premature billing/auth/cloud dependencies.

## Read before coding
- `CODEX_MASTER_PROMPT.md` for Stage 1 and Stage 2 requirements.
- `docs/PRODUCT_REQUIREMENTS.md` for feature priorities and honesty of demo-vs-real state.
- `docs/DESIGN_SYSTEM.md` and `.agents/skills/clipforge-premium-frontend/SKILL.md` for visual standards.
- `docs/TEST_STRATEGY.md` for regression and performance gates.
- `design-references/` for approved design directions.

## ALWAYS TEST EVERY ADDITION — highest standing instruction
For EVERY meaningful code addition, design change, refactor, route, new dependency, integration, feature or fix:
1. Write/update focused test or observable acceptance criterion.
2. Implement one bounded feature.
3. Run the focused test, TypeScript/lint or Python checks on touched modules.
4. Run integration/browser flow for impacted paths; light and dark for visual changes; media validation for rendering.
5. Re-run relevant established tests, compare visual/performance baseline and investigate regressions.
6. Fix failures immediately before next feature. Do not disable tests or assert success without execution.
7. Document exact commands, observed results, unresolved defects and any skipped checks in `docs/TEST_REPORT.md`; update `docs/IMPLEMENTATION_LOG.md`.
At each milestone, run the full automated suite. A new feature is unfinished if it breaks previous working behavior. Prioritize a stable deliverable over a superficially complete but broken UI.

## Interface standards
- Apple-like restraint in light mode; Adobe Premiere-like functional density in editor dark mode; not a copy of proprietary branding.
- NO purple neon gradients, glassmorphism, gratuitous glow, emoji icons, huge cards, vanity metrics, fake testimonials, paywalls or generic AI SaaS aesthetic.
- Polished typography, 1px dividers, tight and purposeful alignment, restrained cool-blue accents, excellent blank/loading/error states and keyboard support.
- Every major route must exist and work. All visible buttons require meaningful actions or explicit disabled/planned states. Neither mock data nor demo media may masquerade as real processing.
- Support global light/dark/system; dark default in editor but override always works. Test at laptop/desktop viewports.

## Real-vs-demo truthfulness
- Stage 1: real browser interactions, local media preview, persisted UI and transparent sample data. AI results are demo-only and visibly identified.
- Stage 2: actual FastAPI media store, ffprobe metadata, FFmpeg trim/crop/subtitle/audio render, async job progress and real validated MP4s; advanced AI modules are still not implemented.
- Never show fabricated AI-generated timestamps/scores for uploaded real media. No fake MP4 links, fake network progress, fake success toasts or false test results.

## Technical guidance
- Stack: Next.js App Router, React, TypeScript, CSS variables/Tailwind, FastAPI, Python, SQLAlchemy/Alembic, FFmpeg/ffprobe, queue adapter (Redis/Celery preferred), local file storage. Local SQLite allowed as initial convenient database with PostgreSQL migration path.
- Keep source media immutable; store a versioned edit document and render from it. Save source timestamps and clip-relative captions precisely. Ensure preview/export settings stay aligned.
- Keep uploads streamed/validated and file paths safe. Never interpolate raw user strings into shell commands; use argument arrays.
- Respect source permissions and platform policies; no unrestricted YouTube downloader. Never ship third-party copyrighted clips or fonts without proper rights.
- Honor OS portability, especially Windows PowerShell paths. Provide `npm run dev`, `.env.example`, and usable setup docs.

## Execution style
Inspect before editing. Work on small milestones. Implement working code, not just plans. When dependencies are unavailable, report exact blockers and proceed with unaffected work. Create a stable checkpoint, do not silently leave processes running, and explain changes clearly. Keep continuous testing above speed. Do not delete user files or discard previous work without explicit need and safe backup.
