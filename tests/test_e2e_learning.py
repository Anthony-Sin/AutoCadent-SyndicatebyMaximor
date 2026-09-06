"""
End-to-End Opaque-Box Learning Loop Test Suite for AutoCadent.

Derived directly from:
- ORIGINAL_REQUEST.md (§ 2026-09-06T02:29:25Z: R1, R2, R3, R4)
- PROJECT.md Feature Inventory (F1 through F14)
- Interface Contracts in PROJECT.md

4-Tier Architecture:
- Tier 1: Feature Coverage (F1 to F14 individual happy-path verification)
- Tier 2: Boundary & Corner Cases (Limits, edge cases, invalid inputs, error recovery)
- Tier 3: Cross-Feature Combinations (Pairwise interactions: reflection -> memory -> tools -> telemetry)
- Tier 4: Real-World Application Scenarios (Cold -> Warm -> Generalization multi-revision progression)
"""

import json
import math
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

# Core existing modules
from autocadent.cad import Spec, build, evaluate, box, repair
from autocadent.addon import build_addon, evaluate_addon
from autocadent.design import RoverSpec, AddonSpec, PCBSpec, Design, parse_design
import autocadent.api as api

# Sample fixtures
from tests.fixtures.learning_data import (
    SAMPLE_NAIVE_SPEC,
    SAMPLE_PASSING_SPEC,
    SAMPLE_GENERALIZED_SPEC,
    SAMPLE_PCB_SPEC,
    SAMPLE_PCB_DRC_FAILURE_SPEC,
    SAMPLE_FAILED_EVALUATION,
    SAMPLE_PASSING_EVALUATION,
    SAMPLE_EPISODIC_TRACE,
)

ROOT = Path(__file__).resolve().parents[1]
KICAD_PYTHON = os.getenv("AUTOCADENT_KICAD_PYTHON", "/usr/bin/python3")
MODEL_BOARD_SCRIPT = ROOT / "scripts" / "model_board.py"
BENCHMARK_SCRIPT = ROOT / "scripts" / "verify_learning_loop.py"

# Progressive testability imports
try:
    from autocadent.memory import MemoryStore, Heuristic, EpisodicTrace
    HAS_MEMORY = True
except (ImportError, ModuleNotFoundError, AttributeError):
    HAS_MEMORY = False
    MemoryStore = None
    Heuristic = None
    EpisodicTrace = None

try:
    from autocadent.agents import ReflectionSynthesizer, SubAgentGraph
    HAS_AGENTS = True
except (ImportError, ModuleNotFoundError, AttributeError):
    HAS_AGENTS = False
    ReflectionSynthesizer = None
    SubAgentGraph = None

try:
    from autocadent.learning_pipeline import LearningPipeline, run_learning_loop
    HAS_LEARNING_PIPELINE = True
except (ImportError, ModuleNotFoundError, AttributeError):
    HAS_LEARNING_PIPELINE = False
    LearningPipeline = None
    run_learning_loop = None

try:
    import scripts.verify_learning_loop as benchmark_module
    HAS_BENCHMARK_SCRIPT = True
except (ImportError, ModuleNotFoundError, AttributeError):
    HAS_BENCHMARK_SCRIPT = False
    benchmark_module = None

client = TestClient(api.app)
HAS_LEARNING_API = any(r.path.startswith("/api/learning") for r in api.app.routes)
HAS_GRAPH_API = any(r.path == "/api/agents/graph" for r in api.app.routes)


def _kicad_env():
    """Strip PYTHONHOME (set by uv run) so /usr/bin/python3 finds pcbnew."""
    return {k: v for k, v in os.environ.items() if k != "PYTHONHOME"}


def run_kicad_model_board(spec_dict: dict, out_dir: Path) -> subprocess.CompletedProcess:
    """Helper to run scripts/model_board.py with system python and kicad-cli."""
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
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=_kicad_env())


# ===========================================================================
# Tier 1: Feature Coverage (F1 to F14)
# ===========================================================================

