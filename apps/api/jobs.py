import hashlib
import os
import queue
import subprocess
import threading
import time
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from .database import Session, JobRow, ClipRow, MediaRow, ProjectRow, SettingsRow, DATA_DIR, now, uid
from .media import safe_path, binary, probe, run
from .preview import preview_spec, preview_arguments, validate_preview
from .performance import ENCODERS, PROFILES, cpu_threads, hardware_checks, processing_slot
from .schemas import EditDocument
from .rendering import render_arguments, validate_output, ass_document, srt_document, safe_filename

router = APIRouter()
lock = threading.RLock()
TERMINAL = {'succeeded', 'failed', 'cancelled'}
RENDER_STALL_SECONDS = 120


def public_job(row):
    return {'id': row.id, **{key: value for key, value in row.data.items() if key not in {'sourcePath', 'path', 'edit', 'sourceMetadata', 'windows', 'sourceHash'}}}


def get_job(id):
    with Session() as db:
        row = db.get(JobRow, id)
        if not row:
            raise HTTPException(404, 'Job not found')
        return dict(row.data)


def patch_job(id, **changes):
    with lock, Session() as db:
        row = db.get(JobRow, id)
        if not row:
            return
        row.data = {**row.data, **changes, 'updatedAt': now()}
        db.commit()


def attach_preview(db, media, path, spec):
    data = {**media.data, 'proxyPath': path.relative_to(DATA_DIR).as_posix(), 'previewStatus': 'ready'}
    if spec:
        data.update(previewKey=spec['key'], previewSize=spec['size'])
        thumbnail = safe_path(f"thumbnails/{media.data['hash']}-v1.jpg")
        if thumbnail.is_file():
            data['thumbnailPath'] = thumbnail.relative_to(DATA_DIR).as_posix()
    media.data = data


