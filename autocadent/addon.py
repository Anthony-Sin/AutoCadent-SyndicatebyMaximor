"""Trusted sensor bridge compiler; model input is numeric data, never source."""
import cadquery as cq
if __package__:
    from .cad import box
else:
    from cad import box


def build_addon(spec, addon):
    x = -spec.length / 2 + 13
    ys = [-spec.width / 2 + 12, spec.width / 2 - 12]
    plate = box(addon['depth'], spec.width - 14, addon['thickness'], (x, 0, spec.thickness + 6))
    bridge = plate
    for y in ys:
        post = cq.Workplane('XY').center(x, y).circle(5).extrude(6).translate((0, 0, spec.thickness)).val()
        bridge = bridge.fuse(post)
        bore = cq.Workplane('XY').center(x, y).circle(1.7).extrude(12).translate((0, 0, spec.thickness)).val()
        bridge = bridge.cut(bore)
    bridge = bridge.clean()
    part = dict(name='Sensor bridge', shape=bridge, color='#698fa8', group='structure', printable=True)
    return part, plate


def evaluate_addon(part, plate, measured):
    bridge = part['shape']
    thickness = plate.BoundingBox().zlen
    clearance = min(bridge.distance(measured['tray']), bridge.distance(measured['mast']))
    bores = [f for f in bridge.Faces() if f.geomType() == 'CYLINDER' and abs(f._geomAdaptor().Cylinder().Radius() - 1.7) < 1e-5]
    checks = [
        dict(name='Bridge plate thickness', measured=round(thickness, 4), requirement='≥ 2.4 mm', passed=thickness >= 2.4 - 1e-6, unit='mm', method='B-rep plate bounding box'),
        dict(name='Bridge clearance', measured=round(clearance, 4), requirement='≥ 0.5 mm from tray and mast', passed=clearance >= .5 - 1e-6, unit='mm', method='Minimum B-rep solid distance; not full assembly collision analysis'),
        dict(name='Bridge mounting bores', measured=len(bores), requirement='2 through bores, diameter 3.4 mm', passed=len(bores) == 2 and all(abs(f.BoundingBox().zlen - (6 + thickness)) < 1e-5 for f in bores), unit='bores', method='Cylindrical B-rep faces and axial extent'),
    ]
    return checks
