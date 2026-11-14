'use client';

import { useState } from 'react';
import { youtubeId } from '@/lib/source-links';

export function SourceReference({ url }: { url: string }) {
  const id = youtubeId(url);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (!id) return null;
  return <section className="source-reference">
    <h3>YouTube reference</h3>
    <p className="hint">Load the YouTube player to preview the reference. Import an authorized file to edit, transcribe, or export it.</p>
    {loaded === id && <iframe title="YouTube reference preview" src={`https://www.youtube-nocookie.com/embed/${id}`}
      referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture" allowFullScreen/>}
    <div className="filterbar">
      {loaded !== id && <button type="button" onClick={() => setLoaded(id)}>Load YouTube preview</button>}
      <a className="button" href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer">Open on YouTube</a>
    </div>
  </section>;
}
