"""Sample small display-oriented frames and turn face tracks into crop positions."""

from dataclasses import dataclass
from functools import lru_cache
from importlib.util import find_spec
from math import hypot
from pathlib import Path
import subprocess
from time import monotonic

from .media import binary
from .schemas import FramingKeyframe


@dataclass
class Sample:
    time_ms: int
    # Normalized center and extent in the displayed source.
    faces: list[tuple[float, float, float, float]]
    cut: bool = False


@lru_cache(maxsize=1)
def face_detector():
    import cv2

    path = Path(cv2.data.haarcascades) / 'haarcascade_frontalface_default.xml'
    classifier = cv2.CascadeClassifier(str(path))
    if classifier.empty():
        raise RuntimeError('The OpenCV frontal-face model is missing.')
    return classifier


def framing_available():
    if not (binary('ffmpeg') and find_spec('cv2')):
        return False
    try:
        face_detector()
        return True
    except (AttributeError, ImportError, OSError, RuntimeError):
        return False


def clamp(value):
    return min(1., max(0., value))


def build_path(samples, source_aspect, output_aspect, fallback):
    crop_w = min(1., output_aspect / source_aspect)
    crop_h = min(1., source_aspect / output_aspect)
    path = []
    primary = None
    last_seen = -1000
    for sample in samples:
        if sample.cut:
            primary = None
        target = fallback
        if sample.faces:
            if primary is None or sample.time_ms - last_seen > 800:
                primary = max(sample.faces, key=lambda face: face[2] * face[3])
            else:
                closest = min(sample.faces, key=lambda face: hypot(face[0] - primary[0], face[1] - primary[1]))
                if hypot(closest[0] - primary[0], closest[1] - primary[1]) < .23:
                    primary = closest
                else:
                    continue
            last_seen = sample.time_ms
            x, y, _, h = primary
            bounds = (min(f[0] - f[2] / 2 for f in sample.faces), max(f[0] + f[2] / 2 for f in sample.faces),
                      min(f[1] - f[3] / 2 for f in sample.faces), max(f[1] + f[3] / 2 for f in sample.faces))
            left, right, top, bottom = bounds
            if right - left < .88 * crop_w and bottom - top < .88 * crop_h:
                x, y = (left + right) / 2, (top + bottom) / 2
            target = (clamp((x - crop_w / 2) / (1 - crop_w)) if crop_w < 1 else fallback[0],
                      clamp((y + h * .2 - crop_h / 2) / (1 - crop_h)) if crop_h < 1 else fallback[1])
        elif not sample.cut and path:
            continue

        if path and not sample.cut:
            previous = path[-1]
            limit = min(.22, (sample.time_ms - previous.timeMs) * .00055)
            target = tuple(old + max(-limit, min(limit, (new - old) * .42))
                           for old, new in zip((previous.x, previous.y), target))
            if max(abs(target[0] - previous.x), abs(target[1] - previous.y)) < .012:
                continue
        path.append(FramingKeyframe(timeMs=sample.time_ms, x=round(target[0], 4), y=round(target[1], 4), cut=sample.cut))
    return path


def compact_path(path, limit=96):
    if len(path) <= limit:
        return path
    protected = {0, len(path) - 1}
    for index, frame in enumerate(path):
        if frame.cut and index:
            protected.update((index - 1, index))
    if len(protected) > limit:
        raise ValueError('Too many scene changes for one framing pass. Use a shorter clip.')
    other = [index for index in range(len(path)) if index not in protected]
    count = limit - len(protected)
    protected.update(other[len(other) * index // count] for index in range(count))
    return [path[index] for index in sorted(protected)]


def track_clip(source, options, metadata, update):
    import cv2
    import numpy as np

    started = monotonic()
    classifier = face_detector()
    duration = options['sourceOutMs'] - options['sourceInMs']
    source_aspect = metadata['width'] / metadata['height']
    sar = (metadata.get('sar') or '').split(':')
    if len(sar) == 2 and all(value.isdigit() and int(value) for value in sar):
        a, b = map(int, sar)
        source_aspect *= b / a if metadata.get('rotation', 0) % 180 else a / b
    width = max(2, round(min(384, 384 * source_aspect)))
    height = max(2, round(min(384, 384 / source_aspect)))
    a, b = map(int, options['ratio'].split(':'))
    args = [binary('ffmpeg'), '-v', 'error', '-nostdin', '-threads', '2', '-filter_threads', '1',
            '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm',
            '-ss', str(options['sourceInMs'] / 1000), '-i', str(source), '-t', str(duration / 1000),
            '-map', '0:v:0', '-an', '-sn', '-vf', f'fps=5:round=up,scale={width}:{height},format=gray',
            '-f', 'rawvideo', 'pipe:1']
    samples = []
    previous = None
    update(0)
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)) as process:
        try:
            while len(raw := process.stdout.read(width * height)) == width * height:
                frame = np.frombuffer(raw, dtype=np.uint8).reshape(height, width)
                scene = cv2.resize(frame, (32, 18), interpolation=cv2.INTER_AREA)
                cut = previous is not None and float(cv2.absdiff(previous, scene).mean()) > 37
                previous = scene
                faces = classifier.detectMultiScale(cv2.equalizeHist(frame), scaleFactor=1.15, minNeighbors=5, minSize=(22, 22))
                time_ms = len(samples) * 200
                if time_ms >= duration:
                    continue
                samples.append(Sample(time_ms, [((x + w / 2) / width, (y + h / 2) / height, w / width, h / height)
                                                for x, y, w, h in faces], cut))
                if len(samples) % 5 == 1:
                    update(time_ms)
            if process.wait(timeout=10) or not samples:
                raise ValueError('FFmpeg could not decode the selected range for framing.')
        finally:
            if process.poll() is None:
                process.kill()

    face_frames = sum(bool(sample.faces) for sample in samples)
    path = compact_path(build_path(samples, source_aspect, a / b, (options['focalX'], options['focalY']))) if face_frames else []
    return {'keyframes': [frame.model_dump() for frame in path], 'faceFrames': face_frames,
            'sampledFrames': len(samples), 'elapsedSeconds': round(monotonic() - started, 3)}


def crop_expression(frames, axis):
    """Use the same piecewise linear interpolation as CSS object-position."""
    def value(frame):
        return format(getattr(frame, axis), '.9g')

    def expression(start, end):
        if end - start == 1:
            frame = frames[start]
            if end == len(frames) or frames[end].cut or value(frame) == value(frames[end]):
                return value(frame)
            following = frames[end]
            return f'{value(frame)}+({value(following)}-{value(frame)})*clip((t*1000-{frame.timeMs})/{following.timeMs-frame.timeMs},0,1)'
        middle = (start + end) // 2
        return f'if(lt(t*1000,{frames[middle].timeMs}),{expression(start, middle)},{expression(middle, end)})'

    return expression(0, len(frames))
