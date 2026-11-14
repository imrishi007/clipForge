import {createStore} from 'zustand/vanilla';
import {defaultEdit,type EditDocument,type Caption,editSchema,editDuration} from './model';
import { framingAt, sliceFraming } from './framing';
import { type SourceSegment, cutFadeGain, timelineSegments } from './segments';
type History={edit:EditDocument;past:EditDocument[];future:EditDocument[];dirty:boolean;load:(e:EditDocument)=>void;change:(patch:Partial<EditDocument>)=>void;undo:()=>void;redo:()=>void;markSaved:(revision:number,snapshot?:EditDocument)=>void};
export const createEditSession=(initial=defaultEdit())=>createStore<History>((set)=>({edit:initial,past:[],future:[],dirty:false,load:edit=>set({edit,past:[],future:[],dirty:false}),change:patch=>set(s=>({edit:{...s.edit,...patch},past:[...s.past.slice(-99),s.edit],future:[],dirty:true})),undo:()=>set(s=>s.past.length?{edit:{...s.past[s.past.length-1],revision:s.edit.revision},past:s.past.slice(0,-1),future:[s.edit,...s.future],dirty:true}:{}),redo:()=>set(s=>s.future.length?{edit:{...s.future[0],revision:s.edit.revision},past:[...s.past,s.edit],future:s.future.slice(1),dirty:true}:{}),markSaved:(revision,snapshot)=>set(s=>({edit:{...s.edit,revision},dirty:!!snapshot&&JSON.stringify(s.edit)!==JSON.stringify(snapshot)}))}));
function sliceCaptions(captions: Caption[], start: number, end: number) {
  return captions.filter(caption => caption.startMs < end && caption.endMs > start).map(caption => {
    const words = caption.words?.filter(word => word.startMs < end && word.endMs > start).map(word => ({
      ...word, startMs: Math.max(start, word.startMs) - start, endMs: Math.min(end, word.endMs) - start,
    }));
    return { ...caption, startMs: Math.max(start, caption.startMs) - start,
      endMs: Math.min(end, caption.endMs) - start, words,
      text: words?.length && words.length !== caption.words?.length ? words.map(word => word.text).join(' ') : caption.text };
  });
}

export function splitEdit(edit: EditDocument, relativeMs: number): [EditDocument, EditDocument] {
  const duration = editDuration(edit);
  if (relativeMs <= 0 || relativeMs >= duration) throw Error('Place the playhead inside the clip to split.');
  const segments = timelineSegments(edit);
  const left = applySourceSegments(edit, segments.filter(s => s.timelineStart < relativeMs).map(s => ({
    startMs: s.startMs, endMs: Math.min(s.endMs, s.startMs + relativeMs - s.timelineStart),
  })));
  const right = applySourceSegments(edit, segments.filter(s => s.timelineEnd > relativeMs).map(s => ({
    startMs: Math.max(s.startMs, s.startMs + relativeMs - s.timelineStart), endMs: s.endMs,
  })));
  return [left, { ...right, revision: 0, captions: right.captions.map(caption => ({ ...caption, id: crypto.randomUUID() })) }];
}

export function trimEdit(edit: EditDocument, start: number, end: number): EditDocument {
  if (edit.sourceSegments?.length) {
    const segments = edit.sourceSegments.map(segment => ({ startMs: Math.max(start, segment.startMs), endMs: Math.min(end, segment.endMs) }))
      .filter(segment => segment.endMs > segment.startMs);
    return applySourceSegments(edit, segments);
  }
  const clipStart = start - edit.sourceInMs;
  const clipEnd = end - edit.sourceInMs;
  return editSchema.parse({ ...edit, sourceInMs: start, sourceOutMs: end,
    framingKeyframes: sliceFraming(edit, clipStart, clipEnd), captions: sliceCaptions(edit.captions, clipStart, clipEnd) });
}

