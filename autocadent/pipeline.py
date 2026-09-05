"""Supervisor -> CAD generator -> measured evaluator -> bounded repair."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import zipfile
from datetime import datetime, timezone
import cadquery as cq
from .cad import Spec, build, evaluate, repair


def save_json(path, data):
    Path(path).write_text(json.dumps(data,indent=2)+'\n')


def export(parts, dest, spec):
    dest.mkdir(parents=True,exist_ok=True)
    meshes=[]
    for p in parts:
        vertices, triangles=p['shape'].tessellate(.2,.2)
        meshes.append({k:v for k,v in p.items() if k!='shape'} | {
            'vertices':[[round(v.x,4),round(v.y,4),round(v.z,4)] for v in vertices],
            'triangles':triangles})
        if p['printable']:
            cq.exporters.export(p['shape'],str(dest/(p['name'].lower().replace(' ','-')+'.stl')),tolerance=.1,angularTolerance=.15)
    compound=cq.Compound.makeCompound([p['shape'] for p in parts])
    cq.exporters.export(compound,str(dest/'rove-1.step'))
    save_json(dest/'mesh.json',meshes)
    save_json(dest/'spec.json',spec.dict())
    shutil.copyfile(Path(__file__).with_name('cad.py'),dest/'cad.py')
    (dest/'generate.py').write_text('import json\nimport cadquery as cq\nfrom cad import Spec, build\nfrom pathlib import Path\ns = Spec(**json.loads(Path(__file__).with_name("spec.json").read_text()))\nparts, _ = build(s)\nfor p in parts:\n    if p["printable"]: cq.exporters.export(p["shape"], p["name"]+".stl")\ncq.exporters.export(cq.Compound.makeCompound([p["shape"] for p in parts]), "rove-1.step")\n')


def run(spec=None, output='.runs/latest', description='Educational rover with sensor mast and connector board', execution='deterministic'):
    s=spec or Spec()
    dest=Path(output).resolve(); dest.mkdir(parents=True,exist_ok=True)
    start=time.monotonic()
    report={'schema_version':1,'project':'Rove-1','description':description,'execution':execution,
            'created_at':datetime.now(timezone.utc).isoformat(),'ao_session':os.getenv('AO_SESSION_ID'),
            'scope':'Parameterized educational assembly; wheel/sensor envelopes. No physical or electrical certification.',
            'iterations':[],'events':[{'role':'Supervisor','message':'Accepted bounded rover specification. Run CAD kernel and dimensional evaluator.'}]}
    for n in range(3):
        tick=time.monotonic(); parts, measured=build(s); result=evaluate(s,parts,measured)
        folder=dest/f'iteration-{n+1}'
        export(parts,folder,s)
        report['iterations'].append({'iteration':n+1,'spec':s.dict(),'evaluation':result,'seconds':round(time.monotonic()-tick,3)})
        report['events'].append({'role':'CAD evaluator','message':f'Iteration {n+1}: '+ ('PASS' if result['passed'] else 'FAIL')+ '. '+ '; '.join(f"{c['name']}: {c['measured']} {c['unit']}" for c in result['checks'] if not c['passed'])})
        if result['passed']: break
        s, changes=repair(s,result)
        if not changes: break
        report['events'].append({'role':'Repair policy','message':'Apply measured-failure corrections: '+json.dumps(changes)})
    report['passed']=result['passed']; report['seconds']=round(time.monotonic()-start,3)
    report['final_iteration']=len(report['iterations'])
    final=dest/'final'; shutil.copytree(folder,final,dirs_exist_ok=True)
    report['files']=[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(final.iterdir()) if p.is_file()]
    save_json(dest/'report.json',report)
    with zipfile.ZipFile(dest/'rove-1-cad.zip','w',zipfile.ZIP_DEFLATED) as z:
        for p in final.iterdir(): z.write(p,'rove-1/'+p.name)
        z.write(dest/'report.json','rove-1/report.json')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--output',default='.runs/latest'); p.add_argument('--spec'); p.add_argument('--description',default='Educational rover with sensor mast and connector board'); p.add_argument('--execution',default='deterministic',choices=['deterministic','ao-worker'])
    a=p.parse_args(); spec=Spec(**json.loads(Path(a.spec).read_text())) if a.spec else Spec()
    result=run(spec,a.output,a.description,a.execution); print(json.dumps({'passed':result['passed'],'iterations':result['final_iteration'],'seconds':result['seconds']}))
