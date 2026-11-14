import os
from pathlib import Path
import time

import pytest

from apps.api.highlights import candidate_windows, local_runtime, ranked_picks
from apps.api.database import Session, ClipRow
from apps.api import highlights


def test_ranker_releases_process_on_cancellation(tmp_path, monkeypatch):
    import sys
    from time import monotonic

    monkeypatch.setattr(highlights, 'local_runtime', lambda: [sys.executable, '-c', 'import time; time.sleep(60)'])
    checks = []

    def check(position):
        checks.append(position)
        if len(checks) == 2:
            raise InterruptedError('Cancelled')

    started = monotonic()
    with pytest.raises(InterruptedError):
        highlights.rank_highlights([{'id': 1, 'text': 'sample'}], tmp_path, update=check)
    assert monotonic() - started < 10
    assert not (tmp_path / 'highlight-prompt.json').exists()


def transcript(duration_ms, step_ms=1000):
    return [{'id': str(index), 'startMs': start, 'endMs': min(start + 850, duration_ms), 'text': f'word {index}'}
            for index, start in enumerate(range(0, duration_ms, step_ms)) if start + 850 <= duration_ms]


def test_candidates_are_source_bounded_and_between_thirty_and_fifty_seconds():
    duration = 140_000
    scenes = [{'startMs': value, 'endMs': value + 2_000} for value in range(9_600, duration, 20_000)]
    windows = candidate_windows(transcript(duration), scenes, duration)
    assert windows
    assert len(windows) <= 8
    assert all(0 <= row['startMs'] < row['endMs'] <= duration for row in windows)
    assert all(30_000 <= row['endMs'] - row['startMs'] <= 50_000 for row in windows)
    assert all(len(row['text'].split()) >= 12 for row in windows)


def test_candidate_duration_is_configurable_and_dedupes_repeated_language():
    windows = candidate_windows(transcript(150000), [], 150000, 12, 18)
    assert windows and all(12000 <= row['endMs'] - row['startMs'] <= 18000 for row in windows)
    repeated = [{**windows[0], 'id': 101}, {**windows[-1], 'id': 102, 'text': windows[0]['text']}]
    picks = {'picks': [{'id': row['id'], 'title': 'A title', 'reason': 'A reason'} for row in repeated]}
    assert [pick['id'] for pick in ranked_picks(repeated, picks)] == [101]


def test_ranked_picks_accept_only_grounded_unique_windows():
    windows = [
        {'id': 1, 'startMs': 0, 'endMs': 40_000, 'text': 'first'},
        {'id': 2, 'startMs': 10_000, 'endMs': 50_000, 'text': 'second'},
        {'id': 3, 'startMs': 80_000, 'endMs': 120_000, 'text': 'third'},
    ]
    result = {'picks': [
        {'id': 1, 'title': ' Opening ', 'reason': ' A strong opening '},
        {'id': 2, 'title': 'Overlap', 'reason': 'Too close to the first'},
        {'id': 3, 'title': 'Payoff', 'reason': 'Clear finish'},
        {'id': 99, 'title': 'Invented', 'reason': 'Unknown id'},
        {'id': True, 'title': 'Wrong type', 'reason': 'Boolean is not an id'},
        None,
    ]}
    picks = ranked_picks(windows, result)
    assert [(row['id'], row['title'], row['reason']) for row in picks] == [
        (1, 'Opening', 'A strong opening'), (3, 'Payoff', 'Clear finish'),
    ]
    assert ranked_picks(windows, {'picks': [None]}) == []
    assert ranked_picks(windows, []) == []


def test_capabilities_report_highlights_only_when_local_stack_is_ready(client, monkeypatch):
    monkeypatch.setattr(highlights, 'local_runtime', lambda: None)
    assert client.get('/api/capabilities').json()['highlights']['status'] == 'unavailable'
    monkeypatch.setattr(highlights, 'local_runtime', lambda: ['node', 'rank.mjs'])
    available = client.get('/api/capabilities').json()['highlights']
    assert available['status'] == 'available'
    assert 'Local' in available['reason']