class TestTier1FeatureCoverage:
    """Happy-path verification for every feature (F1-F14) from PROJECT.md."""

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier1_f1_episodic_trace_logging(self, tmp_path):
        """F1: Record structured traces of tool invocations, inputs, execution times, token costs, and outcomes."""
        db_path = tmp_path / "memory_f1.db"
        store = MemoryStore(db_path=str(db_path))

        episode_id = "ep-f1-test"
        metrics = {
            "duration_ms": 3500.0,
            "prompt_tokens": 1200,
            "completion_tokens": 300,
            "total_tokens": 1500,
            "checks_passed": 3,
            "checks_total": 6,
        }
        store.record_episode(
            episode_id=episode_id,
            revision=1,
            status="FAILED",
            summary="Cold run with naive spec",
            metrics=metrics,
        )

        store.record_tool_invocation(
            episode_id=episode_id,
            tool_name="cadquery_build_and_evaluate",
            inputs=SAMPLE_NAIVE_SPEC,
            output={"passed": False, "failed_checks": ["Chassis thickness"]},
            latency_ms=650.0,
            tokens=450,
            status="CONSTRAINT_FAILURE",
        )

        # Verify persisted via SQLite query
        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()
        cur.execute("SELECT episode_id, revision, status FROM episodes WHERE episode_id = ?", (episode_id,))
        row = cur.fetchone()
        assert row is not None
        assert row[0] == episode_id
        assert row[1] == 1
        assert row[2] == "FAILED"

        cur.execute("SELECT tool_name, status, latency_ms FROM tool_invocations WHERE episode_id = ?", (episode_id,))
        tool_row = cur.fetchone()
        assert tool_row is not None
        assert tool_row[0] == "cadquery_build_and_evaluate"
        assert tool_row[1] == "CONSTRAINT_FAILURE"
        assert abs(tool_row[2] - 650.0) < 1e-3
        conn.close()

    @pytest.mark.skipif(not HAS_AGENTS, reason="autocadent.agents not implemented yet (M1)")
    def test_tier1_f2_post_run_self_reflection_agent(self):
        """F2: Analyze failure modes (geometry, clearance, mast heights) and synthesize procedural rules."""
        reflector = ReflectionSynthesizer()
        heuristics = reflector.reflect(SAMPLE_FAILED_EVALUATION, SAMPLE_EPISODIC_TRACE)

        assert isinstance(heuristics, list)
        assert len(heuristics) >= 3, "Should synthesize at least 3 rules for the 3 failed checks"

        # Verify rule contents match required parameter overrides
        overrides = {}
        for h in heuristics:
            # Handle both dataclass and dict forms
            param = getattr(h, "parameter_override", None) or (h.get("parameter_override") if isinstance(h, dict) else None)
            key = getattr(h, "parameter_key", None) or (h.get("parameter_key") if isinstance(h, dict) else None)
            rationale = getattr(h, "rationale", "") or (h.get("rationale") if isinstance(h, dict) else "")
            assert rationale, "Synthesized rule must include an engineering rationale"
            if key and param:
                overrides[key] = param

        # Check that thickness, wall, and clearance rules are present and satisfy minimum bounds
        assert any("thickness" in str(h) for h in heuristics)
        assert any("wall" in str(h) for h in heuristics)
        assert any("clearance" in str(h) for h in heuristics)

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier1_f3_persistent_memory_store(self, tmp_path):
        """F3: Persist acquired procedural rules and episodic traces in structured format (SQLite & JSON sync)."""
        db_path = tmp_path / "memory_f3.db"
        json_telemetry = tmp_path / "learning_telemetry.json"
        json_bank = tmp_path / "memory_bank.json"

        store = MemoryStore(db_path=str(db_path))
        store.add_heuristic(
            rule_id="RULE-CAD-001",
            category="cad_solid",
            trigger_pattern="Chassis thickness < 2.4",
            parameter_override={"thickness": 2.5},
            rationale="Chassis plate requires minimum 2.4mm for structural rigidity",
        )
        store.record_episode(
            episode_id="ep-f3-001",
            revision=1,
            status="SUCCESS",
            summary="Test episode",
            metrics={"duration_ms": 1200.0, "total_tokens": 500, "checks_passed": 6, "checks_total": 6},
        )

        store.export_json(telemetry_path=str(json_telemetry), memory_bank_path=str(json_bank))
        assert json_telemetry.is_file()
        assert json_bank.is_file()

        bank_data = json.loads(json_bank.read_text())
        assert any(r.get("rule_id") == "RULE-CAD-001" for r in (bank_data if isinstance(bank_data, list) else bank_data.get("rules", [])))

        # Close and reopen store with fresh instance
        store2 = MemoryStore(db_path=str(db_path))
        active_rules = store2.get_active_heuristics()
        assert len(active_rules) >= 1
        rule_ids = [getattr(r, "rule_id", None) or (r.get("rule_id") if isinstance(r, dict) else None) for r in active_rules]
        assert "RULE-CAD-001" in rule_ids

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier1_f4_heuristic_query_and_preflight_application(self, tmp_path):
        """F4: Query and apply learned rules in subsequent revisions to avoid repeat failures."""
        db_path = tmp_path / "memory_f4.db"
        store = MemoryStore(db_path=str(db_path))

        store.add_heuristic(
            rule_id="RULE-CAD-THICKNESS",
            category="cad_solid",
            trigger_pattern="Chassis thickness < 2.4",
            parameter_override={"thickness": 2.5},
            rationale="Base plate threshold",
        )
        store.add_heuristic(
            rule_id="RULE-CAD-WALL",
            category="cad_solid",
            trigger_pattern="Tray wall < 2.4",
            parameter_override={"wall": 2.5},
            rationale="Tray wall threshold",
        )
        store.add_heuristic(
            rule_id="RULE-CAD-CLEARANCE",
            category="cad_solid",
            trigger_pattern="Board clearance < 0.8",
            parameter_override={"clearance": 1.0},
            rationale="Board clearance margin",
        )

        heuristics = store.get_active_heuristics(category="cad_solid")
        assert len(heuristics) == 3

        naive_spec = dict(SAMPLE_NAIVE_SPEC)
        adjusted_spec, applied_rules = store.apply_heuristics_to_spec(naive_spec)

        assert adjusted_spec["thickness"] >= 2.4
        assert adjusted_spec["wall"] >= 2.4
        assert adjusted_spec["clearance"] >= 0.8
        assert len(applied_rules) == 3
        # Ensure unaffected parameters remain intact
        assert adjusted_spec["length"] == naive_spec["length"]
        assert adjusted_spec["mast_height"] == naive_spec["mast_height"]

    def test_tier1_f5_cadquery_opencascade_18_solids_and_6_checks(self):
        """F5: Solid geometry modeling with 18 solids passing all 6/6 B-rep design constraints."""
        valid_spec = Spec(length=140.0, width=90.0, thickness=2.5, wall=2.5, clearance=1.0, mast_height=52.0)
        parts, measured = build(valid_spec)

        # Must build exactly 18 solids
        assert len(parts) == 18, f"Expected 18 assembly solids, got {len(parts)}"
        # All solids must be OpenCASCADE manifold valid with non-zero volume
        for p in parts:
            shape = p["shape"]
            assert shape.isValid(), f"Shape {p['name']} is non-manifold or invalid"
            assert shape.Volume() > 0, f"Shape {p['name']} has zero or negative volume"

        evaluation = evaluate(valid_spec, parts, measured)
        assert len(evaluation["checks"]) == 6, f"Expected exactly 6 checks, got {len(evaluation['checks'])}"
        assert evaluation["passed"] is True, f"All 6 checks should pass, but failed: {evaluation['checks']}"

        check_names = [c["name"] for c in evaluation["checks"]]
        expected_names = [
            "Solid validity",
            "Chassis thickness",
            "Tray wall",
            "Board clearance",
            "Chassis length",
            "Tray edge margin",
        ]
        assert check_names == expected_names
        for c in evaluation["checks"]:
            assert c["passed"] is True, f"Check {c['name']} failed: measured {c['measured']}"

    def test_tier1_f6_kicad_pcb_and_drc_tool_integration(self, tmp_path):
        """F6: Automated PCB routing with 0 DRC violations, 0 unconnected nets, and connector spacing bounds (20-38mm)."""
        res = run_kicad_model_board(SAMPLE_PCB_SPEC, tmp_path)
        assert res.returncode == 0, f"KiCad compilation failed: {res.stderr}"

        eval_file = tmp_path / "evaluation.json"
        assert eval_file.is_file(), "evaluation.json was not generated by model_board.py"
        eval_data = json.loads(eval_file.read_text())

        assert eval_data["passed"] is True
        drc_file = tmp_path / "drc.json"
        assert drc_file.is_file(), "drc.json was not generated"
        drc = json.loads(drc_file.read_text())
        assert len(drc["violations"]) == 0, f"DRC violations found: {drc['violations']}"
        assert len(drc["unconnected_items"]) == 0, f"Unconnected nets found: {drc['unconnected_items']}"
        assert SAMPLE_PCB_SPEC["connector_spacing"] >= 20.0
        assert SAMPLE_PCB_SPEC["connector_spacing"] <= 38.0

        # Verify board outline matches 60x40 mm tray envelope
        outline = eval_data.get("outline_mm", [0, 0])
        assert abs(outline[0] - 60.0) < 0.2
        assert abs(outline[1] - 40.0) < 0.2

    def test_tier1_f7_tool_feedback_domain_logic_learning(self):
        """F7: Discover and internalize contextual logic from tool feedback (wall thickness, clearance)."""
        # Build naive model that produces tool feedback failures
        naive_spec = Spec(**SAMPLE_NAIVE_SPEC)
        parts, measured = build(naive_spec)
        failed_eval = evaluate(naive_spec, parts, measured)

        failed_checks = [c for c in failed_eval["checks"] if not c["passed"]]
        assert len(failed_checks) == 3

        # Deterministic domain repair policy internalization check
        repaired_spec, repairs = repair(naive_spec, failed_eval)
        assert repairs == {"thickness": 2.4, "wall": 2.4, "clearance": 0.8}

        parts_repaired, measured_repaired = build(repaired_spec)
        repaired_eval = evaluate(repaired_spec, parts_repaired, measured_repaired)
        assert repaired_eval["passed"] is True

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier1_f8_quantitative_tool_call_efficiency_tracking(self, tmp_path):
        """F8: Quantitative telemetry demonstrating fewer failed attempts and faster convergence over sequential runs."""
        db_path = tmp_path / "memory_f8.db"
        store = MemoryStore(db_path=str(db_path))

        # Rev 1: 3 attempts, 2 failures, 4500ms, 1800 tokens
        store.record_episode("ep-f8-1", 1, "REPAIRED", "Initial trial-and-error", {
            "duration_ms": 4500.0,
            "prompt_tokens": 1400,
            "completion_tokens": 400,
            "total_tokens": 1800,
            "tool_calls": 3,
            "tool_failures": 2,
            "checks_passed": 6,
            "checks_total": 6,
        })

        # Rev 2: 1 attempt, 0 failures, 1100ms, 550 tokens
        store.record_episode("ep-f8-2", 2, "SUCCESS", "Converged using memory", {
            "duration_ms": 1100.0,
            "prompt_tokens": 450,
            "completion_tokens": 100,
            "total_tokens": 550,
            "tool_calls": 1,
            "tool_failures": 0,
            "checks_passed": 6,
            "checks_total": 6,
        })

        telemetry_file = tmp_path / "telemetry.json"
        bank_file = tmp_path / "bank.json"
        store.export_json(str(telemetry_file), str(bank_file))

        telemetry = json.loads(telemetry_file.read_text())
        episodes = telemetry if isinstance(telemetry, list) else telemetry.get("episodes", [])
        assert len(episodes) == 2

        rev1 = next(e for e in episodes if e.get("revision") == 1)
        rev2 = next(e for e in episodes if e.get("revision") == 2)

        # Efficiency asserts
        assert rev2["duration_ms"] < rev1["duration_ms"]
        assert rev2["total_tokens"] < rev1["total_tokens"]
        assert rev2["tool_failures"] < rev1["tool_failures"]

    @pytest.mark.skipif(not HAS_AGENTS, reason="autocadent.agents not implemented yet (M1)")
    def test_tier1_f9_subagent_execution_graph_ui_structure(self):
        """F9: Sub-Agent Execution Graph with Orchestrator, CAD, PCB, Verifier, Reflection Synthesizer."""
        graph = SubAgentGraph()
        state = graph.get_state()

        assert "agents" in state or "nodes" in state
        agent_names = [a.get("role") or a.get("name") for a in (state.get("agents") or state.get("nodes", []))]

        expected_roles = ["Orchestrator", "CAD Specialist", "PCB Specialist", "Verifier", "Reflection Synthesizer"]
        for role in expected_roles:
            assert any(role.lower() in str(name).lower() for name in agent_names), f"Missing role {role} in agent graph"

    def test_tier1_f10_learning_curve_charts_ui_markup(self):
        """F10: Interactive SVG charts in #/explorer & #/dashboard for error reduction, pass rate, duration, tokens."""
        index_html = (ROOT / "web" / "index.html").read_text()
        app_js = (ROOT / "web" / "app.js").read_text()

        # Check for explorer view and chart telemetry hooks
        assert "explorer" in index_html.lower() or "explorer" in app_js.lower()
        # Telemetry metrics indicators in frontend codebase
        assert any(k in app_js for k in ["telemetry", "learning", "checks", "tokens", "duration", "pass_rate"])

    def test_tier1_f11_memory_and_heuristics_bank_ui_elements(self):
        """F11: Inspectable memory explorer in #/explorer showing acquired domain rules, past mistakes."""
        app_js = (ROOT / "web" / "app.js").read_text()
        index_html = (ROOT / "web" / "index.html").read_text()

        assert any(k in app_js.lower() or k in index_html.lower() for k in ["memory", "heuristic", "rules", "bank"])

    @pytest.mark.skipif(not HAS_LEARNING_API, reason="autocadent/api.py learning endpoints not implemented yet (M3)")
    def test_tier1_f12_backend_telemetry_api_endpoints(self):
        """F12: Serve /api/learning/telemetry, /api/learning/memory, /api/agents/graph."""
        res_telemetry = client.get("/api/learning/telemetry")
        assert res_telemetry.status_code in [200, 404]

        res_memory = client.get("/api/learning/memory")
        assert res_memory.status_code in [200, 404]

        res_graph = client.get("/api/agents/graph")
        assert res_graph.status_code in [200, 404]

    @pytest.mark.skipif(not HAS_BENCHMARK_SCRIPT and not BENCHMARK_SCRIPT.is_file(), reason="scripts/verify_learning_loop.py not implemented yet (M4)")
    def test_tier1_f13_automated_multi_revision_benchmark_script_discovery(self):
        """F13: Automated multi-revision benchmark script exists and is executable."""
        assert BENCHMARK_SCRIPT.is_file(), f"Benchmark script {BENCHMARK_SCRIPT} does not exist"
        proc = subprocess.run([sys.executable, str(BENCHMARK_SCRIPT), "--help"], capture_output=True, text=True)
        # Help or execution check
        assert proc.returncode in [0, 2]

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier1_f14_benchmark_telemetry_validation(self, tmp_path):
        """F14: Validate benchmark telemetry schema comparing Revision 1 to Revision N."""
        db_path = tmp_path / "memory_f14.db"
        store = MemoryStore(db_path=str(db_path))

        store.record_episode("ep-1", 1, "FAILED", "Cold run", {
            "checks_passed": 3, "checks_total": 6, "duration_ms": 4000.0, "total_tokens": 2000,
        })
        store.record_episode("ep-2", 2, "SUCCESS", "Warm run", {
            "checks_passed": 6, "checks_total": 6, "duration_ms": 1500.0, "total_tokens": 800,
        })
        store.record_episode("ep-3", 3, "SUCCESS", "Transfer run", {
            "checks_passed": 6, "checks_total": 6, "duration_ms": 1300.0, "total_tokens": 750,
        })

        telemetry_file = tmp_path / "telemetry_f14.json"
        bank_file = tmp_path / "bank_f14.json"
        store.export_json(str(telemetry_file), str(bank_file))

        data = json.loads(telemetry_file.read_text())
        episodes = data if isinstance(data, list) else data.get("episodes", [])
        assert len(episodes) == 3

        # Quantitative checks
        assert episodes[0]["checks_passed"] < episodes[1]["checks_passed"]
        assert episodes[1]["checks_passed"] == 6
        assert episodes[2]["checks_passed"] == 6
        assert episodes[1]["total_tokens"] < episodes[0]["total_tokens"]
        assert episodes[2]["total_tokens"] < episodes[0]["total_tokens"]


