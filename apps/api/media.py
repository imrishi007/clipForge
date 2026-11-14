import hashlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
from pathlib import Path
from fastapi import APIRouter, UploadFile, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy import select
from .database import DATA_DIR, Session, ProjectRow, MediaRow, ClipRow, uid

router = APIRouter()
ALLOWED = {'.mp4', '.mov', '.mkv', '.webm'}
MIME_TYPES = {'video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'application/octet-stream', 'video/x-msvideo'}


def binary(name):
    configured = os.environ.get(f'{name.upper()}_BINARY')
    if configured:
        path = Path(configured).resolve()
        return str(path) if path.is_file() else None
    return shutil.which(name)


def safe_path(relative):
    candidate = (DATA_DIR / relative).resolve()
    if candidate == DATA_DIR or not candidate.is_relative_to(DATA_DIR):
        raise HTTPException(400, 'Invalid media path')
    return candidate


def run(args, timeout=45):
    result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout, shell=False, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError(result.stderr[-2000:] or 'Media command failed')
    return result.stdout


def probe(path: Path):
    ffprobe = binary('ffprobe')
    if not ffprobe:
        raise HTTPException(503, 'ffprobe is not installed. Set FFPROBE_BINARY or add it to PATH, then restart the API.')
    try:
        raw = json.loads(run([ffprobe, '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-show_format', '-show_streams', '-of', 'json', str(path)], timeout=30))
        videos = [s for s in raw.get('streams', []) if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')]
        if not videos:
            raise ValueError('No video stream found')
        stream = videos[0]
        audio = [s for s in raw['streams'] if s.get('codec_type') == 'audio']
        duration = float(raw.get('format', {}).get('duration', stream.get('duration', 0)))
        if duration <= 0 or duration > float(os.environ.get('CLIPFORGE_MAX_DURATION_SECONDS', 14400)):
            raise ValueError('Source duration is invalid or exceeds the configured four-hour limit')
        rotation = int(stream.get('tags', {}).get('rotate', 0))
        for item in stream.get('side_data_list', []):
            if 'rotation' in item:
                rotation = int(item['rotation'])
        width, height = int(stream['width']), int(stream['height'])
        if not 0 < width <= 16384 or not 0 < height <= 16384:
            raise ValueError('Unsupported source dimensions')
        if abs(rotation) % 180 == 90:
            width, height = height, width
        return {'durationMs': round(duration*1000), 'width': width, 'height': height, 'rotation': rotation, 'fps': stream.get('avg_frame_rate', '0/1'), 'codec': stream.get('codec_name'), 'hasAudio': bool(audio), 'audioStreams': [{'codec': s.get('codec_name'), 'sampleRate': s.get('sample_rate'), 'channels': s.get('channels'), 'language': s.get('tags', {}).get('language')} for s in audio], 'sar': stream.get('sample_aspect_ratio', '1:1'), 'dar': stream.get('display_aspect_ratio'), 'bitrate': raw.get('format', {}).get('bit_rate'), 'format': raw.get('format', {}).get('format_name')}
    except (ValueError, KeyError, subprocess.TimeoutExpired) as error:
        raise HTTPException(422, f'Media validation failed: {str(error)[:1000]}') from error


def ingest(project_id: str, file: UploadFile):
    original = Path((file.filename or 'video').replace('\\', '/')).name
    extension = Path(original).suffix.lower()
    if extension not in ALLOWED or file.content_type not in MIME_TYPES:
        raise HTTPException(415, 'Supported media: MP4, MOV, MKV and WebM video')
    if not binary('ffmpeg') or not binary('ffprobe'):
        raise HTTPException(503, 'FFmpeg and ffprobe are required for persistent media import. Install them or use browser preview mode.')
    with Session() as db:
        if not db.get(ProjectRow, project_id):
            raise HTTPException(404, 'Project not found')
        existing = db.scalars(select(MediaRow).where(MediaRow.project_id == project_id)).first()
        if existing and safe_path(existing.data['path']).exists():
            raise HTTPException(409, 'The immutable source already exists. Create a new project to import a different source.')
        asset_id = uid()
        folder = safe_path(f'media/{project_id}')
        folder.mkdir(parents=True, exist_ok=True)
        temp = folder / f'{asset_id}.upload'
        target = folder / f'{asset_id}{extension}'
        count = 0
        digest = hashlib.sha256()
        limit = int(os.environ.get('CLIPFORGE_MAX_UPLOAD_MB', 2048))*1024**2
        try:
            with temp.open('xb') as output:
                while chunk := file.file.read(1024*1024):
                    count += len(chunk)
                    if count > limit:
                        raise HTTPException(413, 'Upload exceeds the configured size limit')
                    output.write(chunk)
                    digest.update(chunk)
            if not count:
                raise HTTPException(422, 'The file is empty')
            metadata = probe(temp)
            if existing and existing.data['hash'] != digest.hexdigest():
                raise HTTPException(409, 'Relinking requires the same immutable source (SHA-256 mismatch).')
            if any(c.data['edit']['sourceOutMs'] > metadata['durationMs'] for c in db.scalars(select(ClipRow).where(ClipRow.project_id == project_id))):
                raise HTTPException(422, 'Source is shorter than existing clips')
            temp.replace(target)
            data = {**metadata, 'name': original, 'path': target.relative_to(DATA_DIR).as_posix(), 'bytes': count, 'hash': digest.hexdigest(), 'status': 'ready', 'previewStatus': 'source', 'mime': mimetypes.guess_type(original)[0] or 'application/octet-stream'}
            if existing:
                row = existing
                row.data = data
            else:
                row = MediaRow(id=asset_id, project_id=project_id, data=data)
                db.add(row)
            db.commit()
            from .main import public_media
            return public_media(row)
        except BaseException:
            temp.unlink(missing_ok=True)
            if target.exists():
                target.unlink(missing_ok=True)
            raise
        finally:
            file.file.close()


@router.post('/api/projects/{id}/media', status_code=201)
def upload_media(id: str, file: UploadFile):
    result = ingest(id, file)
    from .jobs import enqueue_proxy
    enqueue_proxy(result['id'])
    return media_metadata(result['id'])


def range_bounds(header: str, size: int):
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', header)
    if not match or (not match[1] and not match[2]) or size == 0:
        raise HTTPException(416, 'Invalid byte range', headers={'Content-Range': f'bytes */{size}'})
    if not match[1]:
        suffix = int(match[2])
        start, end = max(0, size-suffix), size-1
    else:
        start, end = int(match[1]), min(int(match[2]) if match[2] else size-1, size-1)
    if start >= size or start > end or (not match[1] and int(match[2]) == 0):
        raise HTTPException(416, 'Range outside file', headers={'Content-Range': f'bytes */{size}'})
    return start, end


def file_stream(path, request, mime):
    if not path.is_file():
        raise HTTPException(410, 'Source file is missing. Relink the original source.')
    size = path.stat().st_size
    header = request.headers.get('range')
    if not header:
        return FileResponse(path, media_type=mime, headers={'Accept-Ranges': 'bytes'})
    start, end = range_bounds(header, size)

    def chunks():
        with path.open('rb') as stream:
            stream.seek(start)
            remaining = end-start+1
            while remaining > 0:
                chunk = stream.read(min(1024*1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
    headers = {'Accept-Ranges': 'bytes', 'Content-Range': f'bytes {start}-{end}/{size}', 'Content-Length': str(end-start+1)}
    if request.method == 'HEAD':
        return Response(status_code=206, headers=headers, media_type=mime)
    return StreamingResponse(chunks(), status_code=206, media_type=mime, headers=headers)


@router.api_route('/api/media/{id}', methods=['GET', 'HEAD'])
def stream_media(id: str, request: Request, original: bool = False, preview: str | None = None):
    with Session() as db:
        row = db.get(MediaRow, id)
        if not row:
            raise HTTPException(404, 'Media not found')
        proxy = None if original else row.data.get('proxyPath')
        if preview and not original:
            digest = row.data.get('hash')
            if not digest or preview not in {f'{digest}-{version}-{size}' for version in ('v1', 'v2') for size in (360, 540, 720)}:
                raise HTTPException(404, 'Preview unavailable')
            proxy = f'proxies/{preview}.mp4'
            if not safe_path(proxy).is_file():
                raise HTTPException(410, 'Preview file is missing')
        if proxy and not safe_path(proxy).is_file():
            proxy = None
        path = safe_path(proxy or row.data['path'])
        return file_stream(path, request, 'video/mp4' if proxy else row.data.get('mime', 'video/mp4'))


@router.get('/api/media/{id}/metadata')
def media_metadata(id: str):
    with Session() as db:
        row = db.get(MediaRow, id)
        if not row:
            raise HTTPException(404, 'Media not found')
        from .main import public_media
        return public_media(row)


@router.post('/api/media/{id}/preview', status_code=202)
def prepare_preview(id: str, retry: bool = False):
    from .jobs import enqueue_proxy
    enqueue_proxy(id, retry=retry)
    return media_metadata(id)


@router.get('/api/media/{id}/thumbnail')
def thumbnail(id: str):
    with Session() as db:
        row = db.get(MediaRow, id)
        if not row or not row.data.get('thumbnailPath'):
            raise HTTPException(404, 'Thumbnail not available')
        return FileResponse(safe_path(row.data['thumbnailPath']), media_type='image/jpeg')
