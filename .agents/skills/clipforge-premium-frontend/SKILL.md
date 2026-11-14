---
name: clipforge-premium-frontend
description: Build, review, refine and visually test ClipForge Studio's premium Apple-inspired light workspace and Premiere-inspired dark video editor; use for any frontend, layout, theme, dashboard, clip gallery, timeline, caption inspector or visual regression work in ClipForge.
---

# ClipForge Premium Frontend Design Skill

Use this skill whenever implementing or modifying a UI screen, design-system component, editor panel, project view, modal, theme, animation or interaction. This is a professional creative workstation, not a marketing dashboard.

## 1. Inspect references and existing app

Before editing, examine `design-references/01-light-project-dashboard.png`, `02-dark-captions-editor.png` and `03-dark-timeline-export-editor.png` (if present). Read `docs/DESIGN_SYSTEM.md`. Inspect current routes/components and take baseline screenshots. Understand what the change might affect. Use the references as **direction, not pixel-copy requirements**; avoid their fictional status text, fake progress, inaccurate timelines and distorted placeholder media.

## 2. Visual character

- Light: editorial, understated, off-white, crisp lines, purposeful white space, subtle blue selection, high-quality typography and calm hierarchy.
- Dark: neutral graphite, compact precision, restrained blue focus state, low-chroma panels, minimal seams, purposeful colored video/audio/caption tracks.
- Source media is the hero. UI surfaces support editing, they do not compete with content.
- Make every spacing and type decision intentional. Prefer flat surfaces and dividers over cards nested in cards. Avoid excessive corner radius (generally 6–10 px controls; 10–12 px larger media surfaces), big shadows and decorative gradients.
- No "AI slop": no neon glow, purple/magenta/coral gradient, glass panels, toy 3D iconography, gigantic emoji, floating dashboards, fake viral metrics, meaningless trophies or Pro upsells.

## 3. Design tokens and components

Use CSS custom properties for background, surface-1, surface-2, surface-raised, border, text-primary, text-secondary, accent, danger, success, focus, timeline-video, timeline-caption, timeline-audio. Support `.light`, `.dark` or `data-theme` consistently with system theme. Read the exact suggested palette in `docs/DESIGN_SYSTEM.md`.

System fonts: `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Arial, sans-serif` for interface; use locally/system-installed or explicitly licensed web Devanagari fonts such as Noto Sans Devanagari for Hindi subtitles; test glyph shaping instead of assuming Latin fonts cover Hindi.

Use a deliberate scale: 12, 13, 14 px controls/metadata; 16 px section titles; 22–32 px page titles according to density. Clear semibold weights, consistent label spacing. One restrained accent (blue), not a rainbow of call-to-actions. Icons should be outline 16–20px with consistent stroke weight.

Build reusable components: `AppShell`, `Sidebar`, `Topbar`, `PageHeader`, `Breadcrumbs`, `ProjectRow`, `ProjectCard`, `MediaThumbnail`, `StatusText`, `EmptyState`, `InlineAlert`, `InspectorSection`, `TimelineTrack`, `TimecodeInput`, `TransportControls`, `UploadDropzone`, `ConfirmDialog`, `Toast`, `ExportDialog`, `ClipCard`, `FilterBar`, `ShortcutHelp`.

## 4. Layout guidelines

### Project dashboard
- Slim left navigation (~212–236px), restrained utility topbar (~52–60px).
- Content grid built around one primary column and optional right sidebar, not disconnected cards.
- Large but restrained page title; upload affordance integrated into workflow; recent projects table/list first, clips below.
- Empty state and first run show a real next action; progressive disclosure prevents clutter.
- Avoid fake statistics. Source duration, active exports and number of clips are allowed only from stored project data or visibly marked sample.

### Editor
- Screen-height application shell with top utility bar (~48–56px), work area, bottom persistent timeline.
- Left: media/project bin; center: source/program preview; right: selected inspector; bottom: timeline (approximately 32–40% screen height, adjustable).
- Maintain video aspect ratio; 9:16 preview centered with safe-area overlays, correctly measured timecode, visible playback controls. Do not stretch source frames.
- Timeline must feel precise: rulers, ticks, selected clip outline, snapping, track mute/visibility, manageable playhead, horizontal scroll, zoom. Clear track colors, not decoration.
- Right inspector selects Edit, Captions, Crop, Audio, Effects, Export. Clearly distinguish unsupported/future controls.
- Compact panels but tappable controls. No horizontal overflow in ordinary 1440px desktop state.

## 5. Interaction standards

Every visible click target is meaningful. Use keyboard shortcuts only when focus isn't in input/textarea; Space for play/pause, Ctrl/Cmd+Z for undo, Ctrl/Cmd+Shift+Z for redo, Delete for selected elements, arrows for seek, S for split when supported. Confirm destructive actions. Preserve editor selection and project state on navigation. Make focus states and screen-reader labels clear.

Ensure theme persists without hydration flash or lost editor state. Support reduced motion. Animations should communicate state (150–220ms subtle transitions), not entertain. Hover should not be the sole mechanism for discovery.

## 6. Real/demo integrity

Do not render demo scores or generated captions as if they came from analyzing real user uploads. Use `Demo project` in sample content and `Coming in AI phase` on real projects when appropriate. If export is unavailable, show a clear disabled reason rather than a fake success toast. Screens should be useful even in empty states.

## 7. Testing workflow for EVERY UI change

1. Before: capture existing route screenshot and ensure tests pass.
2. Implement one bounded change.
3. Run relevant unit/component tests and TypeScript/lint.
4. Manually inspect or run Playwright for the changed flow.
5. Capture light/dark screenshots at 1440x900 and 1920x1080, plus narrower 1280x800 where layout changed. Use stable fixtures and wait for fonts.
6. Check navigation, focus, keyboard, responsiveness, empty/loading/error states.
7. Compare against previous screenshots; only update baselines after visually reviewing intended differences.
8. If interaction latency, memory usage, route performance or video playback regresses, repair before moving on.
9. Record command results and evidence in `docs/TEST_REPORT.md`; never say "tested" without running checks.

**Definition of done:** visually coherent in both themes, functional interaction, no accessibility or layout regression, and relevant automated checks green. Read AGENTS.md: this applies to every new feature, not just design work.
