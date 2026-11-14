# Implementation log

## 2026-11-13 — Inspection and foundation setup
Read AGENTS.md, complete master prompt, all three original docs and the local frontend skill. Inspected all three design PNGs. Repository has no application code or git history. Node 24.13.0, npm 11.6.2, Python 3.13.11 available. FFmpeg/ffprobe/Docker absent from PATH. `rg` unavailable; using PowerShell file discovery.

Acceptance: first route and persisted theme work in a real browser; static/unit checks pass before subsequent functionality.

## Shared contract and foundation checks
Implemented theme tokens, shell, initial dashboard, typed/versioned edit document, range/timecode/geometry validation and Python schema parity. Static frontend checks and 3 unit tests passed; Python schema checks passed (3 tests). Network installation blocked; recovered dependencies from existing local files/cache. API work proceeded while frontend dependency restoration was blocked. Browser and API integration checks are in progress; not yet accepted.

## Persistent backend foundation
SQLAlchemy project/media/clip/edit revision/campaign/job/settings tables and CRUD endpoints implemented. Six direct schema/service tests pass. HTTP/browser tests are blocked by local socket behavior in the execution sandbox; exact stack and failed attempts recorded in TEST_REPORT. Continuing implementation with static/unit/direct-service verification, retaining HTTP and browser tests for local execution.

## Projects and browser persistence
Implemented IndexedDB repository, API ownership boundary, dashboard, project actions, import/settings wizard, manual clip creation and discovery. All six frontend tests/static checks pass; visual acceptance still blocked. Original sample SVG is authored locally; missing sample MP4 is explicitly identified with fixture-generation instructions. No fabricated progress or AI results are attached to real sources.

## Editor domain
Implemented independently tested undo/redo, trim and split caption re-timing, SRT import/export and fade-volume calculations. Added a regression check for edits arriving while autosave is in flight. UI integration follows these tested operations.

## Editor workspace
Connected tested edit operations to source/program monitors, safe areas, manual crop/fit, timed captions/style, timeline seeking/zoom, frame-snapped source trim, split, audio fades, keyboard help and export settings. Missing waveform/advanced effects are explicitly identified. Static checks and 12 unit tests pass. No real-media preview/export claim yet; media prerequisites remain absent.

## 2026-11-13 — Playable original sample

Retained the existing project and editor. Added the missing 12-second `public/demo.mp4` and a repeatable generator for the demo and integration fixtures. The sample uses original procedural sunset scenery and a synthesized tone. The asset is 113 KB and works in the browser-only workspace. Browser and API loopback tests now run with local networking enabled. This workspace has no Git metadata.

## Export history

Connected the Exports screen to the persisted job API. It polls active work, displays measured progress and errors, supports cancellation and retry, and exposes MP4 downloads for validated exports. The existing editor and batch actions lead to this screen.

## Verified Windows media workflow

Added an opt-in Playwright journey against a fresh SQLite/media store. It uploads original synthetic footage, creates a 30-second manual clip, saves Hindi text, reloads the edit, renders through the local worker, downloads the MP4 and checks the output with ffprobe. Verified the rendered caption in an extracted frame. The development check used workspace-local FFmpeg and ffprobe; they are not runtime npm dependencies.

Added real API regression coverage for range reads, five distinct batch renders, silent portrait output and corrupt uploads.

## Caption templates

Connected the Templates route to the editor's built-in presets and existing custom preset storage. Users can search, preview English and Hindi examples, create a custom style, and apply a preset to a chosen clip's saved edit document.

## Campaign workspace

Connected campaign list and detail routes to the existing local and server repositories. Users can set requirements, link clips, and record submission links, status, views and payout estimates. Checks use the current validated export's dimensions and duration when available, otherwise the edit document. Branding and disclaimer require manual review.

## Settings and project defaults

Added workspace preferences and media diagnostics. New imports inherit the saved language, aspect, caption style and default clip length. Newly created clips apply the project's aspect and built-in caption style. Existing edit documents retain their saved settings.

## Help and first full verification

Added searchable shortcuts shared with the editor and a workflow guide linking to service diagnostics. Added a Windows startup and verification guide in `README.md`. The full suite passed with real media tests enabled against an isolated API and the production build succeeded.

## Editor save isolation

Each editor instance now owns its history and in-flight save state. When navigation unmounts the editor during an API write, any later valid edits flush against the original clip and its updated revision. The next clip retains its own revision and content.

## Visual verification

Added responsive screenshot coverage and page-overflow assertions for the main workspace and editor in both themes at 1280×800 and 1920×1080. Retained the existing 1440×900 browser coverage.

