import re
from fractions import Fraction
from pathlib import Path
from .schemas import EditDocument
from .media import binary
from .framing import crop_expression
from .performance import encoder_options
from .audio import RUMBLE_FILTER


def ass_time(ms):
    centiseconds = round(ms/10)
    return f'{centiseconds//360000}:{centiseconds//6000%60:02d}:{centiseconds//100%60:02d}.{centiseconds%100:02d}'


def srt_time(ms):
    return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'


def srt_document(edit: EditDocument):
    return '\n\n'.join(f'{i+1}\n{srt_time(c.startMs)} --> {srt_time(c.endMs)}\n{c.text}' for i, c in enumerate(edit.captions))+'\n'


def ass_color(color):
    return color[5:7] + color[3:5] + color[1:3]


def ass_text(text):
    text = text.replace('\\', '＼').replace('{', '｛').replace('}', '｝').replace('\r', '').replace('\n', '\\N')
    return ''.join(ch for ch in text if ord(ch) >= 32)


def ass_document(edit: EditDocument):
    a, b = map(int, edit.ratio.split(':'))
    height = round(1080*b/a)
    color = '&H00' + ass_color(edit.color)
    lines = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', f'PlayResY: {height}', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding', f'Style: Default,{edit.fontFamily},{edit.fontSize},{color},{color},&H00000000,&H80000000,{-1 if edit.bold else 0},0,0,0,100,100,0,0,{3 if edit.captionBackground else 1},{edit.outline},0,5,86,86,30,1', '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    for c in edit.captions:
        boundaries = {c.startMs, c.endMs}
        if c.words and edit.captionHighlight:
            boundaries.update(t for word in c.words for t in (word.startMs, word.endMs))
        times = sorted(boundaries)
        for start, end in zip(times, times[1:]):
            if ass_time(start) == ass_time(end):
                continue
            text = ass_text(c.text)
            active = next((word for word in c.words if word.startMs <= start < word.endMs), None)
            if active and edit.captionHighlight:
                highlight = f'{{\\1c&H{ass_color(edit.captionHighlight)}&}}'
                restore = f'{{\\1c&H{ass_color(edit.color)}&}}'
                tokens = iter(c.words)
                text = re.sub(r'\S+', lambda token: highlight + ass_text(token[0]) + restore
                              if next(tokens) is active else ass_text(token[0]), c.text.replace('\r', '')).replace('\n', '\\N')
            tags = f'\\pos(540,{round(height*edit.captionY/100)})'
            if edit.captionShadow:
                tags += f'\\shad{edit.captionShadow}'
            # Clip-relative transitions retain cue timing across word highlight events.
            if edit.captionAnimation == 'fade':
                fade = min(140, (c.endMs - c.startMs) // 2)
                tags += f'\\fade(255,0,255,{c.startMs-start},{c.startMs-start+fade},{c.endMs-start-fade},{c.endMs-start})'
            elif edit.captionAnimation == 'pop' and start - c.startMs < 160:
                scale = 88 + 12 * (start - c.startMs) / 160
                tags += f'\\fscx{scale:g}\\fscy{scale:g}\\t(0,{160-start+c.startMs},\\fscx100\\fscy100)'
            lines.append(f'Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{{{tags}}}{text}')
    return '\n'.join(lines)+'\n'


def segment_filters(edit, has_audio):
    segments = edit.sourceSegments
    count = len(segments)
    parts = [f'[0:v:0]split={count}' + ''.join(f'[v{i}]' for i in range(count))]
    if has_audio:
        parts.append(f'[0:a:0]asplit={count}' + ''.join(f'[a{i}]' for i in range(count)))
    streams = []
    for index, segment in enumerate(segments):
        start, end = (f'{(ms - edit.sourceInMs) / 1000:.3f}' for ms in (segment.startMs, segment.endMs))
        duration = (segment.endMs - segment.startMs) / 1000
        fade = min(edit.cutFadeMs / 1000, duration / 2)
        effects = []
        if fade and index:
            effects.append(f't=in:st=0:d={fade:.6f}')
        if fade and index < count - 1:
            effects.append(f't=out:st={duration-fade:.6f}:d={fade:.6f}')
        video_fades = ''.join(f',fade={effect}' for effect in effects)
        parts.append(f'[v{index}]trim=start={start}:end={end},setpts=PTS-STARTPTS{video_fades}[vcut{index}]')
        streams.append(f'[vcut{index}]')
        if has_audio:
            audio_fades = ''.join(f',afade={effect}' for effect in effects)
            parts.append(f'[a{index}]atrim=start={start}:end={end},asetpts=PTS-STARTPTS{audio_fades}[acut{index}]')
            streams.append(f'[acut{index}]')
    parts.append(''.join(streams) + f'concat=n={count}:v=1:a={int(has_audio)}[assembled]' + ('[assembled_audio]' if has_audio else ''))
    return parts


def render_arguments(source: Path, output: Path, edit: EditDocument, has_audio: bool, source_fps: str | None = None,
                     pad_to_duration: bool = False, threads: int | None = None, encoder: str = 'libx264'):
    ffmpeg = binary('ffmpeg')
    if not ffmpeg:
        raise RuntimeError('FFmpeg is not installed. Set FFMPEG_BINARY or add it to PATH.')
    width, height = edit.dimensions
    # FFmpeg autorotates input. Normalize sample aspect before display-space framing.
    filters = ['scale=trunc(iw*sar/2)*2:ih', 'setsar=1']
    if edit.cropMode == 'fill':
        filters.append(f'scale={width}:{height}:force_original_aspect_ratio=increase')
        if edit.framingKeyframes:
            x = crop_expression(edit.framingKeyframes, 'x')
            y = crop_expression(edit.framingKeyframes, 'y')
            filters += ['setpts=PTS-STARTPTS', f"crop={width}:{height}:x='(iw-ow)*({x})':y='(ih-oh)*({y})'"]
        else:
            filters.append(f'crop={width}:{height}:(iw-ow)*{edit.focalX}:(ih-oh)*{edit.focalY}')
    else:
        # Fit using even dimensions, including on FFmpeg builds without force_divisible_by.
        fit = f'min({width}/iw,{height}/ih)'
        filters += [f"scale='max(2,trunc(iw*{fit}/2)*2)':'max(2,trunc(ih*{fit}/2)*2)'",
                    f'pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black']
    if edit.zoomPercent > 100:
        zoom_width = round(width * 50 / edit.zoomPercent) * 2
        zoom_height = round(height * 50 / edit.zoomPercent) * 2
        filters += [f'crop={zoom_width}:{zoom_height}', f'scale={width}:{height}']
    if edit.saturation != 1:
        filters.append(f'eq=saturation={edit.saturation}')
    filters += ['setsar=1', 'setpts=PTS-STARTPTS']
    if pad_to_duration:
        filters.append('tpad=stop_mode=clone:stop=-1')
    if edit.captions:
        # Relative filename avoids Windows drive-colon escaping in filter expressions.
        filters.append('ass=filename=captions.ass')
    args = [ffmpeg, '-y', '-hide_banner', '-loglevel', 'warning', '-nostdin', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-ss', f'{edit.sourceInMs/1000:.6f}', '-i', str(source), '-t', f'{edit.duration:.6f}']
    if threads is not None:
        args[6:6] = ['-threads', str(threads), '-filter_threads', str(min(threads, 2))]
    fades = ['asetpts=PTS-STARTPTS', f'volume={edit.volume}']
    if edit.reduceRumble:
        fades.append(RUMBLE_FILTER)
    if edit.loudnessGainDb:
        fades.append(f'volume={edit.loudnessGainDb}dB')
    if edit.fadeIn:
        fades.append(f'afade=t=in:st=0:d={min(edit.fadeIn, edit.duration)}')
    if edit.fadeOut:
        fade = min(edit.fadeOut, edit.duration)
        fades.append(f'afade=t=out:st={edit.duration-fade}:d={fade}')
    if pad_to_duration:
        fades.append('apad')
    if len(edit.sourceSegments) > 1:
        parts = segment_filters(edit, has_audio)
        parts.append('[assembled]' + ','.join(filters) + '[video]')
        if has_audio:
            parts.append('[assembled_audio]' + ','.join(fades) + '[audio]')
        args += ['-filter_complex_threads', '2', '-filter_complex', ';'.join(parts), '-map', '[video]']
        if has_audio:
            args += ['-map', '[audio]']
    else:
        args += ['-map', '0:v:0', '-vf', ','.join(filters)]
        if has_audio:
            args += ['-map', '0:a:0', '-af', ','.join(fades)]
    fps = str(edit.fps)
    if edit.preserveSourceFps and source_fps and re.fullmatch(r'\d{1,9}/\d{1,9}', source_fps):
        numerator, denominator = map(int, source_fps.split('/'))
        if denominator and 1 <= Fraction(numerator, denominator) <= 120:
            fps = source_fps
    args += ['-c:v', encoder, *encoder_options(encoder, edit.quality), '-pix_fmt', 'yuv420p' if encoder == 'libx264' else 'nv12',
             '-r', fps, '-threads', str(threads or 2)]
    if has_audio:
        args += ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000']
    else:
        args.append('-an')
    return args+['-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', str(output)]


def validate_output(metadata, edit: EditDocument, has_audio: bool, size: int):
    if size <= 0:
        raise ValueError('Renderer produced an empty file')
    if (metadata['width'], metadata['height']) != edit.dimensions:
        raise ValueError('Rendered geometry does not match the edit')
    if abs(metadata['durationMs']-edit.duration*1000) > 250:
        raise ValueError('Rendered duration differs from requested boundaries by more than 250 ms')
    if metadata.get('codec') != 'h264':
        raise ValueError('Output is not H.264')
    if has_audio and (not metadata['hasAudio'] or metadata.get('audioStreams', [{}])[0].get('codec') != 'aac'):
        raise ValueError('Expected AAC source audio is missing')


def safe_filename(title, id):
    stem = re.sub(r'[^A-Za-z0-9_-]+', '-', title).strip('-')[:70] or 'clip'
    return f'{stem}-{id[:8]}.mp4'
