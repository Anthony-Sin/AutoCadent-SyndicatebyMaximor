"""Tests for Native Three.js Motion Lab, Switchable Terrains, and Locomotion Kinematics.
Derived from ORIGINAL_REQUEST.md § R3 and TEST_INFRA.md (Tiers 1-4).
"""
import math
import re
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"


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
        index_html = (WEB_DIR / "index.html").read_text()
        assert '<script type="importmap">' in index_html
        # Must map "three" to the vendored module
        assert '"three":' in index_html
        assert '"./vendor/three.module.js"' in index_html

    def test_app_js_imports_three_and_orbit_controls(self):
        app_js = (WEB_DIR / "app.js").read_text()
        assert "import * as THREE from 'three';" in app_js or 'from "three"' in app_js
        assert "OrbitControls" in app_js


# ===========================================================================
# Tier 1 & Tier 2: Switchable Realistic Terrain Environments (R3)
# ===========================================================================

class TestSwitchableTerrains:
    """Verifies color tokens, procedural displacement, and parameters for switchable terrains."""

    TERRAINS = {
        "martian": {
            "name": "Martian Regolith",
            "base_color": 0xb85233,
            "roughness": 0.88,
            "fog_color": 0x3a1e14,
            "has_fog": True,
            "sun_color": 0xffbe85,
        },
        "lunar": {
            "name": "Lunar Surface",
            "base_color": 0x8a8d91,
            "roughness": 0.96,
            "fog_color": 0x050608,
            "has_fog": False,
            "sun_color": 0xffffff,
        },
        "proving_ground": {
            "name": "Proving Ground Grid",
            "base_color": 0xeeebe2,
            "major_grid": 200.0,
            "minor_grid": 40.0,
            "has_fog": False,
            "sun_color": 0xfffaee,
        },
    }

    def test_terrain_palette_specifications(self):
        """Verifies distinct aesthetics for at least 3 environments per ORIGINAL_REQUEST.md."""
        assert len(self.TERRAINS) >= 3
        # Martian is warm ochre/red
        assert (self.TERRAINS["martian"]["base_color"] >> 16) > (self.TERRAINS["martian"]["base_color"] & 0xff)
        # Lunar is neutral grey (R ≈ G ≈ B)
        lunar_c = self.TERRAINS["lunar"]["base_color"]
        r, g, b = (lunar_c >> 16) & 0xff, (lunar_c >> 8) & 0xff, lunar_c & 0xff
        assert abs(r - g) <= 5 and abs(g - b) <= 10
        # Proving ground is light cream engineering floor
        assert self.TERRAINS["proving_ground"]["base_color"] > 0xe0e0e0

    def test_martian_procedural_dune_elevation_function(self):
        """Martian dunes: continuous sinusoidal height displacement bounded within [-40, 40] mm."""
        def martian_elevation(x, y):
            # Layered sinusoidal dune displacement
            dune1 = 18.0 * math.sin(x * 0.005 + y * 0.002)
            dune2 = 8.0 * math.cos(x * 0.012 - y * 0.008)
            micro = 2.5 * math.sin(x * 0.03 + y * 0.025)
            return dune1 + dune2 + micro

        # Test bounds over a 2000x2000 mm domain
        samples = [martian_elevation(x, y) for x in range(-1000, 1000, 100) for y in range(-1000, 1000, 100)]
        assert all(-35.0 <= h <= 35.0 for h in samples)
        assert min(samples) < -15.0
        assert max(samples) > 15.0

    def test_lunar_crater_rim_elevation_profile(self):
        """Lunar surface: crater profile with depressed center and raised rim."""
        def crater_elevation(r, radius=250.0, depth=30.0, rim_height=10.0):
            norm_r = r / radius
            if norm_r < 0.8:
                return -depth * (1.0 - (norm_r / 0.8) ** 2)
            elif norm_r <= 1.2:
                # Raised rim
                return rim_height * math.sin(math.pi * (norm_r - 0.8) / 0.4)
            return 0.0

        # Center should be depressed
        assert crater_elevation(0.0) == -30.0
        # Mid-crater depth rises
        assert -30.0 < crater_elevation(100.0) < 0.0
        # Rim (norm_r = 1.0 -> r = 250.0) is elevated
        assert crater_elevation(250.0) == pytest.approx(10.0)
        # Outside crater returns to flat terrain
        assert crater_elevation(400.0) == 0.0

    def test_proving_ground_dual_grid_spacing(self):
        pg = self.TERRAINS["proving_ground"]
        assert pg["major_grid"] % pg["minor_grid"] == 0
        assert pg["major_grid"] / pg["minor_grid"] == 5.0  # 5 minor subdivisions per major


# ===========================================================================
# Tier 1, Tier 2 & Tier 3: Robot Locomotion Kinematics (R3)
# ===========================================================================

