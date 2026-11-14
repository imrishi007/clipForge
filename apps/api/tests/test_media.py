from io import BytesIO
from pathlib import Path
import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from apps.api import media, main
from apps.api.schemas import ProjectInput
from apps.api.database import DATA_DIR, Session, MediaRow


def test_safe_paths_and_ranges():
    assert media.safe_path('media/abc.mp4').is_relative_to(DATA_DIR)
    with pytest.raises(HTTPException):
        media.safe_path('../outside.mp4')
    assert media.range_bounds('bytes=5-9', 20) == (5, 9)
    assert media.range_bounds('bytes=-4', 20) == (16, 19)
    assert media.range_bounds('bytes=18-', 20) == (18, 19)
    for header in ['bytes=25-', 'bytes=-0', 'bytes=5-2', 'bytes=1-2,5-6', 'bad']:
        with pytest.raises(HTTPException):
            media.range_bounds(header, 20)


def test_streamed_ingest_and_immutable_source(database, monkeypatch):
    # Probe/FFmpeg are stubbed here; real-media tests are separate and never counted as executed.
    monkeypatch.setattr(media, 'binary', lambda name: name)
    monkeypatch.setattr(media, 'probe', lambda path: {'durationMs': 12000, 'width': 1280, 'height': 720, 'hasAudio': True})
    monkeypatch.setattr(media, 'run', lambda args, timeout: Path(args[-1]).write_bytes(b'jpg'))
    project = main.create_project(ProjectInput(title='Owned'))
    body = UploadFile(BytesIO(b'fake-fixture-for-storage-test'), filename='../../असली.mp4', headers=Headers({'content-type': 'video/mp4'}))
    result = media.ingest(project['id'], body)
    assert result['name'] == 'असली.mp4'
    assert 'path' not in result
    assert result['durationMs'] == 12000
    with Session() as db:
        row = db.get(MediaRow, result['id'])
        assert media.safe_path(row.data['path']).read_bytes() == b'fake-fixture-for-storage-test'
    second = UploadFile(BytesIO(b'overwrite'), filename='new.mp4', headers=Headers({'content-type': 'video/mp4'}))
    with pytest.raises(HTTPException) as error:
        media.ingest(project['id'], second)
    assert error.value.status_code == 409


def test_rejected_upload_cleans_temp(database, monkeypatch):
    monkeypatch.setattr(media, 'binary', lambda name: name)
    p = main.create_project(ProjectInput(title='Test'))
    def corrupt(_):
        raise HTTPException(422, 'Corrupt source')
    monkeypatch.setattr(media, 'probe', corrupt)
    file = UploadFile(BytesIO(b'broken'), filename='broken.mp4', headers=Headers({'content-type': 'video/mp4'}))
    with pytest.raises(HTTPException):
        media.ingest(p['id'], file)
    assert not list((DATA_DIR/'media'/p['id']).glob('*.upload'))
    assert main.project(p['id'])['media'] is None


def test_probe_metadata_and_rotation(monkeypatch):
    import json
    monkeypatch.setattr(media, 'binary', lambda _: 'ffprobe')
    monkeypatch.setattr(media, 'run', lambda *args, **kwargs: json.dumps({'format': {'duration': '12.5'}, 'streams': [{'codec_type': 'video', 'codec_name': 'h264', 'width': 1920, 'height': 1080, 'avg_frame_rate': '30000/1001', 'side_data_list': [{'rotation': 90}]}, {'codec_type': 'audio', 'codec_name': 'aac', 'sample_rate': '48000'}]}))
    m = media.probe(Path('fixture.mp4'))
    assert (m['width'], m['height'], m['durationMs']) == (1080, 1920, 12500)
    assert m['hasAudio'] and m['fps'] == '30000/1001'


def test_missing_proxy_falls_back_to_original(client):
    project = client.post('/api/projects', json={'title': 'Preview source'}).json()
    path = DATA_DIR / 'preview-original.mp4'
    path.write_bytes(b'original')
    with Session() as db:
        db.add(MediaRow(id='preview-test', project_id=project['id'], data={
            'path': path.name, 'proxyPath': 'missing-proxy.mp4', 'mime': 'video/mp4',
        }))
        db.commit()
    url = '/api/media/preview-test'
    assert client.get(url).content == b'original'
    assert client.get(url + '/metadata').json()['sourceAvailable'] is True
    path.unlink()
    assert client.get(url).status_code == 410
    assert client.get(url + '/metadata').json()['sourceAvailable'] is False