## Remaining Stage 1 and 2 acceptance work

- Timeline waveforms, resizable editor panels, richer discovery previews and a fuller demo analysis flow remain open. The current editor supports a single source per clip.
- The API uses SQLite schema creation and a single-process local worker. Alembic migration history, Redis/Celery, processed-media cleanup, and an export folder separate from the data directory remain open.
- Expand real media tests to cover browser proxy playback and active FFmpeg cancellation and retry. Add startup, long-source scrubbing and editor memory benchmarks. Existing viewport tests capture screenshots and assert layout overflow. They do not use committed pixel baselines.

## Authorized source import

Added a public HTTPS direct-file import that streams into the existing immutable media store, a reference-only YouTube project with a click-to-load official player, and source availability metadata. Missing proxies fall back to the original when it is present. YouTube references require an authorized file before clipping or analysis.

## Local Whisper and transcript corrections

Added optional local faster-whisper analysis on the persistent worker, with CPU INT8 and source-relative word timings. Analysis accepts English, Hindi, Hinglish and automatic detection. Transcript corrections retain cue boundaries and clear word alignment for edited cues. The Analysis tab supports playback seeking, revision-checked text edits and source SRT download.

## Local scene detection

Added a persistent PySceneDetect hard-cut job over the original file. The Analysis tab displays source-timed scene spans with seek controls. Silent video can be analyzed independently of transcription.

## Handoff — interrupted during highlight integration

- **Verified:** Direct-file import with controlled API responses, source availability and missing-proxy fallback, and click-to-load YouTube reference UI in light and dark. A live Wikimedia request returned HTTP 429. Live YouTube playback was not verified.
- **Verified:** faster-whisper CPU INT8 with local multilingual small weights on real Hindi, English and mixed-language recordings. The API persists source-relative word timings, supports revision-checked transcript corrections and generates SRT. The browser flow used controlled API responses. Recognition quality varied, particularly on the second Hindi interview. See `TEST_REPORT.md` for timings, memory and source attribution.
- **Verified:** PySceneDetect analyzed both real speech videos and found the known cut in a joined excerpt within 85 ms. Scene controls passed a browser check with controlled responses.
- **In progress:** `apps/api/highlights.py`, `scripts/rank-highlights.mjs` and additions to `apps/api/analysis.py` and `apps/api/jobs.py` implement the draft ranking path. It constructs 30–50 second windows from transcript boundaries, optionally snaps to nearby scene cuts, asks a local model to rank window IDs, and converts accepted results into existing editor documents with clip-relative captions. These changes were interrupted before lint, tests or real inference. The Analysis tab has no highlight controls yet. Automatic zooms and scene-aware edit effects remain open.
- **Resume here:** Run `python -m ruff check apps/api` and focused tests for candidate bounds, model output validation, acceptance, stale transcripts and job recovery. Then run real Qwen ranking on both licensed sources, connect the Analysis UI to the existing editor, and verify captioned renders before adding zoom. Re-run the full suite after integration. The last fully green Windows build predates this AI work.
- **Local test setup:** Ignored `.tools/` contains `ai-av` and `ai-python` (use in that order on Windows `PYTHONPATH`), `whisper-small`, `speech-fixtures`, `highlight-runtime`, and `qwen-highlight/qwen2.5-1.5b-instruct-q4_k_m.gguf`. Set `CLIPFORGE_WHISPER_MODEL`, `CLIPFORGE_SPEECH_FIXTURES`, and `CLIPFORGE_HIGHLIGHT_MODEL` to the corresponding absolute paths. Use the existing `.tools/ffmpeg-npm/package/ffmpeg.exe` and `.tools/ffprobe-npm/package/ffprobe.exe` paths for media checks. Existing dev servers were observed on ports 3000 and 8000. Use isolated test data and avoid stopping the user's servers.

## 2026-11-13 — Highlight candidate validation

Added focused tests for transcript-derived candidate bounds and defensive handling of local model output. Python lint and both focused tests pass. During test authoring, corrected the test expectation to match the existing duplicate policy (>25 seconds shared); production behavior was unchanged. The Analysis screen still needs highlight controls and real local-model integration is not yet verified.

## 2026-11-13 — Local AI highlight workflow integrated

Implemented and verified the first real local highlight workflow without replacing the existing editor:

- Transcript-derived 30–50 second candidate windows are bounded to the source duration, carry actual transcript context, optionally align near scene cuts, and are limited to eight per source. Local Qwen output is constrained to supplied candidate IDs; malformed/unknown IDs and highly overlapping candidates are rejected.
- The Analysis tab now starts, polls and cancels local ranking jobs, shows source-accurate candidate timecodes and model explanations, and opens an accepted candidate in the existing editor. Accepted clips retain the source in/out range and source-derived captions.
- Candidate results are hidden after transcript revision changes. The API rejects accepting a result from a stale transcript. Capabilities report highlight ranking as available only when the local GGUF model and runtime are configured.
- README, `.env.example` and optional AI requirements now document local setup, CPU processing, source permissions and model limitations. AI weights remain user-provided and outside the application bundle.

Real local pipeline verification used authorized Commons Hindi and English source videos, multilingual faster-whisper small (CPU INT8), Qwen2.5 1.5B Instruct Q4_K_M with node-llama-cpp 3.22.3, and workspace FFmpeg/ffprobe. Each source produced three ranked candidates, saved exact 30–50 second source bounds and passed transcript-edit invalidation checks. An accepted candidate from each source rendered and downloaded as H.264 1080×1920 MP4 with AAC audio, captions, and duration within the existing renderer tolerance. Full measured details are in `TEST_REPORT.md`.

**Checkpoint status:** implementation and focused AI/Analysis visual checks passed. The milestone-wide suite exposed one unresolved browser test failure in the pre-existing YouTube-reference import flow; do not mark the project or Stage 1/2 complete until it is diagnosed and the full suite passes. Automatic zooms, automatic editing presets/effects and scene-aware edit effects are still unimplemented. Current edit documents do not claim those effects. AI transcription accuracy varies by speaker and should be reviewed; word timing is a model draft, and manual transcript corrections intentionally clear word alignment. Peak sampled process-tree RSS was about 2.18 GiB (English) and 2.21 GiB (Hindi); reserve at least that much memory for this combined CPU workflow. The same browser/API review and output render should be repeated on lower-memory hardware before broad performance claims.

## YouTube import navigation

Moved the optional player below the wizard actions. Expanding the iframe previously pushed Continue down and the recorded click left focus in the iframe. The strengthened browser test checks that the action stays in place while retaining the existing first-click and saved-project assertions. Full default verification reached and passed the production build.

## Automatic caption presets for highlights

Accepted highlights use the project's selected built-in caption style. The frontend and API read the same preset list. Missing or unknown styles keep the previous Podcast Clean settings. The Analysis tab refreshes the workspace before opening the saved clip, and the editor labels the generated text as a transcript draft.

## Clip zoom

Added a 100–150% fixed clip zoom in the Effects inspector. It uses the existing edit history and persistence. Preview and FFmpeg apply a centered zoom after framing. Captions and safe areas stay at their existing size. Older documents use 100%. The Fit renderer now calculates even dimensions directly for compatibility with the workspace FFmpeg build.

## Scene boundaries in the editor

The Edit inspector loads detected cuts for the current source. Users can preview a boundary and set either trim edge to its source timestamp. The existing edit history, caption retiming, save and render path apply. This keeps the editor's single contiguous source range.

## Editing milestone regression

The full API suite passed with local AI and media enabled. Standard verification passed through the production build. The opt-in real upload browser case requires an isolated media service and was skipped in the standard run. Real media processing and output validation ran in the API suite.

## Highlight framing presets

Ranked highlights offer Standard (100%) and Close-up (115%). The API applies the selection when creating the editor document alongside the project caption style. The existing zoom control can change it after opening. The Analysis tests isolate settings writes from the live API so they also run with an offline media service.

The final standard verification passed through production build. The opt-in browser media journey also passed separately against an isolated local API, with a real 30-second portrait MP4 and Hindi caption edits. The temporary API stopped after verification. Scene trimming is still one contiguous range, and zoom is fixed for the clip. Transcription remains an editable draft.

## Automatic reframing

The Crop inspector runs a cancellable CPU face-tracking pass over the clip range. FFmpeg decodes reduced, display-oriented frames at 5 Hz. OpenCV detects frontal faces and the crop follows a stable primary face or a group that fits. The path holds through brief occlusions and resets on detected hard cuts. Editable clip-relative keyframes flow through autosave, undo/redo, trim/split, browser preview and MP4 export. Existing edit documents default to fixed framing. Tracking is limited to 0.2–180 seconds and 96 saved keyframes. The detector covers frontal faces and does not classify non-face subjects or determine the active speaker.

## Word-aligned captions

Accepted highlights carry source-derived word timings where the complete cue has alignment. The Captions inspector can also import from a saved source transcript. Caption groups split at sentence punctuation and length limits without inventing timestamps. Editors can correct a word and its in/out points, set a highlight color, choose still/fade/pop and adjust caption shadow or short-video placement. Editing a whole sentence clears its alignment. Legacy captions and SRT retain sentence timing. ASS renders the timed emphasis and motion in the same saved document. The detector and caption effects are local.

