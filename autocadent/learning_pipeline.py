"""Learning pipeline: records episodic traces, applies learned rules across revisions."""
import time
from .cad import Spec, build, evaluate
from .memory import MemoryStore
from .agents import ReflectionSynthesizer


class LearningPipeline:
    def __init__(self, db_path: str = "learning.db"):
        self.store = MemoryStore(db_path=db_path)
        self.reflector = ReflectionSynthesizer()

    def run_revision(self, spec_dict: dict, revision: int) -> dict:
        adjusted, applied = self.store.apply_heuristics_to_spec(spec_dict)
        spec = Spec(**adjusted)
        start = time.monotonic()
        parts, measured = build(spec)
        result = evaluate(spec, parts, measured)
        duration_ms = (time.monotonic() - start) * 1000

        failed = [c for c in result["checks"] if not c["passed"]]
        status = "SUCCESS" if result["passed"] else "FAILED"

        episode_id = f"rev-{revision}"
        self.store.record_episode(
            episode_id=episode_id,
            revision=revision,
            status=status,
            summary=f"Revision {revision}: {len(failed)} failures" if failed else f"Revision {revision}: all checks pass",
            metrics={
                "duration_ms": round(duration_ms, 1),
                "total_tokens": 0,
                "checks_passed": sum(1 for c in result["checks"] if c["passed"]),
                "checks_total": len(result["checks"]),
                "tool_failures": len(failed),
            },
        )

        if not result["passed"]:
            trace = {"episode_id": episode_id, "revision": revision, "spec": spec_dict, "evaluation": result}
            heuristics = self.reflector.reflect(result, trace)
            for h in heuristics:
                self.store.add_heuristic(h.rule_id, h.category, h.trigger_pattern, h.parameter_override, h.rationale)

        return {"spec": adjusted, "evaluation": result, "applied_rules": len(applied), "status": status}


def run_learning_loop(spec_dict: dict, max_revisions: int = 5, db_path: str = "learning.db") -> dict:
    pipeline = LearningPipeline(db_path=db_path)
    results = []
    for rev in range(1, max_revisions + 1):
        result = pipeline.run_revision(spec_dict, rev)
        results.append(result)
        if result["status"] == "SUCCESS":
            break
    return {"revisions": results, "final_status": results[-1]["status"] if results else "UNKNOWN"}