class LocalWorker:
    """Single-process queue adapter. Persisted jobs; one transcode at a time.

    On restart queued jobs resume, interrupted running jobs fail with retry.
    Run exactly one uvicorn process. No Redis durability claim is made.
    """
    def __init__(self):
        self.queue = queue.Queue()
        self.stopping = threading.Event()
        self.thread = None
        self.processes = {}

    def enqueue(self, id):
        self.queue.put(id)

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.stopping.clear()
        recover_jobs(self)
        self.thread = threading.Thread(target=self._loop, daemon=True, name='clipforge-local-worker')
        self.thread.start()

    def _loop(self):
        while not self.stopping.is_set():
            try:
                id = self.queue.get(timeout=.3)
            except queue.Empty:
                continue
            try:
                with processing_slot:
                    if not self.stopping.is_set():
                        self.run_job(id)
            finally:
                self.queue.task_done()

    def stop(self):
        self.stopping.set()
        with lock:
            processes = list(self.processes.values())
        for process in processes:
            if process.poll() is None:
                process.terminate()
        if self.thread:
            self.thread.join(timeout=8)

    def run_job(self, id):
        work = safe_path(f'work/{id}')
        partial = work/'output.partial.mp4'
        try:
            with lock:
                job = get_job(id)
                if job['status'] != 'queued':
                    return
                started = time.monotonic()
                stage = {'render': 'Preparing render', 'proxy': 'Preparing browser proxy',
                         'transcription': 'Loading local Whisper model', 'scenes': 'Preparing scene detection',
                         'highlights': 'Loading local highlight model', 'framing': 'Loading OpenCV face detector'}[job['type']]
                patch_job(id, status='running', stage=stage, progress=0, startedAt=now())
            source = safe_path(job['sourcePath'])
            if not source.is_file():
                raise ValueError('Source is missing. Relink the original file, then retry.')
            if job['type'] in {'transcription', 'scenes', 'highlights', 'framing'}:
                from .analysis import run_analysis
                run_analysis(id, job, source, self)
                patch_job(id, elapsedSeconds=round(time.monotonic() - started, 2))
                return
            work.mkdir(parents=True, exist_ok=True)
            spec = job.get('previewSpec')
            encoder = 'libx264'
            requested = 'libx264'
            has_audio = job['sourceMetadata']['hasAudio']
            if spec:
                cached = safe_path(f"proxies/{spec['key']}.mp4")
                if cached.is_file():
                    with lock, Session() as db:
                        if get_job(id).get('cancelRequested'):
                            raise InterruptedError('Cancelled before using cached preview')
                        media = db.get(MediaRow, job['mediaId'])
                        if media and media.data.get('proxyJobId') == id:
                            attach_preview(db, media, cached, spec)
                            db.commit()
                        patch_job(id, status='succeeded', stage='Cached preview ready', progress=100,
                                  path=cached.relative_to(DATA_DIR).as_posix(), completedAt=now())
                    return
                thumbnail = safe_path(f"thumbnails/{job['sourceMetadata']['hash']}-v1.jpg")
                thumbnail.parent.mkdir(parents=True, exist_ok=True)
                if not thumbnail.is_file():
                    try:
                        temp_thumbnail = work / 'thumbnail.jpg'
                        run([binary('ffmpeg'), '-y', '-v', 'error', '-threads', '2', '-filter_threads', '1',
                             '-protocol_whitelist', 'file,pipe', '-ss', str(min(2, spec['durationMs'] / 3000)),
                             '-i', str(source), '-map', '0:V:0', '-frames:v', '1', '-vf', 'scale=320:-2', str(temp_thumbnail)], timeout=20)
                        temp_thumbnail.replace(thumbnail)
                    except (ValueError, OSError, subprocess.TimeoutExpired):
                        (work / 'thumbnail.jpg').unlink(missing_ok=True)
                args = preview_arguments(source, partial, spec, has_audio)
                duration = spec['durationMs'] / 1000
            else:
                edit = EditDocument.model_validate(job['edit'])
                if edit.captions:
                    (work/'captions.ass').write_text(ass_document(edit), encoding='utf-8-sig')
                duration = edit.duration
                requested = job.get('exportEncoder') or os.environ.get('CLIPFORGE_EXPORT_ENCODER', 'libx264')
                if job['type'] == 'render' and requested in ENCODERS and (hardware_checks() or {}).get(requested, {}).get('available'):
                    encoder = requested
            messages = []
            if job['type'] == 'render' and requested in ENCODERS and encoder == 'libx264':
                messages.append(f'{ENCODERS[requested]} failed the runtime hardware check. Using software encoding.')
            while True:
                if not spec:
                    args = render_arguments(source, partial, edit, has_audio, job['sourceMetadata'].get('fps'),
                                            pad_to_duration=job['type'] == 'proxy', threads=cpu_threads(job.get('performanceProfile', 'lite')),
                                            encoder=encoder)
                try:
                    self.encode(id, args, work, duration, encoder, messages)
                    patch_job(id, stage='Validating output', progress=99)
                    metadata = probe(partial)
                    if spec:
                        validate_preview(metadata, spec, has_audio)
                    else:
                        validate_output(metadata, edit, has_audio, partial.stat().st_size)
                    break
                except (ValueError, HTTPException, OSError) as error:
                    if encoder == 'libx264':
                        raise
                    messages.append(f'{ENCODERS[encoder]} failed. Retrying with software: {getattr(error, "detail", str(error))[:800]}')
                    partial.unlink(missing_ok=True)
                    encoder = 'libx264'
            digest = hashlib.sha256()
            with partial.open('rb') as file:
                while chunk := file.read(1024*1024):
                    digest.update(chunk)
            with lock:
                if get_job(id).get('cancelRequested'):
                    raise InterruptedError('Cancelled before finalization')
                if job['type'] == 'proxy':
                    target = safe_path(f"proxies/{spec['key'] if spec else id}.mp4")
                else:
                    target = safe_path(f'exports/{job["filename"]}')
                target.parent.mkdir(parents=True, exist_ok=True)
                partial.replace(target)
                patch_job(id, status='succeeded', stage='Validated', progress=100, path=target.relative_to(DATA_DIR).as_posix(), metadata=metadata, bytes=target.stat().st_size, checksum=digest.hexdigest(), completedAt=now(), encoder=encoder, elapsedSeconds=round(time.monotonic() - started, 2), logs=[*messages, 'FFmpeg completed.', 'ffprobe validated codec, geometry, duration and audio.', 'Output atomically finalized.'])
                if job['type'] == 'proxy':
                    with Session() as db:
                        media = db.get(MediaRow, job['mediaId'])
                        if media and media.data.get('hash') == job['sourceMetadata'].get('hash') and media.data.get('proxyJobId') == id:
                            attach_preview(db, media, target, spec)
                            db.commit()
        except InterruptedError as error:
            patch_job(id, status='cancelled', stage='Cancelled', progress=None, error=str(error), completedAt=now())
        except Exception as error:
            message = getattr(error, 'detail', str(error))
            patch_job(id, status='failed', stage='Failed', progress=None, error=str(message)[:3000], completedAt=now(), logs=[str(message)[:3000]])
        finally:
            with lock:
                process = self.processes.pop(id, None)
            if process and process.poll() is None:
                process.kill()
                process.wait(timeout=10)
            try:
                partial.unlink(missing_ok=True)
            except OSError as error:
                # Another process can temporarily hold a completed handle on Windows.
                with Session() as db:
                    row = db.get(JobRow, id)
                    if row:
                        patch_job(id, logs=[*row.data.get('logs', []), f'Could not yet remove the temporary render: {error}'])

    def encode(self, id, args, work, duration, encoder, messages):
        stderr_path = work / 'ffmpeg.log'
        with stderr_path.open('w', encoding='utf-8') as errors:
            with lock:
                if get_job(id).get('cancelRequested'):
                    raise InterruptedError('Cancelled before rendering')
                if self.stopping.is_set():
                    raise RuntimeError('Worker stopped before rendering. Retry this job.')
                process = subprocess.Popen(args, cwd=work, stdout=subprocess.PIPE, stderr=errors, text=True, encoding='utf-8',
                                           errors='replace', shell=False, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) |
                                           getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0))
                self.processes[id] = process
            stage = f'Encoding H.264 · {ENCODERS.get(encoder, "Software")}'
            patch_job(id, stage=stage, progress=0, logs=[*messages, 'Local worker started FFmpeg.'])
            last_update = 0.0
            last_output = [time.monotonic()]
            stalled = threading.Event()
            stopped = threading.Event()

            def watchdog():
                while not stopped.wait(1):
                    if time.monotonic() - last_output[0] > RENDER_STALL_SECONDS and process.poll() is None:
                        stalled.set()
                        process.kill()
                        return

            watch = threading.Thread(target=watchdog, name='clipforge-ffmpeg-watchdog', daemon=True)
            watch.start()
            try:
                last_timestamp = -1
                with process.stdout:
                    for line in process.stdout:
                        key, _, value = line.strip().partition('=')
                        if key in ('out_time_us', 'out_time_ms') and value.isdigit() and int(value) > last_timestamp:
                            last_timestamp = int(value)
                            last_output[0] = time.monotonic()
                            if last_output[0] - last_update > .4:
                                patch_job(id, progress=min(99, last_timestamp / (duration * 10000)))
                                last_update = last_output[0]
                code = process.wait(timeout=30)
            finally:
                stopped.set()
                watch.join()
        if get_job(id).get('cancelRequested'):
            raise InterruptedError('Cancelled by user')
        if self.stopping.is_set():
            raise RuntimeError('Worker stopped during rendering. Retry this job.')
        if stalled.is_set():
            raise ValueError('FFmpeg stopped reporting progress for two minutes. Retry the job or check the source media.')
        if code:
            raise ValueError(stderr_path.read_text(encoding='utf-8', errors='replace')[-3000:] or f'FFmpeg exited with code {code}')


