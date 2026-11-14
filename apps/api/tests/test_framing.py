import os
from pathlib import Path
import subprocess
from time import monotonic

import pytest

from apps.api.framing import Sample, build_path, crop_expression
from apps.api.schemas import EditDocument
from apps.api.media import binary, probe, run
from apps.api.rendering import validate_output


def test_tracks_across_frames_and_holds_through_occlusion():
    samples = [Sample(i * 200, [(x, .5, .12, .18)]) for i, x in enumerate([.3, .35, .4, .45, .5])]
    samples += [Sample(1000, []), Sample(1200, []), Sample(1400, [(.8, .5, .12, .18)], cut=True)]
    path = build_path(samples, 16 / 9, 9 / 16, (.5, .5))
    assert path[0].x < .3
    assert path[0].x < path[1].x < .5
    assert all(frame.timeMs < 1000 for frame in path[:-1])
    assert path[-1].cut and path[-1].x > .85


def test_keeps_primary_face_when_both_cannot_fit():
    samples = [Sample(0, [(.25, .5, .14, .18)]), Sample(200, [(.24, .5, .13, .17), (.8, .5, .2, .23)])]
    assert all(frame.x < .2 for frame in build_path(samples, 16 / 9, 9 / 16, (.5, .5)))


def test_validates_keyframe_order_and_clip_boundaries():
    with pytest.raises(ValueError, match='strictly increasing'):
        EditDocument(framingKeyframes=[dict(timeMs=1000, x=0, y=0), dict(timeMs=1000, x=1, y=1)])
    with pytest.raises(ValueError, match='exceeds clip duration'):
        EditDocument(sourceOutMs=1000, framingKeyframes=[dict(timeMs=1001, x=0, y=0)])
    edit = EditDocument(framingKeyframes=[dict(timeMs=1000, x=0, y=.5), dict(timeMs=2000, x=1, y=.5)])
    assert 'clip(' in crop_expression(edit.framingKeyframes, 'x')


def wait_for_job(client, url):
    from time import sleep

    deadline = monotonic() + 80
    while monotonic() < deadline:
        response = client.get(url)
        assert response.status_code == 200, response.text
        payload = response.json()
        job = payload.get('job', payload)
        if job['status'] not in ('queued', 'running'):
            assert job['status'] == 'succeeded', job
            return payload
        sleep(.1)
    pytest.fail(f'Job timed out: {url}')


@pytest.mark.parametrize('name,caption', [('english.webm', 'A story in English.'), ('hindi.webm', 'हर पल में एक कहानी है।')])
def test_real_source_tracking_and_portrait_export(client, tmp_path, name, caption):
    fixtures = os.environ.get('CLIPFORGE_SPEECH_FIXTURES')
    if not fixtures:
        pytest.skip('Requires the authorized English and Hindi speech fixtures.')
    import psutil

    source = tmp_path / 'source.mp4'
    run([binary('ffmpeg'), '-y', '-ss', '2', '-i', str(Path(fixtures) / name), '-t', '6',
         '-vf', 'scale=640:-2', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', str(source)])
    project = client.post('/api/projects', json={'title': name}).json()['id']
    with source.open('rb') as stream:
        media = client.post(f'/api/projects/{project}/media', files={'file': ('source.mp4', stream, 'video/mp4')})
    assert media.status_code == 201, media.text
    words = [dict(startMs=400 + i * 450, endMs=850 + i * 450, text=word) for i, word in enumerate(caption.split())]
    edit = EditDocument(sourceInMs=500, sourceOutMs=5500, captionHighlight='#FFDB5C', captionAnimation='pop',
                        captionShadow=3, captionY=74,
                        captions=[dict(id='c', startMs=400, endMs=3800, text=caption, words=words)])
    clip = client.post(f'/api/projects/{project}/clips', json={'title': 'tracked', 'edit': edit.model_dump()}).json()['id']
    path = f'/api/clips/{clip}/framing'
    started = monotonic()
    job = client.post(path, json=edit.model_dump(include={'sourceInMs', 'sourceOutMs', 'ratio', 'focalX', 'focalY'}))
    assert job.status_code == 202, job.text
    result = wait_for_job(client, f'{path}/{job.json()["id"]}')['result']
    assert result['faceFrames'] >= 10 and result['sampledFrames'] >= 24
    horizontal = [frame['x'] for frame in result['keyframes']]
    assert len(horizontal) > 1 and max(horizontal) - min(horizontal) > .015
    repeated = client.post(path, json=edit.model_dump(include={'sourceInMs', 'sourceOutMs', 'ratio', 'focalX', 'focalY'}))
    cached = wait_for_job(client, f'{path}/{repeated.json()["id"]}')['result']
    assert cached['cached'] and cached['keyframes'] == result['keyframes']
    saved = client.put(f'/api/clips/{clip}/edit-document', json={**edit.model_dump(), 'framingKeyframes': result['keyframes']})
    assert saved.status_code == 200, saved.text
    assert saved.json()['framingKeyframes'] == result['keyframes']
    tracked = monotonic() - started
    response = client.post(f'/api/clips/{clip}/render')
    assert response.status_code == 202, response.text
    render_id = response.json()['id']
    rendered = wait_for_job(client, f'/api/exports/{render_id}')
    output_dir = Path(os.environ.get('CLIPFORGE_FRAMING_EVIDENCE', tmp_path))
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f'{Path(name).stem}-framed.mp4'
    output.write_bytes(client.get(f'/api/exports/{render_id}/download').content)
    assert rendered['bytes'] == output.stat().st_size
    validate_output(probe(output), edit, True, output.stat().st_size)
    memory = psutil.Process().memory_info()
    print(f'{name}: {result["faceFrames"]}/{result["sampledFrames"]} frames with faces, '
          f'{len(result["keyframes"])} keyframes, tracked in {tracked:.2f}s, '
          f'export in {monotonic() - started - tracked:.2f}s, API RSS {memory.rss/2**20:.1f} MiB')


def test_export_samples_the_same_crop_path(tmp_path):
    from apps.api.rendering import render_arguments

    ffmpeg = binary('ffmpeg')
    if not ffmpeg:
        pytest.skip('Requires FFmpeg.')
    source = tmp_path / 'colors.mp4'
    run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x180:r=30:d=4',
         '-vf', 'drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill', '-c:v', 'libx264', str(source)])
    edit = EditDocument(sourceInMs=500, sourceOutMs=3500, resolution='540', framingKeyframes=[
        dict(timeMs=0, x=0, y=.5), dict(timeMs=1000, x=1, y=.5), dict(timeMs=2000, x=0, y=.5, cut=True),
    ])
    output = tmp_path / 'output.mp4'
    process = subprocess.run(render_arguments(source, output, edit, False), cwd=tmp_path, capture_output=True, timeout=45)
    assert process.returncode == 0, process.stderr.decode(errors='replace')
    for seconds, red in [(0.2, True), (0.8, False), (1.8, False), (2.1, True)]:
        frame = subprocess.check_output([ffmpeg, '-v', 'error', '-ss', str(seconds), '-i', str(output),
                                         '-frames:v', '1', '-vf', 'crop=2:2', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
        assert frame[0] > frame[2] if red else frame[2] > frame[0]
