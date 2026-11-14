"""Local processing limits and runtime hardware checks."""

from functools import lru_cache
import os
import shutil
import subprocess
import tempfile
from threading import Lock, RLock
from pathlib import Path

from .media import binary, probe

PROFILES = {'lite': (360, 2), 'balanced': (540, 4), 'quality': (720, 6)}
ENCODERS = {'h264_nvenc': 'NVENC', 'h264_qsv': 'Quick Sync', 'h264_amf': 'AMF'}
processing_slot = RLock()
audio_slot = Lock()


def cpu_threads(profile, ai=False):
    budget = PROFILES.get(profile, PROFILES['lite'])[1]
    if ai:
        try:
            budget = min(budget, int(os.environ.get('CLIPFORGE_AI_CPU_THREADS', budget)))
        except ValueError:
            pass
    return max(1, min(budget, max(1, (os.cpu_count() or 2) - 2)))


def encoder_options(encoder, quality):
    if encoder == 'h264_nvenc':
        q = {'high': '20', 'standard': '23', 'compact': '27'}[quality]
        return ['-preset', 'hq', '-rc', 'vbr', '-cq', q, '-b:v', '0']
    if encoder == 'h264_qsv':
        q = {'high': '17', 'standard': '20', 'compact': '24'}[quality]
        return ['-preset', 'veryfast', '-global_quality', q]
    if encoder == 'h264_amf':
        q = {'high': '17', 'standard': '20', 'compact': '24'}[quality]
        return ['-quality', 'quality', '-rc', 'cqp', '-qp_i', q, '-qp_p', q]
    q = {'high': '17', 'standard': '20', 'compact': '24'}[quality]
    return ['-preset', 'veryfast', '-crf', q]


def execute(args, limit=12):
    try:
        result = subprocess.run(args, capture_output=True, encoding='utf-8', errors='replace', timeout=limit,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return result.returncode == 0, result.stdout if result.returncode == 0 else result.stderr.strip()[-600:]
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)


def hardware_checks():
    ffmpeg = binary('ffmpeg')
    ffprobe = binary('ffprobe')
    if not ffmpeg or not ffprobe:
        return {}
    if not processing_slot.acquire(blocking=False):
        return None
    try:
        return checked_hardware(ffmpeg, ffprobe, Path(ffmpeg).stat().st_mtime_ns, Path(ffprobe).stat().st_mtime_ns)
    finally:
        processing_slot.release()


@lru_cache(maxsize=2)
def checked_hardware(ffmpeg, ffprobe, ffmpeg_version, ffprobe_version):
    results = {}
    with tempfile.TemporaryDirectory(prefix='clipforge-hardware-') as folder:
        root = Path(folder)
        common = [ffmpeg, '-y', '-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30', '-frames:v', '15']
        for encoder in ENCODERS:
            output = root / (encoder + '.mp4')
            ok, detail = execute([*common, '-c:v', encoder, *encoder_options(encoder, 'standard'), '-pix_fmt', 'nv12', str(output)])
            if ok:
                try:
                    metadata = probe(output)
                    ok = (metadata['codec'], metadata['width'], metadata['height'], metadata['durationMs']) == ('h264', 360, 640, 500)
                    detail = '' if ok else 'The probe output did not match H.264, dimensions or duration.'
                except Exception as error:
                    ok, detail = False, str(getattr(error, 'detail', error))
            results[encoder] = {'available': ok, 'detail': detail}
        sample = root / 'decode.mp4'
        if execute([*common, '-c:v', 'libx264', '-threads', '1', str(sample)])[0]:
            ok, detail = execute([ffmpeg, '-hide_banner', '-v', 'error', '-xerror', '-hwaccel', 'cuda', '-hwaccel_output_format',
                                  'cuda', '-i', str(sample), '-frames:v', '15', '-f', 'null', '-'])
            results['nvdec'] = {'available': ok, 'detail': detail}
    return results


def resource_snapshot():
    status = {'logicalCpus': os.cpu_count()}
    try:
        import psutil
        memory = psutil.virtual_memory()
        status.update(ramMiB=memory.total // 2**20, availableRamMiB=memory.available // 2**20)
    except ImportError:
        if os.name == 'nt':
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [('length', ctypes.c_uint32), ('load', ctypes.c_uint32), ('total', ctypes.c_uint64),
                            ('available', ctypes.c_uint64), ('remaining', ctypes.c_uint64 * 5)]

            data = MemoryStatus()
            data.length = ctypes.sizeof(data)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(data)):
                status.update(ramMiB=data.total // 2**20, availableRamMiB=data.available // 2**20)
    nvidia = shutil.which('nvidia-smi')
    if nvidia:
        ok, line = execute([nvidia, '--query-gpu=name,memory.total,memory.used,temperature.gpu', '--format=csv,noheader,nounits'], 3)
        if ok and line.strip():
            fields = line.splitlines()[0].split(',')
            if len(fields) == 4:
                name, total, used, temperature = (field.strip() for field in fields)
                status['gpu'] = {'name': name, 'totalMiB': int(total) if total.isdigit() else None,
                                 'usedMiB': int(used) if used.isdigit() else None,
                                 'temperatureC': int(temperature) if temperature.isdigit() else None}
    return status
