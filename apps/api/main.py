from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, update, delete
from .database import Base, engine, Session, ProjectRow, ClipRow, MediaRow, EditRevisionRow, CampaignRow, SettingsRow, JobRow, now, uid
from .schemas import ProjectInput, ClipInput, EditDocument, CampaignInput


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(engine)
    from .jobs import worker
    worker.start()
    yield
    worker.stop()


app = FastAPI(title='ClipForge Studio Local API', version='0.1.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:3000', 'http://localhost:3000'], allow_methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], allow_headers=['Content-Type', 'Range'], expose_headers=['Content-Range', 'Content-Length', 'Accept-Ranges'])


@app.middleware('http')
async def local_origin_guard(request: Request, call_next):
    origin = request.headers.get('origin')
    if origin and origin not in {'http://localhost:3000', 'http://127.0.0.1:3000'}:
        from fastapi.responses import JSONResponse
        return JSONResponse({'detail': 'This API only accepts the local ClipForge workspace.'}, status_code=403)
    return await call_next(request)


def require(db, model, id):
    row = db.get(model, id)
    if row is None:
        raise HTTPException(404, 'Record not found')
    return row


def public_media(row):
    if not row:
        return None
    from .media import safe_path
    source = row.data.get('path')
    proxy = row.data.get('proxyPath')
    source_available = bool(source and safe_path(source).is_file())
    proxy_available = bool(proxy and safe_path(proxy).is_file())
    progress, status = None, row.data.get('previewStatus', 'source')
    if status == 'queued' and row.data.get('proxyJobId'):
        from .jobs import get_job
        try:
            job = get_job(row.data['proxyJobId'])
            progress, status = job.get('progress'), job['status']
            if status == 'succeeded':
                status = 'ready' if proxy_available else 'queued'
        except HTTPException:
            pass
    return {'id': row.id, **{k: v for k, v in row.data.items() if k not in ('path', 'proxyPath', 'thumbnailPath', 'previewKey')},
            'sourceAvailable': source_available, 'url': f'/api/media/{row.id}' if source_available or proxy_available else '',
            'originalUrl': f'/api/media/{row.id}?original=true' if source_available else None,
            'previewProgress': progress, 'previewStatus': status,
            'previewUrl': f'/api/media/{row.id}?preview={row.data["previewKey"]}' if proxy_available and row.data.get('previewKey') else None,
            'thumbnail': f'/api/media/{row.id}/thumbnail' if row.data.get('thumbnailPath') else None}


def project_json(db, row):
    media = db.scalars(select(MediaRow).where(MediaRow.project_id == row.id)).first()
    clips = db.scalars(select(ClipRow).where(ClipRow.project_id == row.id)).all()
    return {'id': row.id, **row.data, 'media': public_media(media), 'clips': [{'id': c.id, 'projectId': row.id, **c.data} for c in clips]}


@app.get('/api/health')
def health():
    with Session() as db:
        db.execute(select(ProjectRow).limit(1))
    from .media import binary
    from .jobs import worker
    return {'api': 'available', 'database': 'available', 'storage': 'local', 'worker': 'local-worker', 'workerRunning': bool(worker.thread and worker.thread.is_alive()), 'ffmpeg': bool(binary('ffmpeg')), 'ffprobe': bool(binary('ffprobe'))}


@app.get('/api/performance')
def performance():
    from .jobs import active_profile
    from .performance import PROFILES, cpu_threads, resource_snapshot

    with Session() as db:
        profile = active_profile(db)
    return {'profile': profile, 'previewSize': PROFILES[profile][0], 'cpuThreads': cpu_threads(profile),
            'heavyJobs': 1, **resource_snapshot()}


@app.get('/api/performance/hardware')
def performance_hardware():
    from .performance import hardware_checks

    result = hardware_checks()
    if result is None:
        raise HTTPException(409, 'A local job is processing. Check hardware again when it finishes.')
    return result


