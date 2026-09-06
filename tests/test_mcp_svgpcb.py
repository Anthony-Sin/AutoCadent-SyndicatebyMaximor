"""Tests for svg-pcb MCP server: headless Node runner, tool surface,
episode recording, and learning-loop integration.

Skips gracefully if the vendored svg-pcb bundle is missing.
Requires only Node.js (available in CI).
"""
import json
import shutil
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VENDOR_DIR = ROOT / "web" / "vendor" / "svg-pcb"

pytestmark = pytest.mark.skipif(
    not (VENDOR_DIR / "runner.mjs").exists(),
    reason="svg-pcb vendor bundle not present",
)


# --- Fixtures ---

SIMPLE_FOOTPRINT = {
    "1": {
        "pos": [-0.1, 0],
        "shape": "M -0.03,-0.03 L 0.03,-0.03 L 0.03,0.03 L -0.03,0.03 Z",
        "layers": ["F.Cu"],
    },
    "2": {
        "pos": [0.1, 0],
        "shape": "M -0.03,-0.03 L 0.03,-0.03 L 0.03,0.03 L -0.03,0.03 Z",
        "layers": ["F.Cu"],
    },
}

SIMPLE_COMPONENT = {
    "id": "r1",
    "footprint": SIMPLE_FOOTPRINT,
    "translate": [0, 0],
}

SIMPLE_WIRE = {
    "points": ["r1.1", "r1.2"],
    "thickness": 0.01,
    "layer": "F.Cu",
}


# --- Node runner tests ---

class TestNodeRunner:
    def test_generate_produces_svg(self):
        from autocadent.mcp_svgpcb import _run_node
        result = _run_node({
            "action": "generate",
            "components": [SIMPLE_COMPONENT],
            "wires": [SIMPLE_WIRE],
            "layers": ["F.Cu"],
            "layerColors": {"F.Cu": "#ff8c00cc"},
        })
        assert result["error"] is None
        assert result["svg"] is not None
        assert "<svg" in result["svg"]
        assert "F.Cu" in result["svg"]

    def test_generate_metrics(self):
        from autocadent.mcp_svgpcb import _run_node
        result = _run_node({
            "action": "generate",
            "components": [SIMPLE_COMPONENT],
            "wires": [SIMPLE_WIRE],
            "layers": ["F.Cu"],
        })
        m = result["metrics"]
        assert m["componentCount"] == 1
        assert m["wireCount"] == 1
        assert m["totalPaths"] == 3  # 2 pads + 1 wire
        assert m["boardWidthMm"] > 0
        assert m["boardHeightMm"] > 0

    def test_generate_multi_layer(self):
        from autocadent.mcp_svgpcb import _run_node
        fp_both = {
            "1": {"pos": [0, 0], "shape": "M -0.02,0 L 0.02,0 L 0.02,0.04 L -0.02,0.04 Z",
                   "layers": ["F.Cu", "B.Cu"]},
        }
        result = _run_node({
            "action": "generate",
            "components": [{"id": "c1", "footprint": fp_both, "translate": [0, 0]}],
            "wires": [],
            "layers": ["F.Cu", "B.Cu"],
            "layerColors": {"F.Cu": "#ff0000", "B.Cu": "#0000ff"},
        })
        assert result["error"] is None
        assert "F.Cu" in result["paths"]
        assert "B.Cu" in result["paths"]

    def test_unknown_action_returns_error(self):
        from autocadent.mcp_svgpcb import _run_node
        result = _run_node({"action": "bogus"})
        assert result["error"] is not None
        assert "Unknown action" in result["error"]


# --- MCP tool tests ---

class TestPcbGenerate:
    def test_basic_generate(self):
        from autocadent.mcp_svgpcb import pcb_generate
        result = pcb_generate(
            components=[SIMPLE_COMPONENT],
            wires=[SIMPLE_WIRE],
        )
        assert result["error"] is None
        assert result["svg"] is not None
        assert "<svg" in result["svg"]
        assert result["metrics"]["componentCount"] == 1

    def test_generate_returns_episode(self):
        from autocadent.mcp_svgpcb import pcb_generate
        result = pcb_generate(components=[SIMPLE_COMPONENT])
        ep = result["episode"]
        assert ep["tool_id"] == "svg-pcb:pcb_generate"
        assert ep["outcome"] == "success"
        assert ep["latency_s"] > 0
        assert ep["metrics"] is not None

    def test_generate_returns_learned_rules(self):
        from autocadent.mcp_svgpcb import pcb_generate
        result = pcb_generate(
            components=[SIMPLE_COMPONENT],
            wires=[SIMPLE_WIRE],
        )
        rules = result["learned_rules"]
        assert isinstance(rules, list)
        rule_ids = [r["rule_id"] for r in rules]
        assert "svg-pcb:board-dimensions" in rule_ids

    def test_generate_with_flatten(self):
        from autocadent.mcp_svgpcb import pcb_generate
        result = pcb_generate(
            components=[SIMPLE_COMPONENT],
            wires=[SIMPLE_WIRE],
            flatten=True,
        )
        assert result["error"] is None
        assert result["svg"] is not None