worker = LocalWorker()


def recover_jobs(adapter):
    with Session() as db:
        rows = list(db.scalars(select(JobRow)))
    for row in rows:
        if row.data['status'] in TERMINAL or row.data['status'] == 'running':
            try:
                safe_path(f'work/{row.id}/output.partial.mp4').unlink(missing_ok=True)
            except OSError:
                pass
        if row.data['status'] == 'running':
            patch_job(row.id, status='failed', stage='Interrupted', progress=None, error='Worker stopped before validating output. Retry the export.', completedAt=now())
        elif row.data['status'] == 'queued':
            adapter.enqueue(row.id)
        elif row.data['status'] == 'succeeded' and (not row.data.get('path') or not safe_path(row.data['path']).is_file()):
            patch_job(row.id, status='failed', stage='Output missing', progress=None, error='The completed file was moved or deleted. Retry to render it again.')


def performance_settings(db):
    row = db.get(SettingsRow, 'personal')
    return row.data if row else {}


def active_profile(db):
    name = performance_settings(db).get('performanceProfile')
    return name if name in PROFILES else 'lite'


def enqueue_proxy(media_id, retry=False):
    with lock, Session() as db:
        media = db.get(MediaRow, media_id)
        if not media or not media.data.get('hash') or not media.data.get('path') or not safe_path(media.data['path']).is_file():
            return
        if not binary('ffmpeg') or not binary('ffprobe'):
            return
        spec = preview_spec(media.data, active_profile(db))
        cached = f"proxies/{spec['key']}.mp4"
        if safe_path(cached).is_file():
            if media.data.get('previewKey') != spec['key'] or media.data.get('previewStatus') != 'ready':
                attach_preview(db, media, safe_path(cached), spec)
                media.data = {**media.data, 'proxyJobId': None}
                db.commit()
            return
        previous = db.get(JobRow, media.data.get('proxyJobId') or '')
        if previous and previous.data.get('previewSpec') == spec:
            if previous.data['status'] in ('queued', 'running'):
                return
            if not retry and previous.data['status'] in ('failed', 'cancelled'):
                if media.data.get('previewStatus') != previous.data['status']:
                    media.data = {**media.data, 'previewStatus': previous.data['status']}
                    db.commit()
                return
        # Reuse completed proxy work across projects with the same source bytes.
        # Pending jobs recheck the cache when they start, after the current job finishes.
        id = uid()
        db.add(JobRow(id=id, data={'type': 'proxy', 'mediaId': media_id, 'projectId': media.project_id, 'clipId': '', 'title': 'Browser proxy', 'status': 'queued', 'stage': 'Queued', 'progress': None, 'createdAt': now(), 'editRevision': 0, 'previewSpec': spec, 'sourcePath': media.data['path'], 'sourceMetadata': media.data, 'cancelRequested': False, 'logs': []}))
        media.data = {**media.data, 'previewStatus': 'queued', 'proxyJobId': id}
        db.commit()
        worker.enqueue(id)


