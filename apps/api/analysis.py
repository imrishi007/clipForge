"""Source-bound analysis queue and results."""

import json
import hashlib
import os
import re
import subprocess
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from .database import DATA_DIR, JobRow, MediaRow, ProjectRow, Session, now, uid
from .jobs import active_profile, get_job, lock, patch_job, public_job, worker
from .performance import audio_slot, cpu_threads
from .media import binary, safe_path
from .transcription import cuda_runtime_ready, chunk_cache_key, transcribe, transcription_available, transcription_limit, whisper_directory
from .rendering import srt_time
from .highlights import candidate_windows, local_runtime, rank_highlights
from .framing import framing_available, track_clip
from .captions import transcript_captions
from .audio import loudness_gain, waveform
from .schemas import EditDocument
from .database import ClipRow


router = APIRouter()
CAPTION_PRESETS = {
    preset['name']: {key: preset[key] for key in ('color', 'fontSize', 'bold', 'captionBackground')}
    for preset in json.loads((Path(__file__).resolve().parents[2] / 'lib/caption-presets.json').read_text(encoding='utf-8'))
}


class TranscribeRequest(BaseModel):
    language: Literal['Auto', 'English', 'Hindi', 'Hinglish', 'Other'] = 'Auto'


class TranscriptChanges(BaseModel):
    revision: int = Field(ge=0)
    changes: dict[str, str] = Field(min_length=1, max_length=1000)


class HighlightSelection(BaseModel):
    jobId: str
    candidateId: int = Field(ge=1)
    framing: Literal['standard', 'close-up'] = 'standard'


class HighlightOptions(BaseModel):
    targetCount: int = Field(default=5, ge=1, le=8)
    minSeconds: int = Field(default=30, ge=10, le=90)
    maxSeconds: int = Field(default=50, ge=10, le=90)
    category: str = Field(default='General', max_length=60)
    emphasis: Literal['Balanced', 'Humour', 'Suspense', 'Information', 'Storytelling', 'Emotion'] = 'Balanced'
    style: str = Field(default='Podcast Clean', max_length=60)
    language: Literal['Auto', 'English', 'Hindi', 'Hinglish', 'Other'] = 'Auto'

    @model_validator(mode='after')
    def duration_order(self):
        if self.minSeconds > self.maxSeconds:
            raise ValueError('Maximum duration must be at least the minimum duration')
        return self


def current_source(db, project_id):
    if not db.get(ProjectRow, project_id):
        raise HTTPException(404, 'Project not found.')
    media = db.scalar(select(MediaRow).where(MediaRow.project_id == project_id))
    if not media or not safe_path(media.data['path']).is_file():
        raise HTTPException(409, 'Import or relink the original source before analysis.')
    return media


def analysis_jobs(db, media, kind):
    return sorted((row for row in db.scalars(select(JobRow))
                   if row.data['type'] == kind and row.data.get('mediaId') == media.id
                   and row.data.get('sourceHash') == media.data.get('hash')),
                  key=lambda row: row.data['createdAt'], reverse=True)


def result_path(jobs):
    ready = next((row for row in jobs if row.data['status'] == 'succeeded' and safe_path(row.data['path']).is_file()), None)
    return safe_path(ready.data['path']) if ready else None


def enqueue_analysis(db, media, kind, **options):
    jobs = analysis_jobs(db, media, kind)
    active = next((row for row in jobs if row.data['status'] in {'queued', 'running'}
                   and (kind != 'framing' or (row.data.get('clipId'), row.data.get('framingOptions'))
                        == (options.get('clipId'), options.get('framingOptions')))), None)
    if active:
        return public_job(active)
    row = JobRow(id=uid(), data={'type': kind, 'projectId': media.project_id, 'mediaId': media.id,
                'sourcePath': media.data['path'], 'sourceHash': media.data['hash'], 'durationMs': media.data['durationMs'],
                'status': 'queued', 'stage': 'Queued', 'progress': None, 'createdAt': now(),
                'cancelRequested': False, 'logs': [], 'performanceProfile': active_profile(db), **options})
    db.add(row)
    db.commit()
    worker.enqueue(row.id)
    return public_job(row)


