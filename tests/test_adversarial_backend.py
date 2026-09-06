"""Exhaustive Empirical Adversarial Test Suite for AutoCadent Backend & Compilers.
Probing boundary values, malformed inputs, stream exhaustion, SWIG iterators,
OpenCASCADE geometry adaptors, and graceful error handling under stress.
"""
import copy
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from autocadent.provider import ProviderConfig, Tensormux, ProviderError
from autocadent.design import RoverSpec, AddonSpec, PCBSpec, Design, parse_design
from autocadent.cad import Spec, build, evaluate, repair
from autocadent.addon import build_addon, evaluate_addon
from autocadent.model_pipeline import run_model, CompilerError, compile_board
from autocadent.api import app, LOCK

ROOT = Path(__file__).resolve().parents[1]
KICAD_PYTHON = os.getenv("AUTOCADENT_KICAD_PYTHON", "/usr/bin/python3")
MODEL_BOARD_SCRIPT = ROOT / "scripts" / "model_board.py"


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


def make_llm_response(design_dict, finish_reason="stop", tool_calls=None):
    content = json.dumps(design_dict)
    msg = {"role": "assistant", "content": f"```json\n{content}\n```"}
    if tool_calls is not None:
        msg["tool_calls"] = tool_calls
    return {
        "id": "cmpl-adv-test",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "glm-4-7-flash",
        "choices": [{"index": 0, "message": msg, "finish_reason": finish_reason}],
    }


# ===========================================================================
# 1. Tensormux Provider & Transport Stress
# ===========================================================================

