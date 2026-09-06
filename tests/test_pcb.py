"""Tests for KiCad PCB breakout generation, DRC evaluation, gerber exports,
SWIG iterator compatibility, pad container references, and CadQuery sensor bridge addon.
Derived from ORIGINAL_REQUEST.md § R2 and TEST_INFRA.md (Tiers 1-4).
"""
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
import pytest
import xml.etree.ElementTree as ET

from autocadent.cad import Spec, build, evaluate
from autocadent.addon import build_addon, evaluate_addon


ROOT = Path(__file__).resolve().parents[1]
KICAD_PYTHON = os.getenv("AUTOCADENT_KICAD_PYTHON", "/usr/bin/python3")
MODEL_BOARD_SCRIPT = ROOT / "scripts" / "model_board.py"


def _kicad_env():
    """Build a subprocess env for /usr/bin/python3 that can find pcbnew.

    uv run sets PYTHONHOME to its managed Python; that leaks into child
    processes and makes system Python look for modules in the wrong place.
    Drop it and keep PYTHONPATH (which carries the pcbnew directory).
    """
    env = {k: v for k, v in os.environ.items() if k != "PYTHONHOME"}
    return env


def run_model_board(spec_dict, out_dir):
    spec_path = out_dir / "pcb-spec.json"
    spec_path.write_text(json.dumps(spec_dict))
    cmd = [
        KICAD_PYTHON,
        str(MODEL_BOARD_SCRIPT),
        "--spec",
        str(spec_path),
        "--output",
        str(out_dir),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=_kicad_env())
    return res


# ===========================================================================
# Tier 1 & Tier 2: PCB Schema & Input Parameter Validation
# ===========================================================================

class TestPCBSchemaValidation:
    """Verifies strict input validation in scripts/model_board.py."""

    def test_rejects_unsupported_keys(self, tmp_path):
        bad_spec = {
            "kind": "signal_breakout",
            "nets": ["VCC", "GND", "SIG"],
            "connector_spacing": 25.0,
            "trace_width": 0.4,
            "unexpected_parameter": 42,
        }
        res = run_model_board(bad_spec, tmp_path)
        assert res.returncode != 0
        assert "Unsupported PCB schema" in res.stderr

    def test_rejects_unsupported_kind(self, tmp_path):
        bad_spec = {
            "kind": "power_converter",
            "nets": ["VCC", "GND", "SIG"],
            "connector_spacing": 25.0,
            "trace_width": 0.4,
        }
        res = run_model_board(bad_spec, tmp_path)
        assert res.returncode != 0
        assert "Unsupported PCB schema" in res.stderr

    def test_rejects_non_list_nets(self, tmp_path):
        bad_spec = {
            "kind": "signal_breakout",
            "nets": "VCC,GND,SIG",
            "connector_spacing": 25.0,
            "trace_width": 0.4,
        }
        res = run_model_board(bad_spec, tmp_path)
        assert res.returncode != 0
        assert "Invalid PCB nets" in res.stderr

    def test_rejects_under_3_nets(self, tmp_path):
        bad_spec = {
            "kind": "signal_breakout",
            "nets": ["VCC", "GND"],
            "connector_spacing": 25.0,
            "trace_width": 0.4,
        }
        res = run_model_board(bad_spec, tmp_path)
        assert res.returncode != 0
        assert "Invalid PCB nets" in res.stderr

    def test_rejects_over_8_nets(self, tmp_path):
        bad_spec = {
            "kind": "signal_breakout",
            "nets": [f"N_{i}" for i in range(9)],
            "connector_spacing": 25.0,
            "trace_width": 0.4,
        }
        res = run_model_board(bad_spec, tmp_path)
        assert res.returncode != 0
        assert "Invalid PCB nets" in res.stderr

    def test_rejects_duplicate_nets(self, tmp_path):
        bad_spec = {
            "kind": "signal_breakout",
            "nets": ["VCC", "GND", "VCC"],
            "connector_spacing": 25.0,
            "trace_width": 0.4,
        }
        res = run_model_board(bad_spec, tmp_path)
        assert res.returncode != 0
        assert "Invalid PCB nets" in res.stderr

    @pytest.mark.parametrize("bad_name", [
        "lowercase_net",
        "1START_WITH_DIGIT",
        "_START_UNDERSCORE",
        "NET WITH SPACES",
        "NET-WITH-DASH",
        "EXCEEDING_SIXTEEN_CHARACTERS_LONG",
    ])
    def test_rejects_invalid_net_names(self, tmp_path, bad_name):
        bad_spec = {
            "kind": "signal_breakout",
            "nets": ["VCC", "GND", bad_name],
            "connector_spacing": 25.0,
            "trace_width": 0.4,
        }
        res = run_model_board(bad_spec, tmp_path)
        assert res.returncode != 0
        assert "Invalid PCB nets" in res.stderr

    @pytest.mark.parametrize("bad_spacing", [19.9, 38.1, -5.0])
    def test_rejects_out_of_bounds_connector_spacing(self, tmp_path, bad_spacing):
        bad_spec = {
            "kind": "signal_breakout",
            "nets": ["VCC", "GND", "SIG"],
            "connector_spacing": bad_spacing,
            "trace_width": 0.4,
        }
        res = run_model_board(bad_spec, tmp_path)
        assert res.returncode != 0
        assert "Invalid PCB dimension" in res.stderr

    @pytest.mark.parametrize("bad_width", [0.24, 0.81, -0.1])
    def test_rejects_out_of_bounds_trace_width(self, tmp_path, bad_width):
        bad_spec = {
            "kind": "signal_breakout",
            "nets": ["VCC", "GND", "SIG"],
            "connector_spacing": 25.0,
            "trace_width": bad_width,
        }
        res = run_model_board(bad_spec, tmp_path)
        assert res.returncode != 0
        assert "Invalid PCB dimension" in res.stderr