@pytest.mark.parametrize(('filename', 'language'), [('english.webm', 'English'), ('hindi.webm', 'Hindi')])
def test_local_model_ranks_and_accepts_real_english_and_hindi_footage(client, filename, language):
    fixture_dir = os.environ.get('CLIPFORGE_SPEECH_FIXTURES')
    if not fixture_dir or not os.environ.get('CLIPFORGE_HIGHLIGHT_MODEL'):
        pytest.skip('Set real speech fixtures and the local pretrained highlight model to run this integration test.')
    if not local_runtime():
        pytest.skip('Install the local node-llama-cpp runtime to run this integration test.')
    import psutil

    process = psutil.Process()

    def sampled_tree_rss():
        rss = process.memory_info().rss
        for child in process.children(recursive=True):
            try:
                if child.is_running():
                    rss += child.memory_info().rss
            except psutil.Error:
                pass
        return rss

    started = time.perf_counter()
    peak_rss = sampled_tree_rss()
    project_id = client.post('/api/projects', json={'title': f'{language} highlight verification',
                             'preferences': {'captionStyle': 'Cinematic Story'}}).json()['id']
    with (Path(fixture_dir) / filename).open('rb') as source:
        uploaded = client.post(f'/api/projects/{project_id}/media', files={'file': (filename, source, 'video/webm')})
    assert uploaded.status_code == 201, uploaded.text
    transcript_route = f'/api/projects/{project_id}/transcript'
    transcription = client.post(transcript_route, json={'language': language})
    assert transcription.status_code == 202, transcription.text
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        status = client.get(f'/api/jobs/{transcription.json()["id"]}').json()
        peak_rss = max(peak_rss, sampled_tree_rss())
        if status['status'] in {'succeeded', 'failed', 'cancelled'}:
            break
        time.sleep(.25)
    assert status['status'] == 'succeeded', status
    transcript_data = client.get(transcript_route).json()['transcript']
    assert len(transcript_data['segments']) > 0

    highlight_route = f'/api/projects/{project_id}/highlights'
    ranking = client.post(highlight_route)
    assert ranking.status_code == 202, ranking.text
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        status = client.get(f'/api/jobs/{ranking.json()["id"]}').json()
        peak_rss = max(peak_rss, sampled_tree_rss())
        if status['status'] in {'succeeded', 'failed', 'cancelled'}:
            break
        time.sleep(.25)
    assert status['status'] == 'succeeded', status
    result = client.get(highlight_route).json()['result']
    assert result and result['candidates'], 'The pretrained model returned no grounded candidates.'
    candidate = result['candidates'][0]
    assert 30_000 <= candidate['endMs'] - candidate['startMs'] <= 50_000
    assert 0 <= candidate['startMs'] < candidate['endMs'] <= uploaded.json()['durationMs']
    selection = {'jobId': ranking.json()['id'], 'candidateId': candidate['id']}
    assert client.post(f'{highlight_route}/clip', json={**selection, 'framing': 'invalid'}).status_code == 422
    accepted = client.post(f'{highlight_route}/clip', json={**selection, 'framing': 'close-up'})
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()['sourceKind'] == 'ai_highlight'
    assert accepted.json()['edit']['sourceInMs'] == candidate['startMs']
    assert accepted.json()['edit']['sourceOutMs'] == candidate['endMs']
    assert accepted.json()['edit']['captions'], 'Accepted highlights should carry source-derived transcript captions.'
    assert accepted.json()['edit']['color'] == '#F5D68C'
    assert accepted.json()['edit']['zoomPercent'] == 115
    assert accepted.json()['edit']['fontSize'] == 46 and accepted.json()['edit']['bold'] is False
    with Session() as db:
        saved = db.get(ClipRow, accepted.json()['id'])
        assert saved is not None
    clip_id = accepted.json()['id']
    edit = accepted.json()['edit']
    framing_url = f'/api/clips/{clip_id}/framing'
    framing = client.post(framing_url, json={key: edit[key] for key in ('sourceInMs', 'sourceOutMs', 'ratio', 'focalX', 'focalY')})
    assert framing.status_code == 202, framing.text
    deadline = time.monotonic() + 70
    while time.monotonic() < deadline:
        tracked = client.get(f'{framing_url}/{framing.json()["id"]}').json()
        peak_rss = max(peak_rss, sampled_tree_rss())
        if tracked['job']['status'] in {'succeeded', 'failed', 'cancelled'}:
            break
        time.sleep(.25)
    assert tracked['job']['status'] == 'succeeded', tracked
    assert tracked['result']['keyframes'] and tracked['result']['faceFrames'] > 0
    edit['framingKeyframes'] = tracked['result']['keyframes']
    edit['captionAnimation'] = 'pop'
    edit['captionHighlight'] = '#FFDB5C'
    edit['preserveSourceFps'] = True
    edit['captionY'] = 74
    measured = client.post(f'/api/clips/{clip_id}/loudness', json=edit)
    assert measured.status_code == 200, measured.text
    edit['loudnessGainDb'] = measured.json()['gainDb']
    saved = client.put(f'/api/clips/{clip_id}/edit-document', json=edit)
    assert saved.status_code == 200, saved.text
    assert client.get(f'/api/clips/{clip_id}/edit-document').json() == saved.json()
    render = client.post(f'/api/clips/{clip_id}/render')
    assert render.status_code == 202, render.text
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        render_status = client.get(f'/api/jobs/{render.json()["id"]}').json()
        peak_rss = max(peak_rss, sampled_tree_rss())
        if render_status['status'] in {'succeeded', 'failed', 'cancelled'}:
            break
        time.sleep(.25)
    assert render_status['status'] == 'succeeded', render_status
    output = render_status['metadata']
    assert output['codec'] == 'h264' and (output['width'], output['height']) == (1080, 1920)
    assert output['hasAudio'] and output['audioStreams'][0]['codec'] == 'aac'
    assert output['fps'] == uploaded.json()['fps']
    assert abs(output['durationMs'] - (candidate['endMs'] - candidate['startMs'])) <= 250
    download = client.get(f'/api/exports/{render.json()["id"]}/download')
    assert download.status_code == 200 and download.headers['content-type'].startswith('video/mp4')
    assert len(download.content) > 10_000
    evidence = os.environ.get('CLIPFORGE_HIGHLIGHT_EVIDENCE')
    if evidence:
        folder = Path(evidence)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f'{language.lower()}-highlight.mp4').write_bytes(download.content)
    corrected = client.put(transcript_route, json={'revision': transcript_data['revision'],
                              'changes': {transcript_data['segments'][0]['id']: 'Reviewed transcript text'}})
    assert corrected.status_code == 200, corrected.text
    assert client.get(highlight_route).json()['result'] is None
    stale = client.post(f'{highlight_route}/clip', json={'jobId': ranking.json()['id'], 'candidateId': candidate['id']})
    assert stale.status_code == 409
    print(f'{language}: {len(transcript_data["segments"])} transcript segments; '
          f'{len(result["candidates"])} ranked candidates; {time.perf_counter()-started:.1f}s; '
          f'sampled process RSS peak {peak_rss/2**20:.1f} MiB')

