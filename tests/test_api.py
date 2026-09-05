from fastapi.testclient import TestClient
import autocadent.api as api
client=TestClient(api.app)

def test_health_and_static_workspace():
    assert client.get('/api/health').json()['scope']=='bounded-rover'
    assert 'AutoCadent' in client.get('/').text

def test_rejects_bad_specs_modes_and_origin():
    assert client.post('/api/jobs',json={'description':'test','spec':{'length':10000}}).status_code==422
    assert client.post('/api/jobs',json={'description':'test','spec':{'unknown':1}}).status_code==422
    assert client.post('/api/jobs',json={'description':'test','execution':'shell'}).status_code==422
    assert client.post('/api/jobs',json={'description':'test'},headers={'Origin':'https://attacker.example'}).status_code==403
    assert client.get('/api/jobs/not-a-uuid').status_code==404

def test_authentication(monkeypatch):
    monkeypatch.setattr(api,'TOKEN','test-only-credential')
    assert client.get('/api/health').status_code==401
    assert client.get('/api/health',headers={'Authorization':'Bearer test-only-credential'}).status_code==200

def test_serializes_expensive_jobs():
    api.LOCK.acquire()
    try: assert client.post('/api/jobs',json={'description':'rover'}).status_code==429
    finally: api.LOCK.release()

def test_real_local_job(tmp_path,monkeypatch):
    import time
    monkeypatch.setattr(api,'JOBS',tmp_path)
    response=client.post('/api/jobs',json={'description':'A compact rover','spec':{'length':125}})
    assert response.status_code==202
    job=response.json()['id']; deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        status=client.get('/api/jobs/'+job).json()
        if status['status'] in ['complete','failed']: break
        time.sleep(.1)
    assert status['status']=='complete',status
    assert status['report']['passed']
    assert status['report']['iterations'][-1]['spec']['length']==125
