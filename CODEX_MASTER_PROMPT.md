# CODEX MASTER BUILD PROMPT — CLIPFORGE STUDIO

> Paste this entire document into Codex after placing the accompanying `AGENTS.md`, `.agents/skills/clipforge-premium-frontend/SKILL.md`, `docs/*` and `design-references/*` into the repository. This is an IMPLEMENTATION request, not an architecture-only or mockup-only request.

## 0. Role, mission and non-negotiable operating instructions

You are the lead engineer, product designer, video-pipeline engineer, QA engineer and technical writer building **ClipForge Studio — Personal Edition**, an elegant local-first tool for transforming long-form videos into stunning, editable short-form content for Instagram Reels, YouTube Shorts and authorized clipping campaigns.

**EXECUTE the implementation.** Inspect the existing repository first. If empty, initialize it. If nonempty, preserve useful work and integrate with it; never overwrite user data or working code casually. Build **Stage 1 (complete, convincing, interactive frontend)** and **Stage 2 (real local media infrastructure, editing persistence, baseline video exports)** in that order, but continue through both within the task, rather than stopping after planning or producing an attractive landing page. Do not ask routine clarification questions: make sensible, documented assumptions and proceed. If an environmental restriction prevents a step, implement and test what can be done, document precisely what remains, and avoid declaring incomplete work finished. Do not stop merely because a phase is complicated.

The product is initially for **one person on Windows**, with easy `npm run dev` local startup, without sign-up, mandatory cloud services, recurring AI API costs, subscription/paywall panels or advertisements. Architecture must accommodate a future SaaS, but do not build SaaS billing/authentication now.

### Absolute priority: continuous, incremental validation

**AFTER EVERY meaningful feature, module, integration, UI route, dependency change or bug fix, test the addition and re-test affected existing functionality BEFORE moving on.** Do not defer testing until the end, do not assume a component works because it compiles, and do not claim that tests pass without running them. This requirement overrides convenience, speed, aesthetics and all other development preferences.

Use an incremental red/green/refactor loop:
1. Identify behavior and acceptance criteria for the next bounded addition.
2. Add/update focused automated tests first wherever practical, including a regression test for bugs.
3. Implement the smallest working change.
4. Run focused tests plus TypeScript/lint checks for touched modules.
5. Run relevant integration or browser E2E tests, including both themes where styling is affected.
6. Compare visual and performance characteristics with baseline; fix regressions immediately.
7. Update `docs/IMPLEMENTATION_LOG.md` and `docs/TEST_REPORT.md`: change, commands run, exact results, failures, measured perf impact, resolved defects, remaining limitation.
8. Only then proceed to the next change.

At each milestone and at the very end run **the full regression suite** across routes, navigation, uploads, editing, saving, exports, light/dark theme, and error states. Tests must include real browser interaction (Playwright), API tests, real short-media fixtures and rendered-MP4 inspection where applicable. Do NOT remove or weaken failing tests to get a green build. Do NOT silently disable a feature to pass tests. Ensure commands are easy to rerun. If testing tools are unavailable, report the exact blocker and the unverified behavior.

### Sources of truth and references

- Read `AGENTS.md`, `docs/PRODUCT_REQUIREMENTS.md`, `docs/DESIGN_SYSTEM.md`, `docs/TEST_STRATEGY.md`, and `.agents/skills/clipforge-premium-frontend/SKILL.md` before implementing.
- Treat `design-references/01-light-project-dashboard.png`, `02-dark-captions-editor.png`, `03-dark-timeline-export-editor.png` as **visual direction and panel layout references**, not pixel-exact source or assets. They are concept renders and can contain impossible or inconsistent UI elements; implement a coherent, usable system instead of copying mistakes.
- If files are missing, use the detailed specification here and create the missing docs.
- Verify commands against installed versions. Avoid undocumented APIs, fake third-party packages, and stale recipes.

## 1. The product and what must be possible

A user opens ClipForge, imports a real video, creates a project, previews the source, browses clip suggestions, opens a clip in a professional editor, adjusts start/end, framing, caption text, font/color and optionally volume, chooses an export preset, renders a **real playable MP4** at a user-selected location, and reopens the project with edits preserved. The same app also has a visually complete AI-analysis experience, template library, campaign folders and export history; advanced AI-only functions may initially use honest, clearly signposted **Demo Mode** pending Stages 3–5.

We are NOT implementing actual intelligent highlight discovery, Whisper transcription, face-tracking, emotion detection, visual scene understanding or natural-language editing in Stages 1–2. Build interfaces, typed contracts, extension points and sample flows for those; never label fabricated timestamps or fake transcripts as the result of analyzing an uploaded video. Stage 2 must actually process and export video, not merely simulate it. Do not invent AI scores as factual predictions of views or virality; use an editorial `Highlight Score` only on explicit demo records.