@router.get('/api/projects/{id}/transcript')
def transcript(id: str):
    with lock, Session() as db:
        media = current_source(db, id)
        jobs = analysis_jobs(db, media, 'transcription')
        path = result_path(jobs)
        return {'available': transcription_available(), 'hasAudio': media.data['hasAudio'],
                'job': public_job(jobs[0]) if jobs else None,
                'transcript': json.loads(path.read_text(encoding='utf-8')) if path else None}


@router.put('/api/projects/{id}/transcript')
def save_transcript(id: str, body: TranscriptChanges):
    with lock, Session() as db:
        media = current_source(db, id)
        jobs = analysis_jobs(db, media, 'transcription')
        path = result_path(jobs)
        if not path or jobs[0].data['status'] in {'queued', 'running'}:
            raise HTTPException(409, 'Wait for the current transcription to finish before editing.')
        data = json.loads(path.read_text(encoding='utf-8'))
        if data['revision'] != body.revision:
            raise HTTPException(409, 'Transcript changed. Reload it and apply the correction again.')
        segments = {segment['id']: segment for segment in data['segments']}
        if any(key not in segments or not text.strip() or len(text) > 2000 for key, text in body.changes.items()):
            raise HTTPException(422, 'Each correction must target an existing segment and contain 1–2000 characters.')
        for key, text in body.changes.items():
            segment = segments[key]
            if segment['text'] != text.strip():
                segment.update(text=text.strip(), words=[], corrected=True)
        data['revision'] += 1
        write_result(path, data)
        return data


@router.get('/api/projects/{id}/transcript/subtitles')
def transcript_subtitles(id: str):
    with lock, Session() as db:
        media = current_source(db, id)
        path = result_path(analysis_jobs(db, media, 'transcription'))
        if not path:
            raise HTTPException(404, 'Generate a transcript before downloading subtitles.')
        data = json.loads(path.read_text(encoding='utf-8'))
    # Source transcripts can contain more entries than an editor document.
    captions = (f'{index}\n{srt_time(row["startMs"])} --> {srt_time(row["endMs"])}\n{row["text"]}'
                for index, row in enumerate(data['segments'], 1))
    return Response('\n\n'.join(captions) + '\n', media_type='application/x-subrip',
                    headers={'Content-Disposition': 'attachment; filename="source-transcript.srt"'})


def clip_source(id, start, end, with_transcript=True):
    with lock, Session() as db:
        clip = db.get(ClipRow, id)
        if not clip:
            raise HTTPException(404, 'Clip not found.')
        media = current_source(db, clip.project_id)
        if not 0 <= start < end <= media.data['durationMs']:
            raise HTTPException(422, 'The clip range must fit inside the source media.')
        path = result_path(analysis_jobs(db, media, 'transcription')) if with_transcript else None
        segments = json.loads(path.read_text(encoding='utf-8'))['segments'] if path else None
        return media.data, segments


@router.get('/api/clips/{id}/transcript-captions')
def clip_transcript_captions(id: str, startMs: int, endMs: int):
    _, segments = clip_source(id, startMs, endMs)
    if segments is None:
        raise HTTPException(404, 'Generate a source transcript in Analysis first.')
    captions = transcript_captions(segments, startMs, endMs)
    if len(captions) > 1000:
        raise HTTPException(422, 'This range produces too many captions. Select a shorter clip.')
    return captions


def silence_ranges(log, start, end, transcript, padding):
    ranges = []
    opening = None
    for edge, seconds in re.findall(r'silence_(start|end):\s*([\d.]+)', log):
        time = min(end, start + round(float(seconds) * 1000))
        if edge == 'start':
            opening = time
        elif opening is not None:
            left, right = opening + padding, time - padding
            opening = None
            if right - left < 200:
                continue
            for cue in transcript or []:
                if cue['endMs'] <= left:
                    continue
                if cue['startMs'] >= right:
                    break
                if cue['startMs'] - left >= 200:
                    ranges.append({'startMs': left, 'endMs': cue['startMs']})
                left = max(left, cue['endMs'])
            if right - left >= 200:
                ranges.append({'startMs': left, 'endMs': right})
    return ranges


