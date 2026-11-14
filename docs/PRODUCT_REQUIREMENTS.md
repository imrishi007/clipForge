# ClipForge Personal Edition — Product requirements and feature matrix

## Product definition
Single-user, Windows-first, local-first workspace for creating short-form clips from user-owned or authorized footage. Primary user is generating attractive Instagram Reels, YouTube Shorts and deliverables for clipping campaigns. Prioritize usability, reliable exports and actual editing control over SaaS monetization.

**Stage 1:** all intended screens and interactions, local demo projects, actual local-file preview and editing state, but advanced AI results honestly demo-only.

**Stage 2:** real FastAPI/database/media store + FFmpeg media pipeline. User can manually select clips, crop, caption and render a genuine H.264 MP4. No automatic highlight selection or speech transcription yet.

## Features and priority
Legend: `S1` working frontend or honest demo UI; `S2` working backend integration; `FUTURE` architecture/presentation only until later phases.

| Area | Feature | S1 | S2 | Future |
|---|---|---|---|---|
| Theming | Global light/dark/system, persists | Working | Working | — |
| Project | New project wizard & validation | Working | Backend-persisted | — |
| Project | Search, sort, favorite, folders, duplicate, delete | Working | Backend-persisted | — |
| Media | Drag-drop file import | Local preview | Streamed upload, probe, safe storage | — |
| Media | Video preview, seek, timecodes | Browser `<video>` | Range stream/proxy | — |
| Media | YouTube URL field | Reference-only, policy notice | Reference-only | authorized providers |
| Media | Multiple sources | UI | optional limited | multitrack composition |
| Intelligence | Transcript workspace | Demo data only | demo data only | Whisper transcription |
| Intelligence | Hindi/Hinglish/English language preferences | Working | persisted | actual ASR |
| Intelligence | Scene detection timeline | Demo data only | demo data only | vision pipeline |
| Intelligence | Highlight suggestions, ranking, explanations | Demo only | demo only | actual AI ranking |
| Intelligence | Custom natural language clip search | Demo/disclosed | Demo/disclosed | prompt-to-analysis |
| Clips | Manually choose in/out | Working | Backend-persisted | — |
| Clips | Save, reject, favorite, duplicate | Working | Working | — |
| Editor | Real source/program monitors | Browser file / demo | Proxy + source | — |
| Editor | Select, trim, split, reorder simple segment | Working subset | Real render semantics | advanced multitrack |
| Editor | Undo/redo, keyboard shortcuts | Working | Working | — |
| Editor | Crop 9:16, 4:5, 1:1, 16:9 | UI preview | Working render | — |
| Editor | Manual crop focal point/fit-fill | Preview | Working render | face tracking |
| Editor | Caption text/timing/style editor | Working | FFmpeg burn-in | word alignment/karaoke |
| Editor | Subtitle import/export | UI as feasible | SRT implemented | translate/diarize |
| Editor | Video effects, keyframes, zoom | UI where safe | limited practical subset | advanced effects |
| Audio | Source volume, fades | Preview controls | Working render | AI cleanup/ducking |
| Templates | Podcast, Cinematic, Minimal, Gaming, Educational | Working settings | Render supported subset | ML edit styles |
| Campaign | Requirements, linked clips, submission URLs, views, payout notes | Working | Persisted | API metrics |
| Campaign | Compliance checks | local metadata | actual export metadata | advanced automated checking |
| Exports | Real output controls | UI, marked unavailable until backend | Working H264/AAC MP4 | HEVC/AV1 optional |
| Exports | Batch export, cancel, retry, history | UI | Working queue | parallel scale |
| Settings | Defaults, privacy, paths, performance | Working | Actual service diagnostics | cloud options |
| SaaS | Login, organizations, billing, collaboration | No | No | if validated market |

## Must-have behaviors at end of Stage 2
1. Real imported source is playable in the project.
2. Manual in/out selection of 30–50 seconds is accurate.
3. Source remains immutable; edit data is versioned, saved and reloadable.
4. Portrait crop works for landscape source, with manual position override.
5. Hindi and English captions render in output, not only preview.
6. H.264+AAC MP4 exports are actual files, watermark-free, validated by ffprobe.
7. Several clips can be created and batch exported from one source.
8. Controls for unavailable AI features are clearly labeled and do not pretend success.
9. Campaign requirements can be tracked and verified against known export metadata.
10. Light/dark themes and all major route layouts remain professional and functional.

## Media/campaign integrity
The app processes footage users possess and have rights to use. Project fields contain permission/attribution notes; upload does not imply permission to repost. External service terms may limit downloads, imports, modifications and social use. Never integrate unrestricted extraction from YouTube. No reuploads automated by default.

## Not in current stages
Real automatic highlight scoring, multilingual Whisper speech-to-text, word-level auto-caption animation, face tracking, smart scene-aware reframing, video understanding model, AI editing agent, music recommendation, generative B-roll, analytics scraping, platform posting or subscriptions. Scaffold typed interfaces, explain limitations honestly and implement after the local editor is dependable.
