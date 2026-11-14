import {describe,it,expect} from 'vitest';
import {defaultEdit, editDuration} from '../../lib/model';
import {applySourceSegments,createEditSession,splitEdit,trimEdit,toSrt,parseSrt,previewVolume} from '../../lib/editing';
import { framingAt } from '../../lib/framing';
import { excludeSourceRanges, sourceAt, timelineAt } from '../../lib/segments';

it('removes a source gap and rebases captions, crop and split onto the assembled timeline', () => {
  const edit = { ...defaultEdit(), sourceInMs: 1000, sourceOutMs: 7000, captions: [
    { id: 'later', text: 'Later', startMs: 4200, endMs: 5200 },
  ], framingKeyframes: [{ timeMs: 0, x: 0, y: .5 }, { timeMs: 6000, x: 1, y: .5 }] };
  const next = applySourceSegments(edit, excludeSourceRanges(edit, [{ startMs: 3000, endMs: 5000 }]));
  expect(editDuration(next)).toBe(4000);
  expect(sourceAt(next, 2000)).toBe(5000);
  expect(timelineAt(next, 3400)).toEqual({ position: 2000, skipTo: 5000 });
  expect(next.captions[0].startMs).toBe(2200);
  expect(framingAt(next, 1999).x).toBeCloseTo(1 / 3);
  expect(framingAt(next, 2000).x).toBeCloseTo(2 / 3);
  const [left, right] = splitEdit(next, 2000);
  expect(left.sourceOutMs).toBe(3000);
  expect(right.sourceInMs).toBe(5000);
  expect(right.captions[0].startMs).toBe(200);
});

it('keeps the original framing list immutable when a path starts after the clip begins', () => {
  const edit = { ...defaultEdit(), framingKeyframes: [{ timeMs: 500, x: .25, y: .5 }] };
  const updated = applySourceSegments(edit, [{ startMs: edit.sourceInMs, endMs: edit.sourceOutMs }]);
  expect(updated.framingKeyframes?.[0].timeMs).toBe(0);
  expect(edit.framingKeyframes).toEqual([{ timeMs: 500, x: .25, y: .5 }]);
});

it('slices verified word timings along with a caption', () => {
  const original = { ...defaultEdit(), captions: [{ id: 'word-cue', text: 'नमस्ते friend', startMs: 200, endMs: 2000,
    words: [{ text: 'नमस्ते', startMs: 200, endMs: 900 }, { text: 'friend', startMs: 1000, endMs: 2000 }] }] };
  const [, right] = splitEdit(original, 1050);
  expect(right.captions[0]).toMatchObject({ text: 'friend', startMs: 0, endMs: 950,
    words: [{ text: 'friend', startMs: 0, endMs: 950 }] });
  expect(trimEdit(original, 400, 1200).captions[0].words?.map(word => [word.startMs, word.endMs])).toEqual([[0, 500], [600, 800]]);
});

it('preserves the framing path at trim and split boundaries, including hard cuts', () => {
  const edit = { ...defaultEdit(), sourceInMs: 1000, sourceOutMs: 6000, framingKeyframes: [
    { timeMs: 0, x: 0, y: .5 }, { timeMs: 2000, x: 1, y: .5 },
    { timeMs: 4000, x: .2, y: .5, cut: true },
  ] };
  expect(framingAt(edit, 1000)).toEqual({ x: .5, y: .5 });
  expect(framingAt(edit, 3999).x).toBe(1);
  expect(framingAt(edit, 4000).x).toBe(.2);
  const trimmed = trimEdit(edit, 2000, 5500);
  expect(framingAt(trimmed, 0).x).toBe(.5);
  expect(framingAt(trimmed, 2999).x).toBe(1);
  expect(framingAt(trimmed, 3000).x).toBe(.2);
  const [left, right] = splitEdit(edit, 4000);
  expect(framingAt(left, 3999).x).toBe(1);
  expect(framingAt(right, 0).x).toBe(.2);
});
it('keeps changes made during an autosave dirty',()=>{const editSession=createEditSession();const snapshot=editSession.getState().edit;editSession.getState().change({focalX:.7});editSession.getState().markSaved(1,snapshot);expect(editSession.getState().dirty).toBe(true);expect(editSession.getState().edit.revision).toBe(1);});
describe('non-destructive editor',()=>{it('undoes and redoes without reverting server revision',()=>{const editSession=createEditSession();editSession.getState().change({focalX:.2});editSession.getState().markSaved(3);editSession.getState().undo();expect(editSession.getState().edit.focalX).toBe(.5);expect(editSession.getState().edit.revision).toBe(3);editSession.getState().redo();expect(editSession.getState().edit.focalX).toBe(.2);});it('splits captions into clip-relative spans',()=>{const e={...defaultEdit(),sourceInMs:2000,sourceOutMs:8000,captions:[{id:'x',startMs:1000,endMs:5000,text:'दो पल'}]};const [l,r]=splitEdit(e,3000);expect(l.sourceOutMs).toBe(5000);expect(r.sourceInMs).toBe(5000);expect(l.captions[0].endMs).toBe(3000);expect(r.captions[0].startMs).toBe(0);expect(r.captions[0].endMs).toBe(2000);expect(()=>splitEdit(e,0)).toThrow();});it('re-times captions when trimming source in',()=>{const e={...defaultEdit(),captions:[{id:'x',startMs:2000,endMs:6000,text:'Hi'}]};expect(trimEdit(e,3000,7000).captions[0]).toMatchObject({startMs:0,endMs:3000});});it('roundtrips Hindi SRT and rejects outside timing',()=>{const c=[{id:'x',startMs:1234,endMs:5432,text:'नमस्ते\nHello'}];expect(parseSrt(toSrt(c),6000)[0]).toMatchObject({startMs:1234,endMs:5432,text:c[0].text});expect(()=>parseSrt(toSrt(c),2000)).toThrow();});it('previews fades with bounded element volume',()=>{expect(previewVolume({...defaultEdit(),fadeIn:2,volume:1},1)).toBe(.5);expect(previewVolume({...defaultEdit(),fadeOut:2},11)).toBe(.5);});});