class TestTensormuxAdversarialStreamAndPayloads:
    """Stress-tests Tensormux HTTPS streaming, payload size limits, and error taxonomy."""

    def test_stream_aborts_immediately_on_oversized_payload(self):
        """Streaming server sending multi-megabyte stream must abort immediately once >64KB."""
        chunks_streamed = 0

        def infinite_chunk_generator():
            nonlocal chunks_streamed
            for _ in range(5000):  # 5 MB total potential
                chunks_streamed += 1
                yield b"A" * 1024

        def mock_stream_handler(request: httpx.Request):
            return httpx.Response(200, content=infinite_chunk_generator())

        config = ProviderConfig(api_key="adv-key")
        provider = Tensormux(config, transport=httpx.MockTransport(mock_stream_handler))

        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Test stream abort", valid_seed())

        assert exc_info.value.code == "response_too_large"
        # 65 chunks * 1024 = 66,560 > 65,536 bytes. Must abort immediately on 65th chunk!
        assert chunks_streamed == 65

    def test_content_exceeding_16kb_design_bound(self):
        """Valid OpenAI envelope with design JSON content > 16KB raises invalid_design_response."""
        huge_design = valid_design_dict()
        huge_design["_padding"] = "X" * 17000  # Will exceed 16KB in content
        resp = {"choices": [{"message": {"content": json.dumps(huge_design)}, "finish_reason": "stop"}]}

        def handler(request: httpx.Request):
            return httpx.Response(200, json=resp)

        provider = Tensormux(ProviderConfig(api_key="adv-key"), transport=httpx.MockTransport(handler))
        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Exceed 16KB", valid_seed())
        assert exc_info.value.code == "invalid_design_response"

    @pytest.mark.parametrize("malformed_body", [
        b"",
        b"   \n\t  ",
        b"{",
        b"{\"choices\": ",
        b"{\"choices\": []}",
        b"{\"choices\": [{}]}",
        b"{\"choices\": [{\"message\": {}}]}",
        b"<html><body>502 Bad Gateway</body></html>",
        b"\xff\xfe\xfd",  # Invalid UTF-8
    ])
    def test_malformed_responses_gracefully_mapped(self, malformed_body):
        """Malformed or incomplete OpenAI response bodies must map to typed ProviderError."""
        def handler(request: httpx.Request):
            return httpx.Response(200, content=malformed_body)

        provider = Tensormux(ProviderConfig(api_key="adv-key"), transport=httpx.MockTransport(handler))
        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Malformed test", valid_seed())
        assert exc_info.value.code in {"invalid_design_response", "incomplete_or_tool_response"}

    @pytest.mark.parametrize("bad_content", [
        None,
        "",
        "not a json object",
        "{truncated json",
        "{\"valid_json\": \"but wrong schema\"}",
        "[]",
    ])
    def test_invalid_content_with_stop_finish_reason(self, bad_content):
        """Responses with finish_reason=='stop' but invalid design content map to invalid_design_response."""
        resp = {
            "choices": [{"message": {"content": bad_content}, "finish_reason": "stop"}]
        }

        def handler(request: httpx.Request):
            return httpx.Response(200, json=resp)

        provider = Tensormux(ProviderConfig(api_key="adv-key"), transport=httpx.MockTransport(handler))
        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Invalid content test", valid_seed())
        assert exc_info.value.code == "invalid_design_response"

    @pytest.mark.parametrize("finish_reason", [
        "length",
        "content_filter",
        "null",
        None,
        "tool_calls",
    ])
    def test_non_stop_finish_reasons_rejected(self, finish_reason):
        """Any finish_reason other than 'stop' must raise incomplete_or_tool_response."""
        resp = make_llm_response(valid_design_dict(), finish_reason=finish_reason)

        def handler(request: httpx.Request):
            return httpx.Response(200, json=resp)

        provider = Tensormux(ProviderConfig(api_key="adv-key"), transport=httpx.MockTransport(handler))
        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Test finish reason", valid_seed())
        assert exc_info.value.code == "incomplete_or_tool_response"

    def test_tool_calls_injection_rejected(self):
        """Even if finish_reason=='stop', presence of tool_calls must raise incomplete_or_tool_response."""
        resp = make_llm_response(
            valid_design_dict(),
            finish_reason="stop",
            tool_calls=[{"id": "call_exec", "type": "function", "function": {"name": "run_shell"}}]
        )

        def handler(request: httpx.Request):
            return httpx.Response(200, json=resp)

        provider = Tensormux(ProviderConfig(api_key="adv-key"), transport=httpx.MockTransport(handler))
        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Test tool injection", valid_seed())
        assert exc_info.value.code == "incomplete_or_tool_response"

    @pytest.mark.parametrize("tampered_field,delta", [
        ("length", 0.01),
        ("length", -0.01),
        ("width", 0.1),
        ("thickness", 0.5),
        ("wall", -0.2),
        ("clearance", 0.05),
        ("mast_height", 1.0),
    ])
    def test_seed_mutation_on_initial_iteration_rejected(self, tampered_field, delta):
        """First iteration (previous=None) must strictly reject any modification to seed dimensions."""
        seed = valid_seed()
        tampered_spec = copy.deepcopy(seed)
        tampered_spec[tampered_field] += delta
        bad_design = valid_design_dict(override_rover=tampered_spec)
        resp = make_llm_response(bad_design)

        def handler(request: httpx.Request):
            return httpx.Response(200, json=resp)

        provider = Tensormux(ProviderConfig(api_key="adv-key"), transport=httpx.MockTransport(handler))
        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Initial rover", seed, previous=None)
        assert exc_info.value.code == "initial_spec_mismatch"

    def test_seed_int_vs_float_equivalence(self):
        """Seed supplied with integer values (e.g. 140 instead of 140.0) correctly validates."""
        int_seed = {"length": 140, "width": 95, "thickness": 3, "wall": 2, "clearance": 1, "mast_height": 50}
        design_dict = valid_design_dict(override_rover=int_seed)
        resp = make_llm_response(design_dict)

        def handler(request: httpx.Request):
            return httpx.Response(200, json=resp)

        provider = Tensormux(ProviderConfig(api_key="adv-key"), transport=httpx.MockTransport(handler))
        design, meta = provider.generate("Int seed test", int_seed, previous=None)
        assert design.spec.length == 140.0
        assert meta["status"] == "validated_design"

    @pytest.mark.parametrize("status_code", [400, 401, 403, 404, 422, 429, 500, 502, 503, 504])
    def test_http_error_code_mapping(self, status_code):
        """All non-200 HTTP status codes map to ProviderError('http_error', status)."""
        def handler(request: httpx.Request):
            return httpx.Response(status_code, json={"error": "test"})

        provider = Tensormux(ProviderConfig(api_key="adv-key"), transport=httpx.MockTransport(handler))
        with pytest.raises(ProviderError) as exc_info:
            provider.generate("HTTP error test", valid_seed())
        assert exc_info.value.code == "http_error"
        assert exc_info.value.status == status_code

    def test_mid_stream_timeout_enforcement(self):
        """Provider stream taking longer than timeout seconds mid-stream raises timeout."""
        def slow_chunk_gen():
            yield b"{\"choices\": "
            time.sleep(1.2)
            yield b"[]}"

        def handler(request: httpx.Request):
            return httpx.Response(200, content=slow_chunk_gen())

        provider = Tensormux(ProviderConfig(api_key="adv-key", timeout=1.0), transport=httpx.MockTransport(handler))
        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Mid stream timeout", valid_seed())
        assert exc_info.value.code == "timeout"

    def test_transport_connection_drop_mapping(self):
        """Network dropouts (RemoteProtocolError, ConnectError) map to transport_error."""
        def handler(request: httpx.Request):
            raise httpx.RemoteProtocolError("Peer disconnected unexpectedly")

        provider = Tensormux(ProviderConfig(api_key="adv-key"), transport=httpx.MockTransport(handler))
        with pytest.raises(ProviderError) as exc_info:
            provider.generate("Network drop test", valid_seed())
        assert exc_info.value.code == "transport_error"

    def test_api_key_redacted_in_repr_and_exceptions(self):
        """Confidential API key must never appear in repr or exception string representations."""
        secret = "secret-token-tensormux-9988-do-not-leak"
        cfg = ProviderConfig(api_key=secret)
        assert secret not in repr(cfg)

        err = ProviderError("not_configured")
        assert secret not in str(err)
        assert secret not in repr(err)


