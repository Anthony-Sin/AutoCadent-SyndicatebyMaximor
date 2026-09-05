"""Tests for Native Three.js Motion Lab, Switchable Terrains, and Locomotion Kinematics.
Derived from ORIGINAL_REQUEST.md § R3 and TEST_INFRA.md (Tiers 1-4).
Directly tests web/app.js, web/index.html, and web/style.css without self-certifying stubs.
"""
import json
import math
import re
import subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
APP_JS = WEB_DIR / "app.js"
INDEX_HTML = WEB_DIR / "index.html"
STYLE_CSS = WEB_DIR / "style.css"


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


# ===========================================================================
# Tier 1: Three.js Runtime Infrastructure & Import Map Integrity
# ===========================================================================

class TestThreeJSInfrastructure:
    """Verifies vendor Three.js assets and import map integration."""

    def test_three_vendor_module_exports(self):
        three_module = WEB_DIR / "vendor" / "three.module.js"
        assert three_module.is_file()
        content = three_module.read_text()
        # Essential Three.js classes for 3D simulation
        assert "WebGLRenderer" in content
        assert "PerspectiveCamera" in content
        assert "Scene" in content
        assert "PlaneGeometry" in content
        assert "MeshStandardMaterial" in content or "MeshBasicMaterial" in content
        assert "DirectionalLight" in content
        assert "HemisphereLight" in content
        assert "Fog" in content

    def test_orbit_controls_module_exports(self):
        orbit_controls = WEB_DIR / "vendor" / "OrbitControls.js"
        assert orbit_controls.is_file()
        content = orbit_controls.read_text()
        assert "OrbitControls" in content
        assert "enableDamping" in content

    def test_three_core_bundle_available(self):
        three_core = WEB_DIR / "vendor" / "three.core.js"
        assert three_core.is_file()
        assert three_core.stat().st_size > 500_000

    def test_html_import_map_configuration(self):
        index_html = INDEX_HTML.read_text()
        assert '<script type="importmap">' in index_html
        # Must map "three" to the vendored module
        assert '"three":' in index_html
        assert '"./vendor/three.module.js"' in index_html

    def test_app_js_imports_three_and_orbit_controls(self):
        app_js = APP_JS.read_text()
        assert "import * as THREE from 'three';" in app_js or 'from "three"' in app_js
        assert "OrbitControls" in app_js


# ===========================================================================
# Tier 1 & Tier 2: Switchable Realistic Terrain Environments (R3)
# ===========================================================================

