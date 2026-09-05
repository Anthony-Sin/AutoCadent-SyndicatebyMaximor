"""Tests for Tensormux Provider, Dynamic Configuration, Design Schemas, and Error Taxonomy.
Derived from ORIGINAL_REQUEST.md § R2 and TEST_INFRA.md (Tiers 1-4).
"""
import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path
import httpx
import pytest
from pydantic import ValidationError

# Dynamic resolution of autocadent package
try:
    from autocadent.provider import ProviderConfig, Tensormux, ProviderError
except ImportError:
    import autocadent
    ref_dir = Path("/home/ANT/.ao/data/worktrees/autocadent-syndicatebymaximor/autocadent-syndicatebymaximor-5/autocadent")
    if ref_dir.exists() and str(ref_dir) not in autocadent.__path__:
        autocadent.__path__.append(str(ref_dir))
    from autocadent.provider import ProviderConfig, Tensormux, ProviderError

from autocadent.design import (
    RoverSpec,
    AddonSpec,
    PCBSpec,
    Design,
    parse_design,
)
from autocadent.cad import Spec


# ---------------------------------------------------------------------------
# Helpers & Fixtures
# ---------------------------------------------------------------------------

def valid_seed():
    return {
        "length": 140.0,
        "width": 95.0,
        "thickness": 3.0,
        "wall": 2.5,
        "clearance": 1.2,
        "mast_height": 50.0,
    }


def valid_design_dict(override_rover=None):
    rover = valid_seed()
    if override_rover:
        rover.update(override_rover)
    return {
        "spec": rover,
        "addon": {
            "kind": "sensor_bridge",
            "depth": 20.0,
            "thickness": 2.5,
        },
        "pcb": {
            "kind": "signal_breakout",
            "nets": ["VCC", "GND", "SDA", "SCL"],
            "connector_spacing": 26.0,
            "trace_width": 0.4,
        },
    }


def make_llm_response_json(design_dict, fence=True, finish_reason="stop", tool_calls=None):
    content = json.dumps(design_dict)
    if fence:
        content = f"```json\n{content}\n```"
    message = {"role": "assistant", "content": content}
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    return {
        "id": "chatcmpl-test-123",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "glm-4-7-flash",
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }
        ],
        "usage": {"prompt_tokens": 120, "completion_tokens": 85, "total_tokens": 205},
    }


# ===========================================================================
# Tier 1 & Tier 2: ProviderConfig & Dynamic Configuration Tests
# ===========================================================================

