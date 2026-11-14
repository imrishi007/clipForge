import subprocess

import pytest

from apps.api.analysis import silence_ranges
from apps.api.media import binary, probe, run
from apps.api.rendering import render_arguments, validate_output
from apps.api.schemas import EditDocument


def test_silence_cuts_preserve_transcribed_speech():
    assert silence_ranges('silence_start: 1.0\nsilence_end: 4.0', 1000, 6000,
                          [{'startMs': 2900, 'endMs': 3500}], 200) == [
        {'startMs': 2200, 'endMs': 2900}, {'startMs': 3500, 'endMs': 4800},
    ]


def test_source_segments_must_be_ordered_and_bound_captions_to_assembled_duration():
    segments = [dict(startMs=500, endMs=1500), dict(startMs=3000, endMs=4000)]
    assert EditDocument(sourceInMs=500, sourceOutMs=4000, sourceSegments=segments).duration_ms == 2000
    with pytest.raises(ValueError, match='Caption exceeds'):
        EditDocument(sourceInMs=500, sourceOutMs=4000, sourceSegments=segments,
                     captions=[dict(id='a', startMs=1800, endMs=2100, text='too late')])
    with pytest.raises(ValueError, match='cannot overlap'):
        EditDocument(sourceInMs=500, sourceOutMs=4000, sourceSegments=[dict(startMs=500, endMs=3200), segments[1]])


def test_rumble_filter_attenuates_low_frequency_in_export(tmp_path):
    from array import array
    from math import cos, pi, sin

    ffmpeg = binary('ffmpeg')
    if not ffmpeg or not binary('ffprobe'):
        pytest.skip('Requires FFmpeg and ffprobe.')
    source = tmp_path / 'rumble.mp4'
    run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=s=320x180:r=30:d=2', '-f', 'lavfi', '-i',
         'aevalsrc=0.2*sin(2*PI*30*t)+0.2*sin(2*PI*440*t):d=2', '-c:v', 'libx264', '-c:a', 'aac', str(source)])
    output = tmp_path / 'filtered.mp4'
    edit = EditDocument(sourceOutMs=2000, reduceRumble=True)
    run(render_arguments(source, output, edit, True, threads=2))
    validate_output(probe(output), edit, True, output.stat().st_size)
    raw = subprocess.check_output([ffmpeg, '-v', 'error', '-ss', '0.5', '-i', str(output), '-t', '1', '-map', '0:a:0',
                                   '-ar', '8000', '-ac', '1', '-f', 's16le', 'pipe:1'])
    samples = array('h', raw)

    def amplitude(hz):
        phase = [2 * pi * hz * index / 8000 for index in range(len(samples))]
        return abs(complex(sum(value * cos(angle) for value, angle in zip(samples, phase)),
                           sum(value * sin(angle) for value, angle in zip(samples, phase)))) / len(samples)

    assert amplitude(440) > 2000 and amplitude(30) / amplitude(440) < .2


@pytest.mark.parametrize('audio', [True, False])
def test_disjoint_ranges_render_in_order_with_or_without_audio(client, tmp_path, audio, monkeypatch):
    ffmpeg = binary('ffmpeg')
    if not ffmpeg or not binary('ffprobe'):
        pytest.skip('Requires FFmpeg and ffprobe.')
    source = tmp_path / 'source.mp4'
    audio_args = ['-f', 'lavfi', '-i', "aevalsrc=if(between(t\\,1.1\\,3.1)\\,0\\,0.3*sin(2*PI*440*t)):d=4"] if audio else []
    run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x180:r=30:d=4', *audio_args,
         '-vf', "drawbox=x=0:y=0:w=320:h=180:color=blue:t=fill:enable='gte(t,3)'", '-c:v', 'libx264',
         *(['-c:a', 'aac'] if audio else []), str(source)])
    if audio:
        project = client.post('/api/projects', json={'title': 'Audio pauses'}).json()['id']
        with source.open('rb') as file:
            response = client.post(f'/api/projects/{project}/media', files={'file': ('source.mp4', file, 'video/mp4')})
        assert response.status_code == 201, response.text
        clip = client.post(f'/api/projects/{project}/clips', json={'title': 'Tight cut', 'edit': {'sourceOutMs': 4000}}).json()['id']
        response = client.get(f'/api/clips/{clip}/silence', params={'startMs': 500, 'endMs': 4000})
        assert response.status_code == 200, response.text
        found, = response.json()['ranges']
        assert found['startMs'] == pytest.approx(1280, abs=40) and found['endMs'] == pytest.approx(2920, abs=40)
        peaks = client.get(f'/api/clips/{clip}/waveform', params={'startMs': 0, 'endMs': 4000}).json()['peaks']
        assert len(peaks) == 320 and peaks[40] > .2 and peaks[150] < .01
        with monkeypatch.context() as patch:
            from apps.api import analysis

            def unexpected_decode(*args):
                raise AssertionError('A cached waveform must not decode the source again')

            patch.setattr(analysis, 'waveform', unexpected_decode)
            assert client.get(f'/api/clips/{clip}/waveform', params={'startMs': 0, 'endMs': 4000}).json()['peaks'] == peaks
    edit = EditDocument(sourceInMs=200, sourceOutMs=3900, resolution='540',
                        sourceSegments=[dict(startMs=200, endMs=1000), dict(startMs=3100, endMs=3900)])
    if audio:
        result = client.post(f'/api/clips/{clip}/loudness', json=edit.model_dump())
        assert result.status_code == 200, result.text
        measured = result.json()
        assert measured['gainDb'] == pytest.approx(-16 - measured['loudnessLufs'], abs=.05)
        edit.loudnessGainDb = measured['gainDb']
    output = tmp_path / 'output.mp4'
    result = subprocess.run(render_arguments(source, output, edit, audio), cwd=tmp_path, capture_output=True, timeout=45)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    metadata = probe(output)
    validate_output(metadata, edit, audio, output.stat().st_size)
    assert metadata['durationMs'] == pytest.approx(1600, abs=55)
    if audio:
        from apps.api.audio import loudness_gain

        output_metrics = loudness_gain(output, EditDocument(sourceOutMs=1500))
        assert output_metrics['loudnessLufs'] == pytest.approx(-16, abs=1)
    for seconds, red in [(.3, True), (1.1, False)]:
        data = subprocess.check_output([ffmpeg, '-v', 'error', '-ss', str(seconds), '-i', str(output),
                                        '-frames:v', '1', '-vf', 'crop=2:2', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
        assert data[0] > data[2] if red else data[2] > data[0]

    edit.cutFadeMs = 150
    faded = tmp_path / 'faded.mp4'
    run(render_arguments(source, faded, edit, audio))
    assert probe(faded)['durationMs'] == pytest.approx(metadata['durationMs'], abs=35)
    frame = subprocess.check_output([ffmpeg, '-v', 'error', '-ss', '0.8', '-i', str(faded), '-frames:v', '1',
                                     '-vf', 'crop=2:2', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
    assert frame and max(frame) < 45
    if audio:
        from apps.api.audio import waveform

        peaks = waveform(faded, 0, 1600)
        assert peaks[159] < peaks[120] / 4
