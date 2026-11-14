import os
from pathlib import Path
import subprocess
import time

import pytest

from apps.api.media import binary, probe, run
from apps.api.rendering import ass_document, render_arguments, validate_output
from apps.api.scenes import detect_scenes
from apps.api.schemas import Caption, EditDocument


def test_scene_analysis_reuses_versioned_source_cache(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from apps.api import analysis, scenes

    samples = []
    finished = []
    monkeypatch.setattr(analysis, 'get_job', lambda _: {})
    monkeypatch.setattr(analysis, 'patch_job', lambda _, **kwargs: finished.append(kwargs))
    monkeypatch.setattr(analysis, 'safe_path', lambda value: tmp_path / value)
    monkeypatch.setattr(analysis, 'DATA_DIR', tmp_path)
    monkeypatch.setattr(scenes, 'detect_scenes', lambda source, duration: samples.append(duration) or {'scenes': []})
    adapter = SimpleNamespace(stopping=SimpleNamespace(is_set=lambda: False))
    job = {'type': 'scenes', 'durationMs': 12000, 'sourceHash': 'source-one'}
    for id, source_hash in [('first', 'source-one'), ('second', 'source-one'), ('third', 'source-two')]:
        analysis.run_analysis(id, {**job, 'sourceHash': source_hash}, tmp_path / 'source.mp4', adapter)
    assert samples == [12000, 12000]
    assert analysis.read_artifact(tmp_path / 'analysis/second.json')['cached']
    assert finished[-1]['status'] == 'succeeded'


def test_scene_detection_on_real_footage_with_known_join(tmp_path):
    folder = os.environ.get('CLIPFORGE_SPEECH_FIXTURES')
    if not folder:
        pytest.skip('Requires the authorized English and Hindi speech fixtures.')
    import psutil

    paths = [Path(folder) / name for name in ('english.webm', 'hindi.webm')]
    output = tmp_path / 'joined.mp4'
    run([binary('ffmpeg'), '-y', '-ss', '2', '-t', '4', '-i', str(paths[0]), '-ss', '2', '-t', '4', '-i', str(paths[1]),
         '-filter_complex', '[0:v]scale=640:360,setsar=1,fps=24[a];[1:v]scale=640:360,setsar=1,fps=24[b];[a][b]concat=n=2:v=1:a=0[v]',
         '-map', '[v]', '-c:v', 'libx264', '-threads', '2', '-an', str(output)])
    process = psutil.Process()
    for path, duration in [*zip(paths, (74000, 102000)), (output, 8000)]:
        started = time.perf_counter()
        before = process.memory_info().rss
        result = detect_scenes(path, duration)
        rows = result['scenes']
        assert rows[0]['startMs'] == 0 and all(0 <= row['startMs'] < row['endMs'] <= duration for row in rows)
        if path == output:
            assert any(abs(row['startMs'] - 4000) <= 85 for row in rows)
        peak = process.memory_info().peak_wset if hasattr(process.memory_info(), 'peak_wset') else process.memory_info().rss
        print(f'{path.name}: {len(rows)} scenes; {time.perf_counter()-started:.2f}s; RSS before {before/2**20:.1f} MiB, process peak {peak/2**20:.1f} MiB')

    boundary = min((row['startMs'] for row in rows if row['startMs'] > 0), key=lambda value: abs(value - 4000))
    for label, start, end, text in [('English', 1000, boundary, 'A story in English.'),
                                    ('Hindi', boundary, 7000, 'हर पल में एक कहानी है।')]:
        edit = EditDocument(sourceInMs=start, sourceOutMs=end, resolution='720', zoomPercent=125,
                            captions=[Caption(id='c', startMs=0, endMs=1500, text=text)])
        (tmp_path / 'captions.ass').write_text(ass_document(edit), encoding='utf-8-sig')
        rendered = tmp_path / f'{label}.mp4'
        started = time.perf_counter()
        encoded = subprocess.run(render_arguments(output, rendered, edit, False), cwd=tmp_path,
                                 capture_output=True, timeout=45)
        assert encoded.returncode == 0, encoded.stderr.decode(errors='replace')
        metadata = probe(rendered)
        validate_output(metadata, edit, False, rendered.stat().st_size)
        assert not metadata['hasAudio']
        assert metadata['durationMs'] == pytest.approx(end - start, abs=50)
        print(f'{label} scene cut: {start}–{end} ms, rendered in {time.perf_counter()-started:.2f}s')
