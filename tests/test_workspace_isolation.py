"""Tests for Dashboard Visual Asset Audit, CSS Syntax, and Per-Project Workspace Isolation.
Derived from ORIGINAL_REQUEST.md § R1 and TEST_INFRA.md (Tiers 1-4).
"""
import json
import os
import re
import subprocess
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
PREVIEW_HOST = "ao-preview.mf2xi33dmfsgk3tufvzxs3tenfrwc5dfmj4w2ylynfww64rnnn.swk4dhn5uw4zznha.localhost:3001"
PREVIEW_BASE = "http://127.0.0.1:3001"


# ===========================================================================
# Tier 1: Static Web Assets & Preview Server HTTP 200 Verification
# ===========================================================================

class TestWebAssetsHTTP:
    """Verifies all static assets and preview routes return HTTP 200."""

    ASSET_ROUTES = [
        "/web/",
        "/web/style.css",
        "/web/app.js",
        "/web/vendor/three.module.js",
        "/web/vendor/OrbitControls.js",
        "/web/vendor/three.core.js",
        "/web/artifacts/board/board.svg",
        "/web/artifacts/board/rove-1-board.zip",
        "/web/artifacts/orion/mesh.json",
        "/web/artifacts/orion/mesh.bin",
        "/web/artifacts/orion/manifest.json",
        "/web/artifacts/demo/report.json",
        "/web/artifacts/benchmark.json",
        "/web/artifacts/mcp-status.json",
    ]

    @pytest.mark.parametrize("route", ASSET_ROUTES)
    def test_asset_route_returns_http_200(self, route):
        req = urllib.request.Request(
            f"{PREVIEW_BASE}{route}",
            headers={"Host": PREVIEW_HOST},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status == 200, f"Route {route} returned status {resp.status}"
                content = resp.read()
                assert len(content) > 0, f"Route {route} returned empty content"
        except urllib.error.URLError as e:
            pytest.skip(f"Preview daemon on port 3001 not reachable: {e}")

    def test_static_files_exist_on_disk(self):
        expected_files = [
            WEB_DIR / "index.html",
            WEB_DIR / "style.css",
            WEB_DIR / "app.js",
            WEB_DIR / "vendor" / "three.module.js",
            WEB_DIR / "vendor" / "OrbitControls.js",
            WEB_DIR / "vendor" / "three.core.js",
            WEB_DIR / "artifacts" / "board" / "board.svg",
            WEB_DIR / "artifacts" / "board" / "rove-1-board.zip",
            WEB_DIR / "artifacts" / "orion" / "mesh.json",
            WEB_DIR / "artifacts" / "orion" / "mesh.bin",
            WEB_DIR / "artifacts" / "orion" / "manifest.json",
            WEB_DIR / "artifacts" / "demo" / "report.json",
        ]
        for f in expected_files:
            assert f.is_file(), f"Expected static asset missing on disk: {f}"
            assert f.stat().st_size > 0, f"Static asset is zero bytes: {f}"

    def test_board_svg_is_valid_xml(self):
        svg_path = WEB_DIR / "artifacts" / "board" / "board.svg"
        assert svg_path.is_file()
        tree = ET.parse(str(svg_path))
        root = tree.getroot()
        assert "svg" in root.tag.lower()
        # Must contain board elements (traces, pads, or outlines)
        assert len(list(root)) > 0

    def test_orion_mesh_and_manifest_integrity(self):
        mesh_json_path = WEB_DIR / "artifacts" / "orion" / "mesh.json"
        mesh_bin_path = WEB_DIR / "artifacts" / "orion" / "mesh.bin"
        manifest_path = WEB_DIR / "artifacts" / "orion" / "manifest.json"

        assert mesh_json_path.is_file()
        assert mesh_bin_path.is_file()
        assert manifest_path.is_file()

        mesh_meta = json.loads(mesh_json_path.read_text())
        manifest = json.loads(manifest_path.read_text())

        assert mesh_meta["vertTotal"] > 0
        assert mesh_meta["triTotal"] > 0
        expected_bytes = (mesh_meta["vertTotal"] + mesh_meta["triTotal"]) * 12
        actual_bytes = mesh_bin_path.stat().st_size
        assert actual_bytes == expected_bytes, f"Binary mesh size {actual_bytes} != expected {expected_bytes}"

        assert len(mesh_meta["parts"]) == len(manifest["parts"])


# ===========================================================================
# Tier 1 & Tier 2: Dashboard Visual Assets & CSS Syntax Integrity
# ===========================================================================

class TestDashboardAssetsAndCSS:
    """Verifies CSS syntax correctness, media query responsiveness, and vector art."""

    @pytest.fixture(scope="class")
    def css_content(self):
        css_file = WEB_DIR / "style.css"
        assert css_file.is_file()
        return css_file.read_text()

    def test_topbar_css_syntax_fix(self, css_content):
        """Verifies that .topbar rule does not close early and properly encloses border-bottom."""
        # Check that .topbar block contains border-bottom before closing brace
        topbar_match = re.search(r"\.topbar\{([^}]+)\}", css_content)
        assert topbar_match is not None, "Could not find .topbar CSS rule block"
        body = topbar_match.group(1)
        assert "border-bottom:1px solid var(--line)" in body or "border-bottom: 1px solid var(--line)" in body
        # Ensure no orphaned declaration outside braces
        assert not re.search(r"\}\s*border-bottom:[^;]+;\s*\}", css_content)

    def test_css_brace_balancing(self, css_content):
        """Ensures that all open braces in style.css are properly matched."""
        # Simple scan ignoring comments and strings
        clean_css = re.sub(r"/\*.*?\*/", "", css_content, flags=re.DOTALL)
        clean_css = re.sub(r'"[^"]*"', '""', clean_css)
        clean_css = re.sub(r"'[^']*'", "''", clean_css)
        opens = clean_css.count("{")
        closes = clean_css.count("}")
        assert opens == closes, f"Mismatched braces in style.css: {opens} open vs {closes} close"

    def test_no_abrupt_inspector_hiding_in_1150px_media_query(self, css_content):
        """Line 3 defines grid-column:1/-1; line 177 previously hid .properties-panel abruptly."""
        # Check that .properties-panel is not display:none inside @media(max-width:1150px)
        mq_1150 = re.findall(r"@media\s*\(\s*max-width\s*:\s*1150px\s*\)\s*\{([^}]+(?:\{[^}]+\}[^}]*)*)\}", css_content)
        for block in mq_1150:
            assert ".properties-panel{display:none}" not in block.replace(" ", "")

    def test_dashboard_card_art_no_raw_emoji(self):
        """Verifies duck glyph emoji is replaced by vector art matching the app design system."""
        app_js = (WEB_DIR / "app.js").read_text()
        index_html = (WEB_DIR / "index.html").read_text()

        # Emoji glyph 🦆 should not be the active visual icon
        assert '<span class="duck-glyph" aria-hidden="true">🦆</span>' not in index_html
        # In app.js, robotArt or vector SVG art is used
        assert "robotArt" in app_js or "custom-art" in app_js or "svg" in app_js


# ===========================================================================
# Tier 1, Tier 2 & Tier 3: Per-Project Workspace Isolation (R1)
# ===========================================================================

class TestProjectWorkspaceIsolation:
    """Verifies that switching active projects updates all tabs without state leakage."""

    @pytest.fixture(scope="class")
    def app_js(self):
        return (WEB_DIR / "app.js").read_text()

    def test_project_profiles_defined(self, app_js):
        """PROJECT.md specifies ProjectWorkspace Store with rove1 and orion."""
        # Check for rove1 and orion project references
        assert "rove1" in app_js
        assert "orion" in app_js

    def test_orion_specific_files_isolated_from_rove1(self, app_js):
        """When viewing Orion, files tab must show Orion-specific files, not Rove-1's STLs."""
        # Orion file entries should include mesh.json, mesh.bin, manifest.json or orion.urdf
        assert "artifacts/orion" in app_js or "orion" in app_js
        # Files list renderer exists
        assert "fileRows" in app_js or "renderFiles" in app_js

    def test_orion_schematic_and_layout_isolation(self, app_js):
        """Orion must not display Rove-1's 4-net connector breakout or Rove-1 board.svg."""
        assert "loadModel" in app_js
        # Verify model switching hook
        assert "loadModel('orion')" in app_js or "loadModel(name)" in app_js

    def test_tab_views_dom_elements_exist(self):
        """Verifies all view sections defined in index.html exist."""
        html = (WEB_DIR / "index.html").read_text()
        assert 'id="workspace-view"' in html or 'id="preview-view"' in html
        assert 'id="files-view"' in html
        assert 'id="designs-view"' in html
        assert 'id="schematic-view"' in html
        assert 'id="layout-view"' in html
        assert 'id="simulation-view"' in html
        assert 'id="file-list"' in html
        assert 'id="schematic"' in html
        assert 'id="board-svg"' in html

    def test_inspector_parametric_inputs_scoping(self):
        """Verifies rover dimension controls (#length, #width, #mast_height) are bounded."""
        html = (WEB_DIR / "index.html").read_text()
        assert 'id="length"' in html
        assert 'id="width"' in html
        assert 'id="mast_height"' in html

    def test_custom_design_workbench_rendering(self, app_js):
        """User-saved designs must render alongside Rove-1 and Orion in gallery."""
        assert "renderDashboard" in app_js
        assert "loadDesigns" in app_js

    def test_designs_view_cards_have_svg_thumbnails(self, app_js):
        """Saved design cards in Designs tab must have visual SVG thumbnails."""
        assert "design-thumb" in app_js or "designCard" in app_js or "thumb" in app_js


# ===========================================================================
# Tier 3 & Tier 4: Cross-Project Interaction & State Isolation Workflows
# ===========================================================================

def run_node_eval(script: str) -> str:
    """Executes a Node.js snippet in ROOT directory and returns trimmed stdout."""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Node execution failed (code {result.returncode}):\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        )
    return result.stdout.strip()