@app.get('/api/capabilities')
def capabilities():
    from .framing import framing_available
    from .highlights import local_runtime
    from .scenes import scene_detection_available
    from .transcription import transcription_available
    result = {key: {'status': 'unavailable', 'reason': 'Coming in the AI phase; create and caption clips manually.'}
              for key in ['highlights', 'faceTracking', 'autoEdit', 'sceneAnalysis']}
    result['transcription'] = {'status': 'available', 'reason': 'Local multilingual Whisper model configured.'} if transcription_available() else {
        'status': 'unavailable', 'reason': 'Install the optional AI dependencies and configure a local Whisper model.',
    }
    if scene_detection_available():
        result['sceneAnalysis'] = {'status': 'available', 'reason': 'PySceneDetect is installed.'}
    result['faceTracking'] = ({'status': 'available', 'reason': 'Local OpenCV face detection and tracking.'}
                              if framing_available() else {'status': 'unavailable', 'reason': 'Install OpenCV and configure FFmpeg.'})
    result['highlights'] = {'status': 'available', 'reason': 'Local transcript ranking model and runtime are configured.'} if local_runtime() else {
        'status': 'unavailable', 'reason': 'Install the local GGUF runtime and configure a pretrained highlight model.',
    }
    return result


@app.get('/api/projects')
def projects():
    with Session() as db:
        return [project_json(db, p) for p in db.scalars(select(ProjectRow)).all()]


@app.post('/api/projects', status_code=201)
def create_project(body: ProjectInput):
    with Session() as db:
        row = ProjectRow(id=uid(), data={**body.model_dump(), 'mode': 'real', 'storage': 'server', 'createdAt': now(), 'updatedAt': now()})
        db.add(row)
        db.commit()
        return project_json(db, row)


@app.get('/api/projects/{id}')
def project(id: str):
    with Session() as db:
        return project_json(db, require(db, ProjectRow, id))


@app.patch('/api/projects/{id}')
def update_project(id: str, body: ProjectInput):
    with Session() as db:
        row = require(db, ProjectRow, id)
        row.data = {**row.data, **body.model_dump(), 'updatedAt': now()}
        db.commit()
        return project_json(db, row)


@app.delete('/api/projects/{id}', status_code=204)
def delete_project(id: str):
    with Session() as db:
        row = require(db, ProjectRow, id)
        if any(j.data.get('projectId') == id and j.data['status'] in ('queued', 'running') for j in db.scalars(select(JobRow))):
            raise HTTPException(409, 'Cancel active exports before deleting this project')
        # Keep immutable owned media on disk; cleanup is a separately authorized operation.
        db.delete(row)
        db.commit()


@app.post('/api/projects/{id}/duplicate', status_code=201)
def duplicate_project(id: str):
    with Session() as db:
        original = require(db, ProjectRow, id)
        row = ProjectRow(id=uid(), data={**original.data, 'title': original.data['title']+' copy', 'createdAt': now(), 'updatedAt': now()})
        db.add(row)
        db.flush()
        for m in db.scalars(select(MediaRow).where(MediaRow.project_id == id)):
            db.add(MediaRow(id=uid(), project_id=row.id, data=dict(m.data)))
        for c in db.scalars(select(ClipRow).where(ClipRow.project_id == id)):
            db.add(ClipRow(id=uid(), project_id=row.id, data={**c.data, 'edit': {**c.data['edit'], 'revision': 0}}, revision=0))
        db.commit()
        return project_json(db, row)


def validate_media_range(db, project_id, edit):
    m = db.scalars(select(MediaRow).where(MediaRow.project_id == project_id)).first()
    if not m:
        raise HTTPException(409, 'Import source media first')
    if edit.sourceOutMs > m.data['durationMs']:
        raise HTTPException(422, 'Clip exceeds source duration')


@app.get('/api/projects/{id}/clips')
def clips(id: str):
    return project(id)['clips']


