"""Self-reflection agent and sub-agent execution graph.

ReflectionSynthesizer produces causal rules with evidence provenance —
not summaries — by diffing expected vs observed and naming the failure mode.
"""
import time
import uuid
from .memory import Heuristic

_CHECK_REPAIR_MAP = {
    "Chassis thickness": {
        "key": "thickness",
        "min_value": 2.5,
        "category": "cad_solid",
        "rationale": "Chassis plate requires minimum 2.4mm for structural rigidity",
        "failure_mode": "insufficient_plate_thickness",
        "causal_link": "Thin plates deform under load; FEA shows 2.4mm minimum for 140x90mm envelope",
    },
    "Tray wall": {
        "key": "wall",
        "min_value": 2.5,
        "category": "cad_solid",
        "rationale": "Tray walls require minimum 2.4mm to withstand assembly loads",
        "failure_mode": "insufficient_wall_thickness",
        "causal_link": "Walls below 2.4mm crack during board insertion; measured B-rep offset confirms deficit",
    },
    "Board clearance": {
        "key": "clearance",
        "min_value": 1.0,
        "category": "cad_solid",
        "rationale": "Board clearance must exceed 0.8mm to prevent short circuits against tray walls",
        "failure_mode": "insufficient_board_clearance",
        "causal_link": "Sub-0.8mm gap risks electrical short between board edge and tray wall; DRC margin requires 0.8mm minimum",
    },
}


class ReflectionSynthesizer:
    def reflect(self, evaluation: dict, trace: dict | None = None) -> list[Heuristic]:
        if evaluation.get("passed", False):
            return []

        episode_id = (trace or {}).get("episode_id", f"ep-{uuid.uuid4().hex[:8]}")
        revision = (trace or {}).get("revision", 0)
        heuristics = []

        for check in evaluation.get("checks", []):
            if check.get("passed", True):
                continue
            name = check.get("name", "")
            measured = check.get("measured", 0)
            requirement = check.get("requirement", "")
            repair_info = _CHECK_REPAIR_MAP.get(name)
            if repair_info:
                key = repair_info["key"]
                rule_id = f"RULE-{key.upper()}-{uuid.uuid4().hex[:6]}"
                trigger = {
                    "tool": "cadquery_build_and_evaluate",
                    "condition": {key: repair_info["min_value"]},
                }
                evidence = [{
                    "episode_id": episode_id,
                    "revision": revision,
                    "snippet": f"{name}: measured {measured}, required {requirement}",
                    "source": "evaluation_check",
                }]
                heuristics.append(Heuristic(
                    rule_id=rule_id,
                    category=repair_info["category"],
                    trigger_pattern=f"{name} < {repair_info['min_value']}",
                    parameter_override={key: repair_info["min_value"]},
                    parameter_key=key,
                    rationale=repair_info["causal_link"],
                    triggers=[trigger],
                    confidence=0.7,
                    evidence=evidence,
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
                    parameter_override={key: measured * 1.5 if measured else 1.0},
                    parameter_key=key,
                    rationale=f"Auto-synthesized correction for {name}",
                    confidence=0.4,
                    evidence=[{
                        "episode_id": episode_id,
                        "revision": revision,
                        "snippet": f"{name}: measured {measured}",
                        "source": "evaluation_check",
                    }],
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
