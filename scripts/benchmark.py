"""Fixed regression corpus, not a statistical or LLM benchmark."""
import json
from pathlib import Path
from autocadent.cad import Spec, build, evaluate, repair
cases=[('thin-and-tight',{}),('compact',{'length':120,'width':80}),('long-mast',{'length':180,'width':110,'mast_height':75}),('already-valid',{'thickness':2.4,'wall':2.4,'clearance':.8})]
rows=[]
for name,kw in cases:
    s=Spec(**kw); p,m=build(s); before=evaluate(s,p,m); new,changes=repair(s,before); p,m=build(new); after=evaluate(new,p,m)
    rows.append({'case':name,'input':s.dict(),'before':before,'repair':changes,'after':after})
out=Path('web/artifacts/benchmark.json')
out.write_text(json.dumps({'kind':'Fixed deterministic regression corpus; no LLM success-rate claim','cases':rows,'before_pass_count':sum(r['before']['passed'] for r in rows),'after_pass_count':sum(r['after']['passed'] for r in rows),'case_count':len(rows)},indent=2)+'\n')
print(out)