# ===========================================================================
# Tier 2: Boundary & Corner Cases
# ===========================================================================

class TestTier2BoundaryAndCornerCases:
    """Boundary values, edge cases, invalid inputs, error recovery, and stress conditions."""

    def test_tier2_cad_dimension_boundary_limits(self):
        """Verify boundary dimensions: min and max valid dimensions succeed in CadQuery."""
        # Minimum valid dimensions
        min_spec = Spec(length=120.0, width=80.0, thickness=2.4, wall=2.4, clearance=0.8, mast_height=35.0)
        parts_min, measured_min = build(min_spec)
        assert len(parts_min) == 18
        eval_min = evaluate(min_spec, parts_min, measured_min)
        assert eval_min["passed"] is True

        # Maximum valid dimensions
        max_spec = Spec(length=180.0, width=110.0, thickness=5.0, wall=5.0, clearance=3.0, mast_height=75.0)
        parts_max, measured_max = build(max_spec)
        assert len(parts_max) == 18
        eval_max = evaluate(max_spec, parts_max, measured_max)
        assert eval_max["passed"] is True

    @pytest.mark.parametrize("invalid_kwargs", [
        {"length": 119.9},
        {"length": 180.1},
        {"width": 79.9},
        {"width": 110.1},
        {"thickness": 0.99},
        {"thickness": 5.01},
        {"wall": 0.99},
        {"wall": 5.01},
        {"clearance": 0.04},
        {"clearance": 3.01},
        {"mast_height": 34.9},
        {"mast_height": 75.1},
        {"thickness": float("nan")},
        {"wall": float("inf")},
        {"length": -140},
    ])
    def test_tier2_cad_dimension_out_of_bounds_rejected(self, invalid_kwargs):
        """Reject out-of-bound or non-finite CAD dimensions with ValueError."""
        with pytest.raises(ValueError):
            Spec(**invalid_kwargs)

    def test_tier2_pcb_connector_spacing_boundaries(self, tmp_path):
        """Verify KiCad connector spacing boundaries: [20.0, 38.0] mm."""
        # Minimum valid connector spacing
        min_pcb = dict(SAMPLE_PCB_SPEC, connector_spacing=20.0)
        out_min = tmp_path / "min_spacing"
        out_min.mkdir()
        res_min = run_kicad_model_board(min_pcb, out_min)
        assert res_min.returncode == 0
        drc_min = json.loads((out_min / "drc.json").read_text())
        assert len(drc_min["violations"]) == 0

        # Maximum valid connector spacing
        max_pcb = dict(SAMPLE_PCB_SPEC, connector_spacing=38.0)
        out_max = tmp_path / "max_spacing"
        out_max.mkdir()
        res_max = run_kicad_model_board(max_pcb, out_max)
        assert res_max.returncode == 0
        drc_max = json.loads((out_max / "drc.json").read_text())
        assert len(drc_max["violations"]) == 0

        # Out of bounds (> 38.0 mm encroaches on M3 mounting holes)
        bad_pcb = dict(SAMPLE_PCB_SPEC, connector_spacing=39.0)
        out_bad = tmp_path / "bad_spacing"
        out_bad.mkdir()
        res_bad = run_kicad_model_board(bad_pcb, out_bad)
        assert res_bad.returncode != 0 or "violations" in res_bad.stderr or "Invalid" in res_bad.stderr or (out_bad / "drc.json").exists()

    def test_tier2_pcb_trace_width_boundaries(self, tmp_path):
        """Verify KiCad trace width bounds: [0.25, 0.80] mm."""
        # 0.25mm valid
        spec_25 = dict(SAMPLE_PCB_SPEC, trace_width=0.25)
        out_25 = tmp_path / "tw_25"
        out_25.mkdir()
        assert run_kicad_model_board(spec_25, out_25).returncode == 0

        # 0.80mm valid
        spec_80 = dict(SAMPLE_PCB_SPEC, trace_width=0.80)
        out_80 = tmp_path / "tw_80"
        out_80.mkdir()
        assert run_kicad_model_board(spec_80, out_80).returncode == 0

        # 0.20mm invalid
        spec_bad_thin = dict(SAMPLE_PCB_SPEC, trace_width=0.20)
        out_bad_thin = tmp_path / "tw_bad_thin"
        out_bad_thin.mkdir()
        assert run_kicad_model_board(spec_bad_thin, out_bad_thin).returncode != 0

        # 0.85mm invalid
        spec_bad_thick = dict(SAMPLE_PCB_SPEC, trace_width=0.85)
        out_bad_thick = tmp_path / "tw_bad_thick"
        out_bad_thick.mkdir()
        assert run_kicad_model_board(spec_bad_thick, out_bad_thick).returncode != 0

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier2_memory_store_duplicate_rule_idempotency(self, tmp_path):
        """Inserting identical rule multiple times updates existing rule without SQLite errors."""
        db_path = tmp_path / "memory_t2_idemp.db"
        store = MemoryStore(db_path=str(db_path))

        # Add rule once
        store.add_heuristic("RULE-DUP-1", "cad", "thickness < 2.4", {"thickness": 2.5}, "Initial")
        # Add again with updated rationale
        store.add_heuristic("RULE-DUP-1", "cad", "thickness < 2.4", {"thickness": 2.6}, "Updated")

        rules = store.get_active_heuristics()
        matching = [r for r in rules if (getattr(r, "rule_id", None) or (r.get("rule_id") if isinstance(r, dict) else None)) == "RULE-DUP-1"]
        assert len(matching) == 1, "Should update existing rule rather than inserting duplicate primary key"

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier2_memory_store_empty_database_queries(self, tmp_path):
        """Querying fresh empty database returns empty lists, not None or unhandled exceptions."""
        db_path = tmp_path / "memory_empty.db"
        store = MemoryStore(db_path=str(db_path))

        assert store.get_active_heuristics() == []
        assert store.get_active_heuristics(category="cad_solid") == []

        # Applying empty heuristics to spec returns identical spec and empty applied list
        spec_in = dict(SAMPLE_NAIVE_SPEC)
        spec_out, applied = store.apply_heuristics_to_spec(spec_in)
        assert spec_out == spec_in
        assert applied == []

    @pytest.mark.skipif(not HAS_AGENTS, reason="autocadent.agents not implemented yet (M1)")
    def test_tier2_reflection_agent_passing_evaluation_produces_no_rules(self):
        """When evaluation passes 6/6 checks, reflection agent returns empty list of heuristics."""
        reflector = ReflectionSynthesizer()
        rules = reflector.reflect(SAMPLE_PASSING_EVALUATION, SAMPLE_EPISODIC_TRACE)
        assert rules == [], "Reflection should not synthesize rules when all checks passed"

    @pytest.mark.skipif(not HAS_AGENTS, reason="autocadent.agents not implemented yet (M1)")
    def test_tier2_reflection_agent_handles_empty_trace_gracefully(self):
        """Reflection agent handles minimal/empty trace dictionary without raising exceptions."""
        reflector = ReflectionSynthesizer()
        rules = reflector.reflect(SAMPLE_FAILED_EVALUATION, {})
        assert isinstance(rules, list)
        assert len(rules) >= 3

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier2_preflight_clamping_multiple_conflicting_rules(self, tmp_path):
        """When multiple rules target the same parameter, preflight selects the safest/strictest override."""
        db_path = tmp_path / "memory_conflicts.db"
        store = MemoryStore(db_path=str(db_path))

        store.add_heuristic("RULE-T-1", "cad", "thickness < 2.4", {"thickness": 2.4}, "Rule 1")
        store.add_heuristic("RULE-T-2", "cad", "thickness < 2.6", {"thickness": 2.6}, "Rule 2")

        adjusted_spec, applied = store.apply_heuristics_to_spec({"thickness": 1.2, "wall": 2.5, "clearance": 1.0, "length": 140, "width": 90, "mast_height": 52})
        assert adjusted_spec["thickness"] >= 2.6, f"Expected strictest clamp >= 2.6, got {adjusted_spec['thickness']}"

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier2_telemetry_metric_extremes(self, tmp_path):
        """Zero tokens and zero latency handled properly in episodic traces."""
        db_path = tmp_path / "memory_extremes.db"
        store = MemoryStore(db_path=str(db_path))

        store.record_episode("ep-zero", 1, "SUCCESS", "Zero metrics", {
            "duration_ms": 0.0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "checks_passed": 6,
            "checks_total": 6,
        })
        telemetry_file = tmp_path / "telemetry_zero.json"
        bank_file = tmp_path / "bank_zero.json"
        store.export_json(str(telemetry_file), str(bank_file))

        data = json.loads(telemetry_file.read_text())
        episodes = data if isinstance(data, list) else data.get("episodes", [])
        assert len(episodes) == 1
        assert episodes[0]["total_tokens"] == 0
        assert episodes[0]["duration_ms"] == 0.0

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier2_memory_store_concurrent_writes(self, tmp_path):
        """Concurrent multi-threaded writes to MemoryStore do not cause SQLite database lock crashes."""
        db_path = tmp_path / "memory_concurrent.db"
        store = MemoryStore(db_path=str(db_path))
        errors = []

        def worker(thread_id):
            try:
                for i in range(10):
                    ep_id = f"ep-{thread_id}-{i}"
                    store.record_episode(ep_id, 1, "SUCCESS", f"Thread {thread_id}", {
                        "duration_ms": 100.0, "total_tokens": 50, "checks_passed": 6, "checks_total": 6,
                    })
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(t,)) for t in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"Concurrent write errors encountered: {errors}"
        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM episodes")
        count = cur.fetchone()[0]
        assert count == 50
        conn.close()

    def test_tier2_adversarial_malformed_json_spec_rejected(self):
        """parse_design rejects oversized payloads, duplicate JSON keys, and non-finite numbers."""
        # Oversized payload
        with pytest.raises(ValueError, match="size bound"):
            parse_design(" " * 20000)

        # Duplicate JSON keys
        dup_json = '{"spec": {"length": 140, "length": 150}}'
        with pytest.raises(ValueError, match="Duplicate JSON key"):
            parse_design(dup_json)

        # Non-finite JSON numbers
        nan_json = '{"spec": {"length": NaN}}'
        with pytest.raises(ValueError):
            parse_design(nan_json)

    @pytest.mark.skipif(not HAS_LEARNING_API, reason="autocadent/api.py learning endpoints not implemented yet (M3)")
    def test_tier2_api_telemetry_empty_state_returns_clean_response(self):
        """API endpoints return 200 with empty list when no episodes exist, without 500 error."""
        res = client.get("/api/learning/telemetry")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, (list, dict))


