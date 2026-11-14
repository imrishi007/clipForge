'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { timecode, type Clip, type Project } from '@/lib/model';
import { mediaUrl, request } from '@/lib/repository';
import { Alert, Field, Modal } from './ui';
import { useWorkspace } from './workspace-context';

type Word = { text: string; startMs: number; endMs: number };
type Segment = Word & { id: string; words: Word[]; corrected?: boolean };
type Transcript = { revision: number; model: string; language: string; languageMode: string; segments: Segment[]; cachedChunks?: number };
type AnalysisJob = { id: string; status: string; stage: string; progress: number | null; error?: string };
type TranscriptState = { available: boolean; hasAudio: boolean; job: AnalysisJob | null; transcript: Transcript | null };
type SceneState = { available: boolean; job: AnalysisJob | null; result: { scenes: Omit<Word, 'text'>[] } | null };
type Highlight = { id: number; startMs: number; endMs: number; title: string; reason: string };
type HighlightState = { available: boolean; job: AnalysisJob | null; resultJobId?: string; result: { candidates: Highlight[] } | null };

const languages = ['Auto', 'English', 'Hindi', 'Hinglish', 'Other'];

export function AnalysisPanel({ project }: { project: Project }) {
  const router = useRouter();
  const { refresh: refreshWorkspace } = useWorkspace();
  const initialLanguage = project.preferences.language;
  const [language, setLanguage] = useState(languages.includes(initialLanguage) ? initialLanguage : 'Auto');
  const [state, setState] = useState<TranscriptState | null>(null);
  const [sceneState, setSceneState] = useState<SceneState | null>(null);
  const [highlightState, setHighlightState] = useState<HighlightState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [framing, setFraming] = useState('standard');
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(0);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [discovery, setDiscovery] = useState({ targetCount: Number(project.preferences.targetCount) || 5, minSeconds: 30, maxSeconds: 50,
    category: project.category || 'General', style: project.preferences.preset || 'Podcast Clean', emphasis: 'Balanced' });
  const [selection, setSelection] = useState<{ segmentId: string; revision: number; title: string; startMs: number; endMs: number }>();
  const video = useRef<HTMLVideoElement>(null);
  const route = `/api/projects/${project.id}/transcript`;
  const sceneRoute = `/api/projects/${project.id}/scenes`;
  const highlightRoute = `/api/projects/${project.id}/highlights`;
  const result = state?.transcript;
  const running = state?.job?.status === 'queued' || state?.job?.status === 'running';
  const sceneRunning = sceneState?.job?.status === 'queued' || sceneState?.job?.status === 'running';
  const highlightRunning = highlightState?.job?.status === 'queued' || highlightState?.job?.status === 'running';
  const available = project.storage === 'server' && !!project.media?.url && project.media.sourceAvailable !== false;

  useEffect(() => {
    if (!available) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const [current, scenes] = await Promise.all([
          request<TranscriptState>(route), request<SceneState>(sceneRoute).catch(() => null),
        ]);
        const highlights = await request<HighlightState>(highlightRoute).catch(() => null);
        if (disposed) return;
        setState(current);
        setSceneState(scenes);
        setHighlightState(highlights);
        if ([current.job, scenes?.job, highlights?.job].some((job) => job?.status === 'running' || job?.status === 'queued')) timer = setTimeout(poll, 1500);
      } catch (error) {
        if (!disposed) setError((error as Error).message);
      }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [available, refresh, route, sceneRoute, highlightRoute]);

  async function action(path: string, method: 'POST' | 'PUT', data?: object) {
    setBusy(true);
    setError('');
    try {
      await request(path, { method, body: data ? JSON.stringify(data) : undefined });
      if (method === 'PUT') setChanges({});
      setRefresh((value) => value + 1);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function acceptHighlight(candidateId: number) {
    const jobId = highlightState?.resultJobId ?? highlightState?.job?.id;
    if (!jobId) return;
    setBusy(true);
    setError('');
    try {
      const clip = await request<Clip>(`${highlightRoute}/clip`, {
        method: 'POST', body: JSON.stringify({ jobId, candidateId, framing }),
      });
      await refreshWorkspace();
      router.push(`/editor/${project.id}/${clip.id}`);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function seek(ms: number) {
    if (video.current?.readyState) video.current.currentTime = ms / 1000;
  }

  async function createTranscriptClip() {
    if (!selection) return;
    setBusy(true);
    setError('');
    try {
      const clip = await request<Clip>(`${route}/clip`, { method: 'POST', body: JSON.stringify(selection) });
      await refreshWorkspace();
      router.push(`/editor/${project.id}/${clip.id}`);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!available) return <Alert>Import or relink the original through the local media service to analyze this project.</Alert>;
  return <section className="analysis-workspace" aria-label="Local analysis">
    {error && <Alert>{error}</Alert>}
    <div className="campaign-panel">
      <h2>Transcription</h2>
      <p className="hint">Whisper generates source-timed text on this computer. Review the draft before using it as captions.</p>
      <div className="filterbar">
        <Field label="Transcription language"><select value={language} onChange={(event) => setLanguage(event.target.value)}>
          {languages.map((choice) => <option key={choice}>{choice}</option>)}
        </select></Field>
        {!result && <button className="primary" disabled={busy || running || !state?.available || !state?.hasAudio}
          onClick={() => void action(route, 'POST', { language })}>Transcribe source</button>}
        {running && <button disabled={busy || state.job?.stage === 'Cancelling'} onClick={() => void action(`/api/jobs/${state.job?.id}/cancel`, 'POST')}>Cancel</button>}
        {(state?.job?.status === 'failed' || state?.job?.status === 'cancelled') && <button disabled={busy}
          onClick={() => void action(`/api/jobs/${state.job?.id}/retry`, 'POST')}>Resume previous transcription</button>}
        {result && <a className="button" href={mediaUrl(`${route}/subtitles`)}>Download source SRT</a>}
      </div>
      {state && !state.available && <Alert>Install the optional analysis dependencies and configure a local Whisper model.</Alert>}
      {state && !state.hasAudio && <Alert>This source has no audio track to transcribe.</Alert>}
      {state?.job && <p role="status">{state.job.stage}{running && state.job.progress !== null ? ` · ${Math.floor(state.job.progress)}%` : ''}</p>}
      {state?.job?.error && <Alert>{state.job.error}</Alert>}
      {!!result?.cachedChunks && <p className="hint">Reused {result.cachedChunks} completed transcription windows.</p>}
    </div>
    <div className="campaign-panel">
      <div className="section-heading"><h2>Highlight discovery</h2><span className="muted">Local model · transcript-based</span></div>
      <p className="hint">Rank transcript windows for a clear hook, enough context and a meaningful payoff. Review the source before editing.</p>
      <details>
        <summary>Discovery settings</summary>
        <div className="form-grid">
          {([['targetCount', 'Target clips', 1, 8], ['minSeconds', 'Minimum seconds', 10, 90], ['maxSeconds', 'Maximum seconds', 10, 90]] as const)
            .map(([key, label, min, max]) => <Field key={key} label={label}><input type="number" min={min} max={max} value={discovery[key]}
              onChange={event => setDiscovery({ ...discovery, [key]: Number(event.target.value) })}/></Field>)}
          <Field label="Highlight emphasis"><select value={discovery.emphasis} onChange={event => setDiscovery({ ...discovery, emphasis: event.target.value })}>
            {['Balanced', 'Humour', 'Suspense', 'Information', 'Storytelling', 'Emotion'].map(value => <option key={value}>{value}</option>)}
          </select></Field>
          <Field label="Video category"><input maxLength={60} value={discovery.category} onChange={event => setDiscovery({ ...discovery, category: event.target.value })}/></Field>
          <Field label="Editorial style"><input maxLength={60} value={discovery.style} onChange={event => setDiscovery({ ...discovery, style: event.target.value })}/></Field>
        </div>
      </details>
      <div className="filterbar">
        <button className="primary" disabled={busy || highlightRunning || !result?.segments.length || !highlightState?.available}
          onClick={() => void action(highlightRoute, 'POST', { ...discovery, language })}>{highlightState?.result ? 'Rank again' : 'Find highlights'}</button>
        {highlightRunning && <button disabled={busy || highlightState?.job?.stage === 'Cancelling'} onClick={() => void action(`/api/jobs/${highlightState?.job?.id}/cancel`, 'POST')}>Cancel ranking</button>}
      </div>
      {highlightState && !highlightState.available && <Alert>Configure a local GGUF highlight model and Node runtime to rank transcript windows.</Alert>}
      {!result && <p className="hint">Transcribe the source first. Highlight discovery uses the editable transcript and never invents timestamps.</p>}
      {highlightState?.job && <p role="status">{highlightState.job.stage}{highlightRunning && highlightState.job.progress !== null ? ` · ${Math.floor(highlightState.job.progress)}%` : ''}</p>}
      {highlightState?.job?.error && <Alert>{highlightState.job.error}</Alert>}
      {!!highlightState?.result?.candidates.length && <Field label="Highlight framing preset">
        <select value={framing} disabled={busy} onChange={(event) => setFraming(event.target.value)}>
          <option value="standard">Standard · 100% zoom</option>
          <option value="close-up">Close-up · 115% zoom</option>
        </select>
      </Field>}
      {highlightState?.result?.candidates.map((candidate) => <article className="highlight-candidate" key={candidate.id}>
        <div className="section-heading"><h3>{candidate.title}</h3><button type="button" onClick={() => seek(candidate.startMs)}>{timecode(candidate.startMs)}–{timecode(candidate.endMs)}</button></div>
        <p>{candidate.reason}</p>
        <button className="button" disabled={busy} onClick={() => void acceptHighlight(candidate.id)}>Open in editor</button>
      </article>)}
      {highlightState?.result && !highlightState.result.candidates.length && <p>No compelling window was returned. Correct the transcript or choose a clip manually.</p>}
    </div>
    <div className="campaign-panel">
      <h2>Scene detection</h2>
      <p className="hint">Find hard cuts in the original video on this computer.</p>
      <div className="filterbar">
        <button disabled={busy || sceneRunning || !sceneState?.available} onClick={() => void action(sceneRoute, 'POST')}>Detect scenes</button>
        {sceneRunning && <button disabled={busy || sceneState.job?.stage === 'Cancelling'} onClick={() => void action(`/api/jobs/${sceneState.job?.id}/cancel`, 'POST')}>Cancel scene detection</button>}
      </div>
      {sceneState && !sceneState.available && <Alert>Install the optional scene detection dependencies.</Alert>}
      {sceneState?.job && <p role="status">{sceneState.job.stage}</p>}
      {sceneState?.job?.error && <Alert>{sceneState.job.error}</Alert>}
      {sceneState?.result && <details><summary>{sceneState.result.scenes.length} detected scene spans</summary>
        <ol>{sceneState.result.scenes.slice(0, 100).map((scene) => <li key={scene.startMs}>
          <button type="button" onClick={() => seek(scene.startMs)}>{timecode(scene.startMs)}–{timecode(scene.endMs)}</button>
        </li>)}</ol>
        {sceneState.result.scenes.length > 100 && <p className="hint">Showing the first 100 scene spans.</p>}
      </details>}
    </div>
    {(result || sceneState?.result) && <div className="campaign-panel">
      <video className="analysis-video" controls preload="metadata" ref={video} src={mediaUrl(project.media?.url)}/>
    </div>}
    {result && <div className="campaign-panel">
      <div className="section-heading"><h2>Source transcript</h2><span className="muted">{result.languageMode} · {result.model}</span></div>
      {!result.segments.length && <p>No speech was detected.</p>}
      {result.segments.slice(page * 12, page * 12 + 12).map((row) => <div className="transcript-row" key={row.id}>
        <button type="button" onClick={() => seek(row.startMs)} aria-label={`Seek to ${timecode(row.startMs)}`}>{timecode(row.startMs)}–{timecode(row.endMs)}</button>
        <div>
          <textarea aria-label={`Transcript segment ${row.id}`} rows={2} maxLength={2000} value={changes[row.id] ?? row.text}
            onChange={(event) => setChanges({ ...changes, [row.id]: event.target.value })}/>
          <button type="button" disabled={busy || running || !!Object.keys(changes).length} onClick={() => {
            const index = result.segments.indexOf(row);
            const first = result.segments[Math.max(0, index - 1)];
            const last = result.segments[Math.min(result.segments.length - 1, index + 1)];
            setError('');
            setSelection({ segmentId: row.id, revision: result.revision, title: row.text.slice(0, 72),
              startMs: row.startMs - first.startMs < 30000 ? first.startMs : row.startMs,
              endMs: last.endMs - row.endMs < 30000 ? last.endMs : row.endMs });
          }}>Create clip around this cue</button>
          {row.corrected ? <small className="muted">Corrected text uses segment timing.</small> : !!row.words.length && <details>
            <summary>Word timestamps</summary>
            <div className="word-times">{row.words.map((word, index) => <button key={index} type="button" title={`${timecode(word.startMs)}–${timecode(word.endMs)}`}
              onClick={() => seek(word.startMs)}>{word.text}</button>)}</div>
          </details>}
        </div>
      </div>)}
      <div className="dialog-actions">
        <button disabled={!page} onClick={() => setPage(page - 1)}>Previous segments</button>
        <button disabled={(page + 1) * 12 >= result.segments.length} onClick={() => setPage(page + 1)}>Next segments</button>
        <button className="primary" disabled={busy || running || !Object.keys(changes).length} onClick={() => void action(route, 'PUT', { revision: result.revision, changes })}>Save corrections</button>
      </div>
    </div>}
    {selection && <Modal title="Create clip from transcript" onClose={() => setSelection(undefined)}>
      {error && <Alert>{error}</Alert>}
      <Field label="Clip title"><input value={selection.title} maxLength={180} onChange={event => setSelection({ ...selection, title: event.target.value })}/></Field>
      <div className="form-grid">
        <Field label="Context start (source seconds)"><input type="number" min="0" step="0.001" value={selection.startMs / 1000}
          onChange={event => setSelection({ ...selection, startMs: Math.round(Number(event.target.value) * 1000) })}/></Field>
        <Field label="Context end (source seconds)"><input type="number" min="0" step="0.001" value={selection.endMs / 1000}
          onChange={event => setSelection({ ...selection, endMs: Math.round(Number(event.target.value) * 1000) })}/></Field>
      </div>
      <div className="dialog-actions"><button onClick={() => setSelection(undefined)}>Cancel</button>
        <button className="primary" disabled={busy || !selection.title.trim() || selection.endMs <= selection.startMs}
          onClick={() => void createTranscriptClip()}>Approve and open editor</button></div>
    </Modal>}
  </section>;
}