@router.post('/api/clips/{id}/render', status_code=202)
def enqueue_render(id: str):
    if not binary('ffmpeg') or not binary('ffprobe'):
        raise HTTPException(503, 'FFmpeg and ffprobe must be installed before exporting')
    with lock, Session() as db:
        clip = db.get(ClipRow, id)
        if not clip:
            raise HTTPException(404, 'Clip not found')
        media = db.scalars(select(MediaRow).where(MediaRow.project_id == clip.project_id)).first()
        if not media or not safe_path(media.data['path']).is_file():
            raise HTTPException(410, 'Source media is missing. Relink it before exporting.')
        for existing in db.scalars(select(JobRow)):
            if existing.data['type'] == 'render' and existing.data['clipId'] == id and existing.data['editRevision'] == clip.revision and existing.data['status'] in ('queued', 'running'):
                return public_job(existing)
        job_id = uid()
        row = JobRow(id=job_id, data={'type': 'render', 'projectId': clip.project_id, 'clipId': id, 'title': clip.data['title'], 'status': 'queued', 'stage': 'Queued', 'progress': None, 'createdAt': now(), 'editRevision': clip.revision, 'edit': clip.data['edit'], 'sourcePath': media.data['path'], 'sourceMetadata': media.data, 'performanceProfile': active_profile(db), 'cancelRequested': False, 'filename': safe_filename(clip.data['title'], job_id), 'logs': []})
        row.data['exportEncoder'] = performance_settings(db).get('exportEncoder')
        db.add(row)
        db.commit()
        worker.enqueue(row.id)
        return public_job(row)


