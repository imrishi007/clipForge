"""Local word-timed transcription using a preinstalled multilingual Whisper model."""

from importlib.util import find_spec
import hashlib
import json
import os
from pathlib import Path
import subprocess
from time import monotonic

from .media import binary

LANGUAGES = {'Auto': None, 'English': 'en', 'Hindi': 'hi', 'Hinglish': None, 'Other': None}


def whisper_directory():
    configured = os.environ.get('CLIPFORGE_WHISPER_MODEL')
    return Path(configured).resolve() if configured else None


def transcription_available():
    path = whisper_directory()
    return bool(path and all((path / name).is_file() for name in ('config.json', 'model.bin', 'tokenizer.json'))
                and find_spec('faster_whisper'))


def transcription_limit():
    return max(1, int(os.environ.get('CLIPFORGE_TRANSCRIPTION_MAX_SECONDS', '5400'))) * 1000


def cuda_runtime_ready():
    if os.name != 'nt':
        return True
    from ctypes.util import find_library

    return bool(find_library('cublas64_12'))


def timed_segments(segments, duration_ms, update):
    rows = []
    previous_end = 0
    for segment in segments:
        end = min(duration_ms, round(segment.end * 1000))
        start = max(previous_end, round(segment.start * 1000), 0)
        if end <= start or not segment.text.strip():
            continue
        words = []
        previous_word_end = start
        for word in segment.words or []:
            word_start = max(previous_word_end, round(word.start * 1000))
            word_end = min(end, round(word.end * 1000))
            if word_end > word_start and word.word.strip():
                words.append({'text': word.word.strip(), 'startMs': word_start, 'endMs': word_end})
                previous_word_end = word_end
        rows.append({'id': str(len(rows) + 1), 'startMs': start, 'endMs': end, 'text': segment.text.strip(), 'words': words})
        previous_end = end
        update(end)
    return rows


CHUNK_MS = 5 * 60000
CONTEXT_MS = 4000


def transcription_windows(duration_ms):
    for start in range(0, duration_ms, CHUNK_MS):
        yield start, min(duration_ms, start + CHUNK_MS), max(0, start - CONTEXT_MS), min(duration_ms, start + CHUNK_MS + CONTEXT_MS)


def join_transcript_window(rows, window, segments):
    start, end, offset, _ = window
    for segment in segments:
        if not start <= offset + (segment['startMs'] + segment['endMs']) // 2 < end:
            continue
        lower = max(offset + segment['startMs'], rows[-1]['endMs'] if rows else 0)
        upper = offset + segment['endMs']
        if upper <= lower:
            continue
        words = [{**word, 'startMs': max(lower, offset + word['startMs']), 'endMs': offset + word['endMs']}
                 for word in segment['words'] if offset + word['endMs'] > lower]
        text = segment['text']
        if len(words) != len(segment['words']):
            words = []
        rows.append({'id': str(len(rows) + 1), 'startMs': lower, 'endMs': upper, 'text': text, 'words': words})


def chunk_cache_key(source_hash, language, model_path, device='cpu'):
    model = model_path / 'model.bin'
    stats = model.stat()
    key = f'v1:{source_hash}:{language}:{model.resolve()}:{stats.st_size}:{stats.st_mtime_ns}:{CHUNK_MS}:{CONTEXT_MS}'
    if device != 'cpu':
        key += f':{device}:int8_float16'
    return hashlib.sha256(key.encode()).hexdigest()


def decode_chunk(source, audio_path, start, end):
    ffmpeg = binary('ffmpeg')
    if not ffmpeg:
        raise ValueError('Configure FFmpeg for long-source transcription.')
    process = subprocess.run([ffmpeg, '-v', 'error', '-y', '-nostdin', '-threads', '2', '-protocol_whitelist', 'file,pipe',
                              '-format_whitelist', 'mov,matroska,webm', '-ss', str(start / 1000), '-t', str((end - start) / 1000),
                              '-i', str(source), '-map', '0:a:0', '-ac', '1', '-ar', '16000', str(audio_path)],
                             capture_output=True, timeout=75, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if process.returncode:
        raise ValueError('FFmpeg could not extract audio for the current transcription window.')


def transcribe(source, duration_ms, language, update, cache_dir=None, threads=4, device='cpu'):
    from faster_whisper import WhisperModel

    started = monotonic()
    model_path = whisper_directory()
    update(0)
    model = None

    def transcribe_audio(path):
        nonlocal model
        if model is None:
            model = WhisperModel(str(model_path), device=device, compute_type='int8_float16' if device == 'cuda' else 'int8',
                                 cpu_threads=threads, local_files_only=True)
            if not model.model.is_multilingual:
                raise ValueError('Configure a multilingual Whisper model for English, Hindi and Hinglish.')
        return model.transcribe(str(path), language=LANGUAGES[language], multilingual=language == 'Hinglish',
                                task='transcribe', word_timestamps=True, vad_filter=True, beam_size=1,
                                temperature=0, condition_on_previous_text=False, max_new_tokens=128)

    if duration_ms <= CHUNK_MS and cache_dir is None:
        segments, info = transcribe_audio(source)
        rows = timed_segments(segments, duration_ms, update)
        detected_language = info.language
        reused = 0
    else:
        if cache_dir is None:
            raise ValueError('Configure a work folder for long-source transcription.')
        cache_dir.mkdir(parents=True, exist_ok=True)
        rows, reused = [], 0
        detected_language = None
        audio = cache_dir / 'window.wav'
        try:
            for window in transcription_windows(duration_ms):
                start, end, decode_start, decode_end = window
                update(start)
                path = cache_dir / f'{start}.json'
                chunk = None
                if path.is_file():
                    try:
                        chunk = json.loads(path.read_text(encoding='utf-8'))
                    except (OSError, ValueError):
                        pass
                if chunk is None:
                    if duration_ms > CHUNK_MS:
                        decode_chunk(source, audio, decode_start, decode_end)
                    update(start)
                    segments, info = transcribe_audio(audio if duration_ms > CHUNK_MS else source)
                    chunk = {'language': info.language, 'segments': timed_segments(
                        segments, decode_end - decode_start, lambda at: update(min(end, max(start, decode_start + at))))}
                    pending = path.with_suffix('.partial')
                    pending.write_text(json.dumps(chunk, ensure_ascii=False), encoding='utf-8')
                    pending.replace(path)
                else:
                    reused += 1
                if chunk['segments'] and detected_language is None:
                    detected_language = chunk['language']
                join_transcript_window(rows, window, chunk['segments'])
                update(end)
        finally:
            audio.unlink(missing_ok=True)
    return {'language': detected_language or LANGUAGES[language] or 'und', 'languageMode': language, 'model': model_path.name, 'device': device,
            'elapsedSeconds': round(monotonic() - started, 3), 'cachedChunks': reused, 'revision': 0, 'segments': rows}
