"""Reflection agent and sub-agent execution graph for the learning loop."""
from .memory import Heuristic

_CHECK_TO_PARAM = {
    "Chassis thickness": ("thickness", 2.5, "cad_solid", "Chassis plate requires minimum 2.4mm for structural rigidity"),
    "Tray wall": ("wall", 2.5, "cad_solid", "Tray sidewalls require minimum 2.4mm for PCB retention"),
    "Board clearance": ("clearance", 1.0, "cad_solid", "Board-to-wall clearance must exceed 0.8mm for insertion"),
    "Sensor mast height": ("mast_height", 52.0, "cad_solid", "Sensor mast must stay within 35-75mm range"),
}


class ReflectionSynthesizer:
    def reflect(self, evaluation: dict, trace: dict | None = None) -> list[Heuristic]:
        if evaluation.get("passed", False):
            return []

        heuristics: list[Heuristic] = []
        for check in evaluation.get("checks", []):
            if check.get("passed", True):
                continue
            name = check.get("name", "")
            mapping = _CHECK_TO_PARAM.get(name)
            if mapping:
                param_key, override_val, category, rationale = mapping
                heuristics.append(Heuristic(
                    rule_id=f"RULE-{param_key.upper().replace('_', '-')}",
                    category=category,
                    trigger_pattern=f"{name} < {check.get('measured', 'N/A')}",
                    parameter_override={param_key: override_val},
                    rationale=rationale,
                ))

        if not heuristics:
            for check in evaluation.get("checks", []):
                if check.get("passed", True):
                    continue
                name = check.get("name", "")
                for keyword in ("thickness", "wall", "clearance"):
                    if keyword in name.lower():
                        heuristics.append(Heuristic(
                            rule_id=f"RULE-GENERIC-{keyword.upper()}",
                            category="cad_solid",
                            trigger_pattern=f"{name} below threshold",
                            parameter_override={keyword: 2.5 if keyword != "clearance" else 1.0},
                            rationale=f"Auto-synthesized correction for {name}",
                        ))
                        break

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
            {"role": role, "status": "idle"} for role in _DEFAULT_ROLES
        ]
        self._event_log: list[dict] = []

    def get_state(self) -> dict:
        return {"agents": [dict(a) for a in self._agents], "event_log": list(self._event_log)}

    def transition_agent(self, role: str, status: str):
        for agent in self._agents:
            if agent["role"].lower() == role.lower():
                agent["status"] = status
                self._event_log.append({"role": role, "status": status})
                return
        raise ValueError(f"Unknown agent role: {role}")