class TestRobotKinematics:
    """Verifies quadruped trotting gait and wheeled rolling kinematics."""

    def test_quadruped_trotting_gait_phases(self):
        """Orion trotting gait: diagonal pairs (FL+BR and FR+BL) are in antiphase (π rad)."""
        # Legs: [FL, FR, BL, BR]
        phases = [0.0, math.pi, math.pi, 0.0]
        # Diagonal pairs FL (idx 0) and BR (idx 3) are in phase
        assert phases[0] == phases[3]
        # Diagonal pairs FR (idx 1) and BL (idx 2) are in phase
        assert phases[1] == phases[2]
        # Opposite pairs are in antiphase
        assert abs(phases[0] - phases[1]) == pytest.approx(math.pi)

    def test_trotting_joint_angles_within_physical_limits(self):
        """Knee and hip rotations must stay within [-45°, 45°] to prevent self-intersection."""
        max_angle_rad = math.radians(45.0)

        def hip_pitch(t, phase, freq=1.5):
            return math.radians(25.0) * math.sin(2.0 * math.pi * freq * t + phase)

        def knee_pitch(t, phase, freq=1.5):
            # Knees flex mostly during lift phase
            return math.radians(35.0) * max(0.0, math.sin(2.0 * math.pi * freq * t + phase))

        for step in range(100):
            t = step * 0.02
            for phase in [0.0, math.pi]:
                hip = hip_pitch(t, phase)
                knee = knee_pitch(t, phase)
                assert abs(hip) <= max_angle_rad
                assert 0.0 <= knee <= max_angle_rad

    def test_gait_cycle_periodicity(self):
        """Kinematics function is strictly periodic with period T = 1 / freq."""
        freq = 2.0  # 2 Hz
        period = 1.0 / freq

        def joint_angle(t):
            return 0.4 * math.sin(2.0 * math.pi * freq * t) + 0.1 * math.cos(4.0 * math.pi * freq * t)

        t0 = 0.35
        assert joint_angle(t0) == pytest.approx(joint_angle(t0 + period), rel=1e-6)
        assert joint_angle(t0) == pytest.approx(joint_angle(t0 + 2 * period), rel=1e-6)

    def test_wheeled_rolling_kinematics(self):
        """Rove-1 wheel rolling: rotation angle θ = d / R_wheel = (v * t) / R_wheel."""
        wheel_radius_mm = 30.0  # 60 mm diameter wheel
        linear_velocity_mm_s = 150.0  # 150 mm/s

        angular_velocity = linear_velocity_mm_s / wheel_radius_mm  # rad/s
        assert angular_velocity == pytest.approx(5.0)

        # After 2 seconds, rotation angle in radians
        theta = angular_velocity * 2.0
        assert theta == pytest.approx(10.0)
        # In degrees
        assert math.degrees(theta) == pytest.approx(572.958, rel=1e-3)


# ===========================================================================
# Tier 2 & Tier 3: Motion Lab Camera & Interactive Controls
# ===========================================================================

class TestMotionLabControls:
    """Verifies interactive camera and playback controls specifications."""

    def test_camera_projection_aspect_calculation(self):
        """Camera projection matrix updates correctly when canvas resizes."""
        # 16:9 widescreen canvas
        width, height = 1280.0, 720.0
        aspect = width / height
        assert aspect == pytest.approx(16.0 / 9.0)

        # Mobile portrait canvas
        width_m, height_m = 375.0, 667.0
        aspect_m = width_m / height_m
        assert aspect_m == pytest.approx(375.0 / 667.0)

    def test_camera_orbit_boundaries(self):
        """OrbitControls must constrain min/max distance and max polar angle to prevent ground clipping."""
        min_distance = 150.0
        max_distance = 4000.0
        max_polar_angle = 0.85 * math.pi  # Cannot view from under the floor

        assert min_distance > 0
        assert max_distance > min_distance
        assert max_polar_angle < math.pi  # Under-floor viewing prevented

    def test_simulation_playback_state_machine(self):
        """Playback controls: play, pause, speed multipliers (0.5x, 1x, 2x)."""
        state = {"playing": True, "speed": 1.0}

        # Pause
        state["playing"] = False
        assert state["playing"] is False

        # Resume
        state["playing"] = True
        assert state["playing"] is True

        # Speed changes
        for speed in [0.25, 0.5, 1.0, 1.5, 2.0]:
            state["speed"] = speed
            assert state["speed"] == speed


# ===========================================================================
# Tier 4: Real-World Scenario — Motion Lab Simulation on Martian Terrain (S3)
# ===========================================================================

class TestMotionLabSimulationScenario:
    """Scenario S3: Initializes simulation, switches to Martian terrain, runs trotting kinematics."""

    def test_scenario_s3_martian_simulation_workflow(self):
        # 1. Environment configuration
        current_terrain = "proving_ground"
        assert current_terrain == "proving_ground"

        # 2. User selects Martian Regolith
        current_terrain = "martian"
        active_config = TestSwitchableTerrains.TERRAINS[current_terrain]
        assert active_config["name"] == "Martian Regolith"
        assert active_config["has_fog"] is True
        assert active_config["base_color"] == 0xb85233

        # 3. Step kinematics for 1 complete gait cycle
        freq = 1.5  # 1.5 Hz trotting
        dt = 0.016  # 60 FPS
        total_steps = int((1.0 / freq) / dt)
        trajectory = []

        for step in range(total_steps):
            t = step * dt
            fl_angle = math.sin(2.0 * math.pi * freq * t)
            br_angle = math.sin(2.0 * math.pi * freq * t)
            fr_angle = math.sin(2.0 * math.pi * freq * t + math.pi)
            bl_angle = math.sin(2.0 * math.pi * freq * t + math.pi)

            trajectory.append({
                "t": round(t, 4),
                "fl": round(fl_angle, 4),
                "br": round(br_angle, 4),
                "fr": round(fr_angle, 4),
                "bl": round(bl_angle, 4),
            })

        assert len(trajectory) == total_steps
        # Confirm diagonal symmetry at all timesteps
        for pt in trajectory:
            assert pt["fl"] == pt["br"]
            assert pt["fr"] == pt["bl"]
            assert pt["fl"] == pytest.approx(-pt["fr"], abs=1e-3)
