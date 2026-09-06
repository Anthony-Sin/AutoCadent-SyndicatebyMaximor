"""Tests for addendum B: contextual rules, confidence, pruning, cache, chat endpoint."""
import json
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from autocadent.memory import MemoryStore, Heuristic
from autocadent.agents import ReflectionSynthesizer
from autocadent.cad import Spec, build, evaluate
import autocadent.api as api

client = TestClient(api.app)


class TestContextualRules:
    def test_heuristic_carries_triggers_and_confidence(self, tmp_path):
        store = MemoryStore(db_path=str(tmp_path / "ctx.db"))
        triggers = [{"tool": "cadquery_build_and_evaluate", "condition": {"thickness": 2.4}}]
        store.add_heuristic("RULE-CTX-1", "cad", "thickness < 2.4",
                            {"thickness": 2.5}, "Structural rigidity",
                            triggers=triggers, confidence=0.8,
                            evidence=[{"episode_id": "ep-1", "snippet": "thickness measured 1.2"}])
        rules = store.get_active_heuristics()
        assert len(rules) == 1
        r = rules[0]
        assert r.confidence == 0.8
        assert len(r.triggers) == 1
        assert r.triggers[0]["tool"] == "cadquery_build_and_evaluate"
        assert len(r.evidence) == 1
        assert r.evidence[0]["episode_id"] == "ep-1"

    def test_help_hurt_counters_update(self, tmp_path):
        store = MemoryStore(db_path=str(tmp_path / "counters.db"))
        store.add_heuristic("RULE-CNT-1", "cad", "wall < 2.4", {"wall": 2.5}, "Wall fix")
        store.update_outcome("RULE-CNT-1", helped=True)
        store.update_outcome("RULE-CNT-1", helped=True)
        store.update_outcome("RULE-CNT-1", helped=False)
        rules = store.get_active_heuristics()
        r = rules[0]
        assert r.times_applied == 3
        assert r.times_helped == 2
        assert r.times_hurt == 1
        assert 0 < r.confidence < 1


class TestTopKRetrieval:
    def test_retrieve_top_k_by_confidence(self, tmp_path):
        store = MemoryStore(db_path=str(tmp_path / "topk.db"))
        store.add_heuristic("R1", "cad", "t1", {"thickness": 2.5}, "Low", confidence=0.3)
        store.add_heuristic("R2", "cad", "t2", {"wall": 2.5}, "Mid", confidence=0.7)
        store.add_heuristic("R3", "cad", "t3", {"clearance": 1.0}, "High", confidence=0.9)
        top = store.retrieve_top_k(k=2)
        assert len(top) == 2
        assert top[0].rule_id == "R3"
        assert top[1].rule_id == "R2"

    def test_retrieval_with_context_matching(self, tmp_path):
        store = MemoryStore(db_path=str(tmp_path / "match.db"))
        store.add_heuristic("R-THICK", "cad", "thickness < 2.4", {"thickness": 2.5},
                            "Thick", triggers=[{"tool": "cadquery_build_and_evaluate",
                                                "condition": {"thickness": 2.4}}],
                            confidence=0.8)
        store.add_heuristic("R-WALL", "cad", "wall < 2.4", {"wall": 2.5},
                            "Wall", triggers=[{"tool": "kicad_drc"}],
                            confidence=0.8)
        ctx = {"tool": "cadquery_build_and_evaluate", "thickness": 1.2}
        top = store.retrieve_top_k(context=ctx, k=2)
        assert top[0].rule_id == "R-THICK"


class TestPruning:
    def test_low_help_rate_pruned(self, tmp_path):
        store = MemoryStore(db_path=str(tmp_path / "prune.db"))
        store.add_heuristic("R-GOOD", "cad", "t1", {"thickness": 2.5}, "Good")
        store.add_heuristic("R-BAD", "cad", "t2", {"wall": 2.5}, "Bad")
        for _ in range(5):
            store.update_outcome("R-GOOD", helped=True)
            store.update_outcome("R-BAD", helped=False)
        pruned = store.prune_rules(min_applied=3, min_help_rate=0.3)
        assert "R-BAD" in pruned
        assert "R-GOOD" not in pruned
        active = store.get_active_heuristics()
        active_ids = [r.rule_id for r in active]
        assert "R-GOOD" in active_ids
        assert "R-BAD" not in active_ids

    def test_no_prune_below_min_applied(self, tmp_path):
        store = MemoryStore(db_path=str(tmp_path / "noprune.db"))
        store.add_heuristic("R-NEW", "cad", "t", {"thickness": 2.5}, "New")
        store.update_outcome("R-NEW", helped=False)
        pruned = store.prune_rules(min_applied=3)
        assert pruned == []