@router.get('/api/clips/{id}/silence')
def clip_silence(id: str, startMs: int, endMs: int, intensity: Literal['gentle', 'standard', 'tight'] = 'standard'):
    media, transcript = clip_source(id, startMs, endMs)
    ffmpeg = binary('ffmpeg')
    if not ffmpeg:
        raise HTTPException(503, 'Configure FFmpeg to detect silence.')
    if not media['hasAudio'] or endMs - startMs > 180000:
        raise HTTPException(422, 'Silence detection needs audio and a source range of up to 3 minutes.')
    threshold, minimum, padding = {'gentle': (-42, 1.0, 240), 'standard': (-38, .75, 180), 'tight': (-34, .55, 120)}[intensity]
    try:
        with audio_slot:
            process = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe',
                                  '-format_whitelist', 'mov,matroska,webm', '-ss', str(startMs / 1000),
                                  '-i', str(safe_path(media['path'])), '-t', str((endMs - startMs) / 1000),
                                  '-map', '0:a:0', '-af', f'asetpts=PTS-STARTPTS,silencedetect=n={threshold}dB:d={minimum}',
                                  '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=25,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if process.returncode:
            raise ValueError('FFmpeg could not decode the source audio.')
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise HTTPException(422, f'Silence detection failed: {error}') from error
    return {'ranges': silence_ranges(process.stderr, startMs, endMs, transcript, padding), 'speechProtected': transcript is not None}


def audio_source(id, start, end):
    media, _ = clip_source(id, start, end, with_transcript=False)
    if not binary('ffmpeg'):
        raise HTTPException(503, 'Configure FFmpeg to analyze audio.')
    if not media['hasAudio'] or end - start > 180000:
        raise HTTPException(422, 'Audio analysis needs audio and a source range of up to 3 minutes.')
    return safe_path(media['path']), media.get('hash')


@router.get('/api/clips/{id}/waveform')
def clip_waveform(id: str, startMs: int, endMs: int):
    source, source_hash = audio_source(id, startMs, endMs)
    cache = artifact_cache(source_hash, 'waveform-v1', [startMs, endMs]) if source_hash else None
    try:
        result = read_artifact(cache)
        if result is None:
            with audio_slot:
                result = read_artifact(cache)
                if result is None:
                    result = {'peaks': waveform(source, startMs, endMs)}
                    if cache:
                        write_result(cache, result)
        return result
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise HTTPException(422, 'Could not read the selected audio waveform.') from error


@router.post('/api/clips/{id}/loudness')
def clip_loudness(id: str, body: EditDocument):
    source, _ = audio_source(id, body.sourceInMs, body.sourceOutMs)
    try:
        with audio_slot:
            return loudness_gain(source, body)
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise HTTPException(422, f'Could not normalize audio. {error}') from error


@router.post('/api/projects/{id}/transcript', status_code=202)
def enqueue_transcript(id: str, body: TranscribeRequest):
    with lock, Session() as db:
        media = current_source(db, id)
        if not transcription_available():
            raise HTTPException(503, 'Install the optional transcription dependencies and configure a local Whisper model.')
        if not media.data['hasAudio']:
            raise HTTPException(422, 'This source has no audio track to transcribe.')
        if media.data['durationMs'] > transcription_limit():
            raise HTTPException(422, f'Transcription is limited to {transcription_limit() // 60000:g} minutes per source on this machine.')
        return enqueue_analysis(db, media, 'transcription', language=body.language)


def write_result(target, data):
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(f'.{uid()}.partial')
    try:
        partial.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)


def artifact_cache(source_hash, version, config):
    key = hashlib.sha256(json.dumps([source_hash, version, config], sort_keys=True).encode()).hexdigest()
    return safe_path(f'analysis/cache/{key}.json')