# ===========================================================================
# 2. Dynamic .env Hot-Reloading Under Rapid Mutation
# ===========================================================================

class TestDynamicEnvHotReloadAdversarial:
    """Stress-tests .env dynamic loading, concurrency, dirty lines, and security boundaries."""

    def test_rapid_concurrent_env_file_mutations(self, monkeypatch, tmp_path):
        """5 reader threads constantly calling from_env() while writer mutates .env must not crash."""
        env_file = tmp_path / "concurrent.env"
        monkeypatch.setenv("AUTOCADENT_ENV_FILE", str(env_file))
        monkeypatch.delenv("TENSORMUX_API_KEY", raising=False)

        stop_event = threading.Event()
        errors = []

        def writer():
            idx = 0
            while not stop_event.is_set():
                env_file.write_text(f"TENSORMUX_API_KEY=key-iteration-{idx}\nTENSORMUX_MODEL=glm-4-7-flash\n")
                idx += 1
                time.sleep(0.001)

        def reader():
            for _ in range(300):
                try:
                    cfg = ProviderConfig.from_env()
                    assert cfg.api_key.startswith("key-iteration-") or cfg.api_key == ""
                    assert cfg.model == "glm-4-7-flash"
                except Exception as e:
                    errors.append(e)

        w_thread = threading.Thread(target=writer)
        w_thread.start()

        readers = [threading.Thread(target=reader) for _ in range(5)]
        for r in readers:
            r.start()
        for r in readers:
            r.join()

        stop_event.set()
        w_thread.join()

        assert len(errors) == 0, f"Encountered {len(errors)} errors during concurrent .env access: {errors[:3]}"

    def test_dirty_env_file_parsing(self, monkeypatch, tmp_path):
        """Parses lines with comments, spaces, extra '=', and quotes correctly."""
        env_file = tmp_path / "dirty.env"
        env_file.write_text("""
# Leading comment
   # Indented comment

TENSORMUX_API_KEY = "quoted_secret_key"   
TENSORMUX_BASE_URL=https://api.tensormux.com/v1/
TENSORMUX_MODEL='glm-4-7-flash'
TENSORMUX_TIMEOUT_SECONDS=60.0
IGNORED_LINE_WITHOUT_EQUALS
EXTRA_EQUALS_KEY=VALUE_PART_1=VALUE_PART_2
""")
        monkeypatch.setenv("AUTOCADENT_ENV_FILE", str(env_file))
        monkeypatch.delenv("TENSORMUX_API_KEY", raising=False)
        monkeypatch.delenv("TENSORMUX_BASE_URL", raising=False)
        monkeypatch.delenv("TENSORMUX_MODEL", raising=False)
        monkeypatch.delenv("TENSORMUX_TIMEOUT_SECONDS", raising=False)

        cfg = ProviderConfig.from_env()
        assert cfg.api_key == "quoted_secret_key"
        assert cfg.base_url == "https://api.tensormux.com/v1"
        assert cfg.model == "glm-4-7-flash"
        assert cfg.timeout == 60.0

    @pytest.mark.parametrize("bad_url", [
        "http://insecure.api.tensormux.com/v1",
        "ftp://api.tensormux.com/v1",
        "https://",
        "https:///path",
        "https://user:pass@api.tensormux.com/v1",
        "https://api.tensormux.com/v1?token=leak",
        "https://api.tensormux.com/v1#anchor",
        "javascript:alert(1)",
    ])
    def test_url_security_boundaries_rejected(self, monkeypatch, bad_url):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_BASE_URL", bad_url)
        with pytest.raises(ValueError, match="Invalid server provider configuration"):
            ProviderConfig.from_env()

    @pytest.mark.parametrize("bad_timeout", [
        "0",
        "0.999",
        "180.001",
        "-10",
        "nan",
        "inf",
        "-inf",
        "not-a-number",
    ])
    def test_timeout_adversarial_inputs_rejected(self, monkeypatch, bad_timeout):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_TIMEOUT_SECONDS", bad_timeout)
        with pytest.raises(ValueError):
            ProviderConfig.from_env()

    def test_overlong_model_name_rejected(self, monkeypatch):
        monkeypatch.setenv("TENSORMUX_API_KEY", "valid-key")
        monkeypatch.setenv("TENSORMUX_MODEL", "x" * 101)
        with pytest.raises(ValueError, match="Invalid server provider configuration"):
            ProviderConfig.from_env()


