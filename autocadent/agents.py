"""Self-reflection agent and sub-agent execution graph."""
import time
import uuid
from .memory import Heuristic

_CHECK_REPAIR_MAP = {
    "Chassis thickness": {
        "key": "thickness",
        "min_value": 2.5,
        "category": "cad_solid",
        "rationale": "Chassis plate requires minimum 2.4mm for structural rigidity",
    },
    "Tray wall": {
        "key": "wall",
        "min_value": 2.5,
        "category": "cad_solid",
        "rationale": "Tray walls require minimum 2.4mm to withstand assembly loads",
    },
    "Board clearance": {
        "key": "clearance",
        "min_value": 1.0,
        "category": "cad_solid",
        "rationale": "Board clearance must exceed 0.8mm to prevent short circuits against tray walls",
    },
}


class ReflectionSynthesizer:
    def reflect(self, evaluation: dict, trace: dict | None = None) -> list[Heuristic]:
        if evaluation.get("passed", False):
            return []

        heuristics = []
        for check in evaluation.get("checks", []):
            if check.get("passed", True):
                continue
            name = check.get("name", "")
            repair_info = _CHECK_REPAIR_MAP.get(name)
            if repair_info:
                key = repair_info["key"]
                rule_id = f"RULE-{key.upper()}-{uuid.uuid4().hex[:6]}"
                heuristics.append(Heuristic(
                    rule_id=rule_id,
                    category=repair_info["category"],
                    trigger_pattern=f"{name} < {repair_info['min_value']}",
                    parameter_override={key: repair_info["min_value"]},
                    parameter_key=key,
                    rationale=repair_info["rationale"],
                ))

        if not heuristics:
            for check in evaluation.get("checks", []):
                if check.get("passed", True):
                    continue
                name = check.get("name", "")
                measured = check.get("measured", 0)
                key = name.lower().replace(" ", "_")
                heuristics.append(Heuristic(
                    rule_id=f"RULE-{key.upper()}-{uuid.uuid4().hex[:6]}",
                    category="general",
                    trigger_pattern=f"{name} below requirement",
                    parameter_override={key: measured * 1.5},
                    parameter_key=key,
                    rationale=f"Auto-synthesized correction for {name}",
                ))

        return heuristics


_DEFAULT_ROLES = [
    "Orchestrator",
    "CAD Specialist",
    "PCB Specialist",
    "Verifier",
    "Reflection Synthesizer",
]


class SubAgentGraph:
    def __init__(self):
        self._agents = [
            {"role": role, "status": "idle", "events": []}
            for role in _DEFAULT_ROLES
        ]

    def get_state(self) -> dict:
        return {"agents": [dict(a) for a in self._agents]}

    def transition_agent(self, role: str, status: str):
        for agent in self._agents:
            if agent["role"] == role:
                agent["status"] = status
                agent["events"].append({
                    "status": status,
                    "timestamp": time.time(),
                })
                return
        raise KeyError(f"Unknown agent role: {role}")
