"""Invoked by a genuine AO worker, writes back to the supervisor job directory."""
import json
import os
from pathlib import Path
import sys
import uuid
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from autocadent.cad import Spec
from autocadent.pipeline import run, save_json
job_id=sys.argv[1]
if str(uuid.UUID(job_id))!=job_id: raise ValueError('Invalid job id')
folder=ROOT/'.runs/jobs'/job_id
try:
    session=os.environ.get('AO_SESSION_ID')
    if not session: raise RuntimeError('This entry point requires a real AO worker session')
    req=json.loads((folder/'request.json').read_text())
    result=run(Spec(**req['spec']),folder,req['description'],execution='ao-worker')
    save_json(folder/'complete.json',{'execution':'ao-worker','ao_session':session})
    print(json.dumps({'passed':result['passed'],'iterations':result['final_iteration'],'ao_session':session}))
except Exception as e:
    save_json(folder/'error.json',{'error':str(e)});raise
