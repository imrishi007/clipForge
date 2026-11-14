import io
import os
import time
from pathlib import Path

import pytest

from apps.api.media import probe


pytestmark = pytest.mark.skipif(os.environ.get('CLIPFORGE_MEDIA_E2E') != '1', reason='Requires generated fixtures and FFmpeg')
FIXTURES = Path(__file__).resolve().parents[3] / 'tests' / 'fixtures'


def upload(client, fixture):
    project = client.post('/api/projects', json={'title': fixture}).json()
    with (FIXTURES / fixture).open('rb') as source:
        response = client.post(f'/api/projects/{project["id"]}/media', files={'file': (fixture, source, 'video/mp4')})
    assert response.status_code == 201, response.text
    return project['id'], response.json()


def finished(client, jobs):
    pending = {job['id'] for job in jobs}
    complete = []
    deadline = time.monotonic() + 75
    while pending and time.monotonic() < deadline:
        for job_id in list(pending):
            job = client.get(f'/api/jobs/{job_id}').json()
            assert job['status'] not in {'failed', 'cancelled'}, job
            if job['status'] == 'succeeded':
                complete.append(job)
                pending.remove(job_id)
        if pending:
            time.sleep(.15)
    assert not pending, f'Unfinished exports: {pending}'
    return complete


def test_five_exports_and_distinct_downloads(client, tmp_path):
    project_id, media = upload(client, 'landscape.mp4')
    first_bytes = client.get(media['url'], headers={'Range': 'bytes=0-15'})
    assert first_bytes.status_code == 206 and len(first_bytes.content) == 16
    for index, ratio in enumerate(('9:16', '4:5', '1:1', '16:9', '9:16')):
        start = index * 1750
        response = client.post(f'/api/projects/{project_id}/clips', json={
            'title': f'Batch cut {index}', 'edit': {
                'sourceInMs': start, 'sourceOutMs': start + 2000, 'ratio': ratio, 'resolution': '540',
                'zoomPercent': 125 if index in (0, 3) else 100, 'preserveSourceFps': index == 0,
                'quality': 'high' if index == 0 else 'standard', 'saturation': 1.1 if index == 0 else 1,
                'captions': [{'id': 'caption', 'startMs': 0, 'endMs': 1000, 'text': f'Cut {index} · हर पल'}],
            },
        })
        assert response.status_code == 201, response.text
    queued = client.post(f'/api/projects/{project_id}/render-batch')
    assert queued.status_code == 202 and len(queued.json()) == 5
    exports = finished(client, queued.json())
    assert len({job['filename'] for job in exports}) == len({job['checksum'] for job in exports}) == 5
    heights = {'Batch cut 0': 960, 'Batch cut 1': 676, 'Batch cut 2': 540, 'Batch cut 3': 304, 'Batch cut 4': 960}
    for job in exports:
        download = client.get(f'/api/exports/{job["id"]}/download')
        assert download.status_code == 200
        output = tmp_path / job['filename']
        output.write_bytes(download.content)
        metadata = probe(output)
        assert metadata['width'] == 540 and metadata['height'] == heights[job['title']]
        assert metadata['codec'] == 'h264' and metadata['audioStreams'][0]['codec'] == 'aac'
        assert metadata['durationMs'] == pytest.approx(2000, abs=50)
        if job['title'] == 'Batch cut 0':
            assert metadata['fps'] == media['fps']


def test_silent_portrait_and_corrupt_media(client):
    project_id, media = upload(client, 'portrait-silent.mp4')
    assert not media['hasAudio']
    clip = client.post(f'/api/projects/{project_id}/clips', json={
        'title': 'Silent portrait', 'edit': {'sourceInMs': 500, 'sourceOutMs': 2500, 'resolution': '540', 'zoomPercent': 150, 'cropMode': 'fit'},
    }).json()
    response = client.post(f'/api/clips/{clip["id"]}/render')
    assert response.status_code == 202
    job, = finished(client, [response.json()])
    assert job['metadata']['codec'] == 'h264' and not job['metadata']['hasAudio']
    assert (job['metadata']['width'], job['metadata']['height']) == (540, 960)

    invalid = client.post('/api/projects', json={'title': 'Invalid media'}).json()
    corrupt = client.post(f'/api/projects/{invalid["id"]}/media', files={
        'file': ('corrupt.mp4', io.BytesIO(b'not an MP4'), 'video/mp4'),
    })
    assert corrupt.status_code == 422
    assert client.get(f'/api/projects/{invalid["id"]}').json()['media'] is None


