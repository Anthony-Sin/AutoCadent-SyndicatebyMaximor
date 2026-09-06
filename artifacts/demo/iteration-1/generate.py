import json
import cadquery as cq
from cad import Spec, build
from pathlib import Path
s = Spec(**json.loads(Path(__file__).with_name("spec.json").read_text()))
parts, _ = build(s)
for p in parts:
    if p["printable"]: cq.exporters.export(p["shape"], p["name"]+".stl")
cq.exporters.export(cq.Compound.makeCompound([p["shape"] for p in parts]), "rove-1.step")