def analysis_version(kind):
    from importlib.metadata import PackageNotFoundError, version

    names = ('scenedetect-headless', 'scenedetect', 'opencv-python-headless', 'opencv-contrib-python-headless',
             'opencv-python', 'opencv-contrib-python', 'av') if kind == 'scenes' else (
                 'opencv-python-headless', 'opencv-contrib-python-headless', 'opencv-python', 'opencv-contrib-python')
    installed = []
    for name in names:
        try:
            installed.append((name, version(name)))
        except PackageNotFoundError:
            pass
    return installed


def read_artifact(path):
    if not path:
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def run_analysis(job_id, job, source, adapter):
    from .scenes import detect_scenes

    kind = job['type']
    threads = cpu_threads(job.get('performanceProfile', 'lite'), ai=True)
    stage, completed = {'transcription': ('Transcribing on CPU', 'Transcript ready'),
                        'scenes': ('Detecting scene cuts', 'Scene detection complete'),
                        'highlights': ('Ranking highlights on CPU', 'Highlights ready'),
                        'framing': ('Tracking faces on CPU', 'Framing ready')}[kind]

    last_progress = -1

    def update(position):
        nonlocal last_progress
        if get_job(job_id).get('cancelRequested'):
            raise InterruptedError('Analysis cancelled.')
        if adapter.stopping.is_set():
            raise RuntimeError('Worker stopped. Start analysis again.')
        progress = min(99, int(position * 100 / job['durationMs'])) if position is not None else None
        if progress != last_progress:
            patch_job(job_id, stage=stage, progress=progress)
            last_progress = progress

    if kind == 'transcription':
        device = 'cuda' if os.environ.get('CLIPFORGE_WHISPER_DEVICE') == 'cuda' else 'cpu'
        if device == 'cuda' and not cuda_runtime_ready():
            patch_job(job_id, logs=['CUDA Whisper could not find cublas64_12.dll on PATH. Using CPU INT8.'])
            device = 'cpu'
        while True:
            stage = f'Transcribing on {device.upper()}'
            key = chunk_cache_key(job['sourceHash'], job['language'], whisper_directory(), device)
            try:
                data = transcribe(source, job['durationMs'], job['language'], update, safe_path(f'analysis/cache/{key}'),
                                  threads=threads, device=device)
                break
            except RuntimeError as error:
                if device == 'cpu' or adapter.stopping.is_set():
                    raise
                patch_job(job_id, stage='CUDA unavailable. Retrying on CPU', logs=[str(error)[:600]])
                device = 'cpu'
                last_progress = -1
    elif kind in {'scenes', 'framing'}:
        update(None)
        options = job.get('framingOptions', {})
        cache = artifact_cache(job['sourceHash'], f'{kind}-v1', [job['durationMs'], options, analysis_version(kind)])
        data = read_artifact(cache)
        if data is None:
            data = (detect_scenes(source, job['durationMs']) if kind == 'scenes' else
                    track_clip(source, options, job['sourceMetadata'], update))
            write_result(cache, data)
        else:
            data = {**data, 'cached': True}
    else:
        update(None)
        work = safe_path(f'work/{job_id}')
        work.mkdir(parents=True, exist_ok=True)
        data = {'candidates': rank_highlights(job['windows'], work, job.get('highlightOptions'), threads=threads, update=update),
                'transcriptRevision': job['transcriptRevision'],
                'transcriptResult': job['transcriptResult']}
    target = safe_path(f'analysis/{job_id}.json')
    with lock:
        update(job['durationMs'])
        write_result(target, data)
        patch_job(job_id, status='succeeded', stage=completed, progress=100,
                  path=target.relative_to(DATA_DIR).as_posix(), completedAt=now())


class FramingRequest(BaseModel):
    sourceInMs: int = Field(ge=0)
    sourceOutMs: int = Field(gt=0)
    ratio: Literal['9:16', '4:5', '1:1', '16:9']
    focalX: float = Field(ge=0, le=1)
    focalY: float = Field(ge=0, le=1)