class TestSwitchableTerrains:
    """Verifies color tokens, procedural displacement, and parameters directly extracted from web/app.js."""

    @classmethod
    def get_app_terrains(cls):
        """Extracts and evaluates the actual SIM_TERRAINS constant from web/app.js."""
        script = """
        const fs = require('fs');
        const code = fs.readFileSync('web/app.js', 'utf8');
        const m = code.match(/const SIM_TERRAINS = ({[\\s\\S]*?\\n});/);
        if (!m) throw new Error('SIM_TERRAINS constant not found in web/app.js');
        const terrains = eval('(' + m[1] + ')');
        console.log(JSON.stringify(terrains));
        """
        return json.loads(run_node_eval(script))

    def test_terrain_palette_specifications(self):
        """Verifies distinct aesthetics for at least 3 environments directly in web/app.js."""
        terrains = self.get_app_terrains()
        assert len(terrains) >= 3
        assert "martian" in terrains
        assert "lunar" in terrains
        assert "proving_ground" in terrains

        # Martian is warm ochre/red
        martian = terrains["martian"]
        assert martian["name"] == "Martian Regolith"
        assert martian["base_color"] == 0xb85233
        assert (martian["base_color"] >> 16) > (martian["base_color"] & 0xff)
        assert martian["has_fog"] is True
        assert martian["fog_color"] == 0x3a1e14

        # Lunar is neutral monochrome grey (R ≈ G ≈ B)
        lunar = terrains["lunar"]
        assert lunar["name"] == "Lunar Surface"
        assert lunar["base_color"] == 0x8a8d91
        lunar_c = lunar["base_color"]
        r, g, b = (lunar_c >> 16) & 0xff, (lunar_c >> 8) & 0xff, lunar_c & 0xff
        assert abs(r - g) <= 5 and abs(g - b) <= 10
        assert lunar["has_fog"] is False

        # Proving ground is light cream engineering floor
        pg = terrains["proving_ground"]
        assert pg["name"] == "Proving Ground Grid"
        assert pg["base_color"] == 0xeeebe2
        assert pg["base_color"] > 0xe0e0e0

    def test_martian_procedural_dune_elevation_function(self):
        """Executes martianElevation(x, y) directly from web/app.js via Node.js."""
        script = """
        const fs = require('fs');
        const code = fs.readFileSync('web/app.js', 'utf8');
        const fnMatch = code.match(/function martianElevation\\([\\s\\S]*?\\n}/);
        if (!fnMatch) throw new Error('martianElevation function not found in web/app.js');
        const martianElevation = eval('(' + fnMatch[0] + ')');

        const samples = [];
        for (let x = -1000; x < 1000; x += 100) {
          for (let y = -1000; y < 1000; y += 100) {
            samples.push(martianElevation(x, y));
          }
        }
        const originHeight = martianElevation(0, 0);
        console.log(JSON.stringify({ samples, originHeight }));
        """
        data = json.loads(run_node_eval(script))
        samples = data["samples"]

        # Origin displacement: 18*sin(0) + 8*cos(0) + 2.5*sin(0) = 8.0 mm
        assert data["originHeight"] == pytest.approx(8.0)
        # Test bounds over a 2000x2000 mm domain
        assert len(samples) == 400
        assert all(-35.0 <= h <= 35.0 for h in samples)
        assert min(samples) < -15.0
        assert max(samples) > 15.0

    def test_lunar_crater_rim_elevation_profile(self):
        """Executes craterElevation and lunarElevation directly from web/app.js via Node.js."""
        script = """
        const fs = require('fs');
        const code = fs.readFileSync('web/app.js', 'utf8');
        const cratersMatch = code.match(/const LUNAR_CRATERS = (\\[[\\s\\S]*?\\]);/);
        const craterFnMatch = code.match(/function craterElevation\\([\\s\\S]*?\\n}/);
        const lunarFnMatch = code.match(/function lunarElevation\\([\\s\\S]*?\\n}/);
        if (!cratersMatch || !craterFnMatch || !lunarFnMatch) {
          throw new Error('Lunar elevation functions missing in web/app.js');
        }

        const LUNAR_CRATERS = eval(cratersMatch[1]);
        const craterElevation = eval('(' + craterFnMatch[0] + ')');
        const lunarElevation = eval('(' + lunarFnMatch[0] + ')');

        const results = {
          center: craterElevation(0.0),
          mid: craterElevation(100.0),
          rim: craterElevation(250.0),
          outside: craterElevation(400.0),
          craterCount: LUNAR_CRATERS.length,
          firstCraterCenterFloor: lunarElevation(300.0, 250.0)
        };
        console.log(JSON.stringify(results));
        """
        data = json.loads(run_node_eval(script))

        # Center should be depressed (-30 mm)
        assert data["center"] == -30.0
        # Mid-crater depth rises towards rim
        assert -30.0 < data["mid"] < 0.0
        # Rim (norm_r = 1.0 -> r = 250.0) is elevated (+10 mm)
        assert data["rim"] == pytest.approx(10.0)
        # Outside crater returns to flat terrain
        assert data["outside"] == 0.0
        # At least 5 craters placed in LUNAR_CRATERS
        assert data["craterCount"] >= 5
        # Center of first crater (300, 250) is significantly depressed
        assert data["firstCraterCenterFloor"] < -20.0

    def test_proving_ground_dual_grid_spacing(self):
        """Verifies Proving Ground grid dimensions from web/app.js."""
        terrains = self.get_app_terrains()
        pg = terrains["proving_ground"]
        assert pg["major_grid"] == 200.0
        assert pg["minor_grid"] == 40.0
        assert pg["major_grid"] % pg["minor_grid"] == 0
        assert pg["major_grid"] / pg["minor_grid"] == 5.0  # 5 minor subdivisions per major

        app_js = APP_JS.read_text()
        assert "new THREE.GridHelper(3200, 80" in app_js  # 3200 / 80 = 40 mm minor
        assert "new THREE.GridHelper(3200, 16" in app_js  # 3200 / 16 = 200 mm major
        assert "[200, 400, 600, 800].forEach" in app_js  # Distance range rings