Create a minimal **mode discriminator** throughout the app:
- `demo`: curated synthetic/local demo footage and known sample transcripts, badged as demo; simulated analysis clearly labeled.
- `real`: actual user-uploaded source files and real media metadata, playable source, honest manual clip creation and real exports; AI features are `not_implemented` or safely disabled with an informative explanation until integrated.

A demo project must never masquerade as a real user media analysis. No dead navigation, deceptive calls to action, or blank editor.

### Target workflows

**Workflow A — Explore app without media:** Launch, use `Explore sample project`, view a realistic project dashboard, navigate analysis steps, select a demo highlight, edit its caption style and crop, return to projects, and change light/dark themes. The preview should be meaningful (use an original test video and real editor state if possible), not a static fake image pretending to be video.

**Workflow B — Real video to MP4:** Import a real MP4/MOV/MKV/WebM (subject to codecs supported by FFmpeg), see source duration/resolution/thumbnail/preview, create 30–50s manually selected segments or trim to test duration, preview in editor, set centered/left/right/manual portrait framing, add/edit caption overlay or timed subtitle entries, save, render MP4 H.264/AAC, inspect it, download locally, and reopen the project successfully.

**Workflow C — Multiple shorts:** From one source create several segments with different in/out times, edit each independently, enqueue batch exports, show honest progress, and access completed output files. In Stage 2 clips may be manually defined, not AI-discovered.

**Workflow D — Clipping campaign:** Create campaign with requirements, associate source or projects/clips, track links, filenames, statuses and manual view/earnings estimates. Validate clip length, frame dimensions and whether campaign branding is present as configured; display `not verified` for requirements that cannot be automatically checked. No posting bots.

**Workflow E — Recover reliably:** Restart app, reopen saved data, recover projects and completed exports. Canceled/failed jobs remain visible with actionable details, retry controls and no false success indications.

## 2. Visual direction: premium, serious software, not generic AI SaaS

The visual references are APPROVED. The designs should feel like a blend of **Apple's visual restraint and Adobe Premiere Pro's practical editing density**, without copying proprietary icons, trade dress, logos or copyrighted assets. No dark neon, purple gradients, glassmorphism, enormous rounded cards, plastic-looking 3D icons, purple glows, giant emojis, shouty marketing copy, fake upgrade CTAs or arbitrary 'AI-powered' badges everywhere.

### Light theme — project workspace
- Background off-white / warm gray, surface #FFFFFF, deep graphite type, muted secondary labels, hairline dividers, cool restrained blue for focus/selection. See `docs/DESIGN_SYSTEM.md` for exact tokens.
- Editorial hierarchy with compact navigation, decisive headings and quiet controls; generous whitespace where appropriate, especially on project dashboard, library and new-project wizard.
- Projects displayed in readable list/grid modes with high-quality thumbnails; status, source duration, clip count, last modified, folder and actions. Avoid fabricated vanity metrics.
- A carefully organized upload area and right utility panel; section navigation should be understandable even for someone with no video-editing experience.

### Dark theme — video production workspace
- Neutral graphite #17191D and #21242A, not pure black everywhere; 1px panel separators, small consistent toolbar heights, precise alignment, compact nested panels, blue selection emphasis, purposeful color on timeline tracks.
- Professional NLE layout: left media/project bin, center source/program monitors with portrait-safe preview, right inspector/tabs (Edit, Captions, Effects, Audio, Crop, Export), bottom timeline with ruler, waveforms, tracks, clips, playhead and zoom.
- Panels can collapse/resize where feasible; keyboard shortcuts must work when focus isn't in an input and must never hijack text editing.
- Font stack should use elegant system fonts for UI; use properly licensed Devanagari-capable fonts for Hindi captions and verify rendering visually.

### Theme behavior
Both themes are available globally and persist; default can be light for home and dark for editor, but **the user can force light or dark across all views**. Theme switch must not change editor state or lose timeline position. Test every core route in both themes and 1440x900, 1920x1080, and a narrower laptop viewport. Mobile/tablet require graceful read-only/layout adaptation; fully featured timeline is desktop-first.

### Prohibited visual shortcuts
No placeholder logos masquerading as shipped branding; use a simple original monogram/filmmark. No fake Apple or Adobe products embedded. No reliance on random internet images, broken hotlink thumbnails, unlicensed movie/TV clips, or emojis as UI icons. Use thoughtful iconography (Lucide or equivalent), consistent spacing, typography and crisp status indicators. Empty/error/loading states should be as deliberately designed as happy paths.

## 3. Complete screen and route map — build EVERY route in Stage 1

Proposed frontend URL routes; adapt naming consistently to the repo:

