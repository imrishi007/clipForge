"""Detect hard cuts using decoded frames and preserve source timecodes."""

from importlib.util import find_spec
from time import monotonic


def scene_detection_available():
    return bool(find_spec('scenedetect') and find_spec('cv2'))


def detect_scenes(source, duration_ms):
    from scenedetect import ContentDetector, detect

    start = monotonic()
    cuts = detect(str(source), ContentDetector(), start_in_scene=True, backend='pyav')
    spans = []
    for first, last in cuts:
        start_ms = max(0, round(first.seconds * 1000))
        end_ms = min(duration_ms, round(last.seconds * 1000))
        if end_ms > start_ms:
            spans.append({'startMs': start_ms, 'endMs': end_ms})
    if not spans:
        raise ValueError('Scene detection could not decode any source frames.')
    return {'scenes': spans, 'elapsedSeconds': round(monotonic() - start, 3)}