class TestProviderConfig:
    def test_default_values(self):
        config = ProviderConfig(api_key="test-key")
        assert config.base_url == "https://api.tensormux.com/v1"
        assert config.model == "glm-4-7-flash"
        assert config.timeout == 90.0
        assert config.api_key == "test-key"

    def test_repr_masks_api_key(self):
        config = ProviderConfig(api_key="super-secret-api-key-12345")
        representation = repr(config)
        assert "super-secret" not in representation
        assert "api_key" not in representation

    def test_from_env_direct_environment_variable(self, monkeypatch):
        monkeypatch.setenv("TENSORMUX_API_KEY", "env-direct-key-8899")
        monkeypatch.setenv("TENSORMUX_BASE_URL", "https://api.tensormux.com/v1/")
        monkeypatch.setenv("TENSORMUX_MODEL", "glm-4-7-flash")
        monkeypatch.setenv("TENSORMUX_TIMEOUT_SECONDS", "45")

        config = ProviderConfig.from_env()
        assert config.api_key == "env-direct-key-8899"
        assert config.base_url == "https://api.tensormux.com/v1"
        assert config.model == "glm-4-7-flash"
        assert config.timeout == 45.0

    def test_from_env_custom_env_file(self, monkeypatch, tmp_path):
        env_file = tmp_path / "custom.env"
        env_file.write_text("TENSORMUX_API_KEY=custom-file-key-4321\n")
        monkeypatch.delenv("TENSORMUX_API_KEY", raising=False)
        monkeypatch.setenv("AUTOCADENT_ENV_FILE", str(env_file))

        config = ProviderConfig.from_env()
        assert config.api_key == "custom-file-key-4321"

    def test_from_env_strips_quotes_from_key(self, monkeypatch, tmp_path):
        env_file = tmp_path / "quoted.env"
        env_file.write_text('TENSORMUX_API_KEY="quoted-key-val"\n')
        monkeypatch.delenv("TENSORMUX_API_KEY", raising=False)
        monkeypatch.setenv("AUTOCADENT_ENV_FILE", str(env_file))

        config = ProviderConfig.from_env()
        assert config.api_key == "quoted-key-val"

    def test_dynamic_reloading_when_env_file_modified(self, monkeypatch, tmp_path):
        """Verifies hot-reloading: changing the .env file changes the loaded key."""
        env_file = tmp_path / "dynamic.env"
        env_file.write_text("TENSORMUX_API_KEY=initial-key\n")
        monkeypatch.delenv("TENSORMUX_API_KEY", raising=False)
        monkeypatch.setenv("AUTOCADENT_ENV_FILE", str(env_file))

        config1 = ProviderConfig.from_env()
        assert config1.api_key == "initial-key"

        # Modify file on disk
        env_file.write_text("TENSORMUX_API_KEY=updated-live-key\n")
        config2 = ProviderConfig.from_env()
        assert config2.api_key == "updated-live-key"

    def test_rejects_non_https_scheme(self, monkeypatch):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_BASE_URL", "http://api.tensormux.com/v1")
        with pytest.raises(ValueError, match="Invalid server provider configuration"):
            ProviderConfig.from_env()

    def test_rejects_missing_hostname(self, monkeypatch):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_BASE_URL", "https://")
        with pytest.raises(ValueError, match="Invalid server provider configuration"):
            ProviderConfig.from_env()

    def test_rejects_url_with_credentials(self, monkeypatch):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_BASE_URL", "https://user:pass@api.tensormux.com/v1")
        with pytest.raises(ValueError, match="Invalid server provider configuration"):
            ProviderConfig.from_env()

    def test_rejects_url_with_query_or_fragment(self, monkeypatch):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_BASE_URL", "https://api.tensormux.com/v1?token=xyz")
        with pytest.raises(ValueError, match="Invalid server provider configuration"):
            ProviderConfig.from_env()

        monkeypatch.setenv("TENSORMUX_BASE_URL", "https://api.tensormux.com/v1#section")
        with pytest.raises(ValueError, match="Invalid server provider configuration"):
            ProviderConfig.from_env()

    @pytest.mark.parametrize("timeout_val", [1.0, 90.0, 180.0])
    def test_timeout_within_allowed_range(self, monkeypatch, timeout_val):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_TIMEOUT_SECONDS", str(timeout_val))
        config = ProviderConfig.from_env()
        assert config.timeout == timeout_val

    @pytest.mark.parametrize("invalid_timeout", [0.99, 180.01, -10.0, float("nan"), float("inf")])
    def test_timeout_out_of_range_rejected(self, monkeypatch, invalid_timeout):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_TIMEOUT_SECONDS", str(invalid_timeout))
        with pytest.raises(ValueError, match="Invalid server provider configuration"):
            ProviderConfig.from_env()

    def test_empty_model_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_MODEL", "")
        config = ProviderConfig.from_env()
        assert config.model == "glm-4-7-flash"

    def test_overlong_model_name_rejected(self, monkeypatch):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_MODEL", "m" * 101)
        with pytest.raises(ValueError, match="Invalid server provider configuration"):
            ProviderConfig.from_env()


# ===========================================================================
# Tier 1 & Tier 2: Bounded Design Schema Tests (Pydantic Models)
# ===========================================================================