| Path | Purpose | Stage 1 UI behaviors | Stage 2 real hookup |
|---|---|---|---|
| `/` | Redirect/app entry | Navigate to Dashboard | readiness checks |
| `/dashboard` | Home | recent projects, drag-drop, pipeline/status, featured/last clips, quick actions | real metadata, jobs |
| `/projects` | Project library | search, sort, filters, folders, grid/list, create, duplicate, rename, archive/delete, context menu | DB-backed |
| `/projects/new` | New project | step-by-step import/settings and contextual validation | persist upload, ffprobe |
| `/projects/[id]` | Project detail | source preview, metadata, processing, transcript tab, clip candidates, activity and actions | real source/proxies, manual candidate list |
| `/projects/[id]/analyze` | Analysis | clear staged timeline (ingest, transcribe, scenes, ranking, edit) and log | real ingest steps only; AI stages explicitly demo/unavailable |
| `/projects/[id]/clips` | Discovery | preview/rank/sort/filter/bookmark/compare and create manual candidate | real manual candidates; AI candidates demo only |
| `/editor/[projectId]/[clipId]` | Professional NLE | full workspace, shortcut help, toolbars, timeline, inspector, previews and edits | real source, real trim/crop/caption basic render |
| `/templates` | Style library | curated presets, thumbnails, search, preview, save custom preset | apply supported render settings |
| `/campaigns` | Campaign dashboard | create/edit folders, requirements, linked clips, statuses | persist campaign data |
| `/campaigns/[id]` | Campaign detail | checklists, metadata, submissions, manual views/earnings | validate real export properties |
| `/exports` | Export center | queue, histories, filter, format info, errors, retry, open file/download | real FFmpeg jobs/files |
| `/settings` | Preferences | themes, language, default duration, captions, paths, processing mode, model placeholders, cache/privacy | real preferences, diagnostic tools |
| `/help` | Keyboard shortcuts/onboarding | searchable shortcuts and useful product information | actual commands only |

Navigation changes must preserve in-progress edits and not reset global state. Use meaningful breadcrumbs, back navigation, contextual menus, empty states, zero-data demo states and correct responsive scroll behavior.

### Required top-level UI components
- Main shell with sidebar/topbar, theme toggle, recent-project command palette (Ctrl+K), route-aware navigation and quick-create.
- File picker/dropzone with robust validation, progress and cancel.
- Compact processing stage/status widget, log drawer and notifications/toasts.
- Project cards and list rows with thumbnails, metadata and action menu.
- Candidate clip cards: genuine video preview when media exists, start/end, duration, description and score **for demo data only**, Edit/Save/Export/Reject.
- Source and program video monitors, transport controls, timecode, playback speed, volume, fit/zoom, platform safe zones.
- Timeline tracks, ruler/ticks, playhead, draggable trim handles, selected element state, clip boundary snapping, zoom, scrolling and basic waveforms where available.
- Inspector for transform/crop/volume/captions/effects/export.
- Reusable modals for new project, rename, delete confirmation, create clip, editing preset, export settings and source relinking.
- Search, filters, dropdowns, segmented controls, keyboard shortcuts, undo/redo, settings.
- A clearly visible but understated **Demo Mode** ribbon/badge on simulated results.

## 4. Stage 1 — fully interactive frontend FIRST

### Stage 1 goal
Ship a complete, coherent, testable front-end product that can be explored immediately. Stage 1 should **not** require Python, Docker, PostgreSQL, Redis, a GPU, account creation or external paid APIs to boot. Use persisted client-side state where appropriate, with an abstraction that Stage 2 can swap for backend persistence.

### Frontend stack
- Next.js App Router + React + strict TypeScript.
- Tailwind CSS with CSS variable design tokens for themes; Radix primitives / shadcn patterns if they improve behavior, but extensively customize styling. No default shadcn dashboard appearance.
- Zustand for editor session state; TanStack Query or thin data layer for server-backed entities; Zod for validation; React Hook Form where justified.
- IndexedDB for Stage 1 local project/sample persistence and metadata; never put raw video blobs or gigabytes of media into `localStorage`. Object URLs are ephemeral: revoke them on unload, and show a clear 'relink source' state if media is unavailable after refresh. Stage 2 should migrate metadata to backend persistence cleanly.
- HTML5 `<video>` source monitor and program preview for actual uploaded files, with viewport controls; keep preview and actual exported feature support clearly differentiated.
- Unit/integration tests: Vitest + React Testing Library; E2E/visual: Playwright. ESLint, TypeScript and Prettier.

