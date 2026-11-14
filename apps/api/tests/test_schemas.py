import pytest
from pydantic import ValidationError
from apps.api.schemas import EditDocument, Caption, CampaignInput


def test_edit_boundaries():
    assert EditDocument(sourceInMs=2000, sourceOutMs=8000).duration == 6
    for params in [{'sourceInMs': 12000}, {'focalX': 2}, {'ratio': 'bad'}, {'schemaVersion': 2}]:
        with pytest.raises(ValidationError):
            EditDocument(**params)


def test_caption_relative_time():
    c = Caption(id='hi', startMs=0, endMs=6000, text='नमस्ते दुनिया')
    assert EditDocument(sourceInMs=2000, sourceOutMs=8000, captions=[c]).captions[0].text == c.text
    with pytest.raises(ValidationError):
        EditDocument(sourceInMs=2000, sourceOutMs=7000, captions=[c])
    with pytest.raises(ValidationError):
        Caption(id='bad', startMs=100, endMs=50, text='bad')


def test_geometry_and_campaign_limits():
    assert EditDocument().dimensions == (1080, 1920)
    assert EditDocument(ratio='16:9', resolution='540').dimensions == (540, 304)
    with pytest.raises(ValidationError):
        CampaignInput(title='Test', minSeconds=80, maxSeconds=60)