# ===========================================================================
# Tier 1, Tier 3 & Tier 4: KiCad 10 Native Board Generation & Verification
# ===========================================================================

class TestKiCadBoardGeneration:
    """Verifies KiCad 10 native board compilation, DRC, gerbers, and SWIG fixes."""

    @pytest.fixture(scope="class")
    def standard_board(self, tmp_path_factory):
        out_dir = tmp_path_factory.mktemp("kicad_std_board")
        spec = {
            "kind": "signal_breakout",
            "nets": ["VCC", "GND", "SDA", "SCL"],
            "connector_spacing": 26.0,
            "trace_width": 0.4,
        }
        res = run_model_board(spec, out_dir)
        assert res.returncode == 0, f"KiCad compilation failed: {res.stderr}"
        eval_json = json.loads((out_dir / "evaluation.json").read_text())
        return {"dir": out_dir, "eval": eval_json, "spec": spec}

    def test_board_compilation_success(self, standard_board):
        assert standard_board["eval"]["passed"] is True
        outline = standard_board["eval"]["outline_mm"]
        assert abs(outline[0] - 60.0) < 0.1
        assert abs(outline[1] - 40.0) < 0.1

    def test_kicad_pcb_file_generated(self, standard_board):
        pcb_file = standard_board["dir"] / "custom-breakout.kicad_pcb"
        assert pcb_file.is_file()
        content = pcb_file.read_text()
        assert "(kicad_pcb" in content
        assert "AUTOCADENT / SIGNAL BREAKOUT" in content

    def test_board_svg_generated_and_valid(self, standard_board):
        svg_file = standard_board["dir"] / "board.svg"
        assert svg_file.is_file()
        assert svg_file.stat().st_size > 1000
        # Parse XML
        tree = ET.parse(str(svg_file))
        root = tree.getroot()
        assert "svg" in root.tag.lower()

    def test_drc_json_reports_zero_violations(self, standard_board):
        drc_file = standard_board["dir"] / "drc.json"
        assert drc_file.is_file()
        drc = json.loads(drc_file.read_text())
        assert len(drc["violations"]) == 0
        assert len(drc["unconnected_items"]) == 0

    def test_gerber_and_drill_exports_present(self, standard_board):
        gerber_dir = standard_board["dir"] / "gerbers"
        assert gerber_dir.is_dir()
        files = list(gerber_dir.iterdir())
        file_names = [f.name for f in files]
        # Must contain copper, silk, edge cuts, and drill
        assert any("F_Cu" in fn or "F.Cu" in fn for fn in file_names)
        assert any("Edge_Cuts" in fn or "Edge.Cuts" in fn for fn in file_names)
        assert any(".drl" in fn for fn in file_names)

    def test_bom_csv_contents(self, standard_board):
        bom_file = standard_board["dir"] / "bom.csv"
        assert bom_file.is_file()
        text = bom_file.read_text()
        assert "J1 J2" in text
        assert "H1 H2 H3 H4" in text
        assert "M3 mounting hole" in text

    def test_nets_json_routed_pins(self, standard_board):
        nets_file = standard_board["dir"] / "nets.json"
        assert nets_file.is_file()
        data = json.loads(nets_file.read_text())
        assert len(data["nets"]) == 4
        for net_entry in data["nets"]:
            assert len(net_entry["pins"]) == 2
            assert any(p.startswith("J1.") for p in net_entry["pins"])
            assert any(p.startswith("J2.") for p in net_entry["pins"])

    def test_custom_breakout_zip_archive(self, standard_board):
        zip_path = standard_board["dir"] / "custom-breakout-board.zip"
        assert zip_path.is_file()
        with zipfile.ZipFile(zip_path, "r") as z:
            names = z.namelist()
            assert "custom-breakout.kicad_pcb" in names
            assert "board.svg" in names
            assert "drc.json" in names
            assert "evaluation.json" in names
            # Must not contain nested zip archives
            assert not any(n.endswith(".zip") for n in names)

    def test_swig_iterator_compatibility(self):
        """Direct check that SWIG iterator next patch works in KiCad python."""
        code = """
import pcbnew as k
it = k.TRACKS().iterator()
it.__class__.next = it.__class__.__next__
assert hasattr(it, 'next')
print('SWIG iterator next verified')
"""
        res = subprocess.run([KICAD_PYTHON, "-c", code], capture_output=True, text=True, env=_kicad_env())
        assert res.returncode == 0
        assert "SWIG iterator next verified" in res.stdout

    def test_pad_parent_footprint_reference_compatibility(self, standard_board):
        """Direct check that p.GetParentFootprint().GetReference() operates without container error."""
        board_path = standard_board["dir"] / "custom-breakout.kicad_pcb"
        code = f"""
import pcbnew as k
b = k.LoadBoard('{board_path}')
pads = [p for fp in b.GetFootprints() for p in fp.Pads()]
refs = set()
for p in pads:
    ref = p.GetParentFootprint().GetReference()
    refs.add(ref)
assert refs == {{'J1', 'J2', 'H1', 'H2', 'H3', 'H4'}}
print('Pad parent references verified:', sorted(refs))
"""
        res = subprocess.run([KICAD_PYTHON, "-c", code], capture_output=True, text=True, env=_kicad_env())
        assert res.returncode == 0
        assert "Pad parent references verified" in res.stdout

    def test_boundary_minimum_3_nets_drc(self, tmp_path):
        spec = {
            "kind": "signal_breakout",
            "nets": ["A", "B", "C"],
            "connector_spacing": 20.0,
            "trace_width": 0.25,
        }
        res = run_model_board(spec, tmp_path)
        assert res.returncode == 0
        eval_data = json.loads((tmp_path / "evaluation.json").read_text())
        assert eval_data["passed"] is True

    def test_boundary_maximum_8_nets_drc(self, tmp_path):
        spec = {
            "kind": "signal_breakout",
            "nets": ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"],
            "connector_spacing": 38.0,
            "trace_width": 0.8,
        }
        res = run_model_board(spec, tmp_path)
        assert res.returncode == 0
        eval_data = json.loads((tmp_path / "evaluation.json").read_text())
        assert eval_data["passed"] is True


