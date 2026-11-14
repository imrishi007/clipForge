"""Stream authorized public HTTPS files through the ordinary media importer."""

from contextlib import contextmanager
from http.client import HTTPSConnection, HTTPException as HTTPProtocolError
import ipaddress
import os
from pathlib import PurePosixPath
import socket
import ssl
import time
from typing import Literal
from urllib.parse import unquote, urljoin, urlsplit

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel, Field
from starlette.datastructures import Headers

from .database import ProjectRow, Session
from .media import ALLOWED, MIME_TYPES, binary, upload_media


router = APIRouter()
YOUTUBE_DOMAINS = ('youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com')


def remote_url(value):
    try:
        url = urlsplit(value)
        host = url.hostname
        if (url.scheme != 'https' or not host or url.username is not None or url.password is not None
                or url.port not in (None, 443) or url.fragment or '\\' in value
                or any(ord(char) <= 32 or ord(char) == 127 for char in value)):
            raise ValueError
        host = host.rstrip('.').encode('idna').decode('ascii').lower()
        if any(host == domain or host.endswith('.' + domain) for domain in YOUTUBE_DOMAINS):
            raise HTTPException(422, 'Use YouTube as a reference. Import an authorized video file to edit it.')
        if '.' not in host or host.replace('.', '').isdigit():
            raise ValueError
        return url, host
    except (ValueError, UnicodeError) as error:
        raise HTTPException(422, 'Enter a public HTTPS file URL without credentials or a custom port.') from error


def public_address(host):
    try:
        answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
        addresses = [ipaddress.ip_address(result[4][0]) for result in answers]
    except (OSError, ValueError) as error:
        raise HTTPException(502, 'The media host could not be resolved.') from error
    if not addresses or any(not (getattr(address, 'ipv4_mapped', None) or address).is_global
                            or address.is_multicast or address.is_reserved for address in addresses):
        raise HTTPException(422, 'Direct media imports require a public network address.')
    return str(next((address for address in addresses if address.version == 4), addresses[0]))


class PublicHTTPSConnection(HTTPSConnection):
    def __init__(self, host):
        super().__init__(host, timeout=15)
        self.address = public_address(host)

    def connect(self):
        # Keep TLS verification tied to the hostname and connect to the address already checked.
        raw = socket.create_connection((self.address, 443), timeout=self.timeout)
        try:
            self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


class TimedResponse:
    def __init__(self, response, deadline):
        self.response = response
        self.deadline = deadline

    def read(self, size):
        if time.monotonic() >= self.deadline:
            raise HTTPException(504, 'The media transfer exceeded the time limit.')
        return self.response.read1(size)

    def close(self):
        self.response.close()


@contextmanager
def download_media(value):
    deadline = time.monotonic() + 600
    for _ in range(5):
        url, host = remote_url(value)
        connection = PublicHTTPSConnection(host)
        try:
            request_path = url.path or '/'
            if url.query:
                request_path += '?' + url.query
            connection.request('GET', request_path, headers={
                'Accept': 'video/*, application/octet-stream', 'Accept-Encoding': 'identity',
                'User-Agent': 'ClipForgeStudio/0.1 (authorized direct media import)',
            })
            with connection.getresponse() as response:
                if response.status in {301, 302, 303, 307, 308} and response.getheader('Location'):
                    value = urljoin(value, response.getheader('Location'))
                    continue
                if response.status != 200:
                    raise HTTPException(502, f'The media server returned HTTP {response.status}.')
                mime = response.getheader('Content-Type', '').partition(';')[0].strip().lower()
                filename = PurePosixPath(unquote(url.path)).name
                if mime not in MIME_TYPES or PurePosixPath(filename).suffix.lower() not in ALLOWED:
                    raise HTTPException(415, 'The URL must return an MP4, MOV, MKV or WebM file.')
                size = response.getheader('Content-Length', '')
                if size.isascii() and size.isdecimal() and int(size) > int(os.environ.get('CLIPFORGE_MAX_UPLOAD_MB', 2048)) * 1024**2:
                    raise HTTPException(413, 'The remote file exceeds the configured size limit.')
                yield TimedResponse(response, deadline), filename, mime
                return
        except TimeoutError as error:
            raise HTTPException(504, 'The media server timed out. Check the link and try again.') from error
        except (OSError, HTTPProtocolError, UnicodeError) as error:
            raise HTTPException(502, 'The media server could not complete the HTTPS transfer.') from error
        finally:
            connection.close()
    raise HTTPException(422, 'The media URL redirected too many times.')


class DirectImport(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    authorized: Literal[True]


@router.post('/api/projects/{id}/media-url', status_code=201)
def import_url(id: str, body: DirectImport):
    with Session() as db:
        if not db.get(ProjectRow, id):
            raise HTTPException(404, 'Project not found')
    if not binary('ffmpeg') or not binary('ffprobe'):
        raise HTTPException(503, 'Start the media service with FFmpeg and ffprobe to import a URL.')
    with download_media(body.url) as (response, filename, mime):
        return upload_media(id, UploadFile(response, filename=filename, headers=Headers({'content-type': mime})))
