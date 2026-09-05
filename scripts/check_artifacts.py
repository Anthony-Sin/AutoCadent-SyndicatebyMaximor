"""Verify committed downloads, hashes, CAD evidence and board report consistency."""
import hashlib
import json
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parents[1]/'web/artifacts'
r=json.loads((root/'demo/report.json').read_text())
assert r['passed'] and r['iterations'][0]['evaluation']['passed'] is False
for f in r['files']:
    path=root/'demo/final'/f['name']
    assert path.stat().st_size==f['bytes']
    assert hashlib.sha256(path.read_bytes()).hexdigest()==f['sha256']
for path in root.rglob('*.zip'):
    with zipfile.ZipFile(path) as z: assert z.testzip() is None
for path in (root/'demo/final').glob('*.py'): compile(path.read_text(),str(path),'exec')
drc=json.loads((root/'board/drc.json').read_text())
assert not drc['violations'] and not drc['unconnected_items']
assert (root/'board/board.svg').stat().st_size>100
assert len(json.loads((root/'board/nets.json').read_text())['nets'])==4
print('Artifact hashes, ZIP integrity, source syntax and recorded evidence verified.')
