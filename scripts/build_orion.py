"""Fetch Orion Quadruped URDF+STL assets and bake a viewer mesh bundle.

Source: https://github.com/AshishA26/Orion-Quadruped (no license file upstream;
all rights belong to its author, Ashish Agrahari). Geometry is vendored for
in-browser VISUALIZATION ONLY as an unevaluated reference build. It is NOT run
through autocadent.pipeline, carries no checks, and must never be presented as
measured evidence. STLs stay out of git; only the decimated mesh.json ships.

Usage: uv run python scripts/build_orion.py
"""
import json
import math
import os
import struct
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = "https://raw.githubusercontent.com/AshishA26/Orion-Quadruped/master/urdf/urdf_files_original"
OUT = Path(__file__).resolve().parents[1] / "web" / "artifacts" / "orion"
TRI_BUDGET = None  # full resolution; vertex welding only, binary output
COLORS = {
    "chassis": ("#f2efe6", "structure"),
    "lidar": ("#3a3f3d", "electronics"),
    "camera": ("#e8e4d8", "electronics"),
    "link_1": ("#e86a2a", "mobility"),
    "link_2": ("#f2efe6", "mobility"),
    "link_3": ("#e86a2a", "mobility"),
}


def rpy_matrix(rpy):
    r, p, y = rpy
    cr, sr, cp, sp, cy, sy = (math.cos(r), math.sin(r), math.cos(p),
                              math.sin(p), math.cos(y), math.sin(y))
    return (
        (cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr),
        (sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr),
        (-sp, cp * sr, cp * cr),
    )


def rot(axis, angle):
    x, y, z = axis
    c, s = math.cos(angle), math.sin(angle)
    return (
        (c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s),
        (y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s),
        (z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)),
    )


def mul(a, b):
    ra, ta = a
    rb, tb = b
    r = tuple(tuple(sum(ra[i][k] * rb[k][j] for k in range(3)) for j in range(3)) for i in range(3))
    t = tuple(ta[i] + sum(ra[i][k] * tb[k] for k in range(3)) for i in range(3))
    return (r, t)


def apply(t, v):
    r, o = t
    return (
        round((r[0][0] * v[0] + r[0][1] * v[1] + r[0][2] * v[2] + o[0]) * 1000, 2),
        round((r[1][0] * v[0] + r[1][1] * v[1] + r[1][2] * v[2] + o[1]) * 1000, 2),
        round((r[2][0] * v[0] + r[2][1] * v[1] + r[2][2] * v[2] + o[2]) * 1000, 2),
    )


def read_stl(data):
    n = struct.unpack("<I", data[80:84])[0]
    out = []
    for i in range(n):
        f = struct.unpack("<12f", data[84 + i * 50:84 + i * 50 + 48])
        out.append(((f[3], f[4], f[5]), (f[6], f[7], f[8]), (f[9], f[10], f[11])))
    return out


def key(name):
    n = name.lower()
    if "chassis" in n:
        return "chassis"
    if "lidar" in n:
        return "lidar"
    if "camera" in n:
        return "camera"
    if "link_1" in n:
        return "link_1"
    if "link_2" in n:
        return "link_2"
    return "link_3"


def lookup(v, verts, index):
    if v not in index:
        index[v] = len(verts)
        verts.append(list(v))
    return index[v]