### Stage 1 exact behaviors
1. **Onboarding/demo selection:** two buttons: `Try sample project` and `Import your video`. Real sample media must be safely generated or openly licensed with provenance documented; demo records are distinguishable from real data. No fake upload progress for local file selection.
2. **Dashboard:** show meaningful recent history, filter by status, click cards, create projects, browse templates, open editor. No fictional 'number of viral videos' or fake earnings totals presented as real.
3. **Import:** file selection by drag-drop and file-picker; validate types/sizes; show metadata available to the browser; preview with seek/play/pause; show sensible error for unsupported codecs. New project wizard stores name, category, intended duration (15–30, 30–50, 30–60, 60–90, custom), target count (3/5/8/10/15), output aspect (9:16/4:5/1:1/16:9), source language (auto/Hindi/English/Hinglish/other), highlight focus (balanced/hook/story/funny/action/informational), caption style, editing preset, local-only preference.
4. **Project management:** persistent create/rename/delete/duplicate/favorite/folder, search, sort, grid/list; create real files only in Stage 2; don't delete source original on project delete unless separately confirmed and project-owned.
5. **AI-analysis demo:** stage indicators with clearly labeled simulated data and controls. For uploaded real footage, show `AI transcript/highlight analysis not yet enabled` plus useful alternatives like `Create a clip manually`. Do not invent analysis results.
6. **Clip discovery:** demo candidates with timestamps and explanations, sorting/filtering, selection and compare; real manual clip candidate creation with in/out point controls; bookmarks and notes persisted.
7. **Editor:** create a working interactive timeline using sample or local source video; select, trim, move where supported, split a single source segment, delete, undo/redo, keyboard shortcuts, caption text+timing editing, aspect/crop settings, preset/effect toggles, volume slider, playback, safe-area overlays and export dialog. Unsupported complex effects must be shown in `planned/demo` state, never silently ignored. When changing fields, preview updates where feasible. Show edit-time warning if source blob lost after refresh.
8. **Caption interface:** list transcript/caption segments (demo content for demo project), click segment to seek, edit timings/text, add/delete segments, choose font, weight, highlight color, outline/shadow/size/position, sample Devanagari preview. Keep caption timing model normalized in seconds or integer milliseconds.
9. **Templates:** preview curated presets (Podcast Clean, Cinematic Story, Editorial Minimal, Gaming Focus, Educational), apply preset to current clip and save custom presets locally; changes update editor configuration.
10. **Campaigns:** create campaign, set allowed source/license note, duration, aspect, branding guidelines, required disclaimer, platform, due date, links, manual status and view/earnings; attach clips. Campaign compliance checker in Stage 1 validates entered metadata and labels unverifiable checks `Manual review required`.
11. **Exports:** polished export dialog, queued/history UI, file format options; Stage 1 can have simulated examples only labeled `Demo export` and MUST NOT offer a fake download; actual exports are Stage 2. Stage 1 may optionally include browser-side lightweight export only if genuinely working and verified.
12. **Settings:** appearance (system/light/dark), language, defaults, resource location placeholders, privacy, shortcut help; persist actual preferences; diagnostics distinguish installed/unknown/not connected.
13. **Accessibility:** keyboard navigation, meaningful labels, focus rings, semantic dialogs, icons with accessible titles, contrast, no motion-dependent information.
14. **First-run state:** intentionally designed blank dashboard; one-click sample demo seeding that is idempotent, non-destructive and clearly resets sample data only when confirmed.

### Stage 1 finished only when
- All routes render without 404, runtime exceptions or blank screens; navigation and core controls work.
- Both themes appear polished and consistent across routes; at least 3 desktop screenshot references in tests.
- Demo mode never claims a real uploaded file was AI analyzed.
- A user can add a project, preview a local video, define a clip, edit caption text/style, save changes, refresh and recover persisted metadata (relink source if browser cannot restore it).
- Undo/redo can be demonstrated for supported editor changes; no visible dead buttons.
- Frontend typecheck, lint, unit tests, functional E2E and production build pass.
- A human can reproduce the app with a single frontend command; README explains demo limitations.

## 5. Stage 2 — REAL media processing and baseline export

### Stage 2 goal
Stage 2 converts the frontend into an actually usable **manual short-form editor**, even before sophisticated AI. A real user video can be uploaded, stored, probed, played, trimmed, reframed, captioned, rendered, downloaded and reopened; multiple clips can be exported from one source. The output must contain true video and audio, not placeholder animations.

### Backend and persistence
- FastAPI (Python), Pydantic models, SQLAlchemy ORM, Alembic migrations.
- Default single-user local environment can use SQLite for frictionless Windows onboarding; PostgreSQL supported/configurable for future migration using the SAME data models/migrations. If choosing PostgreSQL-only, provide one-command Docker Compose and a clear Windows setup path and reason. Avoid requiring paid services.
- Job queue behind a documented adapter: use Redis + Celery for durable queue mode. Provide a **clearly named local-worker dev mode** if Redis/Docker is unavailable, with honest caveats about restart reliability; never run long transcodes synchronously in the request lifecycle.
- Local filesystem media store under configurable directory outside public Next.js assets. Persist project references and safe paths in database; never embed original media in JSON or browser localStorage. Storage abstraction interface for future S3/R2.
- API OpenAPI schema plus typed frontend API client. One source of truth; no direct frontend mutations of server entities outside API layer.
- OS-agnostic `pathlib`-based paths, robust Windows quoting, no hand-written shell command interpolation. Python `subprocess.run/Popen([...], shell=False)` for FFmpeg/ffprobe with explicit allowlist parameters.

