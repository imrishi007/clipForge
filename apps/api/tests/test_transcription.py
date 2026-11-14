import os
from pathlib import Path
from types import SimpleNamespace
import time

import pytest

from apps.api import analysis
from apps.api import transcription as engine
from apps.api.database import DATA_DIR, MediaRow, Session
from apps.api.transcription import timed_segments


def test_long_source_windows_recover_completed_chunks_and_rebase_words(tmp_path, monkeypatch):
    import sys

    assert len(list(engine.transcription_windows(5400000))) == 18
    monkeypatch.setattr(engine, 'CHUNK_MS', 10000)
    monkeypatch.setattr(engine, 'CONTEXT_MS', 1000)
    monkeypatch.setattr(engine, 'whisper_directory', lambda: tmp_path)
    decoded = []

    def decode(source, path, start, end):
        decoded.append((start, end))
        path.touch()

    class Model:
        model = SimpleNamespace(is_multilingual=True)

        def transcribe(self, path, **kwargs):
            word = SimpleNamespace(start=2, end=3, word=' नमस्ते')
            return iter([SimpleNamespace(start=2, end=3, text='नमस्ते', words=[word])]), SimpleNamespace(language='hi')

    monkeypatch.setitem(sys.modules, 'faster_whisper', SimpleNamespace(WhisperModel=lambda *args, **kwargs: Model()))
    monkeypatch.setattr(engine, 'decode_chunk', decode)
    cache = tmp_path / 'cache'

    def cancel(at):
        if at >= 10000:
            raise InterruptedError('Cancelled after first chunk')

    with pytest.raises(InterruptedError):
        engine.transcribe(tmp_path / 'source.mp4', 25000, 'Hindi', cancel, cache)
    assert (cache / '0.json').is_file() and not (cache / 'window.wav').exists()
    result = engine.transcribe(tmp_path / 'source.mp4', 25000, 'Hindi', lambda _: None, cache)
    assert decoded == [(0, 11000), (9000, 21000), (19000, 25000)]
    assert result['cachedChunks'] == 1
    assert [segment['startMs'] for segment in result['segments']] == [2000, 11000, 21000]
    assert result['segments'][-1]['words'][0] == {'text': 'नमस्ते', 'startMs': 21000, 'endMs': 22000}


def test_short_cached_transcript_does_not_reload_model(tmp_path, monkeypatch):
    import sys

    monkeypatch.setattr(engine, 'whisper_directory', lambda: tmp_path)
    loads = []

    class Model:
        model = SimpleNamespace(is_multilingual=True)

        def __init__(self, path, **kwargs):
            loads.append(kwargs)

        def transcribe(self, path, **kwargs):
            return iter([SimpleNamespace(start=1, end=2, text='Hello', words=[])]), SimpleNamespace(language='en')

    monkeypatch.setitem(sys.modules, 'faster_whisper', SimpleNamespace(WhisperModel=Model))
    source = tmp_path / 'source.mp4'
    first = engine.transcribe(source, 3000, 'English', lambda _: None, tmp_path / 'cache', threads=2)
    second = engine.transcribe(source, 3000, 'English', lambda _: None, tmp_path / 'cache', threads=2)
    assert first['segments'] == second['segments'] and second['cachedChunks'] == 1
    assert len(loads) == 1 and loads[0]['cpu_threads'] == 2 and loads[0]['compute_type'] == 'int8'


def test_cuda_runtime_failure_retries_same_model_on_cpu(tmp_path, monkeypatch):
    monkeypatch.setenv('CLIPFORGE_WHISPER_DEVICE', 'cuda')
    monkeypatch.setattr(analysis, 'cuda_runtime_ready', lambda: True)
    monkeypatch.setattr(analysis, 'whisper_directory', lambda: tmp_path)
    (tmp_path / 'model.bin').touch()
    monkeypatch.setattr(analysis, 'get_job', lambda _: {})
    noted = []
    monkeypatch.setattr(analysis, 'patch_job', lambda _, **fields: noted.append(fields))
    monkeypatch.setattr(analysis, 'write_result', lambda *args: None)
    attempted = []

    def transcribe(*args, device, threads):
        attempted.append((device, threads))
        if device == 'cuda':
            raise RuntimeError('GPU unavailable')
        return {'device': device}

    monkeypatch.setattr(analysis, 'transcribe', transcribe)
    job = {'type': 'transcription', 'durationMs': 1000, 'sourceHash': 'source', 'language': 'Auto', 'performanceProfile': 'lite'}
    analysis.run_analysis('id', job, tmp_path / 'source.mp4', SimpleNamespace(stopping=SimpleNamespace(is_set=lambda: False)))
    assert [device for device, _ in attempted] == ['cuda', 'cpu'] and attempted[0][1] == attempted[1][1] <= 2
    assert any('GPU unavailable' in row.get('logs', []) for row in noted)
    assert noted[-1]['status'] == 'succeeded'


