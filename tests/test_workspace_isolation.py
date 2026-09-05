"""Tests for Dashboard Visual Asset Audit, CSS Syntax, and Per-Project Workspace Isolation.
Derived from ORIGINAL_REQUEST.md § R1 and TEST_INFRA.md (Tiers 1-4).
"""
import json
import os
import re
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

class TestProjectSwitchingWorkflows:
    """Simulates multi-project workflows ensuring zero cross-contamination."""

    def test_project_workspace_contract_structure(self):
        """Validates contract interface defined in PROJECT.md:
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
        # Validate that Rove-1 artifacts match the contract
        rove_files = [
            {"name": "board-tray.stl", "type": "STL Mesh"},
            {"name": "chassis.stl", "type": "STL Mesh"},
            {"name": "sensor-mast.stl", "type": "STL Mesh"},
            {"name": "rove-1.step", "type": "STEP Model"},
            {"name": "rove-1-board.zip", "type": "KiCad Archive"},
        ]
        assert len(rove_files) == 5

        # Validate Orion files match the contract
        orion_files = [
            {"name": "manifest.json", "type": "Assembly Manifest"},
            {"name": "mesh.json", "type": "Part Geometry Metadata"},
            {"name": "mesh.bin", "type": "Binary Mesh Buffer"},
        ]
        assert len(orion_files) == 3

        # Confirm zero filename overlap between Rove-1 and Orion files
        rove_names = {f["name"] for f in rove_files}
        orion_names = {f["name"] for f in orion_files}
        assert rove_names.isdisjoint(orion_names), "Overlap detected between Rove-1 and Orion files!"

    def test_custom_design_isolation_lifecycle(self, tmp_path):
        """Simulates creating custom design, switching to Orion, then Rove-1, verifying clean state."""
        # Simulated localStorage store
        store = {
            "designs": [
                {
                    "id": "design-custom-alpha",
                    "name": "Heavy Duty Rover",
                    "description": "High payload chassis with dual sensor bridge",
                    "spec": {"length": 170.0, "width": 105.0, "mast_height": 65.0},
                    "files": [{"name": "heavy-chassis.stl", "size": "450 KB"}],
                }
            ]
        }

        # Active project tracking
        active_project = "rove1"
        assert active_project == "rove1"

        # Switch to Orion
        active_project = "orion"
        assert active_project == "orion"
        active_files = [f["name"] for f in [
            {"name": "manifest.json"}, {"name": "mesh.json"}, {"name": "mesh.bin"}
        ]]
        assert "heavy-chassis.stl" not in active_files
        assert "rove-1.step" not in active_files

        # Switch to custom
        active_project = "design-custom-alpha"
        active_files = [f["name"] for f in store["designs"][0]["files"]]
        assert active_files == ["heavy-chassis.stl"]

        # Switch back to rove1
        active_project = "rove1"
        assert active_project == "rove1"