### Suggested API contract (adapt endpoints carefully)
- `GET /api/health` with API, ffmpeg, database, worker, storage diagnostic fields.
- `POST /api/projects`, `GET /api/projects`, `GET /api/projects/{id}`, `PATCH`, `DELETE`.
- `POST /api/projects/{id}/media` streaming multipart upload, optionally chunk/resumable later; return media id/size/hash/processing job id.
- `GET /api/media/{id}` safe authenticated-in-the-future local stream with HTTP Range responses; `GET /api/media/{id}/metadata`; thumbnail/proxy endpoints.
- `POST /api/projects/{id}/clips`, `GET /api/projects/{id}/clips`, `PATCH /api/clips/{id}`, `DELETE /api/clips/{id}`.
- `GET/PUT /api/clips/{id}/edit-document` with optimistic revision/version.
- `POST /api/clips/{id}/render`, `POST /api/projects/{id}/render-batch`, `GET /api/jobs/{id}`, `POST /api/jobs/{id}/cancel`, `POST /api/jobs/{id}/retry`.
- `GET /api/exports`, `GET /api/exports/{id}`, `GET /api/exports/{id}/download` with safe filename.
- `GET/PUT /api/settings`; campaigns CRUD and relationships.
- `GET /api/capabilities` returning `available | demo | unavailable` with explanations for AI processing modules.

Use paginated endpoints where needed, consistent errors, versioning and stable ids. Streaming progress via polling initially; Server-Sent Events optional if implemented and tested. Job state machine must be explicit (`queued`, `running`, `succeeded`, `failed`, `cancelled`), include stage/progress/error and timestamps, and never mark complete before output validation.

### Media upload and ingestion — working functionality
- Accept documented container types; validate size, extension, MIME and actual ffprobe stream support. Prevent path traversal, symlink escapes, malicious filenames, overwrites and uncontrolled disk consumption.
- Stream uploads in bounded chunks to temporary file then atomically move into per-project media directory after validation; use content hashes and unique ids. On rejection or cancellation, remove orphan temp files. Enforce configurable size and duration limits with explicit errors.
- ffprobe the uploaded source to obtain duration, width/height, display rotation, SAR/DAR, real timebase/FPS, audio codec, sample rate, audio-present flag, video codec, bitrate, source metadata, optional language tracks. Handle streams with missing audio, odd rotation, unusual aspect ratios and Unicode filenames.
- Generate a short playable proxy or browser-compatible preview when raw codecs are not browser supported; provide progress and fallback errors. Generate thumbnails at representative positions and seekable preview. Avoid decoding full source into RAM.
- Serve preview via Range requests and proper content types, not huge base64 blobs or raw video files in HTML. Do not expose arbitrary local file paths through API.

### Manual clip selection and editing — working functionality
- Define multiple clips from same source with deterministic in/out time semantics; clamp to duration; reject zero/negative length and out-of-range timestamps; preserve precise timestamps. Offer input timecode and graphical handles with frame/second snapping.
- At least one video track; support split, trim, select, delete, set title/notes, reorder clips within simple sequence when supported. Do not claim full multitrack NLE if not implemented. UI can show future tracks with clear disabled states.
- Non-destructive project JSON schema with `schemaVersion`, original source id, source in/out, output settings, ratio, crop mode, manual crop focal point, scale/position, caption segments, text style, overlay list (if supported), audio configuration, render target, revision. Use zod or JSON schema versioning and backend validation; include schema migrations.
- Source monitors and program monitor seek to equivalent timeline positions; avoid reloading full original file on every keypress.
- Basic clip preview must correspond closely to eventual export: if an effect cannot be previewed, explain explicitly and show `render preview` action.

### Real basic render pipeline — absolutely required
- Use installed FFmpeg/ffprobe binaries through safe subprocess calls. No fictional exports, empty MP4s or silent fallback to demo footage.
- Deterministically cut input at requested timestamps with accurate (re-encoded when needed) video/audio; avoid stream-copy keyframe imprecision if user expects exact boundaries.
- Produce MP4 using H.264 video (`yuv420p` for compatibility) and AAC audio when source has audio. Handle source without audio without crash. Ensure final durations within an expected tolerance (e.g., max 0.25 sec for normal fixtures or one frame when feasible).
- Output format presets: 9:16 (1080x1920), 4:5, 1:1, 16:9; include user-selectable export size/profile and 24/30/60 fps when possible. For performance, use 540x960 or 720x1280 quick previews and 1080x1920 standard export.
- Crop modes: center/left/right, manually positioned focal point, fill, fit/letterbox; optional blurred background using FFmpeg filters. Respect source display rotation, no squashed people. Test wide landscape source to vertical output, portrait source to vertical output, no-audio source.
- Apply at least working audio gain and fade in/out; optional background music file and ducking can be deferred only if explicitly marked. Normalize to avoid clipping when adding music. Track whether external audio asset is licensed.
- Real overlay or subtitle burn-in using user-authored timed captions: correct Hindi/Devanagari shaping, font fallback, line wrapping, background/outline, positioning and 9:16 safe area; test a Hindi fixture visually. Implement SRT export and useful SRT import; word-level animation is NOT required yet. Check FFmpeg libass/shaping capabilities, use ASS or a reliable typography renderer; do not handwave Unicode text.
- Export to configurable local directory with safe deterministic filenames including project/clip, use temporary output + atomic finalization and avoid overwriting unrelated files. Provide download/open file path actions that work on Windows where possible.
- Report real FFmpeg progress based on actual stderr/stdout progress/time, propagate errors, allow cancellation by terminating child process and cleaning temp files, allow retry, update persistent DB. Don't fabricate estimated completion times.
- After FFmpeg returns success, **run ffprobe against output** and validate it has a video stream, correct portrait dimensions, playable audio when required, nonzero file length, and approximately expected duration; only then set job `succeeded`.
- Batch export clips from one project with a true queue, optionally sequential on CPU; avoid resource exhaustion. Rendering must not block the UI. Re-render with changed caption/crop should not repeat upload/probe.
- Cache processed media/thumbnail and detect stale files; maintain disk cleanup policies and file ownership.