class TestPcbEdit:
    def test_edit_add_component(self):
        from autocadent.mcp_svgpcb import pcb_edit
        new_comp = {
            "id": "r2",
            "footprint": SIMPLE_FOOTPRINT,
            "translate": [0.5, 0],
        }
        result = pcb_edit(
            base_components=[SIMPLE_COMPONENT],
            base_wires=[SIMPLE_WIRE],
            patch_components=[new_comp],
        )
        assert result["error"] is None
        assert result["metrics"]["componentCount"] == 2

    def test_edit_remove_component(self):
        from autocadent.mcp_svgpcb import pcb_edit
        c2 = {"id": "r2", "footprint": SIMPLE_FOOTPRINT, "translate": [0.5, 0]}
        result = pcb_edit(
            base_components=[SIMPLE_COMPONENT, c2],
            base_wires=[],
            remove_component_ids=["r2"],
        )
        assert result["error"] is None
        assert result["metrics"]["componentCount"] == 1

    def test_edit_replace_component(self):
        from autocadent.mcp_svgpcb import pcb_edit
        replacement = {
            "id": "r1",
            "footprint": SIMPLE_FOOTPRINT,
            "translate": [1.0, 1.0],
        }
        result = pcb_edit(
            base_components=[SIMPLE_COMPONENT],
            base_wires=[],
            patch_components=[replacement],
        )
        assert result["error"] is None
        assert result["metrics"]["componentCount"] == 1


class TestPcbExport:
    def test_export_writes_file(self):
        from autocadent.mcp_svgpcb import pcb_export
        with tempfile.TemporaryDirectory() as td:
            out_path = str(Path(td) / "test_board.svg")
            result = pcb_export(
                components=[SIMPLE_COMPONENT],
                wires=[SIMPLE_WIRE],
                output_path=out_path,
            )
            assert result["error"] is None
            assert Path(out_path).exists()
            content = Path(out_path).read_text()
            assert "<svg" in content
            assert result["svg_length"] > 0


# --- Learning-loop integration tests ---

class TestLearningLoop:
    def test_load_episodes(self):
        from autocadent.mcp_svgpcb import load_episodes, pcb_generate
        pcb_generate(components=[SIMPLE_COMPONENT])
        episodes = load_episodes(tool_id="svg-pcb:pcb_generate")
        assert len(episodes) >= 1
        ep = episodes[-1]
        assert ep["tool_id"] == "svg-pcb:pcb_generate"
        assert ep["outcome"] == "success"

    def test_episode_to_trace(self):
        from autocadent.mcp_svgpcb import pcb_generate, episode_to_trace
        result = pcb_generate(
            components=[SIMPLE_COMPONENT],
            wires=[SIMPLE_WIRE],
        )
        trace = episode_to_trace(result["episode"])
        assert trace["source"] == "svg-pcb"
        assert trace["tool_id"] == "svg-pcb:pcb_generate"
        assert trace["outcome"] == "success"
        assert trace["measurements"]["componentCount"] == 1
        assert trace["evidence"]["svg_length"] > 0
        assert isinstance(trace["rules"], list)

    def test_learned_rules_min_trace_width(self):
        from autocadent.mcp_svgpcb import _learned_rules
        episode = {
            "metrics": {"boardWidthMm": 5.0, "boardHeightMm": 3.0},
            "args": {
                "wires": [{"points": [[0, 0], [1, 0]], "thickness": 0.001}],
            },
        }
        rules = _learned_rules(episode)
        rule_ids = [r["rule_id"] for r in rules]
        assert "svg-pcb:min-trace-width" in rule_ids
        assert "svg-pcb:board-dimensions" in rule_ids


# --- Error handling ---

class TestErrorHandling:
    def test_missing_vendor_returns_error(self, monkeypatch):
        from autocadent import mcp_svgpcb
        original = mcp_svgpcb.RUNNER
        monkeypatch.setattr(mcp_svgpcb, "RUNNER", Path("/nonexistent/runner.mjs"))
        result = mcp_svgpcb._run_node({"action": "generate"})
        assert result["error"] is not None
        assert "vendor bundle missing" in result["error"]
        monkeypatch.setattr(mcp_svgpcb, "RUNNER", original)

    def test_bad_component_reference(self):
        from autocadent.mcp_svgpcb import _run_node
        result = _run_node({
            "action": "generate",
            "components": [],
            "wires": [{"points": ["nonexistent.1"], "thickness": 0.01}],
            "layers": ["F.Cu"],
        })
        assert result["error"] is not None

    def test_empty_board(self):
        from autocadent.mcp_svgpcb import pcb_generate
        result = pcb_generate(components=[], wires=[])
        assert result["error"] is None
        assert result["svg"] is not None
        assert result["metrics"]["componentCount"] == 0