class TestDesignSchemas:
    def test_rover_spec_valid(self):
        spec = RoverSpec(**valid_seed())
        assert spec.length == 140.0
        assert spec.width == 95.0
        cad_spec = spec.cad()
        assert isinstance(cad_spec, Spec)
        assert cad_spec.length == 140.0

    def test_rover_spec_min_boundaries(self):
        min_spec = RoverSpec(
            length=120.0,
            width=80.0,
            thickness=1.0,
            wall=1.0,
            clearance=0.05,
            mast_height=35.0,
        )
        assert min_spec.length == 120.0
        assert min_spec.clearance == 0.05

    def test_rover_spec_max_boundaries(self):
        max_spec = RoverSpec(
            length=180.0,
            width=110.0,
            thickness=5.0,
            wall=5.0,
            clearance=3.0,
            mast_height=75.0,
        )
        assert max_spec.length == 180.0
        assert max_spec.clearance == 3.0

    @pytest.mark.parametrize("field,bad_val", [
        ("length", 119.9),
        ("length", 180.1),
        ("width", 79.9),
        ("width", 110.1),
        ("thickness", 0.99),
        ("thickness", 5.01),
        ("wall", 0.99),
        ("wall", 5.01),
        ("clearance", 0.049),
        ("clearance", 3.01),
        ("mast_height", 34.9),
        ("mast_height", 75.1),
    ])
    def test_rover_spec_out_of_bounds_rejected(self, field, bad_val):
        data = valid_seed()
        data[field] = bad_val
        with pytest.raises(ValidationError):
            RoverSpec(**data)

    @pytest.mark.parametrize("bad_num", [float("nan"), float("inf"), float("-inf")])
    def test_rover_spec_rejects_non_finite_numbers(self, bad_num):
        data = valid_seed()
        data["length"] = bad_num
        with pytest.raises(ValidationError):
            RoverSpec(**data)

    def test_rover_spec_rejects_extra_fields(self):
        data = valid_seed()
        data["unauthorized_motor_power"] = 100.0
        with pytest.raises(ValidationError):
            RoverSpec(**data)

    def test_addon_spec_valid(self):
        addon = AddonSpec(kind="sensor_bridge", depth=20.0, thickness=3.0)
        assert addon.kind == "sensor_bridge"
        assert addon.depth == 20.0

    def test_addon_spec_boundaries(self):
        # Min
        a_min = AddonSpec(kind="sensor_bridge", depth=16.0, thickness=1.0)
        assert a_min.depth == 16.0
        # Max
        a_max = AddonSpec(kind="sensor_bridge", depth=24.0, thickness=5.0)
        assert a_max.depth == 24.0

    @pytest.mark.parametrize("depth,thickness", [(15.9, 2.0), (24.1, 2.0), (20.0, 0.9), (20.0, 5.1)])
    def test_addon_spec_out_of_bounds(self, depth, thickness):
        with pytest.raises(ValidationError):
            AddonSpec(kind="sensor_bridge", depth=depth, thickness=thickness)

    def test_addon_spec_rejects_invalid_kind(self):
        with pytest.raises(ValidationError):
            AddonSpec(kind="camera_arm", depth=20.0, thickness=2.0)

    def test_pcb_spec_valid(self):
        pcb = PCBSpec(
            kind="signal_breakout",
            nets=["VCC", "GND", "UART_TX", "UART_RX"],
            connector_spacing=28.0,
            trace_width=0.35,
        )
        assert len(pcb.nets) == 4
        assert pcb.trace_width == 0.35

    def test_pcb_spec_nets_count_limits(self):
        # 3 nets (minimum)
        p3 = PCBSpec(kind="signal_breakout", nets=["N1", "N2", "N3"], connector_spacing=25, trace_width=0.4)
        assert len(p3.nets) == 3

        # 8 nets (maximum)
        p8 = PCBSpec(kind="signal_breakout", nets=[f"NET_{i}" for i in range(8)], connector_spacing=25, trace_width=0.4)
        assert len(p8.nets) == 8

        # Under 3 nets rejected
        with pytest.raises(ValidationError):
            PCBSpec(kind="signal_breakout", nets=["N1", "N2"], connector_spacing=25, trace_width=0.4)

        # Over 8 nets rejected
        with pytest.raises(ValidationError):
            PCBSpec(kind="signal_breakout", nets=[f"NET_{i}" for i in range(9)], connector_spacing=25, trace_width=0.4)

    @pytest.mark.parametrize("bad_net", [
        "lowercase_net",
        "1STARTS_WITH_DIGIT",
        "_STARTS_WITH_UNDERSCORE",
        "HAS SPACE",
        "HAS-DASH",
        "TOO_LONG_NET_NAME_EXCEEDING_SIXTEEN_CHARS",
        "",
    ])
    def test_pcb_spec_net_regex_validation(self, bad_net):
        with pytest.raises(ValidationError):
            PCBSpec(
                kind="signal_breakout",
                nets=["VCC", "GND", bad_net],
                connector_spacing=25,
                trace_width=0.4,
            )

    @pytest.mark.parametrize("spacing", [19.9, 38.1])
    def test_pcb_spec_connector_spacing_boundaries(self, spacing):
        with pytest.raises(ValidationError):
            PCBSpec(kind="signal_breakout", nets=["A", "B", "C"], connector_spacing=spacing, trace_width=0.4)

    @pytest.mark.parametrize("width", [0.24, 0.81])
    def test_pcb_spec_trace_width_boundaries(self, width):
        with pytest.raises(ValidationError):
            PCBSpec(kind="signal_breakout", nets=["A", "B", "C"], connector_spacing=25, trace_width=width)

    def test_design_checked_rejects_duplicate_nets(self):
        d_dict = valid_design_dict()
        d_dict["pcb"]["nets"] = ["VCC", "GND", "VCC"]  # Duplicate VCC
        design = Design.model_validate(d_dict)
        with pytest.raises(ValueError, match="PCB net names must be unique"):
            design.checked()

    def test_parse_design_valid_markdown_fence(self):
        raw = f"```json\n{json.dumps(valid_design_dict())}\n```"
        design = parse_design(raw)
        assert isinstance(design, Design)
        assert design.spec.length == 140.0

    def test_parse_design_valid_bare_json(self):
        raw = json.dumps(valid_design_dict())
        design = parse_design(raw)
        assert isinstance(design, Design)

    def test_parse_design_rejects_over_16kb(self):
        huge_content = " " * 16385
        with pytest.raises(ValueError, match="Design exceeds size bound"):
            parse_design(huge_content)

    def test_parse_design_rejects_non_string(self):
        with pytest.raises(ValueError, match="Design exceeds size bound"):
            parse_design(12345)

    def test_parse_design_rejects_surrounding_prose(self):
        valid_json = json.dumps(valid_design_dict())
        prose_before = f"Here is your design:\n```json\n{valid_json}\n```"
        with pytest.raises(ValueError):
            parse_design(prose_before)

        prose_after = f"```json\n{valid_json}\n```\nHope you like it!"
        with pytest.raises(ValueError):
            parse_design(prose_after)

    def test_parse_design_rejects_duplicate_json_keys(self):
        # Construct JSON with duplicate key "spec"
        bad_json = '{"spec": {"length":140,"width":95,"thickness":3,"wall":2.5,"clearance":1.2,"mast_height":50}, "spec": {"length":150,"width":95,"thickness":3,"wall":2.5,"clearance":1.2,"mast_height":50}, "addon":{"kind":"sensor_bridge","depth":20,"thickness":2.5},"pcb":{"kind":"signal_breakout","nets":["VCC","GND","SIG"],"connector_spacing":25,"trace_width":0.4}}'
        with pytest.raises(ValueError, match="Duplicate JSON key"):
            parse_design(bad_json)

    def test_parse_design_rejects_non_finite_json_constants(self):
        bad_json = '{"spec": {"length":NaN,"width":95,"thickness":3,"wall":2.5,"clearance":1.2,"mast_height":50},"addon":{"kind":"sensor_bridge","depth":20,"thickness":2.5},"pcb":{"kind":"signal_breakout","nets":["VCC","GND","SIG"],"connector_spacing":25,"trace_width":0.4}}'
        with pytest.raises(ValueError):
            parse_design(bad_json)