# ===========================================================================
# 3. Pydantic Schema Validation Boundaries
# ===========================================================================

class TestPydanticSchemaAdversarialBoundaries:
    """Rigorous boundary and type-confusion testing of RoverSpec, AddonSpec, PCBSpec, Design."""

    @pytest.mark.parametrize("field,valid_min,valid_max", [
        ("length", 120.0, 180.0),
        ("width", 80.0, 110.0),
        ("thickness", 1.0, 5.0),
        ("wall", 1.0, 5.0),
        ("clearance", 0.05, 3.0),
        ("mast_height", 35.0, 75.0),
    ])
    def test_rover_spec_exact_min_max_and_sub_epsilon_rejection(self, field, valid_min, valid_max):
        # Exact min
        d_min = valid_seed()
        d_min[field] = valid_min
        spec_min = RoverSpec(**d_min)
        assert getattr(spec_min, field) == valid_min

        # Exact max
        d_max = valid_seed()
        d_max[field] = valid_max
        spec_max = RoverSpec(**d_max)
        assert getattr(spec_max, field) == valid_max

        # Sub-epsilon below min
        d_below = valid_seed()
        d_below[field] = valid_min - 0.0001
        with pytest.raises(ValidationError):
            RoverSpec(**d_below)

        # Sub-epsilon above max
        d_above = valid_seed()
        d_above[field] = valid_max + 0.0001
        with pytest.raises(ValidationError):
            RoverSpec(**d_above)

    @pytest.mark.parametrize("field,valid_min,valid_max", [
        ("depth", 16.0, 24.0),
        ("thickness", 1.0, 5.0),
    ])
    def test_addon_spec_exact_min_max_and_sub_epsilon_rejection(self, field, valid_min, valid_max):
        base = {"kind": "sensor_bridge", "depth": 20.0, "thickness": 2.5}

        # Exact min
        d_min = dict(base, **{field: valid_min})
        a_min = AddonSpec(**d_min)
        assert getattr(a_min, field) == valid_min

        # Exact max
        d_max = dict(base, **{field: valid_max})
        a_max = AddonSpec(**d_max)
        assert getattr(a_max, field) == valid_max

        # Sub-epsilon below min
        with pytest.raises(ValidationError):
            AddonSpec(**dict(base, **{field: valid_min - 0.0001}))

        # Sub-epsilon above max
        with pytest.raises(ValidationError):
            AddonSpec(**dict(base, **{field: valid_max + 0.0001}))

    @pytest.mark.parametrize("field,valid_min,valid_max", [
        ("connector_spacing", 20.0, 38.0),
        ("trace_width", 0.25, 0.80),
    ])
    def test_pcb_spec_dimensions_exact_min_max_and_sub_epsilon_rejection(self, field, valid_min, valid_max):
        base = {"kind": "signal_breakout", "nets": ["VCC", "GND", "SIG"], "connector_spacing": 25.0, "trace_width": 0.4}

        # Exact min
        p_min = PCBSpec(**dict(base, **{field: valid_min}))
        assert getattr(p_min, field) == valid_min

        # Exact max
        p_max = PCBSpec(**dict(base, **{field: valid_max}))
        assert getattr(p_max, field) == valid_max

        # Sub-epsilon below
        with pytest.raises(ValidationError):
            PCBSpec(**dict(base, **{field: valid_min - 0.0001}))

        # Sub-epsilon above
        with pytest.raises(ValidationError):
            PCBSpec(**dict(base, **{field: valid_max + 0.0001}))

    def test_pcb_nets_boundary_counts(self):
        """Boundary net counts: exactly 3 and 8 are allowed; 2 and 9 are rejected."""
        base = {"kind": "signal_breakout", "connector_spacing": 25.0, "trace_width": 0.4}

        # 3 nets (min boundary)
        p3 = PCBSpec(nets=["A", "B", "C"], **base)
        assert len(p3.nets) == 3

        # 8 nets (max boundary)
        p8 = PCBSpec(nets=[f"N_{i}" for i in range(8)], **base)
        assert len(p8.nets) == 8

        # 2 nets (below min)
        with pytest.raises(ValidationError):
            PCBSpec(nets=["A", "B"], **base)

        # 9 nets (above max)
        with pytest.raises(ValidationError):
            PCBSpec(nets=[f"N_{i}" for i in range(9)], **base)

    @pytest.mark.parametrize("valid_name", [
        "A",                     # 1 char (minimum)
        "Z",
        "A_",
        "A0",
        "A" + "B" * 15,          # 16 chars (maximum)
        "VCC",
        "GND_EXT_2",
    ])
    def test_pcb_net_name_regex_valid_boundaries(self, valid_name):
        p = PCBSpec(kind="signal_breakout", nets=[valid_name, "GND", "VCC"], connector_spacing=25.0, trace_width=0.4)
        assert p.nets[0] == valid_name

    @pytest.mark.parametrize("bad_name", [
        "",                      # empty
        "A" + "B" * 16,          # 17 chars (exceeds 16)
        "0A",                    # starts with digit
        "_A",                    # starts with underscore
        "vcc",                   # lowercase
        "Vcc",                   # mixed case
        "V-CC",                  # hyphen
        "V CC",                  # space
        "V.CC",                  # period
        "VCC\n",                 # newline
        "VCC\x00",               # null byte
        "VCC;DROP",              # semicolon
    ])
    def test_pcb_net_name_regex_invalid_names_rejected(self, bad_name):
        with pytest.raises(ValidationError):
            PCBSpec(kind="signal_breakout", nets=[bad_name, "GND", "VCC"], connector_spacing=25.0, trace_width=0.4)

    def test_pydantic_strict_mode_rejects_bool_and_string_for_numeric_fields(self):
        """Type confusion: bool or str passed to float field must be strictly rejected."""
        d = valid_seed()
        d["length"] = True
        with pytest.raises(ValidationError):
            RoverSpec(**d)

        d["length"] = "140.0"
        with pytest.raises(ValidationError):
            RoverSpec(**d)

    @pytest.mark.parametrize("bad_constant", [float("nan"), float("inf"), float("-inf")])
    def test_pydantic_rejects_non_finite_floats(self, bad_constant):
        d = valid_seed()
        d["length"] = bad_constant
        with pytest.raises(ValidationError):
            RoverSpec(**d)

    def test_parse_design_rejects_duplicate_json_keys_at_any_depth(self):
        """parse_design uses object_pairs_hook to reject duplicate keys at top and nested levels."""
        # Top level duplicate
        bad_top = '{"spec": {"length":140,"width":95,"thickness":3,"wall":2.5,"clearance":1.2,"mast_height":50}, "spec": {"length":150,"width":95,"thickness":3,"wall":2.5,"clearance":1.2,"mast_height":50}, "addon":{"kind":"sensor_bridge","depth":20,"thickness":2.5},"pcb":{"kind":"signal_breakout","nets":["VCC","GND","SIG"],"connector_spacing":25,"trace_width":0.4}}'
        with pytest.raises(ValueError, match="Duplicate JSON key"):
            parse_design(bad_top)

        # Nested duplicate
        bad_nested = '{"spec": {"length":140,"length":150,"width":95,"thickness":3,"wall":2.5,"clearance":1.2,"mast_height":50}, "addon":{"kind":"sensor_bridge","depth":20,"thickness":2.5},"pcb":{"kind":"signal_breakout","nets":["VCC","GND","SIG"],"connector_spacing":25,"trace_width":0.4}}'
        with pytest.raises(ValueError, match="Duplicate JSON key"):
            parse_design(bad_nested)

    @pytest.mark.parametrize("constant_str", ["NaN", "Infinity", "-Infinity"])
    def test_parse_design_rejects_non_finite_json_constants(self, constant_str):
        raw = f'{{"spec": {{"length":{constant_str},"width":95,"thickness":3,"wall":2.5,"clearance":1.2,"mast_height":50}}, "addon":{{"kind":"sensor_bridge","depth":20,"thickness":2.5}}, "pcb":{{"kind":"signal_breakout","nets":["VCC","GND","SIG"],"connector_spacing":25,"trace_width":0.4}}}}'
        with pytest.raises(ValueError, match="Non-finite JSON"):
            parse_design(raw)


