from contextlib import contextmanager
from io import BytesIO

import pytest
from fastapi import HTTPException

from apps.api import direct_media, media


@pytest.mark.parametrize('url', [
    'http://media.example.com/cut.mp4', 'https://localhost/cut.mp4',
    'https://user:pass@media.example.com/cut.mp4', 'https://youtube.com/watch?v=123',
    'https://127.0.0.1/cut.mp4', 'https://media.example.com:8443/cut.mp4',
])
def test_rejects_unsupported_sources(url):
    with pytest.raises(HTTPException):
        direct_media.remote_url(url)


def test_rejects_non_public_dns_answers(monkeypatch):
    monkeypatch.setattr(direct_media.socket, 'getaddrinfo', lambda *args, **kwargs: [
        (2, 1, 6, '', ('8.8.8.8', 443)), (2, 1, 6, '', ('192.168.1.5', 443)),
    ])
    with pytest.raises(HTTPException, match='public'):
        direct_media.public_address('media.example.com')


def test_url_import_uses_existing_storage_and_validation(client, monkeypatch):
    @contextmanager
    def download(url):
        assert url == 'https://media.example.com/interview.mp4'
        yield BytesIO(b'video-bytes'), 'interview.mp4', 'video/mp4'

    monkeypatch.setattr(direct_media, 'download_media', download)
    monkeypatch.setattr(direct_media, 'binary', lambda name: name)
    monkeypatch.setattr(media, 'binary', lambda name: name)
    monkeypatch.setattr(media, 'probe', lambda path: {'durationMs': 30000, 'width': 1280, 'height': 720, 'hasAudio': False, 'codec': 'h264'})
    monkeypatch.setattr(media, 'run', lambda *args, **kwargs: None)
    project = client.post('/api/projects', json={'title': 'Direct source'}).json()
    route = f'/api/projects/{project["id"]}/media-url'
    assert client.post(route, json={'url': 'https://media.example.com/interview.mp4'}).status_code == 422
    result = client.post(route, json={'url': 'https://media.example.com/interview.mp4', 'authorized': True})
    assert result.status_code == 201, result.text
    assert result.json()['name'] == 'interview.mp4'
    assert client.get(result.json()['url']).content == b'video-bytes'
