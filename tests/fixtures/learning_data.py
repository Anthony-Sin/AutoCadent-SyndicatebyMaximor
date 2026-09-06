"""Sample specifications, failure traces, evaluations, and PCB schemas for E2E tests."""

SAMPLE_NAIVE_SPEC = {
    "length": 140.0,
    "width": 90.0,
    "thickness": 1.2,
    "wall": 1.2,
    "clearance": 0.1,
    "mast_height": 52.0,
}

SAMPLE_PASSING_SPEC = {
    "length": 140.0,
    "width": 90.0,
    "thickness": 2.5,
    "wall": 2.5,
    "clearance": 1.0,
    "mast_height": 52.0,
}

SAMPLE_GENERALIZED_SPEC = {
    "length": 160.0,
    "width": 105.0,
    "thickness": 2.5,
    "wall": 2.5,
    "clearance": 1.0,
    "mast_height": 65.0,
}

SAMPLE_PCB_SPEC = {
    "kind": "signal_breakout",
    "nets": ["VCC", "GND", "SDA", "SCL"],
    "connector_spacing": 26.0,
    "trace_width": 0.4,
}

SAMPLE_PCB_DRC_FAILURE_SPEC = {
    "kind": "signal_breakout",
    "nets": ["VCC", "GND", "SDA", "SCL"],
    "connector_spacing": 39.0,  # exceeds 38mm max bound, encroaching on M3 mounting holes
    "trace_width": 0.4,
}

SAMPLE_FAILED_EVALUATION = {
    "passed": False,
    "checks": [
        {"name": "Solid validity", "measured": 18, "requirement": "18 valid solids", "passed": True, "unit": "solids"},
        {"name": "Chassis thickness", "measured": 1.2, "requirement": "≥ 2.4 mm", "passed": False, "unit": "mm"},
        {"name": "Tray wall", "measured": 1.2, "requirement": "≥ 2.4 mm", "passed": False, "unit": "mm"},
        {"name": "Board clearance", "measured": 0.1, "requirement": "≥ 0.8 mm", "passed": False, "unit": "mm"},
        {"name": "Chassis length", "measured": 140.0, "requirement": "140 ± 0.01 mm", "passed": True, "unit": "mm"},
        {"name": "Tray edge margin", "measured": 23.4, "requirement": "≥ 4 mm", "passed": True, "unit": "mm"},
    ],
}

SAMPLE_PASSING_EVALUATION = {
    "passed": True,
    "checks": [
        {"name": "Solid validity", "measured": 18, "requirement": "18 valid solids", "passed": True, "unit": "solids"},
        {"name": "Chassis thickness", "measured": 2.5, "requirement": "≥ 2.4 mm", "passed": True, "unit": "mm"},
        {"name": "Tray wall", "measured": 2.5, "requirement": "≥ 2.4 mm", "passed": True, "unit": "mm"},
        {"name": "Board clearance", "measured": 1.0, "requirement": "≥ 0.8 mm", "passed": True, "unit": "mm"},
        {"name": "Chassis length", "measured": 140.0, "requirement": "140 ± 0.01 mm", "passed": True, "unit": "mm"},
        {"name": "Tray edge margin", "measured": 23.4, "requirement": "≥ 4 mm", "passed": True, "unit": "mm"},
    ],
}

SAMPLE_EPISODIC_TRACE = {
    "episode_id": "ep-test-rev1",
    "session_id": "sess-test",
    "project_id": "rove1",
    "revision": 1,
    "task_description": "Educational rover with sensor mast and connector board",
    "status": "FAILED",
    "duration_ms": 3200.0,
    "token_telemetry": {
        "prompt_tokens": 1500,
        "completion_tokens": 350,
        "total_tokens": 1850,
        "cost_usd": 0.000925,
    },
    "tool_invocations": [
        {
            "call_id": "call-001",
            "agent_role": "CAD Specialist",
            "tool_name": "cadquery_build_and_evaluate",
            "inputs": SAMPLE_NAIVE_SPEC,
            "output": {"passed": False, "failed_checks": ["Chassis thickness", "Tray wall", "Board clearance"]},
            "duration_ms": 750.0,
            "tokens": 400,
            "status": "CONSTRAINT_FAILURE",
        },
        {
            "call_id": "call-002",
            "agent_role": "PCB Specialist",
            "tool_name": "kicad_model_board",
            "inputs": SAMPLE_PCB_SPEC,
            "output": {"passed": True, "drc_violations": 0},
            "duration_ms": 1900.0,
            "tokens": 350,
            "status": "SUCCESS",
        },
    ],
    "evaluation": SAMPLE_FAILED_EVALUATION,
}
