"""Source-shaped, seek-friendly editing proxies."""

from fractions import Fraction

from .media import binary
from .performance import PROFILES


def preview_spec(metadata, profile):
    width, height = metadata['width'], metadata['height']
    sar = metadata.get('sar') or '1:1'
    try:
        pixels = Fraction(sar.replace(':', '/'))
        if pixels > 0:
            width *= 1 / pixels if metadata.get('rotation', 0) % 180 else pixels
    except (ValueError, ZeroDivisionError):
        pass
    size = PROFILES[profile][0]
    scale = min(1, size / min(width, height), size * 16 / 9 / max(width, height))
    return {'width': max(2, round(width * scale / 2) * 2), 'height': max(2, round(height * scale / 2) * 2),
            'durationMs': metadata['durationMs'], 'size': size, 'key': f"{metadata['hash']}-v2-{size}"}


def preview_arguments(source, output, spec, audio):
    duration = spec['durationMs'] / 1000
    args = [binary('ffmpeg'), '-y', '-hide_banner', '-loglevel', 'warning', '-nostdin', '-threads', '2',
            '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm',
            '-i', str(source), '-t', str(duration), '-map', '0:V:0',
            '-vf', f"scale={spec['width']}:{spec['height']}:flags=fast_bilinear,setsar=1,fps=30,tpad=stop_mode=clone:stop=60",
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-g', '15', '-sc_threshold', '0',
            '-pix_fmt', 'yuv420p', '-threads', '2']
    if audio:
        args += ['-map', '0:a:0', '-af', 'aresample=48000,apad=pad_len=96000', '-c:a', 'aac', '-b:a', '96k']
    return args + ['-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', str(output)]


def validate_preview(metadata, spec, audio):
    if metadata['codec'] != 'h264' or (metadata['width'], metadata['height']) != (spec['width'], spec['height']):
        raise ValueError('Proxy geometry or video codec did not match the preview settings.')
    if abs(metadata['durationMs'] - spec['durationMs']) > 100:
        raise ValueError('Proxy duration did not match the source timeline.')
    if audio and (not metadata['hasAudio'] or metadata['audioStreams'][0]['codec'] != 'aac'):
        raise ValueError('Proxy is missing its AAC audio track.')
