# ClipForge — Premium Design System

## Visual anchors
- `../design-references/01-light-project-dashboard.png`: Apple-inspired light project/library/dashboard environment. Keep its editorial clarity, not its fake statistics, personal profile name or sample thumbnails.
- `../design-references/02-dark-captions-editor.png`: professional, highly legible dense caption/editing workspace with 9:16 monitor and multitrack timeline.
- `../design-references/03-dark-timeline-export-editor.png`: source+program preview, media bin, inspector, timeline, output settings.

Create one coherent design system. Do not glue three screenshots into inconsistent pages. No pixel-exact copying or use of actual Apple/Adobe trade dress.

## Design tokens — suggested initial values (fine-tune after testing screenshots)

| Token | Light | Dark |
|---|---|---|
| `--app-bg` | `#F7F7F6` | `#14161A` |
| `--surface-1` | `#FFFFFF` | `#1C1F24` |
| `--surface-2` | `#F1F2F3` | `#242830` |
| `--surface-raised` | `#FFFFFF` | `#2C3038` |
| `--text-primary` | `#181B20` | `#F0F2F5` |
| `--text-secondary` | `#666D77` | `#A9B1BC` |
| `--text-tertiary` | `#90969D` | `#77808C` |
| `--border` | `#E3E6E9` | `#353A43` |
| `--accent` | `#2463D7` | `#5A91EB` |
| `--accent-surface` | `#E9F0FF` | `#253851` |
| `--focus` | `#2864D8` | `#77A8FF` |
| `--danger` | `#BD3D3D` | `#EF7070` |
| `--success` | `#278260` | `#4DBE8D` |
| `--timeline-video` | `#526A8E` | `#526A8E` |
| `--timeline-caption` | `#86619D` | `#86619D` |
| `--timeline-audio` | `#397B70` | `#397B70` |
| `--timeline-effect` | `#95814C` | `#95814C` |

Color is functional: one interactive accent, status semantic colors, timeline track categories. Do not use 5 unrelated accent colors in the app shell. Keep dark neutral, not blue-purple neon.

## Typography
- UI: system sans stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Inter`, `Arial`, `sans-serif`). Use weight 400 for body, 500 controls, 600 headings. Avoid giant titles outside marketing surfaces.
- Interface sizes: auxiliary 11–12px; dense metadata 12–13px; controls 13–14px; body 14–15px; section 17–20px; dashboard title 26–32px; editor panel label 12–13px uppercase/letter-spaced sparingly.
- Caption typography is separate from UI typography, supports licensed Hindi Devanagari shaping and Latin text, typically large white text with restrained black outline/shadow. Never rely on Latin-only font or artificial stroke that distorts Hindi glyphs.
- Line height: normal UI ~1.4–1.5; dense editor labels ~1.25–1.35. Clip titles max 2 lines; tooltips precise.

## Grid and spacing
- Use 4px spacing unit, common gaps 8/12/16/24/32.
- Sidebar 224px default; compact mode optional.
- Topbar ~56px.
- Page horizontal padding 28–36px on desktop; reduce as viewport narrows.
- Editor uses resizable panels, typical project/media bin 240–320px, inspector 300–380px, central monitor flexible, bottom timeline 32–40% of viewport height.
- Main control radius 6–8px; modals/media panels 10–12px max. Thin borders over heavy shadows.
- Avoid arbitrary empty space in editor; leave room for media preview and timeline.

## Dashboard
Minimal, calm header with `Projects` context, searchable recents, discreet upload call-to-action, project status, compact clips, useful pipeline progress only when real. Side utility panel can show working operations and actual system health; don't build fictional usage/revenue counters. Prefer high-quality project table and selected cards over giant metric boxes.

## Dark editor
- Left vertical tool rail when useful, media bin, source monitor, program monitor, inspector on right, track timeline at bottom.
- Previews must preserve aspect ratio; platform safe areas selectable.
- Workflow command bar: `New clip`, `Trim`, `Captions`, `Crop`, `Export` etc with shortcut hints.
- Playhead and selection always have sufficient contrast; horizontal zoom/scroll predictable.
- Inspector shows only relevant controls with progressive disclosure; controls are small but accessible.
- Status bar shows actual save state, processing state and capabilities.

## Motion and interaction
- Use subtle 150–220ms animations for panel opening/hovers; no perpetual gradients or pulse animations.
- All dropdowns are keyboard-navigable, dialogs trap focus, destructive actions confirmed. Reduce motion preference honored.
- Clickable areas min ~32px on desktop where possible; focus ring always visible.
- Explicit loading, error and empty states designed with same quality as finished views.
- Responsive target: optimal 1440x900+, functional 1280x800, no critical overflow in narrower tablet; full timeline desktop-first.

## Quality audit checklist before accepting a screen
1. Does it look like professional editing software rather than a startup marketing screenshot?
2. Is typography consistent, and is the most important operation obvious?
3. Does everything in view have an action or clear read-only state?
4. Does it work in both themes without lost contrast?
5. Are there any fake metrics, fake exports, or misleading `AI complete` indicators?
6. Is source video correctly letterboxed/cropped without stretching?
7. Are spacing, panel edges and labels aligned?
8. Does a narrow viewport maintain utility or an explicit desktop guidance state?
9. Are Hindi characters shaped and line-broken correctly?
10. Did automated visual and functional regression checks pass after this addition?
