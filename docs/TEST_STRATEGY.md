# ClipForge — Always-on test and regression protocol

This file is a persistent quality gate. Read and follow it for **every future Codex prompt**, not only Stage 1/2. The user explicitly requires testing new additions continually to ensure no existing functionality or performance regresses.

## One-change verification loop

Before changing code:
- Inspect affected file/module, behavior, tests, app routes and dependencies.
- Capture a baseline test result and basic performance/screenshot if UI or media work.
- Identify at least one acceptance assertion for the change.

After EACH meaningful change:
1. Run TypeScript typecheck + ESLint (if TS affected); or Python lint and unit checks (if backend affected).
2. Run relevant unit/component/API/FFmpeg test for feature touched.
3. Run an integration/browser smoke journey covering the changed path and one previously working critical path.
4. For UI changes, screenshot both themes on editor and dashboard where affected; inspect diff, keyboard and accessibility behavior.
5. For media changes, generate fixture, render actual MP4 and verify streams/duration/geometry with ffprobe; include broken, no-audio and Hindi cases.
6. Compare performance and resource use against recorded baseline; investigate significant regressions (>10–15% target threshold; note hardware and variance).
7. Fix all meaningful failures BEFORE adding another feature. Document exact command, outcome and supporting evidence in `docs/TEST_REPORT.md`.

## Tests by capability

### Frontend
- theme persists after refresh and route change; system/forced overrides correct
- all navigation routes reachable with empty and populated data
- create/rename/delete/duplicate/favorite/search/sort project; proper confirmation
- upload field type/size validation, drag/drop and cancellation
- object URLs revoked, missing local file message after reload
- clip start/end constraints, snapping and duration formatting
- timeline selection/trim/split, undo/redo and keyboard shortcuts
- seek transport, caption edit, styling, safe-area overlay
- rehydration/persistence of editor state
- template selection changes editor configuration
- campaign rule validation and manual submission status
- demo-mode AI data never attributed to real uploads
- no actionable click target that does nothing

### Backend
- streaming upload handles valid/invalid/corrupt/oversized inputs without RAM spike
- malicious filenames, `../` escapes and arbitrary file path read attempts rejected
- ffprobe source metadata, rotation, fps, audio detection accurate
- DB create/retrieve/edit/delete operations with transaction rollback tests
- media range requests serve correct bytes and headers
- clipped time range validation and optimistic edit revisions
- async job transitions, cancel/retry, failure logs and progress accurate
- recovery from worker crash or missing output never produces false success
- file/metadata integrity and orphan cleanup

### Render pipeline
- short landscape fixture -> 9:16 output no stretching
- portrait fixture -> portrait output no unnecessary crop
- trim start/end with off-by-one-frame tolerance benchmark
- source missing audio -> output still valid
- source with audio -> AAC present, measured duration sensible
- caption burn-in in English and Hindi is visually correct and inside safe area
- ffprobe dimensions, streams, duration, bitrate/fps expectations
- export changed crop/caption = changed output rather than stale cached file
- five-job batch output contains five distinct files with unique filenames
- canceled job cleans partial output and never appears as succeeded

## Browser automation plan
Use Playwright desktop Chromium by default, optionally Firefox WebKit for smoke. Fix viewports and data; allow fonts to load; disable transitions only for screenshot stability. Baseline screenshots for:
- light dashboard (empty and seeded)
- light project library/new project wizard
- dark clip discovery and captions editor
- dark detailed timeline/export editor
- light editor override to ensure global theme completeness

Review changed screenshots manually before updating golden images. Do not quietly bless visual regressions. Full-browser screenshot and crop tool evidence if available.

## Benchmark baselines to record
- Cold and warm frontend start and navigation timings, with browser/build environment.
- Bundle sizes for primary routes; monitor surprising growth.
- Dashboard table with 100 projects and clip gallery with 100 items (virtualization as appropriate).
- Timeline scrubbing responsiveness with 20 caption segments and several video clips.
- Browser JS heap trend across 10 repeated editor opens/close cycles (detect leaked video object URLs).
- FFmpeg render seconds-per-video-second on tiny 720p test, peak RSS (if measurable).
- Concurrent upload/render effect on responsiveness; prefer sequential CPU worker on laptops.

Do not claim any particular performance numbers without measurement. If the environment doesn't allow measurement, label performance `not measured` and keep prior baseline intact.

## Verification commands required in repo
`npm run typecheck`
`npm run lint`
`npm run test:unit`
`npm run test:e2e`
`npm run test:visual`
`npm run build`
`npm run verify:quick`
`npm run verify`
`pytest -q` in API/worker environment
`scripts/verify.ps1` for Windows
`scripts/verify.sh` for POSIX

Implementation may select npm workspace/pnpm equivalent, but scripts above must exist or be documented synonyms. Lack of Docker cannot prevent Stage 1 tests. If any test cannot run because of a missing dependency, install/repair responsibly or report exact blocker.

## Documentation format
For each change append to `docs/IMPLEMENTATION_LOG.md` and record in `docs/TEST_REPORT.md`:

```text
Change: [feature / fix]
Affected: [paths]
Tests: [exact commands]
Results: [pass N / fail N / skipped N, with errors]
Visual: [routes/theme/viewports checked]
Performance: [before -> after measurement or not measured]
Known issues: [explicit]
Next: [next bounded addition]
```

Never mark stage complete until all its explicit acceptance criteria are measured and all serious regressions fixed.