def test_profile_proxy_is_seekable_cached_and_export_reads_original(client, tmp_path):
    project_id, original = upload(client, 'landscape.mp4')
    media_id = original['id']
    metadata = f'/api/media/{media_id}/metadata'
    preview = f'/api/media/{media_id}/preview'

    def ready(size):
        until = time.monotonic() + 60
        while time.monotonic() < until:
            media = client.get(metadata).json()
            if media['previewStatus'] == 'ready' and media['previewSize'] == size:
                return media
            assert media['previewStatus'] != 'failed', media
            time.sleep(.1)
        pytest.fail(f'{size}p proxy never became ready')

    lite = ready(360)
    assert lite['width'] == original['width'] and lite['thumbnail']
    response = client.get(lite['previewUrl'], headers={'Range': 'bytes=0-31'})
    assert response.status_code == 206 and b'ftyp' in response.content
    path = tmp_path / 'proxy.mp4'
    path.write_bytes(client.get(lite['previewUrl']).content)
    first = probe(path)
    assert (first['width'], first['height']) == (640, 360)
    assert first['durationMs'] == pytest.approx(original['durationMs'], abs=100)
    started = time.monotonic()
    client.put('/api/settings', json={'performanceProfile': 'balanced'})
    client.post(preview)
    balanced = ready(540)
    print(f'540p proxy took {time.monotonic() - started:.2f}s for {original["durationMs"]} ms source')
    assert balanced['previewUrl'] != lite['previewUrl']
    client.put('/api/settings', json={'performanceProfile': 'lite'})
    assert client.post(preview).json()['previewUrl'] == lite['previewUrl']
    assert client.get(balanced['previewUrl'], headers={'Range': 'bytes=0-31'}).status_code == 206
    clip = client.post(f'/api/projects/{project_id}/clips', json={'title': 'Original render', 'edit': {'sourceOutMs': 1500}}).json()
    job = client.post(f'/api/clips/{clip["id"]}/render').json()
    from apps.api.jobs import get_job
    assert get_job(job['id'])['sourcePath'].startswith('media/')
    output, = finished(client, [job])
    assert (output['metadata']['width'], output['metadata']['height']) == (1080, 1920)


def test_runtime_encoder_failure_falls_back_without_losing_export(client, monkeypatch):
    from apps.api import jobs

    project, _ = upload(client, 'landscape.mp4')
    clip = client.post(f'/api/projects/{project}/clips', json={'title': 'Fallback', 'edit': {'sourceOutMs': 1200}}).json()
    client.put('/api/settings', json={'exportEncoder': 'h264_nvenc'})
    monkeypatch.setattr(jobs, 'hardware_checks', lambda: {'h264_nvenc': {'available': True}})
    original = jobs.worker.encode

    def fail_hardware(id, args, work, duration, encoder, messages):
        if encoder == 'h264_nvenc':
            (work / 'output.partial.mp4').write_bytes(b'partial')
            raise ValueError('GPU busy')
        return original(id, args, work, duration, encoder, messages)

    monkeypatch.setattr(jobs.worker, 'encode', fail_hardware)
    request = client.post(f'/api/clips/{clip["id"]}/render')
    output, = finished(client, [request.json()])
    assert output['encoder'] == 'libx264' and 'GPU busy' in output['logs'][0]
    assert output['metadata']['width'] == 1080 and output['metadata']['height'] == 1920


@pytest.mark.parametrize('encoder', ['h264_nvenc', 'h264_qsv'])
def test_real_verified_hardware_render(client, encoder, tmp_path):
    if os.environ.get('CLIPFORGE_HARDWARE_E2E') != '1':
        pytest.skip('Requires working hardware encoding.')
    results = client.get('/api/performance/hardware').json()
    assert results[encoder]['available'], results
    project, _ = upload(client, 'landscape.mp4')
    edit = {'sourceOutMs': 3000, 'saturation': 1.1, 'zoomPercent': 110,
            'captions': [{'id': 'one', 'startMs': 300, 'endMs': 2500, 'text': 'हर पल · Every moment'}]}
    clip = client.post(f'/api/projects/{project}/clips', json={'title': encoder, 'edit': edit}).json()
    client.put('/api/settings', json={'exportEncoder': encoder})
    result, = finished(client, [client.post(f'/api/clips/{clip["id"]}/render').json()])
    assert result['encoder'] == encoder, result
    path = tmp_path / f'{encoder}.mp4'
    path.write_bytes(client.get(f'/api/exports/{result["id"]}/download').content)
    data = probe(path)
    assert (data['width'], data['height'], data['codec'], data['audioStreams'][0]['codec']) == (1080, 1920, 'h264', 'aac')
    print(f'{encoder}: {result["elapsedSeconds"]} sec for 3s clip, {result["bytes"]} bytes')