### Stage 2 UI integration
- Replace demo project metadata with real backend records for actual projects while preserving the ability to browse demo examples.
- Display source metadata and thumbnails from real media; working video playback and scrubbing.
- Project CRUD, campaign management, edit docs and export history survive refresh/server restart.
- Export dialog shows exact supported settings, renders real output and handles failures/retries.
- `AI analysis`, `automatic clip discovery`, `face tracking`, `automatic word-aligned captions`, `advanced natural-language editing`, `AI B-roll` remain **clearly labeled upcoming features** on REAL user projects. Manual equivalent actions must work.
- Never call a manually selected clip "AI-generated". Never show invented scores on real clips.

### Stage 2 finished only when
- One 16:9 source imported on Windows is trimmed to a real 30–50 second portrait clip, captioned in Hindi and exported as validated 1080x1920 H.264 MP4 with audio.
- Five clips from same source can have distinct boundaries/captions/presets and can be batch-exported with correct names and distinct outputs.
- After reloading app, settings, clips, captions, campaign links and export history remain consistent.
- Failed source/FFmpeg process triggers a meaningful error and recovery path; cancellation works; no orphan output marked as success.
- API unit/integration tests, FFmpeg media tests, frontend and E2E smoke/regression pass; output files verified with ffprobe and sample playback where available.
- Clear Windows-centric setup docs and one-command frontend start exist, with backend and worker boot steps documented and automation scripts provided.

## 6. Out-of-scope, but preserve future integration points

Do **NOT** spend Stage 1–2 time implementing a polished subscription landing page, paywalls, analytics vanity metrics, automatic social posting, mass scraping/download of arbitrary YouTube media, copyright circumvention, account registration, paid API dependencies, GPU-only inference, model fine-tuning, voice cloning, deepface, generative B-roll or complete advanced Premiere features. Future modules should have interfaces:
- `TranscriptionProvider` (local Whisper; language/word-alignment eventual output).
- `SceneAnalysisProvider` (scene cuts, faces, visual context).
- `HighlightRankingProvider` (candidate spans, scores and explanations).
- `AutoEditPlanner` (suggested non-destructive edit operations).
- `Renderer` (FFmpeg initially; alternate Remotion maybe after licensing review).

YouTube links can be used as user-supplied REFERENCES or metadata only where allowed; do not implement unrestricted media extraction from YouTube. Prioritize uploaded or explicitly authorized source files. Do not ship unlicensed assets or background music. Respect original creator/campaign permissions.

## 7. Architecture and folders

Use a straightforward monorepo, avoiding premature microservices:

```text
clipforge/
  AGENTS.md
  package.json                       # root Windows-friendly scripts
  apps/
    web/                             # Next.js App Router
      app/(studio)/dashboard/
      app/(studio)/projects/
      app/(studio)/editor/
      app/(studio)/templates/
      app/(studio)/campaigns/
      app/(studio)/exports/
      app/(studio)/settings/
      components/{shell,projects,clips,editor,timeline,inspector,...}/
      lib/{api,schemas,stores,media,utils}/
      tests/{unit,e2e,visual}/
    api/                             # FastAPI, SQLAlchemy, Alembic
      app/{routes,models,schemas,services,settings,storage}/
      tests/
  workers/
    media/{ingest,probe,proxy,thumbnails,render,subtitles}/
    jobs/
    tests/
  packages/
    editing-schema/                  # versioned JSON/TS and Python model agreement
    design-tokens/
  scripts/
    generate_test_media.py
    dev.ps1
    verify.ps1
    verify.sh
  tests/
    fixtures/                        # tiny legally safe generated samples, no big binaries
    integration/
  docs/
    PRODUCT_REQUIREMENTS.md
    DESIGN_SYSTEM.md
    TEST_STRATEGY.md
    IMPLEMENTATION_LOG.md
    TEST_REPORT.md
    DECISIONS.md
    DEMO_VS_REAL.md
    WINDOWS_SETUP.md
  .agents/skills/clipforge-premium-frontend/SKILL.md
  design-references/
  .env.example
  docker-compose.yml                 # optional Postgres/Redis services
  README.md
```