@app.post('/api/projects/{id}/clips', status_code=201)
def create_clip(id: str, body: ClipInput):
    with Session() as db:
        require(db, ProjectRow, id)
        validate_media_range(db, id, body.edit)
        data = body.model_dump()
        data['edit']['revision'] = 0
        row = ClipRow(id=uid(), project_id=id, data={**data, 'sourceKind': 'manual'}, revision=0)
        db.add(row)
        db.commit()
        return {'id': row.id, 'projectId': id, **row.data}


@app.patch('/api/clips/{id}')
def update_clip(id: str, body: ClipInput):
    save_edit(id, body.edit)
    with Session() as db:
        row = require(db, ClipRow, id)
        row.data = {**row.data, **body.model_dump(exclude={'edit'})}
        db.commit()
        return {'id': row.id, 'projectId': row.project_id, **row.data}


@app.delete('/api/clips/{id}', status_code=204)
def delete_clip(id: str):
    with Session() as db:
        db.delete(require(db, ClipRow, id))
        db.commit()


@app.get('/api/clips/{id}/edit-document')
def get_edit(id: str):
    with Session() as db:
        return require(db, ClipRow, id).data['edit']


@app.put('/api/clips/{id}/edit-document')
def save_edit(id: str, body: EditDocument):
    with Session() as db:
        row = require(db, ClipRow, id)
        validate_media_range(db, row.project_id, body)
        next_edit = {**body.model_dump(), 'revision': body.revision+1}
        result = db.execute(update(ClipRow).where(ClipRow.id == id, ClipRow.revision == body.revision).values(data={**row.data, 'edit': next_edit}, revision=body.revision+1))
        if result.rowcount != 1:
            raise HTTPException(409, 'This clip changed in another session. Reload before saving.')
        db.add(EditRevisionRow(id=f'{id}:{body.revision+1}', clip_id=id, data=next_edit))
        db.commit()
        return next_edit


@app.get('/api/campaigns')
def campaigns():
    with Session() as db:
        return [{'id': c.id, **c.data} for c in db.scalars(select(CampaignRow))]


@app.post('/api/campaigns', status_code=201)
def create_campaign(body: CampaignInput):
    with Session() as db:
        row = CampaignRow(id=uid(), data=body.model_dump())
        db.add(row)
        db.commit()
        return {'id': row.id, **row.data}


@app.put('/api/campaigns/{id}')
def update_campaign(id: str, body: CampaignInput):
    with Session() as db:
        row = require(db, CampaignRow, id)
        row.data = body.model_dump()
        db.commit()
        return {'id': id, **row.data}


@app.delete('/api/campaigns/{id}', status_code=204)
def delete_campaign(id: str):
    with Session() as db:
        db.execute(delete(CampaignRow).where(CampaignRow.id == id))
        db.commit()


@app.get('/api/settings')
def settings():
    with Session() as db:
        row = db.get(SettingsRow, 'personal')
        return row.data if row else {}


@app.put('/api/settings')
def save_settings(body: dict):
    allowed = {'theme', 'language', 'defaultDuration', 'defaultRatio', 'defaultCaption', 'performanceProfile', 'exportEncoder'}
    if set(body)-allowed:
        raise HTTPException(422, 'Unknown setting; storage paths are configured by environment variables')
    if 'performanceProfile' in body and body['performanceProfile'] not in ('lite', 'balanced', 'quality'):
        raise HTTPException(422, 'Unknown performance profile')
    if 'exportEncoder' in body and body['exportEncoder'] not in ('libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf'):
        raise HTTPException(422, 'Unknown export encoder')
    with Session() as db:
        db.merge(SettingsRow(id='personal', data=body))
        db.commit()
    return body


from .media import router as media_router  # noqa: E402
from .jobs import router as jobs_router  # noqa: E402
from .direct_media import router as direct_media_router  # noqa: E402
from .analysis import router as analysis_router  # noqa: E402
app.include_router(media_router)
app.include_router(jobs_router)
app.include_router(direct_media_router)
app.include_router(analysis_router)
