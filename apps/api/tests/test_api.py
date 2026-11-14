from apps.api.database import Session, MediaRow


def test_project_crud_and_persistence(client):
    assert client.get('/api/health').json()['database'] == 'available'
    p = client.post('/api/projects', json={'title': 'My footage'}).json()
    assert p['mode'] == 'real' and p['clips'] == []
    assert client.get('/api/projects').json()[0]['id'] == p['id']
    assert client.patch(f'/api/projects/{p["id"]}', json={'title': 'Renamed', 'folder': 'Work'}).json()['folder'] == 'Work'
    copy = client.post(f'/api/projects/{p["id"]}/duplicate').json()
    assert copy['id'] != p['id'] and copy['title'] == 'Renamed copy'
    assert client.delete(f'/api/projects/{p["id"]}').status_code == 204
    assert client.get(f'/api/projects/{p["id"]}').status_code == 404


def test_clips_require_media_and_optimistic_revisions(client):
    p = client.post('/api/projects', json={'title': 'Source'}).json()
    payload = {'title': 'Cut', 'edit': {'sourceInMs': 2000, 'sourceOutMs': 8000}}
    assert client.post(f'/api/projects/{p["id"]}/clips', json=payload).status_code == 409
    with Session() as db:
        db.add(MediaRow(id='fixture', project_id=p['id'], data={'durationMs': 12000}))
        db.commit()
    c = client.post(f'/api/projects/{p["id"]}/clips', json=payload).json()
    assert c['sourceKind'] == 'manual' and 'score' not in c
    edit = c['edit']
    edit['captions'] = [{'id': 'one', 'startMs': 0, 'endMs': 2000, 'text': 'नमस्ते'}]
    assert client.put(f'/api/clips/{c["id"]}/edit-document', json=edit).json()['revision'] == 1
    assert client.put(f'/api/clips/{c["id"]}/edit-document', json=edit).status_code == 409
    assert client.get(f'/api/clips/{c["id"]}/edit-document').json()['captions'][0]['text'] == 'नमस्ते'
    payload['edit']['sourceOutMs'] = 13000
    assert client.post(f'/api/projects/{p["id"]}/clips', json=payload).status_code == 422


def test_campaign_settings_and_local_security(client, monkeypatch):
    monkeypatch.delenv('CLIPFORGE_WHISPER_MODEL', raising=False)
    c = client.post('/api/campaigns', json={'title': 'Owned footage', 'maxSeconds': 40}).json()
    assert client.put(f'/api/campaigns/{c["id"]}', json={**{k: v for k, v in c.items() if k != 'id'}, 'branding': 'Personal logo'}).status_code == 200
    assert client.get('/api/campaigns').json()[0]['branding'] == 'Personal logo'
    assert client.put('/api/settings', json={'theme': 'light'}).status_code == 200
    assert client.get('/api/settings').json()['theme'] == 'light'
    assert client.put('/api/settings', json={'storagePath': 'C:/Windows'}).status_code == 422
    assert client.post('/api/projects', json={'title': 'Bad'}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.get('/api/capabilities').json()['transcription']['status'] == 'unavailable'
