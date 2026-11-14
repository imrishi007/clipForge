import { type EditDocument, editDuration } from './model';

export type FramingKeyframe = { timeMs: number; x: number; y: number; cut?: boolean };

export function framingAt(edit: EditDocument, timeMs: number) {
  const frames = edit.framingKeyframes ?? [];
  if (!frames.length) return { x: edit.focalX, y: edit.focalY };
  const nextIndex = frames.findIndex(frame => frame.timeMs > timeMs);
  if (nextIndex === 0) return { x: frames[0].x, y: frames[0].y };
  const previous = nextIndex < 0 ? frames[frames.length - 1] : frames[nextIndex - 1];
  const next = frames[nextIndex];
  const fraction = next && !next.cut ? (timeMs - previous.timeMs) / (next.timeMs - previous.timeMs) : 0;
  return { x: previous.x + ((next?.x ?? previous.x) - previous.x) * fraction,
    y: previous.y + ((next?.y ?? previous.y) - previous.y) * fraction };
}

export function sliceFraming(edit: EditDocument, start: number, end: number) {
  const frames = edit.framingKeyframes;
  if (!frames?.length || (start === 0 && end === editDuration(edit))) return frames;
  const kept = frames.filter(frame => frame.timeMs >= start && frame.timeMs <= end)
    .map(frame => ({ ...frame, timeMs: frame.timeMs - start }));
  if (start > frames[0].timeMs && kept[0]?.timeMs !== 0) {
    kept.unshift({ ...framingAt(edit, start), timeMs: 0 });
  }
  const next = frames.find(frame => frame.timeMs > end);
  const last = kept.at(-1);
  if (!last || (next && !next.cut && last.timeMs !== end - start)) {
    kept.push({ ...framingAt(edit, end), timeMs: end - start });
  }
  return kept;
}