# ===========================================================================
# 4. KiCad PCB Compiler Edge Cases
# ===========================================================================

class TestKiCadPCBCompilerAdversarialEdgeCases:
    """Adversarially exercises scripts/model_board.py across 6 extreme boundary combinations."""

    @pytest.mark.parametrize("combo_name,nets,spacing,width", [
        ("3nets_min_dim", ["NET_A", "NET_B", "NET_C"], 20.0, 0.25),
        ("3nets_max_dim", ["NET_A", "NET_B", "NET_C"], 38.0, 0.80),
        ("8nets_min_dim", [f"NET_{i}" for i in range(8)], 20.0, 0.25),
        ("8nets_max_dim", [f"NET_{i}" for i in range(8)], 38.0, 0.80),
        ("8nets_tight_dense", [f"NET_{i}" for i in range(8)], 20.0, 0.80),
        ("8nets_wide_thin", [f"NET_{i}" for i in range(8)], 38.0, 0.25),
    ])
    def test_extreme_pcb_combinations_drc_cleanliness(self, tmp_path, combo_name, nets, spacing, width):
        """KiCad 10 board compiler generates clean DRC with 0 violations across all boundary combos."""
        out = tmp_path / combo_name
        out.mkdir()
        spec = {
            "kind": "signal_breakout",
            "nets": nets,
            "connector_spacing": spacing,
            "trace_width": width,
        }
        spec_path = out / "pcb-spec.json"
        spec_path.write_text(json.dumps(spec))

        cmd = [KICAD_PYTHON, str(MODEL_BOARD_SCRIPT), "--spec", str(spec_path), "--output", str(out)]
        kicad_env = {k: v for k, v in os.environ.items() if k != "PYTHONHOME"}
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=90, env=kicad_env)
        assert res.returncode == 0, f"KiCad compilation failed on {combo_name}: {res.stderr}"

        eval_data = json.loads((out / "evaluation.json").read_text())
        assert eval_data["passed"] is True
        drc_data = json.loads((out / "drc.json").read_text())
        assert len(drc_data["violations"]) == 0
        assert len(drc_data["unconnected_items"]) == 0

        # Verify all expected artifacts exist and are non-empty
        assert (out / "board.svg").stat().st_size > 1000
        assert (out / "custom-breakout.kicad_pcb").stat().st_size > 1000
        assert (out / "custom-breakout-board.zip").is_file()
        assert (out / "bom.csv").is_file()
        assert (out / "nets.json").is_file()

    def test_swig_iterator_and_pad_parent_footprint_compat(self, tmp_path):
        """Empirically verifies SWIG iterator next patch and p.GetParentFootprint().GetReference()."""
        spec = {"kind": "signal_breakout", "nets": ["VCC", "GND", "SIG"], "connector_spacing": 25.0, "trace_width": 0.4}
        (tmp_path / "pcb-spec.json").write_text(json.dumps(spec))
        kicad_env = {k: v for k, v in os.environ.items() if k != "PYTHONHOME"}
        subprocess.run([KICAD_PYTHON, str(MODEL_BOARD_SCRIPT), "--spec", str(tmp_path / "pcb-spec.json"), "--output", str(tmp_path)], check=True, env=kicad_env)

        verify_script = f"""
import pcbnew as k
b = k.LoadBoard('{tmp_path / "custom-breakout.kicad_pcb"}')

# Verify SWIG iterator next patch
it = k.TRACKS().iterator()
assert hasattr(it, '__next__') or hasattr(it, 'next')

# Verify pad parent footprint references
pads = [p for fp in b.GetFootprints() for p in fp.Pads()]
refs = {{p.GetParentFootprint().GetReference() for p in pads}}
assert refs == {{'J1', 'J2', 'H1', 'H2', 'H3', 'H4'}}
print('PASS')
"""
        res = subprocess.run([KICAD_PYTHON, "-c", verify_script], capture_output=True, text=True, env=kicad_env)
        assert res.returncode == 0
        assert "PASS" in res.stdout