def fetch(name):
    src = os.getenv("ORION_SRC")
    if src:
        p = Path(src, name)
        if not p.exists():
            p = Path(src, name.lower())
        return p.read_bytes()
    return urllib.request.urlopen(f"{BASE}/meshes/{name}", timeout=120).read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    urdf_src = os.getenv("ORION_SRC")
    urdf = (Path(urdf_src, "orion.urdf").read_bytes() if urdf_src
            else urllib.request.urlopen(BASE + "/urdf/urdf_files.urdf", timeout=60).read())
    root = ET.fromstring(urdf)
    pose = [float(x) for x in os.getenv("ORION_POSE", "0,0,0").split(",")]
    joints = {}
    for j in root.findall("joint"):
        o = j.find("origin")
        xyz = tuple(float(x) for x in o.get("xyz").split()) if o is not None else (0, 0, 0)
        rpy = tuple(float(x) for x in o.get("rpy").split()) if o is not None else (0, 0, 0)
        ax = j.find("axis")
        axis = tuple(float(x) for x in ax.get("xyz").split()) if ax is not None else (0, 0, 0)
        level = int(j.get("name").rsplit("_", 1)[-1]) if j.get("name").rsplit("_", 1)[-1].isdigit() else 0
        sgn = next((c for c in axis if c != 0), 0)
        ang = sgn * (pose[level - 1] if 1 <= level <= 3 else 0)
        jt = mul((rpy_matrix(rpy), xyz), (rot(axis, ang), (0, 0, 0)))
        joints[j.get("name")] = (j.find("parent").get("link"), j.find("child").get("link"), jt)
    children = {}
    for name, (par, chi, _) in joints.items():
        children.setdefault(par, []).append(chi)
    visuals = {}
    for link in root.findall("link"):
        for v in link.findall("visual"):
            mesh = v.find("geometry").find("mesh").get("filename").split("/")[-1]
            o = v.find("origin")
            xyz = tuple(float(x) for x in o.get("xyz").split()) if o is not None else (0, 0, 0)
            rpy = tuple(float(x) for x in o.get("rpy").split()) if o is not None else (0, 0, 0)
            visuals.setdefault(link.get("name"), []).append((mesh, (rpy_matrix(rpy), xyz)))

    child_links = {c for _, c, _ in joints.values()}
    base = next(link.get("name") for link in root.findall("link") if link.get("name") not in child_links)
    world = {}

    def walk(link, t):
        world[link] = t
        for chi in children.get(link, []):
            jt = next(v[2] for v in joints.values() if v[1] == chi)
            walk(chi, mul(t, jt))

    walk(base, (((1, 0, 0), (0, 1, 0), (0, 0, 1)), (0, 0, 0)))

    uses = {}
    for link, t in world.items():
        for mesh, vt in visuals.get(link, []):
            data = fetch(mesh)
            uses.setdefault(mesh, []).append((mul(t, vt), read_stl(data)))

    total = sum(len(lst) for v in uses.values() for _, lst in v)
    print(f"links={len(world)} tris={total} (full resolution, welded)")

    parts = []
    for mesh, uu in sorted(uses.items()):
        verts, index, out = [], {}, []
        for wt, lst in uu:
            for a, b, c in lst:
                out.append([lookup(apply(wt, v), verts, index) for v in (a, b, c)])
        color, group = COLORS[key(mesh)]
        parts.append({"name": mesh.replace(".STL", "").replace("_", " "),
                      "color": color, "group": group, "printable": False, "edges": False,
                      "vertices": verts, "triangles": out})
        print(f"{mesh}: {len(out)} tris, {len(verts)} verts")

    allv = [v for p in parts for v in p["vertices"]]
    xs = [v[0] for v in allv]
    ys = [v[1] for v in allv]
    zs = [v[2] for v in allv]
    dx, dy, dz = -(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs)
    for p in parts:
        p["vertices"] = [[round(v[0] + dx, 2), round(v[1] + dy, 2), round(v[2] + dz, 2)] for v in p["vertices"]]
    import array
    vbuf, ibuf, meta = array.array("f"), array.array("I"), []
    for part in parts:
        vstart = len(vbuf)
        for v in part["vertices"]:
            vbuf.extend(v)
        istart = len(ibuf)
        base = vstart // 3
        for tri in part["triangles"]:
            ibuf.extend((tri[0] + base, tri[1] + base, tri[2] + base))
        meta.append({"name": part["name"], "color": part["color"], "group": part["group"],
                     "printable": part["printable"], "edges": part["edges"], "opaque": True,
                     "vertStart": vstart, "vertCount": len(part["vertices"]),
                     "triStart": istart, "triCount": len(part["triangles"])})
    with open(OUT / "mesh.bin", "wb") as f:
        vbuf.tofile(f)
        ibuf.tofile(f)
    (OUT / "mesh.json").write_text(json.dumps({"bin": "mesh.bin",
        "vertTotal": len(vbuf) // 3, "triTotal": len(ibuf) // 3, "parts": meta}))
    manifest = {
        "project": "Orion Quadruped (reference)",
        "source": "https://github.com/AshishA26/Orion-Quadruped",
        "source_path": "urdf/urdf_files_original, zero joint angles, meters x1000 to mm",
        "evaluated": False,
        "note": "Unevaluated reference geometry for visualization only. Not measured, not checked.",
        "parts": [{"name": p["name"], "triangles": len(p["triangles"])} for p in parts],
        "format": "binary mesh.bin: float32 xyz verts, uint32 indices",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("wrote", OUT / "mesh.json")


if __name__ == "__main__":
    main()
