"""Bounded PCM waveform and loudness analysis for editor audio controls."""

from array import array
import json
from math import isfinite
import re
import subprocess
import sys

from .media import binary

RUMBLE_FILTER = 'highpass=f=85:p=2:t=q:w=0.707107'


def audio_command(source, start, end):
    ffmpeg = binary('ffmpeg')
    if not ffmpeg:
        raise RuntimeError('Configure FFmpeg to analyze source audio.')
    return [ffmpeg, '-hide_banner', '-nostdin', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', '-protocol_whitelist', 'file,pipe',
            '-format_whitelist', 'mov,matroska,webm', '-ss', str(start / 1000),
            '-t', str((end - start) / 1000), '-i', str(source)]


def analyze(args):
    result = subprocess.run(args, capture_output=True, timeout=25, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('FFmpeg could not analyze the selected audio.')
    return result


def waveform(source, start, end):
    result = analyze([*audio_command(source, start, end), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'])
    samples = array('h', result.stdout)
    if sys.byteorder != 'little':
        samples.byteswap()
    peaks = [0.] * 320
    # Buckets use the requested source duration, including any silent tail.
    count = max(1, (end - start) * 8)
    for index, sample in enumerate(samples):
        bucket = min(319, index * 320 // count)
        peaks[bucket] = max(peaks[bucket], abs(sample) / 32768)
    return [round(peak, 4) for peak in peaks]


def loudness_gain(source, edit):
    filter_chain = []
    if len(edit.sourceSegments) > 1:
        split, trimmed = [], []
        for i, segment in enumerate(edit.sourceSegments):
            start = (segment.startMs - edit.sourceInMs) / 1000
            end = (segment.endMs - edit.sourceInMs) / 1000
            split.append(f'[a{i}]')
            filter_chain.append(f'[a{i}]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[t{i}]')
            trimmed.append(f'[t{i}]')
        filter_chain = [f'[0:a:0]asplit={len(split)}'+''.join(split), *filter_chain,
                        ''.join(trimmed) + f'concat=n={len(trimmed)}:v=0:a=1[mix]']
    meter = 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json'
    if edit.reduceRumble:
        meter = f'{RUMBLE_FILTER},{meter}'
    filters = (['-filter_complex', ';'.join([*filter_chain, f'[mix]{meter}[out]']), '-map', '[out]']
               if filter_chain else ['-map', '0:a:0', '-af', meter])
    args = audio_command(source, edit.sourceInMs, edit.sourceOutMs)
    result = analyze([*args, *filters, '-vn', '-f', 'null', '-'])
    report = re.search(r'\{\s*"input_i".*?\}', result.stderr.decode('utf-8', errors='replace'), re.S)
    if not report:
        raise ValueError('This FFmpeg build could not measure integrated loudness.')
    metrics = json.loads(report[0])
    measured, peak = float(metrics['input_i']), float(metrics['input_tp'])
    if not (isfinite(measured) and isfinite(peak)):
        raise ValueError('There is insufficient audible material for loudness measurement.')
    gain = max(-24, min(24, -16 - measured, -1.5 - peak))
    return {'gainDb': round(gain, 2), 'loudnessLufs': measured, 'truePeakDb': peak}