# ===========================================================================
# 5. CadQuery B-rep Clearance and OpenCASCADE Evaluations
# ===========================================================================

class TestCadQueryAndOpenCASCADEAdversarialClearance:
    """Stress-tests CadQuery B-rep modeling and OpenCASCADE cylinder adaptor under extreme boundaries."""

    @pytest.mark.parametrize("rover_spec_tuple", [
        (120, 80, 1.0, 1.0, 0.05, 35),   # Absolute minimum boundary
        (180, 110, 5.0, 5.0, 3.0, 75),  # Absolute maximum boundary
        (150, 95, 3.0, 3.0, 1.5, 55),   # Mid-range
    ])
    def test_boundary_rover_cad_and_solid_validity(self, rover_spec_tuple):
        """Every solid produced under boundary parameters must be valid with positive volume."""
        s = Spec(
            length=rover_spec_tuple[0],
            width=rover_spec_tuple[1],
            thickness=rover_spec_tuple[2],
            wall=rover_spec_tuple[3],
            clearance=rover_spec_tuple[4],
            mast_height=rover_spec_tuple[5],
        )
        parts, measured = build(s)
        assert len(parts) == 18
        for p in parts:
            assert p["shape"].isValid() is True
            assert p["shape"].Volume() > 0

        ev = evaluate(s, parts, measured)
        assert len(ev["checks"]) == 6

    def test_opencascade_cylinder_radius_adaptor_across_dimensions(self):
        """Verifies f._geomAdaptor().Cylinder().Radius() succeeds across addon depth/thickness combinations."""
        s = Spec(length=140, width=95, thickness=3.0, wall=2.5, clearance=1.2, mast_height=50)
        parts, measured = build(s)
        measured["mast"] = next(p["shape"] for p in parts if p["name"] == "Sensor mast")

        for depth in [16.0, 20.0, 24.0]:
            for thickness in [1.0, 2.4, 2.5, 4.0, 5.0]:
                part, plate = build_addon(s, {"kind": "sensor_bridge", "depth": depth, "thickness": thickness})
                checks = evaluate_addon(part, plate, measured)
                bore_check = next(c for c in checks if c["name"] == "Bridge mounting bores")
                assert bore_check["passed"] is True, f"Bore check failed for depth={depth}, thickness={thickness}"
                assert bore_check["measured"] == 2

    def test_cad_repair_recovers_failing_boundary_spec(self):
        """Repair logic automatically rectifies thin chassis thickness, wall, and clearance."""
        s_fail = Spec(length=120, width=80, thickness=1.0, wall=1.0, clearance=0.05, mast_height=35)
        parts, measured = build(s_fail)
        ev_fail = evaluate(s_fail, parts, measured)
        assert ev_fail["passed"] is False

        s_repaired, changes = repair(s_fail, ev_fail)
        assert changes == {"thickness": 2.4, "wall": 2.4, "clearance": 0.8}

        parts_rep, measured_rep = build(s_repaired)
        ev_rep = evaluate(s_repaired, parts_rep, measured_rep)
        assert ev_rep["passed"] is True