# ===========================================================================
# Tier 1 & Tier 2: Tensormux Transport & Error Classification Tests
# ===========================================================================

class TestTensormuxTransport:
    def test_provider_error_formatting(self):
        err1 = ProviderError("not_configured")
        assert err1.code == "not_configured"
        assert err1.status is None
        assert "Tensormux not_configured" in str(err1)

        err2 = ProviderError("http_error", 401)
        assert err2.code == "http_error"
        assert err2.status == 401
        assert "Tensormux http_error (HTTP 401)" in str(err2)

    def test_generate_missing_api_key_raises_not_configured(self):
        config = ProviderConfig(api_key="")
        provider = Tensormux(config)
        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Design a rover", valid_seed())
        assert exc_info.value.code == "not_configured"

    def test_generate_success_with_mock_transport(self):
        design_data = valid_design_dict()
        response_payload = make_llm_response_json(design_data)

        def handler(request: httpx.Request):
            assert request.url == "https://api.tensormux.com/v1/chat/completions"
            assert request.headers["Authorization"] == "Bearer mock-secret-key"
            req_body = json.loads(request.read())
            assert req_body["model"] == "glm-4-7-flash"
            assert "initial_spec" in req_body["messages"][1]["content"]
            return httpx.Response(200, json=response_payload)

        mock_transport = httpx.MockTransport(handler)
        config = ProviderConfig(api_key="mock-secret-key")
        provider = Tensormux(config, transport=mock_transport)

        design, meta = provider.generate("Rover design test", valid_seed())
        assert isinstance(design, Design)
        assert design.spec.length == 140.0
        assert meta["provider"] == "tensormux"
        assert meta["model"] == "glm-4-7-flash"
        assert meta["http_status"] == 200
        assert meta["status"] == "validated_design"
        assert meta["revision"] is False

    def test_generate_initial_spec_mismatch_raises(self):
        """First iteration must not modify user seed dimensions."""
        seed = valid_seed()
        # LLM returns altered length 160.0 instead of 140.0
        bad_design = valid_design_dict(override_rover={"length": 160.0})
        response_payload = make_llm_response_json(bad_design)

        def handler(request: httpx.Request):
            return httpx.Response(200, json=response_payload)

        config = ProviderConfig(api_key="mock-key")
        provider = Tensormux(config, transport=httpx.MockTransport(handler))

        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Initial rover", seed, previous=None)
        assert exc_info.value.code == "initial_spec_mismatch"

    def test_generate_revision_allows_spec_modifications(self):
        """On revision (previous is not None), model is allowed to modify spec dimensions."""
        seed = valid_seed()
        revised_design_dict = valid_design_dict(override_rover={"thickness": 3.8, "wall": 3.2})
        response_payload = make_llm_response_json(revised_design_dict)

        def handler(request: httpx.Request):
            return httpx.Response(200, json=response_payload)

        config = ProviderConfig(api_key="mock-key")
        provider = Tensormux(config, transport=httpx.MockTransport(handler))

        initial_design = Design.model_validate(valid_design_dict())
        eval_dict = {"Bridge clearance": "Failed"}

        design, meta = provider.generate("Revise rover", seed, previous=initial_design, evaluation=eval_dict)
        assert design.spec.thickness == 3.8
        assert meta["revision"] is True

    def test_generate_response_too_large_raises(self):
        """Payload exceeding 64 KB (65,536 bytes) raises response_too_large."""
        large_junk = "x" * 70000

        def handler(request: httpx.Request):
            return httpx.Response(200, content=large_junk.encode("utf-8"))

        config = ProviderConfig(api_key="mock-key")
        provider = Tensormux(config, transport=httpx.MockTransport(handler))

        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Test large", valid_seed())
        assert exc_info.value.code == "response_too_large"

    def test_generate_incomplete_finish_reason_raises(self):
        resp = make_llm_response_json(valid_design_dict(), finish_reason="length")

        def handler(request: httpx.Request):
            return httpx.Response(200, json=resp)

        config = ProviderConfig(api_key="mock-key")
        provider = Tensormux(config, transport=httpx.MockTransport(handler))

        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Test incomplete", valid_seed())
        assert exc_info.value.code == "incomplete_or_tool_response"

    def test_generate_tool_calls_raises(self):
        resp = make_llm_response_json(valid_design_dict(), tool_calls=[{"id": "call_1", "type": "function"}])

        def handler(request: httpx.Request):
            return httpx.Response(200, json=resp)

        config = ProviderConfig(api_key="mock-key")
        provider = Tensormux(config, transport=httpx.MockTransport(handler))

        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Test tool calls", valid_seed())
        assert exc_info.value.code == "incomplete_or_tool_response"

    @pytest.mark.parametrize("status_code", [401, 403, 429, 500, 503])
    def test_generate_http_error_statuses(self, status_code):
        def handler(request: httpx.Request):
            return httpx.Response(status_code, json={"error": {"code": "http_failure"}})

        config = ProviderConfig(api_key="mock-key")
        provider = Tensormux(config, transport=httpx.MockTransport(handler))

        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Test http error", valid_seed())
        assert exc_info.value.code == "http_error"
        assert exc_info.value.status == status_code

    def test_generate_timeout_exception(self):
        def handler(request: httpx.Request):
            raise httpx.ReadTimeout("Socket timed out")

        config = ProviderConfig(api_key="mock-key", timeout=1.0)
        provider = Tensormux(config, transport=httpx.MockTransport(handler))

        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Test timeout", valid_seed())
        assert exc_info.value.code == "timeout"

    def test_generate_transport_network_error(self):
        def handler(request: httpx.Request):
            raise httpx.ConnectError("Failed to connect to host")

        config = ProviderConfig(api_key="mock-key")
        provider = Tensormux(config, transport=httpx.MockTransport(handler))

        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Test connect error", valid_seed())
        assert exc_info.value.code == "transport_error"

    def test_generate_invalid_design_json_response(self):
        bad_json_response = {
            "choices": [{"message": {"content": "Not a JSON design at all"}, "finish_reason": "stop"}]
        }

        def handler(request: httpx.Request):
            return httpx.Response(200, json=bad_json_response)

        config = ProviderConfig(api_key="mock-key")
        provider = Tensormux(config, transport=httpx.MockTransport(handler))

        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Test invalid json", valid_seed())
        assert exc_info.value.code == "invalid_design_response"