@pytest.mark.skipif(os.environ.get('CLIPFORGE_CHUNK_E2E') != '1', reason='Opt-in local model and FFmpeg chunk test')
def test_real_chunk_extraction_and_cached_replay(tmp_path, monkeypatch):
    import psutil
    from apps.api.media import probe

    monkeypatch.setattr(engine, 'CHUNK_MS', 30000)
    source = Path(os.environ['CLIPFORGE_SPEECH_FIXTURES']) / 'english.webm'
    duration = probe(source)['durationMs']
    progress = []
    peak = 0
    process = psutil.Process()

    def update(at):
        nonlocal peak
        progress.append(at)
        peak = max(peak, process.memory_info().rss)

    path = tmp_path / 'cache'
    first = engine.transcribe(source, duration, 'English', update, path)
    second = engine.transcribe(source, duration, 'English', lambda _: None, path)
    assert first['segments'] == second['segments'] and first['cachedChunks'] == 0 and second['cachedChunks'] == 3
    assert progress == sorted(progress) and progress[-1] == duration
    assert first['segments'][-1]['startMs'] > 60000
    assert all(row['startMs'] <= word['startMs'] < word['endMs'] <= row['endMs']
               for row in first['segments'] for word in row['words'])
    print(f'{len(first["segments"])} cues across 3 real windows, {first["elapsedSeconds"]}s cold / '
          f'{second["elapsedSeconds"]}s cached, sampled API RSS {peak/2**20:.1f} MiB')


def test_word_timings_stay_within_source_and_segment():
    segments = [SimpleNamespace(start=.5, end=2, text=' नमस्ते friend ', words=[
        SimpleNamespace(start=.4, end=1.1, word=' नमस्ते'),
        SimpleNamespace(start=1, end=2.1, word=' friend'),
    ])]
    updates = []
    assert timed_segments(segments, 1800, updates.append) == [
        {'id': '1', 'startMs': 500, 'endMs': 1800, 'text': 'नमस्ते friend', 'words': [
            {'startMs': 500, 'endMs': 1100, 'text': 'नमस्ते'}, {'startMs': 1100, 'endMs': 1800, 'text': 'friend'},
        ]},
    ]
    assert updates == [1800]


def test_transcript_endpoint_handles_missing_model_and_audio(client, monkeypatch):
    project_id = client.post('/api/projects', json={'title': 'Interview'}).json()['id']
    route = f'/api/projects/{project_id}/transcript'
    assert client.get(route).status_code == 409
    path = DATA_DIR / 'silent-transcript.mp4'
    path.write_bytes(b'fixture')
    with Session() as db:
        db.add(MediaRow(id='transcript-media', project_id=project_id, data={
            'path': path.name, 'durationMs': 8000, 'hasAudio': False, 'hash': 'fixture',
        }))
        db.commit()
    monkeypatch.setattr(analysis, 'transcription_available', lambda: False)
    assert client.post(route, json={}).status_code == 503
    monkeypatch.setattr(analysis, 'transcription_available', lambda: True)
    assert client.post(route, json={}).status_code == 422


@pytest.mark.parametrize(('filename', 'language'), [('hindi.webm', 'Hindi'), ('english.webm', 'English'), ('hindi.webm', 'Hinglish')])
def test_transcribes_real_speech_video(client, filename, language):
    folder = os.environ.get('CLIPFORGE_SPEECH_FIXTURES')
    if not folder:
        pytest.skip('Set CLIPFORGE_SPEECH_FIXTURES to the authorized speech videos.')
    import psutil

    process = psutil.Process()
    started = time.perf_counter()
    before_rss = peak_rss = process.memory_info().rss
    project_id = client.post('/api/projects', json={'title': language}).json()['id']
    with (Path(folder) / filename).open('rb') as source:
        upload = client.post(f'/api/projects/{project_id}/media', files={'file': (filename, source, 'video/webm')})
    assert upload.status_code == 201, upload.text
    route = f'/api/projects/{project_id}/transcript'
    queued = client.post(route, json={'language': language})
    assert queued.status_code == 202, queued.text
    job_url = f'/api/jobs/{queued.json()["id"]}'
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        job = client.get(job_url).json()
        peak_rss = max(peak_rss, process.memory_info().rss)
        if job['status'] in {'succeeded', 'failed', 'cancelled'}:
            break
        time.sleep(.2)
    assert job['status'] == 'succeeded', job
    result = client.get(route).json()['transcript']
    words = [word for segment in result['segments'] for word in segment['words']]
    assert len(words) >= 25
    assert all(0 <= word['startMs'] < word['endMs'] <= upload.json()['durationMs'] for word in words)
    if language == 'English':
        assert result['language'] == 'en'
    else:
        assert any('\u0900' <= char <= '\u097f' for row in result['segments'] for char in row['text'])
    first = result['segments'][0]
    corrected = 'Checked transcript' if language == 'English' else 'जाँचा गया प्रतिलेख'
    edits = {'revision': 0, 'changes': {first['id']: corrected}}
    saved = client.put(route, json=edits)
    assert saved.status_code == 200, saved.text
    row = saved.json()['segments'][0]
    assert (row['text'], row['words'], row['startMs'], row['endMs']) == (corrected, [], first['startMs'], first['endMs'])
    assert client.put(route, json=edits).status_code == 409
    srt = client.get(route + '/subtitles')
    assert srt.status_code == 200 and corrected in srt.text and ' --> ' in srt.text
    print(f'{language}: {len(words)} words; model {result["elapsedSeconds"]}s; '
          f'API elapsed {time.perf_counter()-started:.2f}s; RSS {before_rss/2**20:.1f} -> {peak_rss/2**20:.1f} MiB')