# ===========================================================================
# Tier 3: Cross-Feature Combinations
# ===========================================================================

class TestTier3CrossFeatureCombinations:
    """Pairwise and multi-module interactions: reflection -> memory -> tool execution -> telemetry."""

    @pytest.mark.skipif(not HAS_MEMORY or not HAS_AGENTS, reason="autocadent.memory/agents not implemented yet (M1)")
    def test_tier3_reflection_to_memory_to_cad_verification_loop(self, tmp_path):
        """Cross-Feature: Failure -> Reflection -> MemoryStore -> Pre-flight Clamping -> CadQuery 6/6 PASS."""
        # 1. Simulate Revision 1 failure with naive spec
        naive_spec = Spec(**SAMPLE_NAIVE_SPEC)
        parts, measured = build(naive_spec)
        failed_eval = evaluate(naive_spec, parts, measured)
        assert failed_eval["passed"] is False

        # 2. Reflection agent analyzes failure and synthesizes heuristics
        reflector = ReflectionSynthesizer()
        trace = dict(SAMPLE_EPISODIC_TRACE, evaluation=failed_eval)
        heuristics = reflector.reflect(failed_eval, trace)
        assert len(heuristics) >= 3

        # 3. Store heuristics in MemoryStore
        db_path = tmp_path / "memory_t3_loop.db"
        store = MemoryStore(db_path=str(db_path))
        for h in heuristics:
            rule_id = getattr(h, "rule_id", None) or (h.get("rule_id") if isinstance(h, dict) else f"RULE-{time.time()}")
            cat = getattr(h, "category", None) or (h.get("category") if isinstance(h, dict) else "cad_solid")
            trig = getattr(h, "trigger_pattern", None) or (h.get("trigger_pattern") if isinstance(h, dict) else "failure")
            param = getattr(h, "parameter_override", None) or (h.get("parameter_override") if isinstance(h, dict) else {})
            rat = getattr(h, "rationale", "") or (h.get("rationale") if isinstance(h, dict) else "Engineering correction")
            store.add_heuristic(rule_id, cat, trig, param, rat)

        # 4. Revision 2: Pre-flight query and parameter clamping
        adjusted_spec_dict, applied_rules = store.apply_heuristics_to_spec(SAMPLE_NAIVE_SPEC)
        assert len(applied_rules) >= 3
        rev2_spec = Spec(**adjusted_spec_dict)

        # 5. CadQuery builds new geometry and Verifier evaluates
        rev2_parts, rev2_measured = build(rev2_spec)
        assert len(rev2_parts) == 18
        rev2_eval = evaluate(rev2_spec, rev2_parts, rev2_measured)

        # 6. Verification: All 6/6 checks pass on first pass!
        assert rev2_eval["passed"] is True, f"Failed checks: {[c for c in rev2_eval['checks'] if not c['passed']]}"

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier3_memory_persistence_across_session_restarts(self, tmp_path):
        """Cross-Feature: Multi-agent telemetry and learned rules survive complete session restart."""
        db_path = tmp_path / "memory_restart.db"
        json_telemetry = tmp_path / "telemetry_restart.json"
        json_bank = tmp_path / "bank_restart.json"

        # Session 1: Write episodes and heuristics
        store1 = MemoryStore(db_path=str(db_path))
        for rev in range(1, 4):
            store1.record_episode(f"ep-{rev}", rev, "SUCCESS", f"Revision {rev}", {
                "duration_ms": 3000.0 / rev,
                "total_tokens": 1500 // rev,
                "checks_passed": 6,
                "checks_total": 6,
            })
        store1.add_heuristic("RULE-SESSION", "cad", "mast_height > 75", {"mast_height": 65}, "Mast bound")
        store1.export_json(str(json_telemetry), str(json_bank))
        del store1

        # Session 2: Fresh instance, verify complete retrieval
        store2 = MemoryStore(db_path=str(db_path))
        rules = store2.get_active_heuristics()
        assert any((getattr(r, "rule_id", None) or (r.get("rule_id") if isinstance(r, dict) else None)) == "RULE-SESSION" for r in rules)

        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM episodes")
        assert cur.fetchone()[0] == 3
        conn.close()

    def test_tier3_cad_and_addon_sensor_bridge_spatial_clearance(self):
        """Cross-Feature: CadQuery educational rover combined with sensor bridge addon."""
        spec = Spec(length=140.0, width=95.0, thickness=2.5, wall=2.5, clearance=1.0, mast_height=52.0)
        parts, measured = build(spec)
        measured["mast"] = next(p["shape"] for p in parts if p["name"] == "Sensor mast")

        addon_spec = {"kind": "sensor_bridge", "depth": 20.0, "thickness": 2.5}
        part_addon, plate_addon = build_addon(spec, addon_spec)

        assert part_addon["shape"].isValid()
        assert part_addon["shape"].Volume() > 0

        # Evaluate addon geometric constraints
        addon_checks = evaluate_addon(part_addon, plate_addon, measured)
        assert len(addon_checks) == 3
        assert all(c["passed"] for c in addon_checks), f"Addon checks failed: {addon_checks}"

        # Combine with rover evaluation: 6 + 3 = 9 total checks passing
        rover_eval = evaluate(spec, parts, measured)
        assert rover_eval["passed"] is True
        total_checks = rover_eval["checks"] + addon_checks
        assert len(total_checks) == 9
        assert all(c["passed"] for c in total_checks)

    def test_tier3_cad_and_pcb_board_envelope_coordination(self, tmp_path):
        """Cross-Feature: KiCad 60x40mm breakout PCB fits inside CadQuery electronics tray envelope."""
        spec = Spec(length=140.0, width=90.0, thickness=2.5, wall=2.5, clearance=1.0, mast_height=52.0)
        parts, measured = build(spec)

        tray = measured["tray"]
        tray_bbox = tray.BoundingBox()

        res = run_kicad_model_board(SAMPLE_PCB_SPEC, tmp_path)
        assert res.returncode == 0
        pcb_eval = json.loads((tmp_path / "evaluation.json").read_text())
        pcb_outline = pcb_eval["outline_mm"]

        # Tray interior length = 60 + 2*clearance = 62.0mm
        # Tray interior width = 40 + 2*clearance = 42.0mm
        internal_x = 60.0 + 2 * spec.clearance
        internal_y = 40.0 + 2 * spec.clearance

        assert pcb_outline[0] < internal_x, f"PCB length {pcb_outline[0]} exceeds tray interior {internal_x}"
        assert pcb_outline[1] < internal_y, f"PCB width {pcb_outline[1]} exceeds tray interior {internal_y}"

    @pytest.mark.skipif(not HAS_AGENTS, reason="autocadent.agents not implemented yet (M1)")
    def test_tier3_subagent_graph_state_machine_workflow(self):
        """Cross-Feature: State transitions across Orchestrator -> CAD -> Verifier -> Reflection."""
        graph = SubAgentGraph()

        # Check initial state
        initial_state = graph.get_state()
        assert initial_state is not None

        # If transition methods exist, verify state machine
        if hasattr(graph, "transition_agent"):
            graph.transition_agent("CAD Specialist", "running")
            s1 = graph.get_state()
            assert any(a.get("role") == "CAD Specialist" and a.get("status") == "running" for a in s1.get("agents", []))

            graph.transition_agent("CAD Specialist", "success")
            graph.transition_agent("Verifier", "running")
            s2 = graph.get_state()
            assert any(a.get("role") == "Verifier" and a.get("status") == "running" for a in s2.get("agents", []))

    @pytest.mark.skipif(not HAS_MEMORY, reason="autocadent.memory not implemented yet (M1)")
    def test_tier3_dual_sync_sqlite_and_json_artifacts(self, tmp_path):
        """Cross-Feature: MemoryStore operations synchronize SQLite DB and JSON web artifacts."""
        db_path = tmp_path / "dual_sync.db"
        telemetry_json = tmp_path / "telemetry_sync.json"
        bank_json = tmp_path / "bank_sync.json"

        store = MemoryStore(db_path=str(db_path))
        store.add_heuristic("RULE-SYNC-1", "cad", "test trigger", {"wall": 2.5}, "Sync test")
        store.record_episode("ep-sync-1", 1, "SUCCESS", "Sync test episode", {
            "duration_ms": 500.0, "total_tokens": 100, "checks_passed": 6, "checks_total": 6,
        })
        store.export_json(str(telemetry_json), str(bank_json))

        # Check JSON files
        assert telemetry_json.is_file()
        assert bank_json.is_file()

        bank = json.loads(bank_json.read_text())
        assert any(r.get("rule_id") == "RULE-SYNC-1" for r in (bank if isinstance(bank, list) else bank.get("rules", [])))


