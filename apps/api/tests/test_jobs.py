import pytest
from fastapi import HTTPException
from apps.api import jobs, main
from apps.api.database import Session, MediaRow, DATA_DIR, JobRow
from apps.api.schemas import ProjectInput, ClipInput, EditDocument


def setup_clip(monkeypatch):
    monkeypatch.setattr(jobs, 'binary', lambda name: name)
    monkeypatch.setattr(jobs.worker, 'enqueue', lambda id: None)
    p = main.create_project(ProjectInput(title='Source'))
    path = DATA_DIR/'test-source.mp4'
    path.write_bytes(b'storage fixture, not actual video')
    with Session() as db:
        db.add(MediaRow(id='media', project_id=p['id'], data={'durationMs': 12000, 'path': 'test-source.mp4', 'hasAudio': False}))
        db.commit()
    clip = main.create_clip(p['id'], ClipInput(title='Cut', edit=EditDocument()))
    return p, clip


def test_queue_cancel_retry_and_idempotence(database, monkeypatch):
    _, clip = setup_clip(monkeypatch)
    first = jobs.enqueue_render(clip['id'])
    assert first['status'] == 'queued' and first['progress'] is None
    assert 'sourcePath' not in first and 'edit' not in first
    assert jobs.enqueue_render(clip['id'])['id'] == first['id']
    assert jobs.cancel_job(first['id'])['status'] == 'cancelled'
    assert jobs.retry_job(first['id'])['status'] == 'queued'
    with pytest.raises(HTTPException):
        jobs.download_export(first['id'])
    with pytest.raises(HTTPException):
        main.delete_project(clip['projectId'])


def test_batch_records_distinct_snapshot_jobs(database, monkeypatch):
    p, clip = setup_clip(monkeypatch)
    for index in range(4):
        main.create_clip(p['id'], ClipInput(title=f'Cut {index}', edit=EditDocument(sourceInMs=index*1000, sourceOutMs=(index+2)*1000)))
    batch = jobs.render_batch(p['id'])
    assert len(batch) == len({j['id'] for j in batch}) == 5
    assert len({j['filename'] for j in batch}) == 5
    original = jobs.get_job(batch[0]['id'])['edit']
    main.save_edit(clip['id'], EditDocument(sourceOutMs=6000))
    assert jobs.get_job(batch[0]['id'])['edit'] == original


def test_recovery_never_reports_interrupted_success(database):
    with Session() as db:
        for id, status in [('a', 'running'), ('b', 'queued'), ('c', 'succeeded')]:
            db.add(JobRow(id=id, data={'type': 'render', 'status': status, 'path': 'exports/missing.mp4'}))
        db.commit()
    resumed = []
    class Adapter:
        def enqueue(self, id):
            resumed.append(id)
    jobs.recover_jobs(Adapter())
    assert jobs.get_job('a')['status'] == 'failed'
    assert jobs.get_job('c')['status'] == 'failed'
    assert resumed == ['b']


def test_worker_missing_source_fails_without_fake_file(database, monkeypatch):
    _, clip = setup_clip(monkeypatch)
    job = jobs.enqueue_render(clip['id'])
    (DATA_DIR/'test-source.mp4').unlink()
    jobs.LocalWorker().run_job(job['id'])
    result = jobs.job_detail(job['id'])
    assert result['status'] == 'failed'
    assert 'missing' in result['error']
    assert not (DATA_DIR/'exports'/job['filename']).exists()


def test_stalled_encoder_releases_the_queue(database, monkeypatch):
    import sys

    _, clip = setup_clip(monkeypatch)
    job = jobs.enqueue_render(clip['id'])
    monkeypatch.setattr(jobs, 'RENDER_STALL_SECONDS', .1)
    monkeypatch.setattr(jobs, 'render_arguments', lambda *args, **kwargs: [sys.executable, '-c', 'import time; time.sleep(60)'])
    worker = jobs.LocalWorker()
    worker.run_job(job['id'])
    result = jobs.job_detail(job['id'])
    assert result['status'] == 'failed' and 'stopped reporting progress' in result['error']
    assert job['id'] not in worker.processes
    assert not (DATA_DIR / 'work' / job['id'] / 'output.partial.mp4').exists()