class TestToolCache:
    def test_cache_miss_then_hit(self, tmp_path):
        store = MemoryStore(db_path=str(tmp_path / "cache.db"))
        args = {"thickness": 1.2, "wall": 1.2}
        assert store.cache_get("cad_build", args) is None
        store.cache_put("cad_build", args, {"passed": False, "checks": 3})
        result = store.cache_get("cad_build", args)
        assert result is not None
        assert result["passed"] is False
        stats = store.cache_stats()
        assert stats["entries"] == 1
        assert stats["total_hits"] == 1

    def test_cache_different_args_miss(self, tmp_path):
        store = MemoryStore(db_path=str(tmp_path / "cachemiss.db"))
        store.cache_put("cad_build", {"thickness": 1.2}, {"result": "a"})
        assert store.cache_get("cad_build", {"thickness": 2.5}) is None
        assert store.cache_get("cad_build", {"thickness": 1.2}) is not None


class TestChatEndpoint:
    def test_chat_returns_envelope(self):
        res = client.post("/api/agent/chat", json={"message": "show rules"})
        assert res.status_code == 200
        data = res.json()
        assert "reply" in data
        assert "cards" in data
        assert "chips" in data
        assert "citations" in data
        assert isinstance(data["cards"], list)
        assert isinstance(data["chips"], list)
        assert isinstance(data["citations"], list)

    def test_chat_never_fabricates_rule(self):
        res = client.post("/api/agent/chat", json={"message": "show rules"})
        data = res.json()
        for c in data["citations"]:
            if c["kind"] == "rule":
                rule_res = client.get("/api/learning/memory")
                rule_ids = [r["rule_id"] for r in rule_res.json()]
                assert c["id"] in rule_ids or len(rule_res.json()) == 0

    def test_chat_card_types_valid(self):
        client.post("/api/agent/chat", json={"message": "show episodes"})
        res = client.post("/api/agent/chat", json={"message": "show agent graph"})
        data = res.json()
        valid_types = {"graph", "curves", "memory", "episode", "rule"}
        for card in data["cards"]:
            assert card["type"] in valid_types

    def test_chat_rejects_empty_message(self):
        res = client.post("/api/agent/chat", json={"message": ""})
        assert res.status_code == 422


class TestCausalReflection:
    def test_reflection_produces_evidence(self):
        from tests.fixtures.learning_data import SAMPLE_FAILED_EVALUATION
        reflector = ReflectionSynthesizer()
        trace = {"episode_id": "ep-causal", "revision": 1}
        rules = reflector.reflect(SAMPLE_FAILED_EVALUATION, trace)
        assert len(rules) >= 3
        for r in rules:
            assert r.rationale, "Causal rule must have rationale"
            assert len(r.evidence) > 0, "Causal rule must have evidence"
            assert r.evidence[0]["episode_id"] == "ep-causal"
            assert r.confidence > 0

    def test_reflection_passing_produces_nothing(self):
        from tests.fixtures.learning_data import SAMPLE_PASSING_EVALUATION
        reflector = ReflectionSynthesizer()
        rules = reflector.reflect(SAMPLE_PASSING_EVALUATION, {})
        assert rules == []


class TestBenchmarkEvidence:
    def test_benchmark_names_retrieved_rules(self):
        import scripts.verify_learning_loop as bench
        report = bench.run_benchmark(max_revisions=3)
        assert report["passed"] is True
        assert report["results"][0]["status"] == "FAILED"
        later = report["results"][1:]
        assert all(r["first_pass_pass"] for r in later)
        last = report["results"][-1]
        assert "retrieved_rule_ids" in last
        assert len(last["retrieved_rule_ids"]) > 0
        assert "memory_size" in last
        assert "cache_hits" in last
        assert report["cost_effectiveness"]["provenance"] == "synthetic_estimate"
        assert report["cost_effectiveness"]["actual_tokens"] is None