Adapt for chosen framework idioms; favor clear boundaries and runnable scripts over exact folder names. Keep AI feature contracts and the edit schema separate from route components.

## 8. Data model and editing schema

At least entities:
- `Project`: id, title, category, createdAt, updatedAt, status, folderId, mode, preferences, permissionNotes.
- `MediaAsset`: id, projectId, originalName, storedPath, mime, hash, byteSize, durationMs, width, height, fpsNum/fpsDen, rotation, audioStreams, proxyId, thumbnails, status.
- `Clip`: id, projectId, mediaId, title, sourceInMs, sourceOutMs, sourceKind (`manual`/`demo_ai`/later `ai`), notes, favorite, editingDocumentId, status.
- `CaptionSegment`: id, clip-relative startMs/endMs, text, speakerId optional, style overrides; avoid off-by-source-time errors.
- `EditDocument`: schemaVersion, clipId, revision, video tracks, captions, crop, audio, overlays, effects, output preset, history snapshot.
- `ProcessingJob`: id, type, stage, progressPercent optional, lifecycle, logs, worker, timestamps, cancellation flag, error.
- `Export`: id, projectId, clipId, editRevision, settings, jobId, filePath, bytes, durationMs, checksum, status.
- `Campaign`: id, title, requirements, sourcePermission, dueAt, platform, payoutRule, expectedBranding.
- `Submission`: campaignId, clipId, platformUrl, submittedAt, status, manuallyEnteredViews, estimatedPayout, note.
- `UserSettings`: single-user preferences and paths; future namespace/owner support but no mandatory auth.

Use UTC ISO timestamps for DB records, user local time formatting in UI, idempotent rendering/job enqueue when possible, and stable UUID ids. Define explicit target-resolution behavior and time semantics in docs.

## 9. Testing, quality gates and performance — PERMANENT RULE, NO EXCEPTIONS

Do not implement a whole area and test later. **The test loop runs after EACH meaningful addition.** Keep tests small, deterministic, fast and independent; expand regression coverage as capabilities grow.

### Mandatory test layers
- **Static:** TypeScript strict check, ESLint, formatting, Python lint/type checks when configured, dependency and license review.
- **Frontend unit:** state operations, timeline time math, caption timecode, theme persistence, filters, validation, data mapping, undo/redo history.
- **Component integration:** forms, interactive dropdowns, media player controls, dialogs, keyboard shortcuts, autosave, candidate preview, disabled AI states.
- **Backend:** validation, upload size/type/security, DB transactions, file path normalization, job transitions, range streaming, API errors, campaign CRUD, export permissions.
- **FFmpeg media:** generated source fixtures, precise trim, no-audio handling, Unicode filename, portrait crop, 16:9->9:16, caption burn-in, audio loudness, cancellation and corrupt input; assert with ffprobe and optionally pixel/frame checks.
- **Playwright E2E:** launch, browse dashboard, open sample, create project, upload small file, make clip, edit captions, save, theme switch, export, download/check output, failure/retry. No need for large real-media files in CI.
- **Visual regression:** screenshots for dashboard, project detail, discovery and editor in light/dark and fixed viewports. Avoid pixel-diff instability: freeze time, stable seeded data, fonts loaded, animations disabled in screenshot mode.
- **Performance regression:** measure startup/build size, route interaction, editor playback and scrubbing responsiveness, timeline list performance and memory growth; compare previous baseline and note >10–15% regressions before accepting them. Use realistic laptop constraints; no fabricated benchmarks.

### Tooling and scripts to create
- `npm run dev` — startup for Windows-friendly local frontend, with clear warning if API unavailable; document how to run full stack.
- `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`, `npm run test:visual`, `npm run build`.
- Root `npm run verify:quick` = changed-module unit + type/lint + smoke; `npm run verify` = full unit/integration/E2E/build where services are available.
- Backend `pytest -q` plus tagged integration/media tests; `scripts/verify.ps1` and `.sh` should run or report missing prerequisites distinctly.
- `scripts/generate_test_media.py` or shell script using FFmpeg's `testsrc2`/sine source to make tiny 12s and 20s landscape/portrait/audio/no-audio and Hindi overlay samples; avoid storing giant fixture videos.
- A checked-in `docs/TEST_REPORT.md` showing exact commands, pass/fail, date/commit and limitations; use logs/screenshots as artifacts if your environment supports them.

### Stop-and-fix rule
When a test fails, do not continue adding features. Reproduce, fix root cause, rerun focused+regression tests, log fix. When a feature introduces a measurable usability/performance regression, revert or optimize before accepting. If previous functional features break, **the new feature is not complete**.

