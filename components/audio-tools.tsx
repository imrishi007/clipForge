'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { type EditDocument, type Project, editDuration } from '@/lib/model';
import { request } from '@/lib/repository';
import { timelineSegments } from '@/lib/segments';

export const AudioWaveform = memo(function AudioWaveform({ edit, clipId, project }: { edit: EditDocument; clipId: string; project: Project }) {
  const [data, setData] = useState<{ key: string; peaks: number[] }>();
  const { sourceInMs: start, sourceOutMs: end } = edit;
  const allowed = project.storage === 'server' && project.media?.hasAudio && project.media.sourceAvailable !== false && end - start <= 180000;
  const key = `${project.media?.id}:${start}:${end}`;
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void request<{ peaks: number[] }>(`/api/clips/${clipId}/waveform?startMs=${start}&endMs=${end}`,
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
        .then(({ peaks }) => setData({ key, peaks })).catch(() => {});
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [allowed, clipId, start, end, key]);
  const peaks = allowed && data?.key === key ? data.peaks : undefined;
  if (!peaks?.length) return null;
  const duration = editDuration(edit);
  const segments = timelineSegments(edit);
  let segmentIndex = 0;
  const bars = peaks.map((_, i) => {
    const position = (i + .5) / peaks.length * duration;
    while (position >= segments[segmentIndex].timelineEnd && segmentIndex < segments.length - 1) segmentIndex++;
    const segment = segments[segmentIndex];
    const point = segment.startMs + position - segment.timelineStart;
    const index = Math.floor((point - start) / (end - start) * peaks.length);
    const height = Math.min(16, Math.sqrt(peaks[index] ?? 0) * 18);
    return `M${i + .5},${16 - height}v${2 * height}`;
  });
  return <svg className="timeline-waveform" viewBox={`0 0 ${peaks.length} 32`} preserveAspectRatio="none" role="img" aria-label="Source audio waveform">
    <path d={bars.join(' ')} stroke="currentColor" strokeWidth=".8" fill="none"/>
  </svg>;
});

export function NormalizeAudio({ edit, clipId, change }: {
  edit: EditDocument; clipId: string; change: (patch: Partial<EditDocument>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const latest = useRef(edit);
  latest.current = edit;

  async function normalize() {
    setBusy(true);
    setStatus('Measuring source loudness…');
    try {
      const result = await request<{ gainDb: number; loudnessLufs: number }>(`/api/clips/${clipId}/loudness`, {
        method: 'POST', body: JSON.stringify(edit), signal: AbortSignal.timeout(30000),
      });
      if (latest.current.sourceInMs !== edit.sourceInMs || latest.current.sourceOutMs !== edit.sourceOutMs ||
          latest.current.sourceSegments !== edit.sourceSegments) {
        setStatus('The source ranges changed. Measure the current edit again.');
      } else {
        change({ loudnessGainDb: result.gainDb });
        setStatus(`Measured ${result.loudnessLufs} LUFS. Applied ${result.gainDb} dB gain.`);
      }
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="full-width" onClick={() => void normalize()} disabled={busy}>Normalize speech loudness</button>
    {!!edit.loudnessGainDb && <button onClick={() => { change({ loudnessGainDb: 0 }); setStatus(''); }}>Reset normalization</button>}
    {status && <p className="hint" role="status">{status}</p>}
  </>;
}