@router.post('/api/clips/{id}/framing', status_code=202)
def enqueue_framing(id: str, body: FramingRequest):
    with lock, Session() as db:
        clip = db.get(ClipRow, id)
        if not clip:
            raise HTTPException(404, 'Clip not found.')
        media = current_source(db, clip.project_id)
        duration = body.sourceOutMs - body.sourceInMs
        if not 200 <= duration <= 180000 or body.sourceOutMs > media.data['durationMs']:
            raise HTTPException(422, 'Select a source range between 0.2 seconds and 3 minutes.')
        if not framing_available():
            raise HTTPException(503, 'Install OpenCV with its face cascade and configure FFmpeg to track faces.')
        return enqueue_analysis(db, media, 'framing', clipId=id, framingOptions=body.model_dump(),
                                sourceMetadata=media.data, durationMs=duration)


@router.get('/api/clips/{id}/framing/{job_id}')
def framing_result(id: str, job_id: str):
    with lock, Session() as db:
        clip = db.get(ClipRow, id)
        if not clip:
            raise HTTPException(404, 'Clip not found.')
        media = current_source(db, clip.project_id)
        row = db.get(JobRow, job_id)
        if (not row or row.data['type'] != 'framing' or row.data['clipId'] != id
                or row.data['mediaId'] != media.id or row.data['sourceHash'] != media.data['hash']):
            raise HTTPException(404, 'Framing result unavailable for this source.')
        path = result_path([row])
        return {'job': public_job(row), 'result': json.loads(path.read_text(encoding='utf-8')) if path else None}


@router.get('/api/projects/{id}/scenes')
def scene_results(id: str):
    from .scenes import scene_detection_available

    with lock, Session() as db:
        media = current_source(db, id)
        jobs = analysis_jobs(db, media, 'scenes')
        path = result_path(jobs)
        return {'available': scene_detection_available(), 'job': public_job(jobs[0]) if jobs else None,
                'result': json.loads(path.read_text(encoding='utf-8')) if path else None}


@router.post('/api/projects/{id}/scenes', status_code=202)
def enqueue_scenes(id: str):
    from .scenes import scene_detection_available

    with lock, Session() as db:
        media = current_source(db, id)
        if not scene_detection_available():
            raise HTTPException(503, 'Install PySceneDetect to detect cuts locally.')
        return enqueue_analysis(db, media, 'scenes')


@router.get('/api/projects/{id}/highlights')
def highlight_results(id: str):
    with lock, Session() as db:
        media = current_source(db, id)
        jobs = analysis_jobs(db, media, 'highlights')
        ready = next((row for row in jobs if result_path([row])), None)
        path = result_path([ready]) if ready else None
        transcript_path = result_path(analysis_jobs(db, media, 'transcription'))
        result = json.loads(path.read_text(encoding='utf-8')) if path else None
        # Never present candidates as current after a transcript correction or rerun.
        if result and (not transcript_path or result['transcriptResult'] != transcript_path.stem):
            result = None
        elif result:
            transcript_data = json.loads(transcript_path.read_text(encoding='utf-8'))
            if result['transcriptRevision'] != transcript_data['revision']:
                result = None
        return {'available': local_runtime() is not None, 'job': public_job(jobs[0]) if jobs else None,
                'result': result, 'resultJobId': ready.id if result else None}


@router.post('/api/projects/{id}/highlights', status_code=202)
def enqueue_highlights(id: str, body: HighlightOptions | None = None):
    options = body or HighlightOptions()
    with lock, Session() as db:
        media = current_source(db, id)
        if not local_runtime():
            raise HTTPException(503, 'Configure a local highlight model first.')
        transcript_path = result_path(analysis_jobs(db, media, 'transcription'))
        if not transcript_path:
            raise HTTPException(409, 'Generate a transcript before ranking highlights.')
        transcript_data = json.loads(transcript_path.read_text(encoding='utf-8'))
        scenes_path = result_path(analysis_jobs(db, media, 'scenes'))
        scenes = json.loads(scenes_path.read_text(encoding='utf-8'))['scenes'] if scenes_path else []
        windows = candidate_windows(transcript_data['segments'], scenes, media.data['durationMs'], options.minSeconds, options.maxSeconds)
        rejected = [clip.data['edit'] for clip in db.scalars(select(ClipRow).where(ClipRow.project_id == id))
                    if clip.data.get('sourceKind') == 'ai_highlight' and clip.data.get('status') == 'rejected']
        windows = [window for window in windows if not any(
            min(window['endMs'], edit['sourceOutMs']) - max(window['startMs'], edit['sourceInMs'])
            > .55 * min(window['endMs'] - window['startMs'], edit['sourceOutMs'] - edit['sourceInMs']) for edit in rejected)]
        if not windows:
            raise HTTPException(422, f'No {options.minSeconds}–{options.maxSeconds} second windows with enough transcript context were found.')
        return enqueue_analysis(db, media, 'highlights', windows=windows, transcriptRevision=transcript_data['revision'],
                                transcriptResult=transcript_path.stem, highlightOptions=options.model_dump())


