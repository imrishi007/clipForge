# ClipForge Studio — Personal Edition

ClipForge is a Windows-first workspace for discovering, editing and exporting short-form video. It stores source media and edits locally.

## Start on Windows

Install Node.js 20+, Python 3.11+, and FFmpeg/ffprobe with `libx264` and `libass`. Ensure the commands are on `PATH`. Install the frontend and API dependencies from the project folder:

```powershell
npm install
python -m pip install -r apps/api/requirements.txt
```

Run these commands in separate terminals and open [ClipForge](http://127.0.0.1:3000):

```powershell
npm run api
npm run dev
```

`npm run dev` alone opens the browser workspace with an editable sample and local-file preview. The sample is a 12-second original motion study with a synthesized tone. Real footage supports manual clip selection and caption editing. AI analysis stays unavailable until the optional local models below are configured.

## Optional local AI analysis

Whisper transcription, PySceneDetect scene detection and OpenCV face tracking run in the local Python worker. Install their optional packages into the Python environment running the API:

```powershell
python -m pip install -r apps/api/requirements-ai.txt
```

Download a multilingual faster-whisper model (for example `Systran/faster-whisper-small`) using its documented model files and place it in a local folder. The app runs with CPU INT8 and reads only local weights. Set these variables in the API terminal before `npm run api`:

```powershell
$env:CLIPFORGE_WHISPER_MODEL = 'C:/Models/faster-whisper-small'
$env:CLIPFORGE_AI_CPU_THREADS = '4'
```

Highlight discovery requires a local GGUF instruction model and the Node llama.cpp runtime. The tested stack used Qwen2.5 1.5B Instruct Q4_K_M, `node-llama-cpp` 3.22.3 and Node 24 on CPU. Install the runtime in an ignored local folder and set paths to the runtime entry and model file:

```powershell
npm install --prefix .tools/highlight-runtime node-llama-cpp@3.22.3
$env:CLIPFORGE_LLM_RUNTIME = (Resolve-Path '.tools/highlight-runtime/node_modules/node-llama-cpp/dist/index.js').Path
$env:CLIPFORGE_HIGHLIGHT_MODEL = 'C:/Models/qwen2.5-1.5b-instruct-q4_k_m.gguf'
$env:CLIPFORGE_AI_CPU_THREADS = '4'
```

Choose model files from their official distribution, review their license and terms, and retain the weights outside the application bundle. Model downloads are intentionally not automatic. Transcription creates source-timed word drafts that require review; corrected text keeps the cue range but clears word alignment. Highlight ranking considers only transcript-derived candidate windows and returns source timestamps. Scene detection finds visual cuts; neither model infers rights or validates factual content. YouTube URLs remain references only; import an authorized local/direct-media file to analyze it.

## Real media and exports

For real export, import an authorized video with the API running, create a clip, then choose **Export → Render MP4**. Download the file from **Exports** after ffprobe validation. The API keeps its SQLite database, source media and rendered files under `data/` by default. Run one API process. The local worker resumes queued jobs after restart and allows retries.

Accepted highlights inherit the project's caption style. Discovery settings control clip count, duration and editorial emphasis. Sources over five minutes use resumable transcription windows with a default 90-minute source limit. Use **Create clip around this cue** in Analysis to select context and approve a transcript-based clip.

- In **Crop**, choose **Track faces in clip** or add and adjust framing keyframes at the playhead. The CPU tracker uses OpenCV's frontal-face model. [OpenCV cascade classifier](https://docs.opencv.org/4.11.0/db/d28/tutorial_cascade_classifier.html)
- In **Captions**, choose **Use source transcript** to import available word alignment. Edit word timing, highlighting and motion in the same inspector. Apply auto-framing and transcript captions before assembling separate source ranges.
- In **Edit**, remove a source range or use **Remove quiet gaps**. The timeline keeps separate ranges and rebases existing captions and crop keyframes. Use **Audio → Normalize speech loudness** to measure the assembled source and save its gain. For multi-segment clips, the Edit inspector can fade at cuts. Use **Tighten opening pauses** with a saved source transcript. The Audio inspector can reduce low-frequency rumble. [FFmpeg audio filters](https://ffmpeg.org/ffmpeg-filters.html#Audio-Filters)

Set `CLIPFORGE_DATA_DIR`, `FFMPEG_BINARY` or `FFPROBE_BINARY` in the API process environment to use another data folder or executable paths. See [.env.example](.env.example) for settings. On Windows, captions default to Nirmala UI; install a licensed Devanagari-capable font visible to FFmpeg if needed.

## Performance on Windows

Start with **Settings → Performance profile → Lite** on a 16 GB laptop. It builds a seek-friendly 360p preview and caps export and AI threads at two where the tool supports a thread limit. Balanced builds up to 540p previews with up to four threads. Maximum Quality builds up to 720p previews with up to six threads. Each runs one heavy background job at a time. Export resolution, frame rate and quality are saved on the clip. The final render reads the original footage.

**Check connection and hardware** measures available RAM, NVIDIA VRAM and GPU temperature when supported. It also tests actual H.264 encodes and NVIDIA decoding. On the tested RTX 2050 and i5-12450H, NVENC and Quick Sync both worked. Choose Quick Sync or NVENC in **Export encoder** to use a verified encoder. Software remains the default and is retried automatically if a hardware export fails. See the [benchmark results](docs/TEST_REPORT.md) for timing and output-size tradeoffs.

Whisper defaults to CPU INT8. To try CUDA, set `CLIPFORGE_WHISPER_DEVICE=cuda` before starting the API. ClipForge uses the same local model and falls back to CPU INT8 if the runtime is unavailable. On Windows, make the CUDA libraries required by your CTranslate2 version available on PATH. The tested laptop lacked `cublas64_12.dll`. [faster-whisper GPU requirements](https://github.com/SYSTRAN/faster-whisper#gpu)

## Verification

`npm run verify` runs frontend static checks, unit tests, API tests, browser tests and the production build. For real-media integration tests, set `CLIPFORGE_MEDIA_E2E=1` and use an isolated API data folder on port 8000. The opt-in speech/highlight tests additionally need licensed fixture videos and locally configured models; see [the verification report](docs/TEST_REPORT.md) for exact sources and measured results.

```powershell
npm run fixtures
$env:CLIPFORGE_MEDIA_E2E = '1'
npm run verify
```

The generated synthetic fixtures can be recreated with `npm run fixtures`. See the [verification report](docs/TEST_REPORT.md) for measured outcomes and [the implementation log](docs/IMPLEMENTATION_LOG.md) for current status.