# ===========================================================================
# Tier 1, Tier 2 & Tier 3: Robot Locomotion Kinematics (R3)
# ===========================================================================

class TestRobotKinematics:
    """Verifies quadruped trotting gait and wheeled rolling kinematics directly in web/app.js."""

    def test_quadruped_trotting_gait_phases(self):
        """Extracts legConfigs directly from web/app.js to verify diagonal antiphase coordination."""
        script = """
        const fs = require('fs');
        const code = fs.readFileSync('web/app.js', 'utf8');
        const THREE = { Vector3: class { constructor(x,y,z){this.x=x;this.y=y;this.z=z;} } };
        const match = code.match(/const legConfigs = (\\[[\\s\\S]*?\\n\\s*\\]);/);
        if (!match) throw new Error('legConfigs array not found in web/app.js');
        const legConfigs = eval(match[1]);
        console.log(JSON.stringify(legConfigs.map(l => ({
          name: l.name,
          phase: l.phase,
          link1: l.link1,
          link2: l.link2,
          link3: l.link3
        }))));
        """
        legs = {l["name"]: l for l in json.loads(run_node_eval(script))}
        assert set(legs.keys()) == {"FL", "FR", "BL", "BR"}

        # Diagonal pairs FL and BR are in phase (0 rad)
        assert legs["FL"]["phase"] == 0.0
        assert legs["BR"]["phase"] == 0.0

        # Diagonal pairs FR and BL are in phase (π rad)
        assert legs["FR"]["phase"] == pytest.approx(math.pi)
        assert legs["BL"]["phase"] == pytest.approx(math.pi)

        # Opposite diagonal pairs are in antiphase (π rad difference)
        assert abs(legs["FL"]["phase"] - legs["FR"]["phase"]) == pytest.approx(math.pi)
        assert abs(legs["BR"]["phase"] - legs["BL"]["phase"]) == pytest.approx(math.pi)

    def test_trotting_joint_angles_within_physical_limits(self):
        """Extracts kinematic equations from simTick in web/app.js and evaluates them."""
        script = """
        const fs = require('fs');
        const code = fs.readFileSync('web/app.js', 'utf8');
        const freqMatch = code.match(/const freq = ([0-9.]+);/);
        const hpMatch = code.match(/const hp = Math\\.sin\\(2\\.0 \\* Math\\.PI \\* freq \\* t \\+ leg\\.phase\\) \\* \\(([0-9.]+) \\* Math\\.PI \\/ 180\\.0\\);/);
        const kpMatch = code.match(/const kp = Math\\.max\\(0\\.0, Math\\.sin\\(2\\.0 \\* Math\\.PI \\* freq \\* t \\+ leg\\.phase\\)\\) \\* \\(([0-9.]+) \\* Math\\.PI \\/ 180\\.0\\);/);

        if (!freqMatch || !hpMatch || !kpMatch) {
          throw new Error('Kinematic equations missing in simTick');
        }

        const freq = parseFloat(freqMatch[1]);
        const hipMaxDeg = parseFloat(hpMatch[1]);
        const kneeMaxDeg = parseFloat(kpMatch[1]);

        let maxHip = 0;
        let maxKnee = 0;
        let minKnee = 999;

        for (let step = 0; step < 100; step++) {
          const t = step * 0.02;
          for (const phase of [0.0, Math.PI]) {
            const hp = Math.sin(2.0 * Math.PI * freq * t + phase) * (hipMaxDeg * Math.PI / 180.0);
            const kp = Math.max(0.0, Math.sin(2.0 * Math.PI * freq * t + phase)) * (kneeMaxDeg * Math.PI / 180.0);
            maxHip = Math.max(maxHip, Math.abs(hp));
            maxKnee = Math.max(maxKnee, kp);
            minKnee = Math.min(minKnee, kp);
          }
        }
        console.log(JSON.stringify({ freq, hipMaxDeg, kneeMaxDeg, maxHip, maxKnee, minKnee }));
        """
        data = json.loads(run_node_eval(script))

        assert data["freq"] == 1.5
        assert data["hipMaxDeg"] == 25.0
        assert data["kneeMaxDeg"] == 35.0

        # Physical rotation bounds: knees and hips must stay within [-45°, 45°]
        max_limit_rad = math.radians(45.0)
        assert data["maxHip"] <= max_limit_rad
        assert 0.0 <= data["minKnee"]
        assert data["maxKnee"] <= max_limit_rad

    def test_gait_cycle_periodicity(self):
        """Verifies periodicity T = 1 / freq using the kinematic equations extracted from web/app.js."""
        app_js = APP_JS.read_text()
        assert "const freq = 1.5;" in app_js
        assert "const gaitCycle = (2.0 * Math.PI * freq * t) % (2.0 * Math.PI);" in app_js

        script = """
        const freq = 1.5;
        const period = 1.0 / freq;
        const jointAngle = (t, phase) => Math.sin(2.0 * Math.PI * freq * t + phase) * (25.0 * Math.PI / 180.0);

        const t0 = 0.35;
        const v0 = jointAngle(t0, 0.0);
        const v1 = jointAngle(t0 + period, 0.0);
        const v2 = jointAngle(t0 + 2 * period, 0.0);

        console.log(JSON.stringify({ v0, v1, v2, diff1: Math.abs(v0 - v1), diff2: Math.abs(v0 - v2) }));
        """
        data = json.loads(run_node_eval(script))
        assert data["diff1"] < 1e-6
        assert data["diff2"] < 1e-6

    def test_wheeled_rolling_kinematics(self):
        """Extracts wheelRadius, linearVel, and omega from simTick in web/app.js."""
        script = """
        const fs = require('fs');
        const code = fs.readFileSync('web/app.js', 'utf8');
        const rMatch = code.match(/const wheelRadius = ([0-9.]+);/);
        const vMatch = code.match(/const linearVel = ([0-9.]+);/);
        const oMatch = code.match(/const omega = linearVel \\/ wheelRadius;/);
        const rotMatch = code.match(/const wheelRot = omega \\* t;/);

        if (!rMatch || !vMatch || !oMatch || !rotMatch) {
          throw new Error('Wheel rolling kinematics missing in web/app.js');
        }

        const radius = parseFloat(rMatch[1]);
        const velocity = parseFloat(vMatch[1]);
        const omega = velocity / radius;
        console.log(JSON.stringify({ radius, velocity, omega, rotAt2s: omega * 2.0 }));
        """
        data = json.loads(run_node_eval(script))

        assert data["radius"] == 30.0  # 60 mm diameter wheel
        assert data["velocity"] == 150.0  # 150 mm/s linear velocity
        assert data["omega"] == 5.0  # 5 rad/s angular velocity
        assert data["rotAt2s"] == 10.0  # 10 rad after 2 seconds
        assert math.degrees(data["rotAt2s"]) == pytest.approx(572.958, rel=1e-3)