@router.post('/api/projects/{id}/render-batch', status_code=202)
def render_batch(id: str):
    with Session() as db:
        if not db.get(ProjectRow, id):
            raise HTTPException(404, 'Project not found')
        ids = [c.id for c in db.scalars(select(ClipRow).where(ClipRow.project_id == id)) if c.data.get('status') != 'rejected']
    if not ids:
        raise HTTPException(422, 'This project has no clips to render')
    return [enqueue_render(clip_id) for clip_id in ids]


@router.get('/api/jobs')
def jobs():
    with Session() as db:
        return [public_job(j) for j in db.scalars(select(JobRow))]


@router.get('/api/exports')
def exports():
    return sorted([j for j in jobs() if j['type'] == 'render'], key=lambda j: j['createdAt'], reverse=True)


@router.get('/api/jobs/{id}')
@router.get('/api/exports/{id}')
def job_detail(id: str):
    with Session() as db:
        row = db.get(JobRow, id)
        if not row:
            raise HTTPException(404, 'Job not found')
        if row.data['status'] == 'succeeded' and not safe_path(row.data['path']).is_file():
            patch_job(id, status='failed', stage='Output missing', error='Output file no longer exists. Retry the render.')
            db.refresh(row)
        return public_job(row)


@router.post('/api/jobs/{id}/cancel')
def cancel_job(id: str):
    with lock:
        job = get_job(id)
        if job['status'] in TERMINAL:
            raise HTTPException(409, 'Only queued or running jobs can be cancelled')
        if job['status'] == 'queued':
            patch_job(id, status='cancelled', stage='Cancelled', progress=None, cancelRequested=True, completedAt=now())
        else:
            patch_job(id, cancelRequested=True, stage='Cancelling')
            process = worker.processes.get(id)
            if process and process.poll() is None:
                process.terminate()
    return job_detail(id)


@router.post('/api/jobs/{id}/retry', status_code=202)
def retry_job(id: str):
    with lock:
        job = get_job(id)
        if job['status'] not in {'failed', 'cancelled'}:
            raise HTTPException(409, 'Only failed or cancelled jobs can be retried')
        if job['type'] == 'transcription':
            from .transcription import transcription_available
            if not transcription_available():
                raise HTTPException(503, 'Configure a local Whisper model before retrying.')
        elif job['type'] == 'scenes':
            from .scenes import scene_detection_available
            if not scene_detection_available():
                raise HTTPException(503, 'Install PySceneDetect before retrying.')
        elif job['type'] == 'highlights':
            from .highlights import local_runtime
            if not local_runtime():
                raise HTTPException(503, 'Configure the local highlight model before retrying.')
        elif job['type'] == 'framing':
            from .framing import framing_available
            if not framing_available():
                raise HTTPException(503, 'Configure OpenCV and FFmpeg before retrying.')
        elif not binary('ffmpeg') or not binary('ffprobe'):
            raise HTTPException(503, 'FFmpeg and ffprobe must be installed before retrying')
        patch_job(id, status='queued', stage='Queued', progress=None, cancelRequested=False, error=None, completedAt=None, logs=['Retry queued using the original edit snapshot.'])
        worker.enqueue(id)
    return job_detail(id)


@router.get('/api/exports/{id}/download')
def download_export(id: str):
    job = get_job(id)
    if job['type'] != 'render' or job['status'] != 'succeeded':
        raise HTTPException(409, 'No validated MP4 is available for this job')
    path = safe_path(job['path'])
    if not path.is_file():
        raise HTTPException(410, 'Output file is missing. Retry the export.')
    return FileResponse(path, media_type='video/mp4', filename=job['filename'])


@router.get('/api/clips/{id}/subtitles')
def subtitles(id: str):
    with Session() as db:
        clip = db.get(ClipRow, id)
        if not clip:
            raise HTTPException(404, 'Clip not found')
        return Response(srt_document(EditDocument.model_validate(clip.data['edit'])), media_type='application/x-subrip', headers={'Content-Disposition': f'attachment; filename="{id}.srt"'})