export function applySourceSegments(edit: EditDocument, segments: SourceSegment[]): EditDocument {
  if (!segments.length) throw Error('Keep at least one source segment.');
  if (segments.length > 32) throw Error('Keep at most 32 source segments in one clip.');
  const old = timelineSegments(edit);
  const captions: Caption[] = [];
  const framingKeyframes: NonNullable<EditDocument['framingKeyframes']> = [];
  let offset = 0;
  for (const segment of segments) {
    const owner = old.find(range => range.startMs <= segment.startMs && segment.endMs <= range.endMs);
    if (!owner) throw Error('Each new segment must fit inside an existing source segment.');
    const start = owner.timelineStart + segment.startMs - owner.startMs;
    const end = start + segment.endMs - segment.startMs;
    captions.push(...sliceCaptions(edit.captions, start, end).map(caption => ({
      ...caption, id: captions.some(previous => previous.id === caption.id) ? crypto.randomUUID() : caption.id,
      startMs: caption.startMs + offset, endMs: caption.endMs + offset,
      words: caption.words?.map(word => ({ ...word, startMs: word.startMs + offset, endMs: word.endMs + offset })),
    })));
    const path = [...(sliceFraming(edit, start, end) ?? [])];
    if (path.length) {
      if (path[0].timeMs > 0) path.unshift({ timeMs: 0, ...framingAt(edit, start) });
      // Keep the outgoing side of a boundary on the last frame before the cut.
      const boundary = framingKeyframes.at(-1);
      if (boundary?.timeMs === offset) {
        if ((framingKeyframes.at(-2)?.timeMs ?? -1) < offset - 1) boundary.timeMs -= 1;
        else framingKeyframes.pop();
      }
      framingKeyframes.push(...path.map((frame, index) => ({ ...frame, timeMs: frame.timeMs + offset, cut: index === 0 && offset > 0 || frame.cut })));
    }
    offset += end - start;
  }
  return editSchema.parse({ ...edit, sourceInMs: segments[0].startMs, sourceOutMs: segments[segments.length - 1].endMs,
    sourceSegments: segments.length > 1 ? segments : [], captions, framingKeyframes });
}
function srtTime(ms:number){const h=Math.floor(ms/3600000);const m=Math.floor(ms/60000)%60;const s=Math.floor(ms/1000)%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;}
export function toSrt(captions:Caption[]){return captions.map((c,i)=>`${i+1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text}\n`).join('\n');}
export function parseSrt(text:string,durationMs:number):Caption[]{const rows=text.replace(/^\uFEFF/,'').replace(/\r/g,'').trim().split(/\n\s*\n/);const parse=(t:string)=>{const m=t.match(/^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/);if(!m)throw Error('Invalid SRT timestamp.');return(Number(m[1])*3600+Number(m[2])*60+Number(m[3]))*1000+Number(m[4]);};return rows.filter(Boolean).map(row=>{const lines=row.split('\n');if(/^\d+$/.test(lines[0]))lines.shift();const timing=lines.shift()?.split(/\s+-->\s+/);if(!timing||timing.length!==2)throw Error('Invalid SRT timing line.');const startMs=parse(timing[0]),endMs=parse(timing[1]);if(startMs<0||endMs<=startMs||endMs>durationMs)throw Error('Subtitle times must fit inside the clip.');return{id:crypto.randomUUID(),startMs,endMs,text:lines.join('\n')};});}
export function downloadText(text:string,name:string){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function previewGain(edit: EditDocument, relativeSeconds: number) {
  const duration = editDuration(edit) / 1000;
  const fadeIn = edit.fadeIn ? Math.min(1, relativeSeconds / Math.min(duration, edit.fadeIn)) : 1;
  const fadeOut = edit.fadeOut ? Math.min(1, (duration - relativeSeconds) / Math.min(duration, edit.fadeOut)) : 1;
  return Math.max(0, edit.volume * 10 ** ((edit.loudnessGainDb ?? 0) / 20) * fadeIn * fadeOut * cutFadeGain(edit, relativeSeconds * 1000));
}

export function previewVolume(edit: EditDocument, relativeSeconds: number) {
  return Math.min(1, previewGain(edit, relativeSeconds));
}