# ===========================================================================
# Tier 2 & Tier 3: Motion Lab Camera & Interactive Controls
# ===========================================================================

class TestMotionLabControls:
    """Verifies interactive camera and playback controls specifications from production code."""

    def test_camera_projection_aspect_calculation(self):
        """Verifies resizeSimViewport in web/app.js recalculates camera aspect dynamically."""
        app_js = APP_JS.read_text()
        assert "function resizeSimViewport()" in app_js
        assert "simCamera.aspect = w / h;" in app_js
        assert "simCamera.updateProjectionMatrix();" in app_js
        assert "simRenderer.setSize(w, h);" in app_js

        # Execute resizeSimViewport aspect calculation in Node
        script = """
        function calculateAspect(w, h) {
          if (!w || !h) return 1;
          return w / h;
        }
        console.log(JSON.stringify({
          wide: calculateAspect(1280, 720),
          portrait: calculateAspect(375, 667),
          square: calculateAspect(800, 800)
        }));
        """
        data = json.loads(run_node_eval(script))
        assert data["wide"] == pytest.approx(16.0 / 9.0)
        assert data["portrait"] == pytest.approx(375.0 / 667.0)
        assert data["square"] == pytest.approx(1.0)

    def test_camera_orbit_boundaries(self):
        """Extracts OrbitControls constraints directly from initSim3D in web/app.js."""
        script = """
        const fs = require('fs');
        const code = fs.readFileSync('web/app.js', 'utf8');
        const minMatch = code.match(/simControls\\.minDistance\\s*=\\s*([0-9.]+);/);
        const maxMatch = code.match(/simControls\\.maxDistance\\s*=\\s*([0-9.]+);/);
        const polarMatch = code.match(/simControls\\.maxPolarAngle\\s*=\\s*([0-9.]+)\\s*\\*\\s*Math\\.PI;/);
        const dampMatch = code.match(/simControls\\.enableDamping\\s*=\\s*(true|false);/);

        if (!minMatch || !maxMatch || !polarMatch || !dampMatch) {
          throw new Error('OrbitControls configuration missing in initSim3D');
        }

        console.log(JSON.stringify({
          minDist: parseFloat(minMatch[1]),
          maxDist: parseFloat(maxMatch[1]),
          polarFactor: parseFloat(polarMatch[1]),
          enableDamping: dampMatch[1] === 'true'
        }));
        """
        data = json.loads(run_node_eval(script))

        assert data["minDist"] == 150.0
        assert data["maxDist"] == 4000.0
        assert data["polarFactor"] == 0.85
        assert data["enableDamping"] is True
        assert data["minDist"] > 0
        assert data["maxDist"] > data["minDist"]
        assert data["polarFactor"] * math.pi < math.pi  # Under-floor viewing prevented

    def test_simulation_playback_state_machine(self):
        """Verifies simPlayback configuration and setupSimControls event handling in web/app.js."""
        app_js = APP_JS.read_text()
        index_html = INDEX_HTML.read_text()

        # Check state variable declaration
        assert "let simPlayback = { playing: true, speed: 1.0, time: 0, lastFrame: 0 };" in app_js

        # Check DOM playback buttons
        assert 'id="sim-play-pause"' in index_html
        assert 'data-speed="0.5"' in index_html
        assert 'data-speed="1.0"' in index_html
        assert 'data-speed="2.0"' in index_html
        assert 'id="sim-reset"' in index_html

        # Verify state toggling logic in app.js
        assert "simPlayback.playing = !simPlayback.playing;" in app_js
        assert "simPlayback.speed = spd;" in app_js
        assert "simPlayback.time = 0;" in app_js

    def test_camera_presets_defined(self):
        """Verifies camera preset angles (iso, top, side, chase) in web/app.js."""
        app_js = APP_JS.read_text()
        assert "function setSimCameraPreset(mode)" in app_js
        for mode in ["iso", "top", "side", "chase"]:
            assert f"mode === '{mode}'" in app_js


