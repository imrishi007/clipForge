"""Build editable clip captions from existing source-aligned transcript words."""

from .database import uid
from .schemas import Caption, CaptionWord


def transcript_captions(segments, start, end):
    captions = []
    for segment in segments:
        cue_start, cue_end = max(start, segment['startMs']), min(end, segment['endMs'])
        if cue_start >= cue_end:
            continue
        text = segment['text']
        aligned = segment.get('words', [])
        if not aligned or text.split() != [word['text'] for word in aligned] or any(len(word['text']) > 200 for word in aligned):
            captions.append(Caption(id=uid(), startMs=cue_start - start, endMs=cue_end - start, text=text))
            continue

        words = [CaptionWord(startMs=max(cue_start, word['startMs']) - start, endMs=min(cue_end, word['endMs']) - start,
                             text=word['text']) for word in aligned
                 if word['startMs'] < cue_end and word['endMs'] > cue_start]
        if not words:
            continue
        groups = [[]]
        for word in words:
            group = groups[-1]
            if group and (len(group) >= 8 or sum(len(item.text) + 1 for item in group) + len(word.text) > 44
                          or group[-1].text.endswith(('.', '!', '?', '।', '॥'))):
                group = []
                groups.append(group)
            group.append(word)
        for group in groups:
            captions.append(Caption(id=uid(), startMs=group[0].startMs, endMs=group[-1].endMs,
                                    text=' '.join(word.text for word in group), words=group))
    return captions