## Multi-segment editing and quiet-gap removal

The existing edit document can store up to 32 ordered source ranges and still reads legacy single-range edits. Timeline time is the duration of the assembled ranges. Preview seeks across removed ranges and FFmpeg joins the same source segments before applying framing, captions and gain/fades. The Edit inspector supports manual source-range removal, removing kept segments and adjustable quiet-gap removal with optional transcript protection. Captions, timed words and crop keyframes rebase when ranges change. Tracking and transcript-caption import are currently applied before removing ranges. Existing source media stays immutable.

## Audio waveform and measured speech gain

The timeline draws source PCM peaks decoded locally by FFmpeg and maps them to kept ranges. The Audio inspector measures integrated loudness over the current edit and saves a gain toward −16 LUFS, capped by measured true peak and a ±24 dB range. The preview uses Web Audio for the same gain multiplier and clip-level fades. Measuring again after changing the source ranges updates the gain. Music import, ducking, crossfades and noise reduction remain open.

## Resumable source transcription

The CPU Whisper worker now accepts sources up to 90 minutes by default. Sources over five minutes are decoded to bounded overlapping audio windows and completed windows are cached by source hash, language and model. Transcript cues and words keep source-relative times. Cancellation or worker interruption can resume through the existing persisted job. The Analysis page shows reused windows. A full 30–90-minute licensed source was not available in the workspace.

## Discovery controls, transcript selection and export settings

Discovery takes a requested count, duration range, editorial emphasis, category, style and language. Candidate excerpts retain opening and closing context, favor punctuated endings and suppress strong overlaps and repeated text. Re-ranking can exclude source ranges from previously accepted highlights marked rejected, reusing the saved transcript. Transcript cues can be extended and approved as manually selected clips. The export dialog offers source average frame rate or 24/30/60 fps and three CPU encoding-quality levels.

The Templates library adds professional editing profiles and lets users save custom combinations of caption, framing, color and audio settings. Existing caption presets remain selectable. Profiles apply immediately in the editor and render from the same persisted settings. Cross-segment transitions, automatic hook editing, music mixing/ducking, noise reduction, non-face tracking, hardware export, a human-rated quality dataset and the optional Kaggle exchange are still open.

## Acceptance status

The integrated Hindi and English checks ran on 101- and 73-second licensed originals. They produced validated 42.25- and 34.41-second portrait exports with tracked crops and transcript captions. The test also found and repaired an English browser proxy duration issue. The remaining acceptance requirement is a licensed 30–90-minute source and a human-rated assessment of coherent clips, transcript accuracy, continuity and audio. The optional GPU workflow and further automatic editing features above remain unfinished.

## 2026-11-14 — Editing performance on the RTX 2050 laptop

Lite (default), Balanced and Maximum Quality request source-shaped 360p, 540p or 720p H.264 proxies with half-second keyframe intervals. Existing projects request the selected proxy when opened. Uploads queue proxy and thumbnail work. The editor switches to a completed proxy at a paused position and stops seeking the source monitor during playback. Proxies and thumbnails are reusable by source hash. Export jobs continue to read original media and respect the saved 1080×1920 export settings.

The persistent worker runs one heavy operation at a time. Profile budgets cap FFmpeg and AI threads where supported. FFmpeg and Qwen subprocesses run at below-normal priority on Windows, and Qwen cancellation releases the subprocess. Runtime diagnostics check actual NVENC, Quick Sync and AMF encodes and NVDEC decoding. A selected hardware export falls back to software after encode or validation failure. Settings exposes current RAM, NVIDIA VRAM and GPU temperature when available.

Analysis caches now cover framing, scene detection, waveform ranges and short Whisper jobs, in addition to existing long-source chunks. Cached Whisper windows avoid loading the model. CPU INT8 and the chosen model remain the default. An opt-in CUDA attempt keeps the same model and falls back to CPU if its Windows runtime is missing or inference raises a recoverable error.

Added optional per-cut dip-to-black and audio fades. Clean cuts are the default and both choices retain the assembled timeline duration. The Audio inspector can apply an 85 Hz dialogue high-pass filter through the preview graph and final render. The opening-trim action reuses measured quiet ranges and requires transcript protection. It keeps the edited source and caption timing reversible. Background music import and ducking, full-band denoising and true overlapping crossfades remain open.

The long proxy benchmark exposed a finishing stall in the older FFmpeg build. New proxy jobs use finite tail padding and a media-time watchdog releases stalled encodes. The previous preview can remain available during a profile change.
