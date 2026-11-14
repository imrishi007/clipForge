"""Generate the original demo and optional short integration fixtures."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def encode(output: Path, video: str, duration: int, audio: str | None = None, filters: str | None = None):
    ffmpeg = os.environ.get('FFMPEG_BINARY') or shutil.which('ffmpeg')
    if not ffmpeg:
        raise SystemExit('Install FFmpeg or set FFMPEG_BINARY to the executable path.')
    output.parent.mkdir(parents=True, exist_ok=True)
    args = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', video]
    if audio:
        args += ['-f', 'lavfi', '-i', audio, '-c:a', 'aac', '-b:a', '64k']
    if filters:
        args += ['-vf', filters, '-filter_threads', '2']
    temp = output.with_suffix('.partial.mp4')
    try:
        subprocess.run([*args, '-t', str(duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
                        '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(temp)], check=True)
        temp.replace(output)
    finally:
        temp.unlink(missing_ok=True)


def demo():
    # Draw the sample poster's sunset palette and layers, with slow parallax.
    sun = 'lt(hypot(X-210-12*sin(T/6),Y-59-2*T),32)'
    far = 'gt(Y,103+13*sin(X/42+T/7))'
    middle = 'gt(Y,135+11*sin(X/36+T/5+1.7))'
    near = 'gt(Y,159+7*sin(X/33+T/4+2.5))'
    rgb = [(210, 176, 140), (241, 218, 187), (172, 136, 105), (120, 107, 85), (65, 75, 70)]
    channels = []
    for index, channel in enumerate('rgb'):
        sky, light, hill, ridge, foreground = (color[index] for color in rgb)
        channels.append(f"{channel}='if({near},{foreground},if({middle},{ridge},if({far},{hill},if({sun},{light},{sky}))))'")
    filters = f'format=gbrp,geq={":".join(channels)},scale=1280:720:flags=bicubic'
    audio = 'aevalsrc=0.025*sin(2*PI*196*t)*sin(PI*t/12)^2:s=48000'
    encode(ROOT / 'public/demo.mp4', 'nullsrc=s=320x180:r=24', 12, audio, filters)


def fixtures():
    output = ROOT / 'tests/fixtures'
    encode(output / 'landscape.mp4', 'testsrc2=size=640x360:rate=30', 44, 'sine=frequency=440:sample_rate=48000')
    encode(output / 'portrait-silent.mp4', 'testsrc2=size=360x640:rate=30', 8)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo-only', action='store_true')
    args = parser.parse_args()
    demo()
    if not args.demo_only:
        fixtures()
