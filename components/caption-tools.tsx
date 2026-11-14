'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { type Caption, type EditDocument, timecode } from '@/lib/model';
import { request } from '@/lib/repository';
import { Field } from './ui';

type Word = NonNullable<Caption['words']>[number];

export function CaptionPreview({ caption, edit, time }: { caption: Caption; edit: EditDocument; time: number }) {
  const age = Math.max(0, time - caption.startMs);
  const fade = Math.min(140, Math.floor((caption.endMs - caption.startMs) / 2));
  const opacity = edit.captionAnimation === 'fade' && fade > 0 ? Math.min(1, age / fade, (caption.endMs - time) / fade) : 1;
  const scale = edit.captionAnimation === 'pop' ? .88 + .12 * Math.min(1, age / 160) : 1;
  const shadow = edit.captionShadow ?? 0;
  const style: CSSProperties = {
    top: `${edit.captionY}%`, fontSize: `${edit.fontSize / 1080 * 100}cqw`, fontFamily: `"${edit.fontFamily}", "Nirmala UI", sans-serif`,
    fontWeight: edit.bold ? 700 : 400, color: edit.color, opacity, scale: String(scale),
    WebkitTextStroke: edit.outline ? `${edit.outline / 1080 * 100}cqw #000` : undefined,
    paintOrder: 'stroke fill', textShadow: shadow ? `0 ${shadow / 1080 * 100}cqw ${shadow / 1080 * 100}cqw #000b` : undefined,
    background: edit.captionBackground ? '#000b' : 'transparent',
  };
  let index = 0;
  return <div className="preview-caption" style={style}>{caption.words?.length && edit.captionHighlight
    ? caption.text.split(/(\s+)/u).map((token, i) => {
      if (!token || /^\s+$/u.test(token)) return token;
      const word = caption.words?.[index++];
      const active = word && word.startMs <= time && time < word.endMs;
      return <span key={i} style={active ? { color: edit.captionHighlight ?? undefined } : undefined}>{token}</span>;
    })
    : caption.text}</div>;
}

export function TranscriptCaptionButton({ clipId, edit, replace }: {
  clipId: string; edit: EditDocument; replace: (captions: Caption[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [confirm, setConfirm] = useState(false);
  const latest = useRef(edit);
  latest.current = edit;

  async function importCaptions() {
    const { sourceInMs, sourceOutMs, captions: original } = edit;
    setBusy(true);
    setConfirm(false);
    setStatus('');
    try {
      const captions = await request<Caption[]>(`/api/clips/${clipId}/transcript-captions?startMs=${sourceInMs}&endMs=${sourceOutMs}`);
      if (latest.current.sourceInMs !== sourceInMs || latest.current.sourceOutMs !== sourceOutMs || latest.current.captions !== original) {
        setStatus('The captions or clip range changed. Import again to use the current edit.');
      } else if (captions.length) {
        replace(captions);
        setStatus(`Imported ${captions.length} captions from the source transcript.`);
      } else {
        setStatus('The transcript has no speech inside this range.');
      }
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="full-width" disabled={busy} onClick={() => {
      if (edit.captions.length) setConfirm(true);
      else void importCaptions();
    }}>{busy ? 'Importing captions…' : 'Use source transcript'}</button>
    {confirm && <div className="subtitle-actions">
      <button onClick={() => void importCaptions()}>Replace current captions</button>
      <button onClick={() => setConfirm(false)}>Keep current</button>
    </div>}
    {status && <p role="status" className="hint">{status}</p>}
  </>;
}

export function CaptionWords({ caption, update, seek }: {
  caption: Caption; update: (patch: Partial<Caption>) => void; seek: (time: number) => void;
}) {
  const words = caption.words ?? [];
  const [index, setIndex] = useState(0);
  const word = words[index];
  if (!words.length) return <p className="hint">Sentence timing · word alignment unavailable.</p>;

  function change(patch: Partial<Word>) {
    const next = words.map((item, i) => i === index ? { ...item, ...patch } : item);
    update({ words: next, text: next.map(item => item.text).join(' ') });
  }

  return <details>
    <summary>Edit aligned words</summary>
    <Field label="Caption word"><select value={word ? index : ''} onChange={event => {
      const at = Number(event.target.value);
      setIndex(at);
      seek(words[at].startMs);
    }}>{!word && <option value="" disabled>Select a word</option>}{words.map((item, i) =>
      <option key={i} value={i}>{item.text} · {timecode(item.startMs)}</option>)}</select></Field>
    {word && <>
      <Field label="Word text"><input key={`${caption.id}:${index}:${word.text}`} defaultValue={word.text} maxLength={200}
        onBlur={event => {
          const text = event.target.value.trim();
          if (/^\S+$/u.test(text) && text !== word.text) change({ text });
          else event.target.value = word.text;
        }}/></Field>
      <div className="form-grid">
        <Field label="Word in (seconds)"><input type="number" step="0.001" min={(words[index - 1]?.endMs ?? caption.startMs) / 1000}
          max={(word.endMs - 1) / 1000} value={word.startMs / 1000} onChange={event => {
            const at = Math.round(event.target.valueAsNumber * 1000);
            if (at >= (words[index - 1]?.endMs ?? caption.startMs) && at < word.endMs) change({ startMs: at });
          }}/></Field>
        <Field label="Word out (seconds)"><input type="number" step="0.001" min={(word.startMs + 1) / 1000}
          max={(words[index + 1]?.startMs ?? caption.endMs) / 1000} value={word.endMs / 1000} onChange={event => {
            const at = Math.round(event.target.valueAsNumber * 1000);
            if (at > word.startMs && at <= (words[index + 1]?.startMs ?? caption.endMs)) change({ endMs: at });
          }}/></Field>
      </div>
    </>}
  </details>;
}

export function CaptionMotion({ edit, change }: { edit: EditDocument; change: (patch: Partial<EditDocument>) => void }) {
  return <>
    <Field label="Caption animation"><select value={edit.captionAnimation ?? 'none'} onChange={event =>
      change({ captionAnimation: event.target.value as EditDocument['captionAnimation'] })}>
      <option value="none">Still</option><option value="fade">Soft fade</option><option value="pop">Pop in</option>
    </select></Field>
    <label className="checkbox"><input type="checkbox" checked={!!edit.captionHighlight} onChange={event =>
      change({ captionHighlight: event.target.checked ? '#F5D68C' : null })}/>Highlight timed words</label>
    {edit.captionHighlight && <Field label="Word highlight color"><input type="color" value={edit.captionHighlight}
      onChange={event => change({ captionHighlight: event.target.value })}/></Field>}
    <Field label={`Caption shadow · ${edit.captionShadow ?? 0}px`}><input type="range" min="0" max="8" step="1"
      value={edit.captionShadow ?? 0} onChange={event => change({ captionShadow: Number(event.target.value) })}/></Field>
    <button onClick={() => change({ captionY: 74 })}>Move captions to short-video safe area</button>
  </>;
}