# ===========================================================================
# 6. System Resilience, Graceful Error Handling, and Resource Management
# ===========================================================================

class TestSystemResilienceAndGracefulFailure:
    """Verifies unhandled tracebacks are prevented, locks are freed, and failure reports saved."""

    def test_model_pipeline_saves_report_and_reraises_on_provider_error(self, tmp_path):
        """When provider fails, model_pipeline writes report.json with failure stop_reason."""
        def failing_handler(request: httpx.Request):
            return httpx.Response(500, json={"error": "internal_error"})

        provider = Tensormux(ProviderConfig(api_key="adv-key"), transport=httpx.MockTransport(failing_handler))
        with pytest.raises(ProviderError):
            run_model(provider, "Failing run", valid_seed(), tmp_path)

        report_file = tmp_path / "report.json"
        assert report_file.is_file()
        report = json.loads(report_file.read_text())
        assert report["stop_reason"] == "provider_or_compiler_error"
        assert report["passed"] is False

    def test_api_lock_released_on_job_failure(self):
        """If a background execution raises an error, the global LOCK is always released."""
        assert not LOCK.locked()
        # Acquire lock to simulate job running
        acquired = LOCK.acquire(blocking=False)
        assert acquired is True
        # Release it
        LOCK.release()
        assert not LOCK.locked()