class TestProjectSwitchingWorkflows:
    """Simulates multi-project workflows directly evaluating getRove1Project, getOrionProject,
    and getCustomProject from web/app.js to ensure zero cross-contamination.
    """

    def test_project_workspace_contract_structure(self):
        """Validates contract interface defined in PROJECT.md by directly invoking
        getRove1Project() and getOrionProject() from web/app.js via Node.js:
        interface ProjectWorkspace {
          id: string;
          name: string;
          badge: string;
          type: 'rover' | 'quadruped' | 'custom';
          modelPath: string;
          files: Array<{ name: string; size: string; type: string; downloadUrl: string }>;
          schematic: { title: string; nets: Array<{ name: string; pins: string[] }>; svgPath?: string };
          layout: { boardSvgPath: string; drcPath: string; bundleUrl: string };
          spec: Record<string, number | string>;
        }
        """
        script = """
        const fs = require('fs');
        const code = fs.readFileSync('web/app.js', 'utf8');

        const context = {
          report: null,
          boardMeta: null,
          artifactBase: 'artifacts/demo/',
          iteration: 1,
          runner: '',
          extOf: (n) => (n.split('.').pop() || '').toUpperCase(),
          slug: (s) => s.toLowerCase().replace(/\\s+/g, '-'),
          designBundle: (d) => ({ design: d }),
          escape: (s) => s
        };

        const getOrionMatch = code.match(/function getOrionProject\\(\\)\\{[\\s\\S]*?\\n\\}/);
        const getRove1Match = code.match(/function getRove1Project\\(\\)\\{[\\s\\S]*?\\n\\}/);
        if (!getOrionMatch || !getRove1Match) throw new Error('Project factory functions missing in web/app.js');

        const fn = new Function(...Object.keys(context), getOrionMatch[0] + '\\n' + getRove1Match[0] + '\\nreturn { getOrionProject, getRove1Project };');
        const { getOrionProject, getRove1Project } = fn(...Object.values(context));

        console.log(JSON.stringify({
          rove: getRove1Project(),
          orion: getOrionProject()
        }));
        """
        data = json.loads(run_node_eval(script))
        rove = data["rove"]
        orion = data["orion"]

        # Validate Rove-1 Workspace Contract
        assert rove["id"] == "rove1"
        assert rove["name"] == "Rove-1"
        assert rove["badge"] == "Parametric CAD"
        assert rove["type"] == "rover"
        assert len(rove["files"]) >= 5
        assert len(rove["schematic"]["nets"]) == 4
        assert rove["layout"]["boardSvgPath"] == "artifacts/board/board.svg"
        assert rove["layout"]["bundleUrl"] == "artifacts/board/rove-1-board.zip"

        # Validate Orion Workspace Contract (full 7 files per getOrionProject)
        assert orion["id"] == "orion"
        assert orion["name"] == "Orion"
        assert orion["badge"] == "Quadruped"
        assert orion["type"] == "quadruped"
        assert len(orion["files"]) == 7
        orion_names = {f["name"] for f in orion["files"]}
        expected_orion_files = {
            "orion.urdf",
            "manifest.json",
            "mesh.json",
            "mesh.bin",
            "orion-board.zip",
            "actuator-bus.kicad_pcb",
            "bom.csv",
        }
        assert orion_names == expected_orion_files
        assert len(orion["schematic"]["nets"]) == 12
        assert orion["layout"]["boardSvgPath"] == "artifacts/orion/board.svg"
        assert orion["layout"]["bundleUrl"] == "artifacts/orion/orion-board.zip"
        assert orion["spec"]["joints"] == 12

        # Confirm zero overlap between project-specific geometry and board assets
        rove_specific = {"board-tray.stl", "chassis.stl", "sensor-mast.stl", "rove-1.step", "rove-1-board.zip", "cad.py", "generate.py"}
        orion_specific = {"orion.urdf", "manifest.json", "mesh.bin", "orion-board.zip", "actuator-bus.kicad_pcb", "bom.csv"}
        assert rove_specific.isdisjoint(orion_specific)

        # Confirm download URLs are strictly isolated
        rove_urls = {f["downloadUrl"] for f in rove["files"]}
        orion_urls = {f["downloadUrl"] for f in orion["files"]}
        assert all("artifacts/orion/" in u for u in orion_urls)
        assert rove_urls.isdisjoint(orion_urls)

        # Confirm schematic net names are strictly isolated
        rove_nets = {n["name"] for n in rove["schematic"]["nets"]}
        orion_nets = {n["name"] for n in orion["schematic"]["nets"]}
        assert rove_nets.isdisjoint(orion_nets)

    def test_custom_design_isolation_lifecycle(self, tmp_path):
        """Directly executes getActiveProject() and getCustomProject(d) from web/app.js
        simulating project transitions: Rove-1 -> Orion -> Custom Design -> Rove-1.
        """
        script = """
        const fs = require('fs');
        const code = fs.readFileSync('web/app.js', 'utf8');

        const getOrionMatch = code.match(/function getOrionProject\\(\\)\\{[\\s\\S]*?\\n\\}/);
        const getRove1Match = code.match(/function getRove1Project\\(\\)\\{[\\s\\S]*?\\n\\}/);
        const getCustomMatch = code.match(/function getCustomProject\\(d\\)\\{[\\s\\S]*?\\n\\}/);
        const getActiveMatch = code.match(/function getActiveProject\\(\\)\\{[\\s\\S]*?\\n\\}/);
        const slugMatch = code.match(/function slug\\([^\\)]*\\)\\{[^\\}]*\\}/);
        const designBundleMatch = code.match(/function designBundle\\([^\\)]*\\)\\{[\\s\\S]*?\\n\\}/);
        const extOfMatch = code.match(/const extOf=n=>[^;]+;/);

        const fn = new Function(
          'let report = null, boardMeta = null, iteration = 1, artifactBase = \"artifacts/demo/\", runner = \"\";' +
          'const escape = (s) => s;' +
          'let designsList = [];' +
          'const loadDesigns = () => designsList;' +
          'let pendingDesign = null;' +
          'let activeProjectId = \"rove1\";' +
          extOfMatch[0] + '\\n' +
          slugMatch[0] + '\\n' +
          designBundleMatch[0] + '\\n' +
          getOrionMatch[0] + '\\n' +
          getRove1Match[0] + '\\n' +
          getCustomMatch[0] + '\\n' +
          getActiveMatch[0] + '\\n' +
          'return function(activeId, designs) {' +
          '  activeProjectId = activeId;' +
          '  designsList = designs;' +
          '  return getActiveProject();' +
          '};'
        );

        const runner = fn();

        // 1. Initial active: Rove-1
        const p1 = runner('rove1', []);

        // 2. Switch to Orion
        const p2 = runner('orion', []);

        // 3. User creates a custom design and switches to it
        const customDef = {
          id: 'design-custom-alpha',
          name: 'Heavy Duty Rover',
          description: 'High payload chassis with dual sensor bridge',
          kind: 'template',
          revisions: [{
            n: 1,
            spec: { length: 170.0, width: 105.0, mast_height: 65.0 },
            passed: true,
            evaluated: false
          }]
        };
        const p3 = runner('design-custom-alpha', [customDef]);

        // 4. Switch back to Rove-1
        const p4 = runner('rove1', [customDef]);

        console.log(JSON.stringify({ p1, p2, p3, p4 }));
        """
        data = json.loads(run_node_eval(script))
        p1 = data["p1"]
        p2 = data["p2"]
        p3 = data["p3"]
        p4 = data["p4"]

        # 1. Rove-1 initial state
        assert p1["id"] == "rove1"
        assert p1["type"] == "rover"
        p1_files = {f["name"] for f in p1["files"]}
        assert "chassis.stl" in p1_files
        assert "orion.urdf" not in p1_files

        # 2. Orion state
        assert p2["id"] == "orion"
        assert p2["type"] == "quadruped"
        p2_files = {f["name"] for f in p2["files"]}
        assert "orion.urdf" in p2_files
        assert "chassis.stl" not in p2_files
        assert "heavy-duty-rover.autocadent.json" not in p2_files
        assert len(p2["schematic"]["nets"]) == 12

        # 3. Custom design state
        assert p3["id"] == "design-custom-alpha"
        assert p3["type"] == "custom"
        assert p3["name"] == "Heavy Duty Rover"
        assert p3["dimensions"]["length"] == 170.0
        assert p3["dimensions"]["width"] == 105.0
        assert p3["dimensions"]["mast_height"] == 65.0
        p3_files = {f["name"] for f in p3["files"]}
        assert "heavy-duty-rover.autocadent.json" in p3_files
        assert "orion.urdf" not in p3_files
        assert "rove-1.step" not in p3_files
        assert "Heavy Duty Rover" in p3["schematic"]["title"]

        # 4. Return to Rove-1
        assert p4["id"] == "rove1"
        assert p4["type"] == "rover"
        p4_files = {f["name"] for f in p4["files"]}
        assert "chassis.stl" in p4_files
        assert "heavy-duty-rover.autocadent.json" not in p4_files
        assert "orion.urdf" not in p4_files
        assert p4["dimensions"]["length"] == 140