# ===========================================================================
# Tier 4: Real-World Scenario — Cold-Start Dynamic Key & Synthesis (S5)
# ===========================================================================

class TestColdStartScenario:
    def test_cold_start_dynamic_configuration_and_synthesis(self, monkeypatch, tmp_path):
        """Scenario S5: System starts unconfigured, user injects key via .env, pipeline succeeds."""
        env_path = tmp_path / ".env"
        monkeypatch.delenv("TENSORMUX_API_KEY", raising=False)
        monkeypatch.setenv("AUTOCADENT_ENV_FILE", str(env_path))

        # Initial state: .env does not exist
        initial_config = ProviderConfig.from_env()
        assert initial_config.api_key == ""
        p1 = Tensormux(initial_config)
        with pytest.raises(ProviderError) as exc_info:
            p1.generate("Unconfigured test", valid_seed())
        assert exc_info.value.code == "not_configured"

        # User writes .env file
        env_path.write_text("TENSORMUX_API_KEY=cold-start-secret-key-9988\n")

        # Dynamic reload without server restart
        reloaded_config = ProviderConfig.from_env()
        assert reloaded_config.api_key == "cold-start-secret-key-9988"

        # Transport now succeeds
        design_data = valid_design_dict()
        response_payload = make_llm_response_json(design_data)

        def handler(request: httpx.Request):
            assert request.headers["Authorization"] == "Bearer cold-start-secret-key-9988"
            return httpx.Response(200, json=response_payload)

        p2 = Tensormux(reloaded_config, transport=httpx.MockTransport(handler))
        design, meta = p2.generate("Cold-start synthesis", valid_seed())
        assert isinstance(design, Design)
        assert meta["status"] == "validated_design"