# ===========================================================================
# Tier 1, Tier 2 & Tier 3: CadQuery Sensor Bridge Addon Compiler Tests
# ===========================================================================

class TestCadQuerySensorBridge:
    """Verifies CadQuery sensor bridge parametric compiler and OpenCASCADE cylinder radius fix."""

    @pytest.fixture
    def rover_setup(self):
        spec = Spec(length=140, width=95, thickness=3.0, wall=2.5, clearance=1.2, mast_height=50)
        parts, measured = build(spec)
        measured["mast"] = next(p["shape"] for p in parts if p["name"] == "Sensor mast")
        return spec, parts, measured

    def test_build_addon_shape_properties(self, rover_setup):
        spec, parts, measured = rover_setup
        addon_spec = {"kind": "sensor_bridge", "depth": 20.0, "thickness": 2.5}
        part, plate = build_addon(spec, addon_spec)

        assert part["name"] == "Sensor bridge"
        assert part["group"] == "structure"
        assert part["printable"] is True
        assert part["shape"] is not None
        assert plate is not None

    def test_addon_opencascade_cylinder_radius_fix(self, rover_setup):
        """Verifies that accessing cylindrical face radius via OpenCASCADE geometry adaptor succeeds."""
        spec, parts, measured = rover_setup
        addon_spec = {"kind": "sensor_bridge", "depth": 20.0, "thickness": 2.5}
        part, plate = build_addon(spec, addon_spec)
        bridge = part["shape"]

        # OpenCASCADE geometry adaptor check
        bores = [
            f for f in bridge.Faces()
            if f.geomType() == "CYLINDER" and abs(f._geomAdaptor().Cylinder().Radius() - 1.7) < 1e-5
        ]
        assert len(bores) == 2, f"Expected 2 mounting bores with radius 1.7 mm, found {len(bores)}"

    def test_evaluate_addon_passing_checks(self, rover_setup):
        spec, parts, measured = rover_setup
        addon_spec = {"kind": "sensor_bridge", "depth": 20.0, "thickness": 2.5}
        part, plate = build_addon(spec, addon_spec)
        checks = evaluate_addon(part, plate, measured)

        assert len(checks) == 3
        check_names = {c["name"] for c in checks}
        assert "Bridge plate thickness" in check_names
        assert "Bridge clearance" in check_names
        assert "Bridge mounting bores" in check_names

        for check in checks:
            assert check["passed"] is True, f"Check failed: {check}"

    def test_addon_depth_boundaries(self, rover_setup):
        spec, parts, measured = rover_setup
        # Depth 16 (min)
        part16, plate16 = build_addon(spec, {"kind": "sensor_bridge", "depth": 16.0, "thickness": 2.5})
        checks16 = evaluate_addon(part16, plate16, measured)
        assert all(c["passed"] for c in checks16)

        # Depth 24 (max)
        part24, plate24 = build_addon(spec, {"kind": "sensor_bridge", "depth": 24.0, "thickness": 2.5})
        checks24 = evaluate_addon(part24, plate24, measured)
        assert all(c["passed"] for c in checks24)

    def test_addon_thickness_boundary_eval(self, rover_setup):
        spec, parts, measured = rover_setup
        # Thickness 2.4 mm (minimum acceptance threshold in requirement)
        part, plate = build_addon(spec, {"kind": "sensor_bridge", "depth": 20.0, "thickness": 2.4})
        checks = evaluate_addon(part, plate, measured)
        thick_check = next(c for c in checks if c["name"] == "Bridge plate thickness")
        assert thick_check["passed"] is True
        assert thick_check["measured"] == 2.4

        # Thickness 2.0 mm (below requirement 2.4 mm, should fail check)
        part_thin, plate_thin = build_addon(spec, {"kind": "sensor_bridge", "depth": 20.0, "thickness": 2.0})
        checks_thin = evaluate_addon(part_thin, plate_thin, measured)
        thick_thin_check = next(c for c in checks_thin if c["name"] == "Bridge plate thickness")
        assert thick_thin_check["passed"] is False
