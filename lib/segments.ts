import { type EditDocument, editDuration } from './model';

export type SourceSegment = { startMs: number; endMs: number };

export function sourceSegments(edit: EditDocument): SourceSegment[] {
  return edit.sourceSegments?.length ? edit.sourceSegments : [{ startMs: edit.sourceInMs, endMs: edit.sourceOutMs }];
}

export function timelineSegments(edit: EditDocument) {
  let offset = 0;
  return sourceSegments(edit).map(segment => {
    const timelineStart = offset;
    offset += segment.endMs - segment.startMs;
    return { ...segment, timelineStart, timelineEnd: offset };
  });
}

export function sourceAt(edit: EditDocument, timelineMs: number) {
  const segments = timelineSegments(edit);
  const segment = segments.find(range => timelineMs < range.timelineEnd) ?? segments[segments.length - 1];
  return Math.min(segment.endMs, segment.startMs + Math.max(0, timelineMs - segment.timelineStart));
}

export function timelineAt(edit: EditDocument, sourceMs: number) {
  for (const segment of timelineSegments(edit)) {
    if (sourceMs < segment.startMs) return { position: segment.timelineStart, skipTo: segment.startMs };
    if (sourceMs < segment.endMs) return { position: segment.timelineStart + sourceMs - segment.startMs };
  }
  return { position: editDuration(edit) };
}

export function cutFadeGain(edit: EditDocument, position: number) {
  if (!edit.cutFadeMs || !edit.sourceSegments || edit.sourceSegments.length < 2) return 1;
  const segments = timelineSegments(edit);
  const index = segments.findIndex(segment => position < segment.timelineEnd);
  if (index < 0) return 1;
  const segment = segments[index];
  const fade = Math.min(edit.cutFadeMs, (segment.timelineEnd - segment.timelineStart) / 2);
  return Math.max(0, Math.min(1, index > 0 ? (position - segment.timelineStart) / fade : 1,
    index < segments.length - 1 ? (segment.timelineEnd - position) / fade : 1));
}

export function excludeSourceRanges(edit: EditDocument, exclusions: SourceSegment[]) {
  return sourceSegments(edit).flatMap(segment => {
    const kept: SourceSegment[] = [];
    let start = segment.startMs;
    for (const exclusion of exclusions) {
      if (exclusion.endMs <= start || exclusion.startMs >= segment.endMs) continue;
      if (exclusion.startMs > start) kept.push({ startMs: start, endMs: exclusion.startMs });
      start = exclusion.endMs;
    }
    if (start < segment.endMs) kept.push({ startMs: start, endMs: segment.endMs });
    return kept;
  });
}
