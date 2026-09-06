"""Parametric Rove-1 educational assembly. All lengths in millimeters."""
from dataclasses import dataclass, asdict
import math
import cadquery as cq

@dataclass(frozen=True)
class Spec:
    length: float = 140
    width: float = 90
    thickness: float = 1.2
    wall: float = 1.2
    clearance: float = 0.1
    mast_height: float = 52

    def __post_init__(self):
        ranges = {'length': (120, 180), 'width': (80, 110), 'thickness': (1, 5),
                  'wall': (1, 5), 'clearance': (0.05, 3), 'mast_height': (35, 75)}
        for key, (lo, hi) in ranges.items():
            value = getattr(self, key)
            if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not lo <= value <= hi:
                raise ValueError(f'{key} must be between {lo} and {hi} mm')

    def dict(self):
        return asdict(self)


def box(x, y, z, at=(0, 0, 0)):
    return cq.Workplane('XY').box(x, y, z, centered=(True, True, False)).translate(at).val()


def build(s: Spec):
    base = cq.Workplane('XY').box(s.length, s.width, s.thickness, centered=(True, True, False)).edges('|Z').fillet(9)
    base = base.faces('>Z').workplane().pushPoints([(x, y) for x in [-s.length/2+13, s.length/2-13] for y in [-s.width/2+12,s.width/2-12]]).hole(3.4)
    # Vent slots are real through-cuts, kept away from mounts and tray.
    for y in [-25, -15, -5, 5, 15, 25]:
        base = base.cut(cq.Workplane('XY').center(-s.length/2+20, y).slot2D(18, 3).extrude(s.thickness))
    ix, iy = 60+2*s.clearance, 40+2*s.clearance
    ox, oy = ix+2*s.wall, iy+2*s.wall
    tray_floor = box(ox, oy, 2, (0, 0, s.thickness))
    walls = box(ox, oy, 12, (0, 0, s.thickness+2)).cut(box(ix, iy, 13, (0, 0, s.thickness+2)))
    tray = tray_floor.fuse(walls).clean()
    board = box(60, 40, 1.6, (0, 0, s.thickness+4))
    parts = [dict(name='Chassis', shape=base.val(), color='#b8b1a2', group='structure', printable=True),
             dict(name='Board tray', shape=tray, color='#47a6a2', group='structure', printable=True),
             dict(name='Connector board', shape=board, color='#287f79', group='electronics', printable=False)]
    for x in [-s.length*.31, s.length*.31]:
        for side in [-1, 1]:
            y = side*(s.width/2+10)
            tire = cq.Workplane('XZ').circle(23).circle(12).extrude(16).translate((x,y+8,-1)).val()
            hub = cq.Workplane('XZ').circle(12).circle(3).extrude(16).translate((x,y+8,-1)).val()
            parts.extend([dict(name=f'Wheel {len(parts)}', shape=tire, color='#555c58', group='mobility', printable=False),
                          dict(name=f'Hub {len(parts)}', shape=hub, color='#bcaa88', group='mobility', printable=False)])
    mast_x = s.length/2-19
    mast = box(10, 24, s.mast_height, (mast_x,0,s.thickness)).cut(box(12,12,s.mast_height-14,(mast_x,0,s.thickness+7)))
    foot = box(24,34,3,(mast_x,0,s.thickness))
    mast = mast.fuse(foot).clean()
    parts.append(dict(name='Sensor mast',shape=mast,color='#c688a4',group='structure',printable=True))
    head = cq.Workplane('XY').box(24,58,24).edges('|Z').fillet(5).translate((mast_x,0,s.thickness+s.mast_height+12)).val()
    parts.append(dict(name='Sensor envelope',shape=head,color='#bfbcae',group='electronics',printable=False))
    for y in [-16,16]:
        lens = cq.Workplane('YZ').circle(9).extrude(5).translate((mast_x+12,y,s.thickness+s.mast_height+12)).val()
        parts.append(dict(name=f'Range aperture {y}',shape=lens,color='#327e80',group='electronics',printable=False))
    for y in [-12,0,12]:
        parts.append(dict(name=f'Header {y}',shape=box(8,5,6,(18,y,s.thickness+5.6)),color='#d1ab60',group='electronics',printable=False))
    return parts, {'base':base.val(),'tray':tray,'walls':walls,'board':board}


def evaluate(s, parts, measured):
    """Inspect B-reps. Wall check is scoped to the four planar tray walls."""
    base, walls, board = [measured[k] for k in ['base','walls','board']]
    # Identify planar vertical faces on the actual wall solid, not input values.
    xs = sorted(set(round(f.Center().x,6) for f in walls.Faces()
                    if f.geomType() == 'PLANE' and abs(f.normalAt().x) > .99))
    ys = sorted(set(round(f.Center().y,6) for f in walls.Faces()
                    if f.geomType() == 'PLANE' and abs(f.normalAt().y) > .99))
    wall = min(xs[1]-xs[0], xs[-1]-xs[-2], ys[1]-ys[0], ys[-1]-ys[-2])
    checks = []
    def add(name, value, threshold, passed, unit='mm', method='B-rep measurement'):
        checks.append(dict(name=name, measured=round(value,4), requirement=threshold, passed=bool(passed), unit=unit, method=method))
    valid = all(p['shape'].isValid() and p['shape'].Volume()>0 for p in parts)
    add('Solid validity',sum(p['shape'].isValid() for p in parts),f'{len(parts)} valid solids',valid,'solids','OpenCASCADE isValid and positive volume; not a dimensional check')
    t=base.BoundingBox().zlen
    add('Chassis thickness',t,'≥ 2.4 mm',t>=2.4-1e-6)
    add('Tray wall',wall,'≥ 2.4 mm',wall>=2.4-1e-6,method='Minimum of four paired planar wall-face offsets; not a global wall-thickness test')
    gap=walls.distance(board)
    add('Board clearance',gap,'≥ 0.8 mm',gap>=.8-1e-6,method='Minimum B-rep distance from board envelope to tray sidewalls')
    length=base.BoundingBox().xlen
    add('Chassis length',length,f'{s.length:g} ± 0.01 mm',abs(length-s.length)<.01)
    tray=measured['tray'].BoundingBox()
    margin=min((s.length-tray.xlen)/2,(s.width-tray.ylen)/2)
    add('Tray edge margin',margin,'≥ 4 mm',margin>=4)
    return {'passed':all(c['passed'] for c in checks),'checks':checks}


def repair(s, evaluation):
    changes={}
    for c in evaluation['checks']:
        if c['passed']: continue
        key={'Chassis thickness':'thickness','Tray wall':'wall','Board clearance':'clearance'}.get(c['name'])
        if key: changes[key]=.8 if key=='clearance' else 2.4
    return Spec(**(s.dict()|changes)), changes
