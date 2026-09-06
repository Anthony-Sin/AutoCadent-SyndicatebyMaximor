"""MCP server wrapping svg-pcb for browser-native PCB HDL via headless Node.

Tools: pcb_generate, pcb_edit, pcb_export.
No DRC — svg-pcb is the design/iteration surface only.
Verification stays with local KiCad via mcp-server-kicad.
"""
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Optional

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("svg-pcb")

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "web" / "vendor" / "svg-pcb" / "runner.mjs"
POLYFILL = ROOT / "web" / "vendor" / "svg-pcb" / "polyfill.mjs"
EPISODES_DIR = ROOT / ".runs" / "svg-pcb-episodes"


def _run_node(cmd: dict) -> dict:
    """Shell out to the vendored Node runner. Returns parsed JSON result."""
    if not RUNNER.exists():
        return {"svg": None, "metrics": None, "paths": None,
                "error": "svg-pcb vendor bundle missing"}
    env = {k: v for k, v in os.environ.items()
           if k not in ("PYTHONHOME", "PYTHONPATH")}
    proc = subprocess.run(
        ["node", "--import", str(POLYFILL), str(RUNNER)],
        input=json.dumps(cmd), capture_output=True, text=True,
        timeout=30, env=env, cwd=str(ROOT),
    )
    if proc.returncode != 0 and not proc.stdout.strip():
        return {"svg": None, "metrics": None, "paths": None,
                "error": f"Node runner failed: {proc.stderr[:500]}"}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"svg": None, "metrics": None, "paths": None,
                "error": f"Invalid runner output: {proc.stdout[:200]}"}


def _record_episode(tool_id: str, args: dict, result: dict, latency_s: float):
    """Record an episodic trace for the learning pipeline.

    Each episode captures: tool id, args, latency, outcome, and the tool's
    feedback/measurements verbatim as evidence. The LearningPipeline can
    consume these the same way it consumes CadQuery/KiCad results.
    """
    EPISODES_DIR.mkdir(parents=True, exist_ok=True)
    episode = {
        "tool_id": tool_id,
        "args": args,
        "latency_s": round(latency_s, 4),
        "outcome": "error" if result.get("error") else "success",
        "error": result.get("error"),
        "metrics": result.get("metrics"),
        "svg_length": len(result["svg"]) if result.get("svg") else 0,
        "timestamp": time.time(),
    }
    ts = int(episode["timestamp"] * 1000)
    path = EPISODES_DIR / f"{tool_id.replace(':', '-')}_{ts}.json"
    path.write_text(json.dumps(episode, indent=2) + "\n")
    return episode


def _learned_rules(episode: dict) -> list[dict]:
    """Surface procedural-rule opportunities from an episode.

    Returns a list of candidate rules the learning pipeline can validate
    across multiple episodes (e.g. minimum trace spacing, outline validity).
    """
    rules = []
    metrics = episode.get("metrics") or {}
    args = episode.get("args", {})

    if metrics.get("boardWidthMm") is not None and metrics.get("boardHeightMm") is not None:
        rules.append({
            "rule_id": "svg-pcb:board-dimensions",
            "observation": f"Board {metrics['boardWidthMm']:.2f} x {metrics['boardHeightMm']:.2f} mm",
            "hint": "Track min/max board dimensions that svg-pcb accepts; "
                    "self-intersecting outlines or extreme aspect ratios may fail silently.",
        })

    wires = args.get("wires", [])
    for w in wires:
        t = w.get("thickness", 0)
        if 0 < t < 0.005:
            rules.append({
                "rule_id": "svg-pcb:min-trace-width",
                "observation": f"Wire thickness {t} produced valid SVG",
                "hint": "svg-pcb does not enforce DRC minimum trace width. "
                        "Learn the practical lower bound from export failures.",
            })

    return rules


# --- MCP Tools ---

@mcp.tool()
def pcb_generate(
    components: list[dict],
    wires: Optional[list[dict]] = None,
    layers: Optional[list[str]] = None,
    layer_colors: Optional[dict[str, str]] = None,
    flatten: bool = False,
) -> dict:
    """Generate a PCB board SVG from component placements and wire connections.

    Args:
        components: List of {id, footprint, translate, rotate?, flip?}.
            footprint: {pad_name: {pos: [x,y], shape: "SVG path d", layers: ["F.Cu"]}}
        wires: List of {points: [[x,y]... or "compId.padName"...], thickness, layer}.
        layers: Layer names to render (default ["F.Cu"]).
        layer_colors: {layer: "#color"} (default {"F.Cu": "#ff8c00cc"}).
        flatten: If true, union all shapes per layer into single paths.

    Returns: {svg, metrics, paths, error, episode, learned_rules}
    Note: No DRC. svg-pcb is the design/iteration surface only.
    """
    wires = wires or []
    layers = layers or ["F.Cu"]
    layer_colors = layer_colors or {"F.Cu": "#ff8c00cc"}

    cmd = {
        "action": "generate",
        "components": components,
        "wires": wires,
        "layers": layers,
        "layerColors": layer_colors,
        "flatten": flatten,
    }

    t0 = time.monotonic()
    result = _run_node(cmd)
    latency = time.monotonic() - t0

    episode = _record_episode("svg-pcb:pcb_generate", cmd, result, latency)
    rules = _learned_rules(episode)

    return {
        "svg": result.get("svg"),
        "metrics": result.get("metrics"),
        "paths": result.get("paths"),
        "error": result.get("error"),
        "episode": episode,
        "learned_rules": rules,
    }


