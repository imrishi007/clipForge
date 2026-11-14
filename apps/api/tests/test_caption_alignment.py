import pytest

from apps.api.captions import transcript_captions
from apps.api.rendering import ass_document
from apps.api.schemas import EditDocument


def test_source_alignment_is_rebased_and_corrected_text_uses_sentence_timing():
    segments = [
        {'startMs': 500, 'endMs': 3000, 'text': 'नमस्ते ClipForge', 'words': [
            {'startMs': 700, 'endMs': 1500, 'text': 'नमस्ते'}, {'startMs': 1700, 'endMs': 2500, 'text': 'ClipForge'},
        ]},
        {'startMs': 3100, 'endMs': 4000, 'text': 'यह एक सुधार है।', 'words': []},
    ]
    captions = transcript_captions(segments, 1000, 3900)
    assert captions[0].words[0].startMs == 0
    assert captions[0].words[1].startMs == 700
    assert captions[1].words == [] and captions[1].endMs == 2900
    edit = EditDocument(sourceInMs=1000, sourceOutMs=3900, captions=captions, captionAnimation='pop', captionHighlight='#FFCC33')
    ass = ass_document(edit)
    assert r'{\1c&H33CCFF&}नमस्ते' in ass
    assert '0:00:00.00,0:00:00.50' in ass
    assert r'\fscx' in ass
    assert 'यह एक सुधार है।' in ass


def test_partial_alignment_falls_back_and_invalid_word_times_are_rejected():
    caption = transcript_captions([{'startMs': 0, 'endMs': 2000, 'text': 'Hello world', 'words': [
        {'startMs': 0, 'endMs': 700, 'text': 'Hello'},
    ]}], 0, 2000)[0]
    assert caption.text == 'Hello world' and not caption.words
    with pytest.raises(ValueError, match='Word timings'):
        EditDocument(captions=[dict(id='c', startMs=0, endMs=1000, text='Hello',
                                    words=[dict(startMs=10, endMs=1001, text='Hello')])])
