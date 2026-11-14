"""Rank bounded source-derived windows with a local pretrained GGUF model."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def local_runtime():
    root = Path(__file__).resolve().parents[2]
    runtime = Path(os.environ.get('CLIPFORGE_LLM_RUNTIME', root / '.tools/highlight-runtime/node_modules/node-llama-cpp/dist/index.js'))
    model = os.environ.get('CLIPFORGE_HIGHLIGHT_MODEL')
    node = shutil.which('node')
    if model and Path(model).is_file() and runtime.is_file() and node:
        return [node, str(root / 'scripts/rank-highlights.mjs'), str(runtime.resolve()), str(Path(model).resolve())]
    return None


def candidate_windows(segments, scenes, duration_ms, minimum=30, maximum=50):
    minimum, maximum = minimum * 1000, maximum * 1000
    cuts = [scene['startMs'] for scene in scenes]
    windows = []
    for index, first in enumerate(segments):
        start = first['startMs']
        if windows and start - windows[-1]['startMs'] < min(12000, minimum * .4):
            continue
        end_options = []
        next_index = index
        for next_index in range(index, len(segments)):
            row = segments[next_index]
            length = row['endMs'] - start
            if length > maximum:
                break
            if length >= minimum:
                end_options.append((next_index, row))
        if not end_options:
            continue
        last_index, last = min(end_options, key=lambda item: (
            not item[1]['text'].rstrip().endswith(('.', '!', '?', '।', '॥')),
            abs(item[1]['endMs'] - start - (minimum + maximum) / 2),
        ))
        end = last['endMs']
        excerpt = ' '.join(row['text'] for row in segments[index:last_index + 1])
        if len(excerpt.split()) < 12:
            continue
        before = segments[index - 1]['endMs'] if index else 0
        following = segments[last_index + 1]['startMs'] if last_index + 1 < len(segments) else duration_ms
        start = max((cut for cut in cuts if max(before, start - 500, end - maximum) <= cut <= start), default=start)
        end = min((cut for cut in cuts if end <= cut <= min(following, end + 500, start + maximum)), default=end)
        preview = excerpt if len(excerpt) <= 550 else f'{excerpt[:260]} … {excerpt[-260:]}'
        windows.append({'id': len(windows) + 1, 'startMs': start, 'endMs': end, 'text': preview})
    if len(windows) > 8:
        return [windows[round(index * (len(windows) - 1) / 7)] for index in range(8)]
    return windows


def ranked_picks(windows, result, limit=5):
    if not isinstance(result, dict) or not isinstance(result.get('picks'), list):
        return []
    by_id = {window['id']: window for window in windows}
    ranked = []
    signatures = []
    for pick in result.get('picks', []):
        if not isinstance(pick, dict):
            continue
        if type(pick.get('id')) is not int or pick['id'] not in by_id:
            continue
        window = by_id[pick['id']]
        if any(min(window['endMs'], item['endMs']) - max(window['startMs'], item['startMs']) > .55 * min(
                window['endMs'] - window['startMs'], item['endMs'] - item['startMs']) for item in ranked):
            continue
        tokens = re.findall(r'\S+', window['text'].casefold())
        signature = set(zip(tokens, tokens[1:], tokens[2:]))
        if signature and any(len(signature & other) / len(signature | other) > .58 for other in signatures):
            continue
        title, reason = pick.get('title'), pick.get('reason')
        if isinstance(title, str) and title.strip() and isinstance(reason, str) and reason.strip():
            ranked.append({**window, 'title': title.strip()[:80], 'reason': reason.strip()[:180]})
            signatures.append(signature)
            if len(ranked) >= limit:
                break
    return ranked


def rank_highlights(windows, work, options=None, threads=4, update=lambda _: None):
    args = local_runtime()
    if not args:
        raise ValueError('Configure a local GGUF model and Node llama.cpp runtime first.')
    prompt = work / 'highlight-prompt.json'
    options = options or {}
    candidates = [{'id': row['id'], 'transcript': row['text']} for row in windows]
    prompt.write_text(f'Discovery preferences: {json.dumps(options, ensure_ascii=False)}\n'
                      f'Rank these excerpts:\n{json.dumps(candidates, ensure_ascii=False)}', encoding='utf-8')
    try:
        from time import monotonic

        deadline = monotonic() + 180
        with subprocess.Popen([*args, str(prompt), str(threads)], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              encoding='utf-8', errors='replace', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) |
                              getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)) as process:
            try:
                while True:
                    update(None)
                    remaining = deadline - monotonic()
                    if remaining <= 0:
                        raise ValueError('Highlight ranking exceeded 180 seconds. Retry with fewer active applications.')
                    try:
                        output, errors = process.communicate(timeout=min(1, remaining))
                        break
                    except subprocess.TimeoutExpired:
                        continue
                if process.returncode:
                    raise ValueError(f'The local highlight model failed to rank clips. {errors.strip()[-1200:]}')
                return ranked_picks(windows, json.loads(output), options.get('targetCount', 5))
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()
    finally:
        prompt.unlink(missing_ok=True)
