'use client';

import { useEffect, useState } from 'react';
import { type EditDocument, type Project, timecode, editDuration } from '@/lib/model';
import { type FramingKeyframe, framingAt } from '@/lib/framing';
import { request } from '@/lib/repository';
import { Field } from './ui';

type Job = { id: string; status: string; stage: string; progress?: number; error?: string };
type Tracking = { job: Job; result?: { keyframes: FramingKeyframe[]; faceFrames: number; sampledFrames: number } };

export function FramingControls({ project, clipId, edit, time, seek, change }: {
  project: Project; clipId: string; edit: EditDocument; time: number;
  seek: (time: number) => void; change: (patch: Partial<EditDocument>) => void;
}) {
  const [selected, setSelected] = useState<number>();
  const [tracking, setTracking] = useState<{ id: string; input: string; mediaId?: string }>();
  const [status, setStatus] = useState('');
  const [starting, setStarting] = useState(false);
  const frames = edit.framingKeyframes ?? [];
  const selectedFrame = frames.find(frame => frame.timeMs === selected);
  const input = JSON.stringify({ sourceInMs: edit.sourceInMs, sourceOutMs: edit.sourceOutMs,
    ratio: edit.ratio, focalX: edit.focalX, focalY: edit.focalY });
  const path = `/api/clips/${clipId}/framing`;
  const mediaId = project.media?.id;
  const duration = editDuration(edit);
  const canTrack = project.storage === 'server' && !!mediaId && project.media?.sourceAvailable !== false && !edit.sourceSegments?.length && duration >= 200 && duration <= 180000;

  useEffect(() => {
    if (!tracking) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!tracking) return;
      try {
        const { job, result } = await request<Tracking>(`${path}/${tracking.id}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]) });
        if (controller.signal.aborted) return;
        if (job.status === 'queued' || job.status === 'running') {
          setStatus(`${job.stage}${job.progress == null ? '' : ` · ${Math.round(job.progress)}%`}`);
          timer = setTimeout(() => void poll(), 700);
          return;
        }
        setTracking(undefined);
        if (job.status !== 'succeeded' || !result) {
          setStatus(job.error || job.stage);
        } else if (input !== tracking.input || mediaId !== tracking.mediaId || edit.cropMode !== 'fill' || !!edit.sourceSegments?.length) {
          setStatus('The clip range or framing changed. Track the new selection again.');
        } else if (!result.faceFrames) {
          setStatus('No faces detected. You can set framing keyframes manually.');
        } else {
          change({ framingKeyframes: result.keyframes });
          setSelected(result.keyframes[0]?.timeMs);
          setStatus(`Faces detected in ${result.faceFrames} of ${result.sampledFrames} sampled frames.`);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setTracking(undefined);
          setStatus((error as Error).message);
        }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [tracking, path, input, mediaId, edit.cropMode, edit.sourceSegments, change]);

  async function start() {
    setStarting(true);
    setStatus('Starting face tracking…');
    try {
      const job = await request<Job>(path, { method: 'POST', body: input });
      setTracking({ id: job.id, input, mediaId });
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setStarting(false);
    }
  }

  function addKeyframe() {
    const at = Math.max(0, Math.min(duration, Math.round(time)));
    setSelected(at);
    if (frames.some(frame => frame.timeMs === at)) return;
    change({ framingKeyframes: [...frames, { timeMs: at, ...framingAt(edit, at) }].sort((a, b) => a.timeMs - b.timeMs) });
  }

  function adjust(patch: Partial<FramingKeyframe>) {
    change({ framingKeyframes: frames.map(frame => frame.timeMs === selected ? { ...frame, ...patch } : frame) });
    if (selected !== undefined) seek(selected);
  }

  if (edit.cropMode !== 'fill') return <p className="hint">Choose Fill frame to use crop keyframes.</p>;
  return <>
    <hr/><h3>Framing keyframes</h3>
    {canTrack && <button className="full-width" disabled={starting || !!tracking} onClick={() => void start()}>Track faces in clip</button>}
    {tracking && <button className="full-width" onClick={() => {
      void request(`/api/jobs/${tracking.id}/cancel`, { method: 'POST' }).catch(error => setStatus(error.message));
    }}>Cancel tracking</button>}
    {status && <p role="status" className="hint">{status}</p>}
    <button className="full-width" disabled={!!tracking || frames.length >= 96} onClick={addKeyframe}>Add keyframe at playhead</button>
    {frames.length > 0 && <>
      <Field label="Framing keyframe"><select value={selectedFrame?.timeMs ?? ''} onChange={event => {
        const at = Number(event.target.value);
        setSelected(at);
        seek(at);
      }}><option value="" disabled>Select a keyframe</option>{frames.map(frame =>
        <option key={frame.timeMs} value={frame.timeMs}>{timecode(frame.timeMs)}{frame.cut ? ' · cut' : ''}</option>)}</select></Field>
      {selectedFrame && <>
        <Field label="Keyframe horizontal position"><input type="range" min="0" max="1" step="0.01" value={selectedFrame.x}
          disabled={!!tracking} onChange={event => adjust({ x: Number(event.target.value) })}/></Field>
        <Field label="Keyframe vertical position"><input type="range" min="0" max="1" step="0.01" value={selectedFrame.y}
          disabled={!!tracking} onChange={event => adjust({ y: Number(event.target.value) })}/></Field>
        <label className="checkbox"><input type="checkbox" checked={!!selectedFrame.cut} disabled={!!tracking}
          onChange={event => adjust({ cut: event.target.checked })}/>Jump at scene cut</label>
        <button disabled={!!tracking} onClick={() => change({ framingKeyframes: frames.filter(frame => frame.timeMs !== selected) })}>Remove keyframe</button>
      </>}
      <button disabled={!!tracking} onClick={() => {
        const point = framingAt(edit, time);
        change({ framingKeyframes: [], focalX: point.x, focalY: point.y });
        setStatus('');
      }}>Use fixed framing</button>
    </>}
  </>;
}
