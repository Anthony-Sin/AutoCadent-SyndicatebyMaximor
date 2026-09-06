"""Real provider design -> trusted native compilers -> measurements -> provider revision."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import zipfile
from .addon import build_addon, evaluate_addon
from .cad import build, evaluate
from .pipeline import export, save_json
from .provider import ProviderError

ROOT = Path(__file__).resolve().parents[1]

class CompilerError(RuntimeError):
    pass


def compile_board(design, folder):
    save_json(folder/'pcb-input.json', design.pcb.model_dump())
    kicad_env = {k: v for k, v in os.environ.items() if k != "PYTHONHOME"}
    try:
        subprocess.run([os.getenv('AUTOCADENT_KICAD_PYTHON','/usr/bin/python3'),
                        str(ROOT/'scripts/model_board.py'),'--spec',str(folder/'pcb-input.json'),
                        '--output',str(folder/'board')],check=True,capture_output=True,timeout=200,
                        env=kicad_env)
    except subprocess.TimeoutExpired:
        raise CompilerError('PCB compiler timeout') from None
    except (OSError, subprocess.CalledProcessError):
        raise CompilerError('PCB compiler unavailable or failed; requires pcbnew and kicad-cli') from None
    return json.loads((folder/'board/evaluation.json').read_text())


def export_design(parts, folder, design):
    export(parts, folder, design.spec.cad())
    save_json(folder/'design.json', design.model_dump())
    shutil.copyfile(ROOT/'autocadent/addon.py', folder/'addon.py')
    shutil.copyfile(ROOT/'scripts/model_board.py', folder/'model_board.py')
    (folder/'generate.py').write_text(
        '"""Trusted compiler source; model generated only design.json data."""\n'
        'import json\nfrom pathlib import Path\nimport cadquery as cq\nfrom cad import Spec, build\n'
        'from addon import build_addon\n'
        'design=json.loads(Path(__file__).with_name("design.json").read_text())\n'
        's=Spec(**design["spec"])\nparts,_=build(s)\naddon,_=build_addon(s,design["addon"])\nparts.append(addon)\n'
        'for p in parts:\n    if p["printable"]: cq.exporters.export(p["shape"],p["name"]+".stl")\n'
        'cq.exporters.export(cq.Compound.makeCompound([p["shape"] for p in parts]),"rove-1.step")\n')


def run_model(provider, description, seed, output):
    dest=Path(output).resolve(); dest.mkdir(parents=True,exist_ok=True)
    started=time.monotonic()
    report={'schema_version':1,'project':'Rove-1','description':description,'execution':'tensormux',
            'created_at':datetime.now(timezone.utc).isoformat(),'ao_session':os.getenv('AO_SESSION_ID'),
            'scope':'LLM-generated bounded design data compiled by trusted templates. Sensor bridge add-on and custom signal breakout; no generated code execution, controller, electrical function or physical validation.',
            'iterations':[],'events':[],'provider_requests':[],'passed':False,'final_iteration':0}
    previous=None; evaluation=None
    try:
        for n in range(1,4):
            design,metadata=provider.generate(description,seed,previous,evaluation)
            report['provider_requests'].append(metadata)
            report['events'].append({'role':'Tensormux model','message':f'HTTP {metadata["http_status"]}: validated '+('revised' if previous else 'initial')+' design data.'})
            folder=dest/f'iteration-{n}'
            s=design.spec.cad(); parts,measured=build(s)
            measured['mast']=next(p['shape'] for p in parts if p['name']=='Sensor mast')
            addon,plate=build_addon(s,design.addon.model_dump()); parts.append(addon)
            evaluation=evaluate(s,parts,measured)
            evaluation['checks'].extend(evaluate_addon(addon,plate,measured))
            export_design(parts,folder,design)
            board=compile_board(design,folder)
            evaluation['checks'].extend(board['checks'])
            evaluation['passed']=all(c['passed'] for c in evaluation['checks'])
            changes={}
            if previous:
                before=previous.model_dump(); after=design.model_dump()
                changes={section:{k:{'before':before[section][k],'after':v} for k,v in after[section].items() if before[section][k]!=v} for section in after}
                changes={k:v for k,v in changes.items() if v}
            report['iterations'].append({'iteration':n,'spec':s.dict(),'design':design.model_dump(),
                                         'evaluation':evaluation,'pcb':board,'model_changes':changes})
            report['final_iteration']=n; report['passed']=evaluation['passed']
            report['events'].append({'role':'CAD and PCB evaluator','message':f'Iteration {n}: '+('PASS' if evaluation['passed'] else 'FAIL')})
            save_json(dest/'report.json',report)
            if evaluation['passed']:
                report['stop_reason']='accepted'; break
            if previous and not changes:
                report['stop_reason']='model_made_no_changes'; break
            previous=design
        else:
            report['stop_reason']='iteration_limit'
        final=dest/'final'; shutil.copytree(folder,final,dirs_exist_ok=True)
        report['files']=[{'name':p.relative_to(final).as_posix(),'bytes':p.stat().st_size,
                          'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(final.rglob('*')) if p.is_file()]
        report['seconds']=round(time.monotonic()-started,3)
        save_json(dest/'report.json',report)
        with zipfile.ZipFile(dest/'rove-1-cad.zip','w',zipfile.ZIP_DEFLATED) as archive:
            for p in sorted(final.rglob('*')):
                if p.is_file(): archive.write(p,'rove-1/'+p.relative_to(final).as_posix())
            archive.write(dest/'report.json','rove-1/report.json')
        return report
    except (ProviderError, CompilerError):
        # Retain previous measured iterations, never invent a successful fallback.
        report['stop_reason']='provider_or_compiler_error'
        report['seconds']=round(time.monotonic()-started,3)
        save_json(dest/'report.json',report)
        raise
