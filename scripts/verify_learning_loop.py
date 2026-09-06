"""Multi-revision benchmark: verifies the learning engine converges from cold to 6/6 pass.

Emits per-revision: first-pass success, iterations-to-pass, estimated tokens, latency,
cache hits, memory size, rules acquired, rules pruned, and retrieved rule IDs.
"""
import argparse
import json
import os
import signal
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from autocadent.cad import Spec, build, evaluate
from autocadent.memory import MemoryStore
from autocadent.agents import ReflectionSynthesizer


NAIVE_SPEC = {
    "length": 140.0, "width": 90.0,
    "thickness": 1.2, "wall": 1.2, "clearance": 0.1, "mast_height": 52.0,
}


REV_TIMEOUT_S = int(os.environ.get("BENCHMARK_REV_TIMEOUT", "120"))

def run_benchmark(db_path: str | None = None, max_revisions: int = 5) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        db = db_path or str(Path(tmp) / "benchmark.db")
        store = MemoryStore(db_path=db)
        reflector = ReflectionSynthesizer()

        results = []
        total_cache_hits = 0
        total_pruned = 0

        for rev in range(1, max_revisions + 1):
            start = time.monotonic()

            context = {"tool": "cadquery_build_and_evaluate", **NAIVE_SPEC}
            retrieved_rules = store.retrieve_top_k(context=context, k=10)
            retrieved_ids = [r.rule_id for r in retrieved_rules]

            cache_result = store.cache_get("cad_build", NAIVE_SPEC)
            if cache_result:
                total_cache_hits += 1
                adjusted = cache_result["spec"]
                parts, measured = build(Spec(**adjusted))
                result = evaluate(Spec(**adjusted), parts, measured)
            else:
                adjusted, applied = store.apply_heuristics_to_spec(NAIVE_SPEC, context=context)
                spec = Spec(**adjusted)
                parts, measured = build(spec)
                result = evaluate(spec, parts, measured)
                if result["passed"]:
                    store.cache_put("cad_build", NAIVE_SPEC, {"spec": adjusted})

            duration_ms = (time.monotonic() - start) * 1000
            passed = sum(1 for c in result["checks"] if c["passed"])
            total = len(result["checks"])
            status = "SUCCESS" if result["passed"] else "FAILED"

            if duration_ms > REV_TIMEOUT_S * 1000:
                status = "TIMEOUT"
                results.append({
                    "revision": rev, "status": status,
                    "first_pass_pass": False,
                    "checks_passed": passed, "checks_total": total,
                    "duration_ms": round(duration_ms, 1),
                    "estimated_total_tokens": 0,
                    "token_provenance": "synthetic_estimate",
                    "tool_failures": 0,
                    "retrieved_rule_ids": [],
                    "rules_applied": 0, "rules_acquired": 0, "rules_pruned": 0,
                    "memory_size": 0, "cache_hits": total_cache_hits,
                    "timeout": True,
                })
                break

            est_prompt = 400 if not retrieved_rules else max(50, 400 - len(retrieved_rules) * 30)
            est_completion = 120
            episode_id = f"bench-rev-{rev}"
            metrics = {
                "duration_ms": round(duration_ms, 1),
                "prompt_tokens": None,
                "completion_tokens": None,
                "total_tokens": None,
                "estimated_prompt_tokens": est_prompt,
                "estimated_completion_tokens": est_completion,
                "estimated_total_tokens": est_prompt + est_completion,
                "token_provenance": "synthetic_estimate",
                "checks_passed": passed,
                "checks_total": total,
                "tool_calls": 1,
                "tool_failures": total - passed,
            }
            store.record_episode(episode_id, rev, status, f"Benchmark revision {rev}", metrics)

            rules_acquired = 0
            if not result["passed"]:
                trace = {"episode_id": episode_id, "revision": rev, "evaluation": result}
                heuristics = reflector.reflect(result, trace)
                for h in heuristics:
                    store.add_heuristic(h.rule_id, h.category, h.trigger_pattern,
                                        h.parameter_override, h.rationale,
                                        triggers=h.triggers, confidence=h.confidence,
                                        evidence=h.evidence)
                    rules_acquired += 1
                for r in retrieved_rules:
                    if r.rule_id in retrieved_ids:
                        store.update_outcome(r.rule_id, helped=result["passed"])

            pruned = store.prune_rules(min_applied=3, min_help_rate=0.3) if result["passed"] else []
            total_pruned += len(pruned)
            mem_stats = store.get_memory_stats()

            results.append({
                "revision": rev, "status": status,
                "first_pass_pass": result["passed"],
                "checks_passed": passed, "checks_total": total,
                "duration_ms": round(duration_ms, 1),
                "estimated_total_tokens": est_prompt + est_completion,
                "token_provenance": "synthetic_estimate",
                "tool_failures": total - passed,
                "retrieved_rule_ids": retrieved_ids,
                "rules_applied": len(retrieved_rules),
                "rules_acquired": rules_acquired,
                "rules_pruned": len(pruned),
                "memory_size": mem_stats["active_rules"],
                "cache_hits": total_cache_hits,
            })

            if result["passed"]:
                break

        telemetry_path = str(Path(tmp) / "benchmark_telemetry.json")
        bank_path = str(Path(tmp) / "benchmark_bank.json")
        store.export_json(telemetry_path, bank_path)
        telemetry = json.loads(Path(telemetry_path).read_text())
        bank = json.loads(Path(bank_path).read_text())

    final = results[-1]
    return {
        "passed": final["checks_passed"] == 6,
        "revisions": len(results),
        "final_checks": f"{final['checks_passed']}/{final['checks_total']}",
        "results": results,
        "telemetry": telemetry,
        "memory_bank": bank,
        "cost_effectiveness": {
            "provenance": "synthetic_estimate",
            "cold_estimated_tokens": results[0]["estimated_total_tokens"] if results else 0,
            "warm_estimated_tokens": results[-1]["estimated_total_tokens"] if results else 0,
            "estimated_token_reduction_pct": (
                round((1 - results[-1]["estimated_total_tokens"] / results[0]["estimated_total_tokens"]) * 100, 1)
                if results and results[0]["estimated_total_tokens"] > 0 else 0
            ),
            "actual_tokens": None,
            "note": "No LLM provider integrated; estimates are structural placeholders based on rule application state",
        },
        "learning_evidence": {
            "rev1_failed": results[0]["status"] == "FAILED" if results else False,
            "later_revs_pass_first_try": all(r["first_pass_pass"] for r in results[1:]) if len(results) > 1 else False,
            "retrieved_rule_ids": results[-1].get("retrieved_rule_ids", []) if results else [],
            "total_cache_hits": total_cache_hits,
            "total_rules_pruned": total_pruned,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="AutoCadent learning loop benchmark")
    parser.add_argument("--revisions", type=int, default=5, help="Max revisions")
    parser.add_argument("--db", type=str, default=None, help="SQLite DB path")
    args = parser.parse_args()

    report = run_benchmark(db_path=args.db, max_revisions=args.revisions)
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
