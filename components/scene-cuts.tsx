'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { timecode, type Project } from '@/lib/model';
import { request } from '@/lib/repository';
import { Field } from './ui';

type SceneResults = { result: { scenes: { startMs: number }[] } | null };

export function SceneCuts({ project, start, end, seek, trim }: {
  project: Project;
  start: number;
  end: number;
  seek: (relativeMs: number) => void;
  trim: (start: number, end: number) => void;
}) {
  const [cuts, setCuts] = useState<number[] | null>(null);
  const [selected, setSelected] = useState<number>();
  const [error, setError] = useState('');
  const available = project.storage === 'server' && !!project.media?.url && project.media.sourceAvailable !== false;

  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    request<SceneResults>(`/api/projects/${project.id}/scenes`, { signal: controller.signal })
      .then(({ result }) => setCuts(result?.scenes.slice(1).map((scene) => scene.startMs) ?? []))
      .catch(() => { if (!controller.signal.aborted) setError('Scene results could not be loaded.'); });
    return () => controller.abort();
  }, [available, project.id, project.media?.id]);

  const within = cuts?.filter((cut) => cut > start && cut < end) ?? [];
  const cut = selected !== undefined && within.includes(selected) ? selected : within[0];

  return <section aria-label="Detected scene cuts">
    <h3>Detected scene cuts</h3>
    {!available ? <p className="hint">Scene detection requires an imported source and the local media service.</p>
      : error ? <p role="status" className="hint">{error}</p>
      : cuts === null ? <p role="status" className="hint">Loading scene results…</p>
      : cut === undefined ? <p className="hint">No detected cut inside this clip. <Link href={`/projects/${project.id}/analyze`}>Open Analysis</Link></p>
      : <>
        <Field label="Scene boundary (source time)">
          <select value={cut} onChange={(event) => setSelected(Number(event.target.value))}>
            {within.map((boundary) => <option key={boundary} value={boundary}>{timecode(boundary)}</option>)}
          </select>
        </Field>
        <button className="full-width" onClick={() => seek(cut - start)}>Preview boundary</button>
        <div className="segmented crop-presets">
          <button onClick={() => trim(cut, end)}>Set clip start</button>
          <button onClick={() => trim(start, cut)}>Set clip end</button>
        </div>
        <p className="hint">Trimming keeps captions inside the new range. Use Undo to restore the previous cut.</p>
      </>}
  </section>;
}
