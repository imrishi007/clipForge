'use client';

import { useRef, useState } from 'react';
import { applySourceSegments } from '@/lib/editing';
import { type EditDocument, type Project, timecode } from '@/lib/model';
import { request } from '@/lib/repository';
import { type SourceSegment, excludeSourceRanges, timelineSegments } from '@/lib/segments';
import { Field } from './ui';

export function SegmentControls({ project, clipId, edit, time, change, seek }: {
  project: Project; clipId: string; edit: EditDocument; time: number;
  change: (patch: Partial<EditDocument>) => void; seek: (time: number) => void;
}) {
  const [intensity, setIntensity] = useState('standard');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const editRef = useRef(edit);
  editRef.current = edit;
  const segments = timelineSegments(edit);
  const canDetect = project.storage === 'server' && project.media?.hasAudio && project.media.sourceAvailable !== false &&
    edit.sourceOutMs - edit.sourceInMs <= 180000;

  function apply(ranges: SourceSegment[], report: string) {
    try {
      const current = editRef.current;
      const next = applySourceSegments(current, ranges);
      change(next);
      setMessage(report);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function removeSilence(openingOnly = false) {
    const { sourceInMs, sourceOutMs, sourceSegments } = edit;
    setBusy(true);
    setMessage('Analyzing source audio…');
    try {
      const end = openingOnly ? Math.min(sourceOutMs, sourceInMs + 7000) : sourceOutMs;
      const { ranges, speechProtected } = await request<{ ranges: SourceSegment[]; speechProtected: boolean }>(
        `/api/clips/${clipId}/silence?startMs=${sourceInMs}&endMs=${end}&intensity=${openingOnly ? 'gentle' : intensity}`, { signal: AbortSignal.timeout(30000) });
      const current = editRef.current;
      if (current.sourceInMs !== sourceInMs || current.sourceOutMs !== sourceOutMs || current.sourceSegments !== sourceSegments) {
        setMessage('The clip ranges changed. Analyze again to use the current edit.');
        return;
      }
      if (openingOnly && !speechProtected) {
        setMessage('Generate a source transcript in Analysis to tighten the opening safely.');
        return;
      }
      const kept = excludeSourceRanges(current, openingOnly ? ranges.filter(range => range.endMs < end - 250) : ranges);
      const unchanged = kept.length === segments.length && kept.every((range, i) =>
        range.startMs === segments[i].startMs && range.endMs === segments[i].endMs);
      if (unchanged) setMessage('No eligible quiet gaps in the current segments.');
      else apply(kept, openingOnly ? 'Shortened pauses in the opening while preserving transcript cues.' : speechProtected
        ? 'Quiet gaps removed with transcript protection.' : 'Quiet gaps removed using audio levels. Review the cut boundaries.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Source segments">
    <h3>Source segments <span className="count">{segments.length}</span></h3>
    {segments.length > 1 && <div className="caption-list">{segments.map(segment =>
      <div className="row-between" key={segment.startMs}>
        <button onClick={() => seek(segment.timelineStart)}>{timecode(segment.startMs)}–{timecode(segment.endMs)}</button>
        <button aria-label={`Remove segment at ${timecode(segment.startMs)}`} onClick={() =>
          apply(segments.filter(item => item !== segment).map(({ startMs, endMs }) => ({ startMs, endMs })), 'Segment removed.')}>Remove</button>
      </div>)}</div>}
    {segments.length > 1 && <Field label="Fade at cuts (ms per side)"><input type="range" min="0" max="250" step="25"
      value={edit.cutFadeMs ?? 0} onChange={event => change({ cutFadeMs: Number(event.target.value) })}/>
      <span className="hint">{edit.cutFadeMs ? `${edit.cutFadeMs} ms · Video dips to black and audio fades` : 'Clean cuts'}</span></Field>}
    <details>
      <summary>Remove a source range</summary>
      <div className="form-grid">
        <Field label="Remove from (source seconds)"><input type="number" step="0.001" value={start} onChange={e => setStart(e.target.value)}/></Field>
        <Field label="Remove to (source seconds)"><input type="number" step="0.001" value={end} onChange={e => setEnd(e.target.value)}/></Field>
      </div>
      <button onClick={() => {
        const a = Math.round(Number(start) * 1000), b = Math.round(Number(end) * 1000);
        if (!start || !end || a < edit.sourceInMs || b > edit.sourceOutMs || b <= a) {
          setMessage('Enter two ordered source times inside this clip.');
          return;
        }
        apply(excludeSourceRanges(edit, [{ startMs: a, endMs: b }]), 'Source range removed.');
      }}>Remove range</button>
    </details>
    {canDetect && <>
      <button className="full-width" disabled={busy} onClick={() => void removeSilence(true)}>Tighten opening pauses</button>
      <Field label="Silence removal intensity"><select value={intensity} onChange={event => setIntensity(event.target.value)}>
        <option value="gentle">Gentle</option><option value="standard">Standard</option><option value="tight">Tight</option>
      </select></Field>
      <button className="full-width" disabled={busy} onClick={() => void removeSilence()}>Remove quiet gaps</button>
    </>}
    {message && <p className="hint" role="status">{message}</p>}
    <p className="hint">Playhead {timecode(time)} · Use Undo to restore removed ranges.</p>
  </section>;
}
