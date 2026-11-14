# Start here — ClipForge Codex Build Kit

This kit instructs Codex to IMPLEMENT **Stage 1 + Stage 2** of ClipForge Studio, not merely generate a plan or static UI.

## What's included
- `CODEX_MASTER_PROMPT.md` — detailed, approximately 6,000-word implementation prompt covering Stage 1, Stage 2, screen map, backend, media, product rules and test protocol.
- `AGENTS.md` — persistent repository-wide rules Codex will re-read in future tasks, **including test-every-change requirements**.
- `.agents/skills/clipforge-premium-frontend/SKILL.md` — real Codex skill with YAML front matter; use for all frontend design, visual QA, timeline and theme changes.
- `docs/PRODUCT_REQUIREMENTS.md` — feature matrix and demo-versus-real distinction.
- `docs/DESIGN_SYSTEM.md` — layout/palette/typography directions for both themes.
- `docs/TEST_STRATEGY.md` — permanent testing, regression and performance procedure.
- `design-references/` — three approved frontend screenshots (light dashboard, dark caption editor, dark timeline/export editor).

## Recommended setup
1. Create or open a repository/folder for ClipForge, preferably an empty new folder if starting fresh.
2. Extract **the contents of this ZIP into the repository ROOT**. Keep `.agents/skills/...` intact; the `.agents` directory can be hidden in some file browsers.
3. Open that repository in Codex so it can see `AGENTS.md`, the skill, `docs/` and `design-references/`.
4. Paste the prompt below (or the entire `CODEX_MASTER_PROMPT.md` if Codex cannot read local files):

```
Read AGENTS.md, CODEX_MASTER_PROMPT.md, docs/PRODUCT_REQUIREMENTS.md, docs/DESIGN_SYSTEM.md, docs/TEST_STRATEGY.md, the frontend skill at .agents/skills/clipforge-premium-frontend/SKILL.md, and inspect all three design-references images. Implement ClipForge Studio Stages 1 and 2 in this repository; do not stop at planning, static mockups, or Stage 1. Follow the complete master prompt as specification. Crucially, test EVERY meaningful addition immediately; run impacted regression, browser and performance checks before moving to the next change, log exact outcomes, and fix anything that breaks existing functionality. Prioritize local Windows usage, a polished Apple-inspired light dashboard, a Premiere-inspired dark professional editor, honest demo states for later AI features, and genuine FFmpeg-driven MP4 export for Stage 2. Keep working through milestones and leave an accurately documented stable checkpoint.
```

## Reality check about scope
This is a large multi-milestone application. A single Codex run may produce partial work depending on tools/context. The prompt requires continuing through both stages within available execution, always leaving a runnable, tested checkpoint with precise remaining tasks rather than calling the entire project 'complete' prematurely.

## Rights and licenses
The three PNGs are design references, not source footage and not screen images to paste into the app UI. Use original/sample generated media for tests; do not bundle unlicensed film scenes, music or fonts. YouTube video URL extraction is not part of this build. Review FFmpeg/encoder and optional Remotion licenses before commercializing.
