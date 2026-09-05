import json
from pathlib import Path
import pytest
import cadquery as cq
from autocadent.cad import Spec, build, evaluate, repair, box
from autocadent.pipeline import run

@pytest.mark.parametrize('kwargs',[{'length':119},{'wall':float('nan')},{'width':True},{'clearance':-1},{'mast_height':1000}])
def test_rejects_invalid_input(kwargs):
    with pytest.raises(ValueError): Spec(**kwargs)

def test_valid_solids_can_fail_dimensions_and_repair():
    s=Spec(); parts, measured=build(s); first=evaluate(s,parts,measured)
    assert first['checks'][0]['passed']
    assert {c['name'] for c in first['checks'] if not c['passed']}=={'Chassis thickness','Tray wall','Board clearance'}
    fixed, changes=repair(s,first); parts, measured=build(fixed)
    assert changes=={'thickness':2.4,'wall':2.4,'clearance':.8}
    assert evaluate(fixed,parts,measured)['passed']

def test_evaluator_measures_geometry_not_spec():
    s=Spec(thickness=2.4,wall=2.4,clearance=.8)
    parts, measured=build(s); measured['base']=box(s.length,s.width,1.1)
    checks=evaluate(s,parts,measured)['checks']
    assert next(c for c in checks if c['name']=='Chassis thickness')['measured']==1.1
    assert not evaluate(s,parts,measured)['passed']

def test_pipeline_exports_reimportable_solid_and_retains_failure(tmp_path):
    result=run(output=tmp_path)
    assert result['passed'] and len(result['iterations'])==2
    assert not result['iterations'][0]['evaluation']['passed']
    shape=cq.importers.importStep(str(tmp_path/'final/rove-1.step'))
    assert shape.val().isValid()
    assert (tmp_path/'iteration-1/chassis.stl').stat().st_size>100
    assert json.loads((tmp_path/'report.json').read_text())['files']