### Concrete E2E journey requirements
1. New install → Dashboard + sample project works (both themes).
2. Project creation wizard validates errors and persists settings.
3. Source upload → actual metadata and video player (Stage 2).
4. Manual clip 00:02–00:08 → program monitor corresponds to cut and timeline.
5. Caption in English and Hindi → display correctly, stays on timeline and matches exported burn-in.
6. Change from 16:9 to 9:16 → crop and output match selected setting.
7. Save → refresh → reopen restores edited state.
8. Export H.264 → genuine MP4 present and ffprobe has expected streams/resolution/duration.
9. Five clips → five separate validated outputs and recorded export history.
10. Invalid file/cancel job/offline worker → correct error states, no false success.
11. Theme switch and navigating between pages do not change clip edit state.
12. Campaign association and checks match real export metadata, not guessed info.

### Performance expectations
- Target visually stable and responsive UI on a normal modern laptop; no major layout shifts or flash of incorrect theme.
- Don't decode full hour-long videos in the browser. Use source/video element and proxy, virtualize heavy lists, memoize timeline components, debounce autosave, cancel stale requests, clean up object URLs, avoid rerendering whole timeline every playback frame.
- Measure interaction durations and memory; prefer comparison against recorded baselines rather than claiming universal numbers. For local 60-fps timeline UX, strive for smooth frame pacing with efficient rendering, but report measured reality. Use short fixture benchmarks for CI.
- Do not launch parallel heavy transcodes by default on a normal laptop; queue sequentially or expose concurrency setting.

## 10. Licensing, privacy and deployment readiness

- Local-first private media; do not upload source to external AI or analytics without explicit opt-in.
- No unlicensed stock assets, copyrighted movie scenes, commercial music or brand logos bundled as sample media. References are layout guidance only.
- Do not rely on unrestricted YouTube video download: YouTube policies prohibit unauthorized download/store of audiovisual content through API Services. Implement user uploads and permitted direct-media sources.
- Licensing of Remotion must be reviewed before building a paid automated SaaS. FFmpeg and encoding library licenses must also be reviewed for distribution/hosting and chosen build configuration.
- No payment, user accounts, marketing funnel or 'Upgrade Pro' at this stage.
- Prepare a `.env.example` with no secrets, host binding localhost by default, strict CORS for local dev, no public API exposed accidentally, no arbitrary filesystem access.

## 11. Delivery plan and checkpoints

Create `docs/IMPLEMENTATION_PLAN.md` with small tasks and validation commands. Build in this order, closing each task only with evidence:

**Milestone A — repository foundation**
Create monorepo, scripts, linters, test runners, design tokens, theme switching, root layouts, CI-ready test setup. Verify typecheck, lint, first route, both themes and basic screenshot.

**Milestone B — full navigation and project experience**
Implement dashboard, project library, wizard, local metadata persistence, empty/loading/error/demo states, templates, campaigns, settings, exports and help. Test each route immediately, E2E flows for CRUD and persistence.

**Milestone C — frontend editor**
Implement source/program monitors, short-form timeline, trim/split, clip operations, caption editor, crop settings, audio controls, preset application, keyboard shortcuts, undo/redo, autosave and demo content. Confirm UI responsive and state maintained across navigation. Screenshot test both themes.

**Milestone D — backend data/services**
FastAPI + persistence, migrations, project/media/clip/campaign/export entities, settings, safe upload and stream, ffprobe, metadata and thumbnails. Unit/API tests after each endpoint; integration tests from Next.js.

**Milestone E — render worker**
FFmpeg trim/re-encode, aspect presets, crop/manual focal position, audio, timed caption burn-in, SRT, export job state/progress/cancel/retry, file validation. End-to-end tests with real small files. Confirm Windows compatibility.

**Milestone F — integrate & harden**
Make real project mode use the backend. Batch render, API capability state, cache, recovery, invalid media cases, missing FFmpeg diagnostics, source relink, final polish; full regression and performance comparison.

At completion, create a concise technical summary with:
1. What was implemented and what remains demo-only.
2. Exact commands to run on Windows/PowerShell.
3. Which automated tests ran, exact results, and any tests skipped (with reasons).
4. Screenshots or browser evidence of dashboard/light and editor/dark.
5. One validated local MP4 sample render and ffprobe output from synthetic media, or clear statement if environment prevented this.
6. Known limitations and recommended Stage 3 work.
7. Changed files, risks and key technical decisions.

**Do not stop at a plan, at static mockups, or after Stage 1. Make best-effort progress on BOTH stages within available execution, prioritizing a working vertical slice and rigorous testing over superficial feature count. If all requirements cannot be completed in one execution, leave a stable, runnable checkpoint with a clear next-task list.**

## 12. First actions to take immediately

1. Inspect repository and available Node/Python/FFmpeg/Docker environment; note Windows implications.
2. Read included reference images and design skill; create decision log, stage plan and initial tests.
3. Implement the polished app shell and theme system; run tests and screenshot.
4. Proceed feature by feature as specified, always testing additions and their effects on existing behavior.
5. Continue into real media processing and exports; only claim a stage complete after meeting its acceptance tests.

Remember: **FUNCTIONAL PRODUCT, PREMIUM DESIGN, REAL VIDEO EXPORTS, HONEST DEMO BOUNDARIES, AND CONTINUOUS REGRESSION TESTING.**