@router.post('/api/projects/{id}/highlights/clip', status_code=201)
def accept_highlight(id: str, body: HighlightSelection):
    with lock, Session() as db:
        media = current_source(db, id)
        row = next((row for row in analysis_jobs(db, media, 'highlights') if row.id == body.jobId), None)
        path = result_path([row]) if row else None
        if not path:
            raise HTTPException(404, 'Highlight result unavailable.')
        result = json.loads(path.read_text(encoding='utf-8'))
        transcript_path = result_path(analysis_jobs(db, media, 'transcription'))
        if not transcript_path or transcript_path.stem != result['transcriptResult']:
            raise HTTPException(409, 'The transcript changed. Rank highlights again.')
        transcript_data = json.loads(transcript_path.read_text(encoding='utf-8'))
        if transcript_data['revision'] != result['transcriptRevision']:
            raise HTTPException(409, 'The transcript changed. Rank highlights again.')
        candidate = next((pick for pick in result['candidates'] if pick['id'] == body.candidateId), None)
        if not candidate:
            raise HTTPException(404, 'Highlight candidate unavailable.')
        return create_transcript_clip(db, id, candidate, transcript_data['segments'], body.framing, 'ai_highlight')


def create_transcript_clip(db, id, candidate, segments, framing, kind):
    captions = transcript_captions(segments, candidate['startMs'], candidate['endMs'])
    preferences = db.get(ProjectRow, id).data.get('preferences', {})
    ratio = preferences.get('ratio', '9:16')
    style = CAPTION_PRESETS.get(preferences.get('captionStyle'), CAPTION_PRESETS['Podcast Clean'])
    edit = EditDocument(sourceInMs=candidate['startMs'], sourceOutMs=candidate['endMs'], captions=captions,
                        ratio=ratio if ratio in {'9:16', '4:5', '1:1', '16:9'} else '9:16',
                        zoomPercent=115 if framing == 'close-up' else 100, captionHighlight='#F5D68C', **style)
    data = {'title': candidate['title'], 'notes': candidate['reason'], 'edit': edit.model_dump(),
            'favorite': False, 'status': 'draft', 'sourceKind': kind}
    clip = ClipRow(id=uid(), project_id=id, data=data, revision=0)
    db.add(clip)
    db.commit()
    return {'id': clip.id, 'projectId': id, **clip.data}


class TranscriptSelection(BaseModel):
    segmentId: str
    revision: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=180)
    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)


@router.post('/api/projects/{id}/transcript/clip', status_code=201)
def transcript_clip(id: str, body: TranscriptSelection):
    with lock, Session() as db:
        media = current_source(db, id)
        path = result_path(analysis_jobs(db, media, 'transcription'))
        if not path:
            raise HTTPException(404, 'Generate a source transcript first.')
        result = json.loads(path.read_text(encoding='utf-8'))
        if body.revision != result['revision']:
            raise HTTPException(409, 'The transcript changed. Reload before creating the clip.')
        anchor = next((segment for segment in result['segments'] if segment['id'] == body.segmentId), None)
        if (not anchor or not body.startMs <= anchor['startMs'] < anchor['endMs'] <= body.endMs <= media.data['durationMs']
                or body.endMs - body.startMs > 180000):
            raise HTTPException(422, 'Keep the selected sentence inside a source range of up to 3 minutes.')
        return create_transcript_clip(db, id, {**body.model_dump(), 'reason': 'Created from a reviewed source transcript range.'},
                                      result['segments'], 'standard', 'manual')
