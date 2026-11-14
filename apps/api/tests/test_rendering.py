import pytest
from pathlib import Path
from apps.api import rendering
from apps.api.schemas import EditDocument, Caption


def test_safe_render_args_and_exact_time(monkeypatch):
    monkeypatch.setattr(rendering, 'binary', lambda _: 'ffmpeg.exe')
    edit = EditDocument(sourceInMs=2000, sourceOutMs=8000, focalX=.25, fadeIn=1, fadeOut=1)
    args = rendering.render_arguments(Path('C:/media/हिंदी & video.mp4'), Path('output.mp4'), edit, True)
    assert args[args.index('-ss')+1] == '2.000000'
    assert args[args.index('-t')+1] == '6.000000'
    assert 'C:\\media\\हिंदी & video.mp4' in args or 'C:/media/हिंदी & video.mp4' in args
    assert 'crop=1080:1920:(iw-ow)*0.25' in args[args.index('-vf')+1]
    assert 'afade=t=out:st=5.0:d=1.0' in args[args.index('-af')+1]
    no_audio = rendering.render_arguments(Path('a.mp4'), Path('b.mp4'), EditDocument(cropMode='fit'), False)
    assert '-an' in no_audio and '-af' not in no_audio
    assert 'pad=1080:1920' in no_audio[no_audio.index('-vf')+1]


def test_zoom_is_centered_after_framing_and_before_subtitles(monkeypatch):
    monkeypatch.setattr(rendering, 'binary', lambda _: 'ffmpeg.exe')
    edit = EditDocument(zoomPercent=125, captions=[Caption(id='c', startMs=0, endMs=500, text='Hello')])
    args = rendering.render_arguments(Path('in.mp4'), Path('out.mp4'), edit, False)
    filters = args[args.index('-vf') + 1]
    assert 'crop=864:1536,scale=1080:1920,setsar=1,setpts=PTS-STARTPTS,ass=' in filters
    with pytest.raises(ValueError):
        EditDocument(zoomPercent=151)


def test_source_rate_and_quality_are_explicit_and_legacy_rate_is_preserved(monkeypatch):
    monkeypatch.setattr(rendering, 'binary', lambda _: 'ffmpeg.exe')
    source, output = Path('source.mp4'), Path('out.mp4')
    auto = EditDocument(preserveSourceFps=True, quality='high', saturation=1.1)
    args = rendering.render_arguments(source, output, auto, False, '24000/1001')
    assert args[args.index('-r') + 1] == '24000/1001'
    assert args[args.index('-crf') + 1] == '17'
    assert 'eq=saturation=1.1' in args[args.index('-vf') + 1]
    default = rendering.render_arguments(source, output, EditDocument(), False, '24000/1001')
    assert default[default.index('-r') + 1] == '30'
    fallback = rendering.render_arguments(source, output, auto, False, '0/0')
    assert fallback[fallback.index('-r') + 1] == '30'


def test_unicode_subtitles_and_injection_neutralized():
    edit = EditDocument(captions=[Caption(id='c', startMs=1234, endMs=5432, text='नमस्ते दुनिया\n{\\pos(0,0)}Hello')])
    ass = rendering.ass_document(edit)
    assert 'नमस्ते दुनिया\\N｛＼pos(0,0)｝Hello' in ass
    assert '0:00:01.23,0:00:05.43' in ass
    assert '00:00:01,234 --> 00:00:05,432' in rendering.srt_document(edit)


def test_final_validation_and_filenames():
    edit = EditDocument(sourceInMs=2000, sourceOutMs=8000)
    good = {'width': 1080, 'height': 1920, 'durationMs': 6030, 'codec': 'h264', 'hasAudio': True, 'audioStreams': [{'codec': 'aac'}]}
    rendering.validate_output(good, edit, True, 10000)
    for bad in [{**good, 'width': 100}, {**good, 'durationMs': 7000}, {**good, 'codec': 'hevc'}, {**good, 'hasAudio': False}]:
        with pytest.raises(ValueError):
            rendering.validate_output(bad, edit, True, 10000)
    name = rendering.safe_filename('../../CON:my?clip', '12345678-abc')
    assert '/' not in name and ':' not in name and name.endswith('12345678.mp4')


def test_proxy_fills_a_trailing_container_gap(tmp_path):
    import subprocess
    from apps.api.media import binary, probe, run

    ffmpeg = binary('ffmpeg')
    if not ffmpeg or not binary('ffprobe'):
        pytest.skip('Requires FFmpeg and ffprobe.')
    source = tmp_path / 'source.mp4'
    output = tmp_path / 'proxy.mp4'
    run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=30:d=1',
         '-f', 'lavfi', '-i', 'sine=d=1', '-c:v', 'libx264', '-c:a', 'aac', str(source)])
    edit = EditDocument(sourceOutMs=1800, resolution='540')
    result = subprocess.run(rendering.render_arguments(source, output, edit, True, pad_to_duration=True),
                            capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    assert probe(output)['durationMs'] == pytest.approx(1800, abs=35)