@mcp.tool()
def pcb_edit(
    base_components: list[dict],
    base_wires: list[dict],
    patch_components: Optional[list[dict]] = None,
    patch_wires: Optional[list[dict]] = None,
    remove_component_ids: Optional[list[str]] = None,
    layers: Optional[list[str]] = None,
    layer_colors: Optional[dict[str, str]] = None,
) -> dict:
    """Edit a PCB by applying a patch to an existing component/wire list and regenerating.

    Args:
        base_components: Original component list.
        base_wires: Original wire list.
        patch_components: Components to add or replace (matched by id).
        patch_wires: Additional wires to append.
        remove_component_ids: Component ids to remove before patching.
        layers: Layer names to render.
        layer_colors: Layer color map.

    Returns: {svg, metrics, paths, error, episode, learned_rules}
    """
    remove_ids = set(remove_component_ids or [])
    patch_comps = {c["id"]: c for c in (patch_components or [])}

    merged = []
    for c in base_components:
        if c.get("id") in remove_ids:
            continue
        if c.get("id") in patch_comps:
            merged.append(patch_comps.pop(c["id"]))
        else:
            merged.append(c)
    merged.extend(patch_comps.values())

    merged_wires = list(base_wires) + (patch_wires or [])

    return pcb_generate(
        components=merged,
        wires=merged_wires,
        layers=layers,
        layer_colors=layer_colors,
    )


@mcp.tool()
def pcb_export(
    components: list[dict],
    wires: Optional[list[dict]] = None,
    layers: Optional[list[str]] = None,
    layer_colors: Optional[dict[str, str]] = None,
    output_path: str = ".runs/svg-pcb-export/board.svg",
) -> dict:
    """Generate a PCB and write the SVG to a file.

    Args:
        components: Component list (same as pcb_generate).
        wires: Wire list.
        layers: Layer names.
        layer_colors: Layer color map.
        output_path: File path for the SVG output.

    Returns: {output_path, svg_length, metrics, error, episode}
    """
    wires = wires or []
    layers = layers or ["F.Cu"]
    layer_colors = layer_colors or {"F.Cu": "#ff8c00cc"}

    out = (ROOT / output_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    cmd = {
        "action": "export_svg",
        "components": components,
        "wires": wires,
        "layers": layers,
        "layerColors": layer_colors,
        "outputPath": str(out),
    }

    t0 = time.monotonic()
    result = _run_node(cmd)
    latency = time.monotonic() - t0

    episode = _record_episode("svg-pcb:pcb_export", cmd, result, latency)

    return {
        "output_path": str(out) if not result.get("error") else None,
        "svg_length": len(result["svg"]) if result.get("svg") else 0,
        "metrics": result.get("metrics"),
        "error": result.get("error"),
        "episode": episode,
    }


def load_episodes(tool_id: Optional[str] = None) -> list[dict]:
    """Load recorded episodes, optionally filtered by tool_id.

    This is the consumption point for LearningPipeline: call this to retrieve
    all svg-pcb episodic traces, then feed them into the pipeline the same
    way CadQuery/KiCad evaluation results are consumed.
    """
    if not EPISODES_DIR.exists():
        return []
    episodes = []
    for path in sorted(EPISODES_DIR.glob("*.json")):
        ep = json.loads(path.read_text())
        if tool_id and ep.get("tool_id") != tool_id:
            continue
        episodes.append(ep)
    return episodes


def episode_to_trace(episode: dict) -> dict:
    """Convert an svg-pcb episode to a standardized trace format.

    Produces a dict compatible with the EpisodicTrace schema used by
    MemoryStore/LearningPipeline: tool_id, args, outcome, measurements,
    latency, and evidence (the raw metrics + learned rules).
    """
    return {
        "source": "svg-pcb",
        "tool_id": episode.get("tool_id"),
        "outcome": episode.get("outcome"),
        "args": episode.get("args"),
        "latency_s": episode.get("latency_s"),
        "measurements": episode.get("metrics"),
        "evidence": {
            "svg_length": episode.get("svg_length"),
            "error": episode.get("error"),
            "metrics": episode.get("metrics"),
        },
        "rules": _learned_rules(episode),
    }


if __name__ == "__main__":
    mcp.run(transport="stdio")