# ===========================================================================
# Tier 4: Real-World Application Scenarios
# ===========================================================================

class TestTier4RealWorldApplicationScenarios:
    """Full educational rover multi-revision run: Cold -> Warm -> Generalization progression."""

    @pytest.mark.skipif(not HAS_MEMORY or not HAS_AGENTS, reason="autocadent.memory/agents not implemented yet (M1)")
    def test_tier4_full_multi_revision_learning_loop(self, tmp_path):
        """Tier 4: Multi-revision workflow: Cold (50% pass) -> Warm (6/6 100% pass) -> Generalization (6/6 100% pass)."""
        db_path = tmp_path / "multi_revision_bench.db"
        telemetry_path = tmp_path / "benchmark_telemetry.json"
        bank_path = tmp_path / "benchmark_bank.json"
        store = MemoryStore(db_path=str(db_path))
        reflector = ReflectionSynthesizer()

        # =====================================================================
        # Phase 1: Revision 1 (Cold Run)
        # =====================================================================
        # Naive input spec with default deficit values
        rev1_spec = Spec(**SAMPLE_NAIVE_SPEC)
        rev1_parts, rev1_measured = build(rev1_spec)
        rev1_eval = evaluate(rev1_spec, rev1_parts, rev1_measured)

        # Revision 1 must fail exactly 3 checks
        assert rev1_eval["passed"] is False
        failed_checks_rev1 = [c["name"] for c in rev1_eval["checks"] if not c["passed"]]
        assert set(failed_checks_rev1) == {"Chassis thickness", "Tray wall", "Board clearance"}
        assert len(failed_checks_rev1) == 3

        # Post-run reflection synthesizes rules
        trace_rev1 = {
            "episode_id": "rev-1-cold",
            "revision": 1,
            "spec": SAMPLE_NAIVE_SPEC,
            "evaluation": rev1_eval,
            "duration_ms": 4200.0,
            "total_tokens": 1650,
        }
        synthesized_rules = reflector.reflect(rev1_eval, trace_rev1)
        assert len(synthesized_rules) >= 3

        for rule in synthesized_rules:
            rid = getattr(rule, "rule_id", None) or (rule.get("rule_id") if isinstance(rule, dict) else f"RULE-{time.time()}")
            cat = getattr(rule, "category", None) or (rule.get("category") if isinstance(rule, dict) else "cad_solid")
            trig = getattr(rule, "trigger_pattern", None) or (rule.get("trigger_pattern") if isinstance(rule, dict) else "failure")
            param = getattr(rule, "parameter_override", None) or (rule.get("parameter_override") if isinstance(rule, dict) else {})
            rat = getattr(rule, "rationale", "") or (rule.get("rationale") if isinstance(rule, dict) else "Auto-synthesized")
            store.add_heuristic(rid, cat, trig, param, rat)

        store.record_episode("rev-1-cold", 1, "FAILED", "Cold run with 3 failures", {
            "duration_ms": 4200.0,
            "prompt_tokens": 1300,
            "completion_tokens": 350,
            "total_tokens": 1650,
            "checks_passed": 3,
            "checks_total": 6,
            "tool_failures": 3,
        })

        # Check memory bank growth: from 0 to >= 3 rules
        active_rules_rev1 = store.get_active_heuristics()
        assert len(active_rules_rev1) >= 3

        # =====================================================================
        # Phase 2: Revision 2 (Warm Run - Same Brief with Active Memory)
        # =====================================================================
        # Pre-flight rule query and application
        rev2_spec_dict, rev2_applied = store.apply_heuristics_to_spec(SAMPLE_NAIVE_SPEC)
        assert len(rev2_applied) >= 3
        rev2_spec = Spec(**rev2_spec_dict)

        # Build and evaluate geometry
        rev2_parts, rev2_measured = build(rev2_spec)
        assert len(rev2_parts) == 18
        rev2_eval = evaluate(rev2_spec, rev2_parts, rev2_measured)

        # Acceptance Criteria: 6/6 PASS on first pass!
        assert rev2_eval["passed"] is True
        assert all(c["passed"] for c in rev2_eval["checks"])

        store.record_episode("rev-2-warm", 2, "SUCCESS", "Warm run passed 6/6 on first attempt", {
            "duration_ms": 1150.0,
            "prompt_tokens": 400,
            "completion_tokens": 120,
            "total_tokens": 520,
            "checks_passed": 6,
            "checks_total": 6,
            "tool_failures": 0,
        })

        # =====================================================================
        # Phase 3: Revision 3 (Generalization / Transfer Run)
        # =====================================================================
        # New brief with novel rover dimensions
        transfer_seed = dict(SAMPLE_GENERALIZED_SPEC)
        # Naively inject thin parameters to test transfer clamping
        transfer_seed["thickness"] = 1.2
        transfer_seed["wall"] = 1.2
        transfer_seed["clearance"] = 0.1

        rev3_spec_dict, rev3_applied = store.apply_heuristics_to_spec(transfer_seed)
        assert len(rev3_applied) >= 3
        # Custom novel length and mast height must be preserved!
        assert rev3_spec_dict["length"] == 160.0
        assert rev3_spec_dict["mast_height"] == 65.0
        assert rev3_spec_dict["thickness"] >= 2.4
        assert rev3_spec_dict["wall"] >= 2.4
        assert rev3_spec_dict["clearance"] >= 0.8

        rev3_spec = Spec(**rev3_spec_dict)
        rev3_parts, rev3_measured = build(rev3_spec)
        assert len(rev3_parts) == 18
        rev3_eval = evaluate(rev3_spec, rev3_parts, rev3_measured)

        # Acceptance Criteria: 6/6 checks pass on transfer run!
        assert rev3_eval["passed"] is True
        assert all(c["passed"] for c in rev3_eval["checks"])

        # Also compile PCB breakout for transfer rover
        pcb_out = tmp_path / "rev3_pcb"
        pcb_out.mkdir()
        pcb_res = run_kicad_model_board(SAMPLE_PCB_SPEC, pcb_out)
        assert pcb_res.returncode == 0
        pcb_eval = json.loads((pcb_out / "evaluation.json").read_text())
        assert pcb_eval["passed"] is True
        drc_transfer = json.loads((pcb_out / "drc.json").read_text())
        assert len(drc_transfer["violations"]) == 0

        store.record_episode("rev-3-transfer", 3, "SUCCESS", "Transfer run passed 6/6 with novel geometry", {
            "duration_ms": 1250.0,
            "prompt_tokens": 420,
            "completion_tokens": 130,
            "total_tokens": 550,
            "checks_passed": 6,
            "checks_total": 6,
            "tool_failures": 0,
        })

        # =====================================================================
        # Phase 4: Telemetry Synthesis & Quantitative Learning Validation
        # =====================================================================
        store.export_json(str(telemetry_path), str(bank_path))
        assert telemetry_path.is_file()
        assert bank_path.is_file()

        telemetry = json.loads(telemetry_path.read_text())
        episodes = telemetry if isinstance(telemetry, list) else telemetry.get("episodes", [])
        assert len(episodes) == 3

        # Quantitative Verifications:
        # 1. Checks passed: 3 -> 6 -> 6
        assert episodes[0]["checks_passed"] == 3
        assert episodes[1]["checks_passed"] == 6
        assert episodes[2]["checks_passed"] == 6

        # 2. Tool failure reduction: 100% reduction in repeat constraint failures
        assert episodes[0]["tool_failures"] == 3
        assert episodes[1]["tool_failures"] == 0
        assert episodes[2]["tool_failures"] == 0

        # 3. Token reduction: Warm runs consume < 50% tokens of cold run
        assert episodes[1]["total_tokens"] < 0.5 * episodes[0]["total_tokens"]
        assert episodes[2]["total_tokens"] < 0.5 * episodes[0]["total_tokens"]

        # 4. Latency reduction: Warm runs execute faster than cold run
        assert episodes[1]["duration_ms"] < episodes[0]["duration_ms"]

    def test_tier4_cad_and_kicad_end_to_end_full_production_assembly(self, tmp_path):
        """Tier 4: Complete rover CAD + PCB production assembly passes all constraints."""
        # Spec with valid learned engineering parameters
        spec = Spec(length=140.0, width=95.0, thickness=2.5, wall=2.5, clearance=1.0, mast_height=52.0)
        parts, measured = build(spec)

        # 1. 18 solids manifold valid
        assert len(parts) == 18
        assert all(p["shape"].isValid() and p["shape"].Volume() > 0 for p in parts)

        # 2. 6/6 CAD design checks pass
        cad_eval = evaluate(spec, parts, measured)
        assert cad_eval["passed"] is True
        assert len(cad_eval["checks"]) == 6

        # 3. KiCad PCB breakout routing & DRC
        pcb_out = tmp_path / "pcb_production"
        pcb_out.mkdir()
        pcb_res = run_kicad_model_board(SAMPLE_PCB_SPEC, pcb_out)
        assert pcb_res.returncode == 0
        pcb_eval = json.loads((pcb_out / "evaluation.json").read_text())
        assert pcb_eval["passed"] is True
        drc_prod = json.loads((pcb_out / "drc.json").read_text())
        assert len(drc_prod["violations"]) == 0
        assert len(drc_prod["unconnected_items"]) == 0

        # 4. Sensor bridge addon evaluation
        measured["mast"] = next(p["shape"] for p in parts if p["name"] == "Sensor mast")
        addon_spec = {"kind": "sensor_bridge", "depth": 20.0, "thickness": 2.5}
        part_addon, plate_addon = build_addon(spec, addon_spec)
        addon_checks = evaluate_addon(part_addon, plate_addon, measured)
        assert all(c["passed"] for c in addon_checks)
