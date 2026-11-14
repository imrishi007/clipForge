import pytest
from fastapi import HTTPException
from apps.api import main
from apps.api.database import Session, MediaRow
from apps.api.schemas import ProjectInput, ClipInput, EditDocument, CampaignInput


def test_project_transactions(database):
    p = main.create_project(ProjectInput(title='Footage'))
    assert main.project(p['id'])['title'] == 'Footage'
    main.update_project(p['id'], ProjectInput(title='Renamed', folder='Work'))
    copy = main.duplicate_project(p['id'])
    assert copy['title'] == 'Renamed copy'
    main.delete_project(p['id'])
    with pytest.raises(HTTPException) as error:
        main.project(p['id'])
    assert error.value.status_code == 404


def test_clip_revision_transactions(database):
    p = main.create_project(ProjectInput(title='Test'))
    body = ClipInput(title='Cut', edit=EditDocument(sourceInMs=2000, sourceOutMs=8000))
    with pytest.raises(HTTPException):
        main.create_clip(p['id'], body)
    with Session() as db:
        db.add(MediaRow(id='fixture', project_id=p['id'], data={'durationMs': 12000}))
        db.commit()
    clip = main.create_clip(p['id'], body)
    saved = main.save_edit(clip['id'], body.edit)
    assert saved['revision'] == 1
    with pytest.raises(HTTPException) as error:
        main.save_edit(clip['id'], body.edit)
    assert error.value.status_code == 409
    assert main.get_edit(clip['id'])['revision'] == 1
    assert main.project(p['id'])['clips'][0]['sourceKind'] == 'manual'


def test_campaign_settings(database):
    c = main.create_campaign(CampaignInput(title='Campaign', permissionNotes='Owned'))
    main.update_campaign(c['id'], CampaignInput(title='Updated', clipIds=['1']))
    assert main.campaigns()[0]['clipIds'] == ['1']
    main.save_settings({'theme': 'dark'})
    assert main.settings()['theme'] == 'dark'
    with pytest.raises(HTTPException):
        main.save_settings({'storagePath': 'C:/Windows'})
    main.delete_campaign(c['id'])
    assert main.campaigns() == []