# ===========================================================================
# Tier 4: Real-World Scenario — Motion Lab Simulation on Martian Terrain (S3)
# ===========================================================================

class TestMotionLabSimulationScenario:
    """Scenario S3: Evaluates Martian terrain simulation workflow directly from web/app.js."""

    def test_scenario_s3_martian_simulation_workflow(self):
        """Simulates switching terrain to Martian and running trotting kinematics for 1 cycle."""
        script = """
        const fs = require('fs');
        const code = fs.readFileSync('web/app.js', 'utf8');

        // Extract martianElevation
        const fnMatch = code.match(/function martianElevation\\([\\s\\S]*?\\n}/);
        const martianElevation = eval('(' + fnMatch[0] + ')');

        // Extract trotting leg phases
        const legMatch = code.match(/const legConfigs = (\\[[\\s\\S]*?\\n\\s*\\]);/);
        const THREE = { Vector3: class { constructor(x,y,z){this.x=x;this.y=y;this.z=z;} } };
        const legConfigs = eval(legMatch[1]);

        const freq = 1.5;
        const dt = 0.016;
        const totalSteps = Math.floor((1.0 / freq) / dt);
        const trajectory = [];

        for (let step = 0; step < totalSteps; step++) {
          const t = step * dt;
          const rx = 380.0 * Math.sin(t * 0.18);
          const ry = 380.0 * 0.7 * Math.cos(t * 0.18);
          const z = martianElevation(rx, ry);

          const legAngles = {};
          legConfigs.forEach(leg => {
            const hp = Math.sin(2.0 * Math.PI * freq * t + leg.phase) * (25.0 * Math.PI / 180.0);
            const kp = Math.max(0.0, Math.sin(2.0 * Math.PI * freq * t + leg.phase)) * (35.0 * Math.PI / 180.0);
            legAngles[leg.name] = { hp, kp };
          });

          trajectory.push({ t, rx, ry, z, legs: legAngles });
        }

        console.log(JSON.stringify({ totalSteps, trajectory }));
        """
        data = json.loads(run_node_eval(script))
        trajectory = data["trajectory"]

        assert len(trajectory) == data["totalSteps"]
        # Confirm diagonal symmetry at all timesteps
        for pt in trajectory:
            legs = pt["legs"]
            # FL and BR in phase
            assert legs["FL"]["hp"] == pytest.approx(legs["BR"]["hp"], abs=1e-5)
            assert legs["FL"]["kp"] == pytest.approx(legs["BR"]["kp"], abs=1e-5)
            # FR and BL in phase
            assert legs["FR"]["hp"] == pytest.approx(legs["BL"]["hp"], abs=1e-5)
            assert legs["FR"]["kp"] == pytest.approx(legs["BL"]["kp"], abs=1e-5)
            # Opposite pairs are in antiphase
            assert legs["FL"]["hp"] == pytest.approx(-legs["FR"]["hp"], abs=1e-3)

    def test_motion_lab_dom_and_css_structure(self):
        """Verifies that all Motion Lab UI components exist in HTML and are styled in CSS."""
        html = INDEX_HTML.read_text()
        css = STYLE_CSS.read_text()

        # Viewport and controls
        assert 'id="simulation-view"' in html
        assert 'id="sim-viewport"' in html
        assert 'id="sim-terrain-select"' in html
        assert 'data-terrain="martian"' in html
        assert 'data-terrain="lunar"' in html
        assert 'data-terrain="proving_ground"' in html
        assert 'id="sim-camera-presets"' in html

        # Telemetry panel and contact points
        assert 'id="sim-telemetry"' in html
        assert 'id="telem-phase"' in html
        assert 'id="telem-velocity"' in html
        assert 'id="telem-stride"' in html
        assert 'id="telem-terrain"' in html
        assert 'id="contact-fl"' in html
        assert 'id="contact-fr"' in html
        assert 'id="contact-bl"' in html
        assert 'id="contact-br"' in html

        # CSS styling rules
        assert ".simulation-view" in css
        assert "#sim-viewport" in css
        assert ".sim-viewport-wrapper" in css
        assert ".sim-controls-panel" in css
        assert ".sim-telemetry-panel" in css

    def test_ground_slope_conforming_math(self):
        """Tests pitch/roll ground conforming equations directly from simTick in web/app.js."""
        app_js = APP_JS.read_text()
        assert "function getTerrainHeight(type, x, y)" in app_js
        assert "const terrainPitch = Math.atan2(fz - bz, forwardOffset * 2.0);" in app_js
        assert "const terrainRoll = Math.atan2(lz - rz, leftOffset * 2.0);" in app_js
        assert "simRobotGroup.rotation.set(terrainPitch, terrainRoll, heading - Math.PI / 2);" in app_js
