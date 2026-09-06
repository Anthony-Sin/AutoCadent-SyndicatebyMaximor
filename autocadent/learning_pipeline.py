"""Learning pipeline: records episodic traces and applies learned rules across revisions."""
import time
from .cad import Spec, build, evaluate, repair
from .memory import MemoryStore
from .agents import ReflectionSynthesizer


class LearningPipeline:
    def __init__(self, db_path: str = "learning.db"):
        self.store = MemoryStore(db_path=db_path)
        self.reflector = ReflectionSynthesizer()
        self.revision = 0

    def run_revision(self, spec_dict: dict, episode_prefix: str = "ep") -> dict:
        self.revision += 1
        start = time.monotonic()

        adjusted_spec_dict, applied_rules = self.store.apply_heuristics_to_spec(spec_dict)
        spec = Spec(**adjusted_spec_dict)
        parts, measured = build(spec)
        result = evaluate(spec, parts, measured)

        failed_checks = [c for c in result["checks"] if not c["passed"]]
        status = "SUCCESS" if result["passed"] else "FAILED"
        duration_ms = (time.monotonic() - start) * 1000

        episode_id = f"{episode_prefix}-{self.revision}"
        est_prompt = 400 if not applied_rules else 200
        est_completion = 120
        metrics = {
            "duration_ms": round(duration_ms, 1),
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "estimated_prompt_tokens": est_prompt,
            "estimated_completion_tokens": est_completion,
            "estimated_total_tokens": est_prompt + est_completion,
            "token_provenance": "synthetic_estimate",
            "checks_passed": sum(1 for c in result["checks"] if c["passed"]),
            "checks_total": len(result["checks"]),
            "tool_calls": 1,
            "tool_failures": len(failed_checks),
            "rules_applied": len(applied_rules),
        }
        self.store.record_episode(episode_id, self.revision, status,
                                  f"Revision {self.revision}", metrics)

        if not result["passed"]:
            trace = {
                "episode_id": episode_id,
                "revision": self.revision,
                "spec": spec_dict,
                "evaluation": result,
                "duration_ms": duration_ms,
                "estimated_total_tokens": metrics["estimated_total_tokens"],
                "token_provenance": "synthetic_estimate",
            }
            heuristics = self.reflector.reflect(result, trace)
            for h in heuristics:
                self.store.add_heuristic(
                    h.rule_id, h.category, h.trigger_pattern,
                    h.parameter_override, h.rationale,
                )

        return {
            "episode_id": episode_id,
            "revision": self.revision,
            "status": status,
            "evaluation": result,
            "metrics": metrics,
            "applied_rules": len(applied_rules),
        }


def run_learning_loop(spec_dict: dict, max_revisions: int = 5,
                      db_path: str = "learning.db") -> list[dict]:
    pipeline = LearningPipeline(db_path=db_path)
    results = []
    for _ in range(max_revisions):
        result = pipeline.run_revision(spec_dict)
        results.append(result)
        if result["status"] == "SUCCESS":
            break
    return results
