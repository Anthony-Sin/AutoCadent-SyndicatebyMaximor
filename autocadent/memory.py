"""Structured persistent memory for the learning engine. SQLite-backed.

Supports contextual multi-predicate rules with confidence, evidence provenance,
help/hurt counters, top-k retrieval, pruning, and a tool-result cache.
"""
import hashlib
import json
import sqlite3
import threading
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Heuristic:
    rule_id: str
    category: str
    trigger_pattern: str
    parameter_override: dict = field(default_factory=dict)
    parameter_key: str = ""
    rationale: str = ""
    triggers: list[dict] = field(default_factory=list)
    confidence: float = 0.5
    evidence: list[dict] = field(default_factory=list)
    times_applied: int = 0
    times_helped: int = 0
    times_hurt: int = 0
    active: bool = True

    def __post_init__(self):
        if not self.parameter_key and self.parameter_override:
            self.parameter_key = next(iter(self.parameter_override))

    @property
    def help_rate(self) -> float:
        if self.times_applied == 0:
            return self.confidence
        return self.times_helped / self.times_applied


@dataclass
class EpisodicTrace:
    episode_id: str
    revision: int
    status: str
    summary: str = ""
    metrics: dict = field(default_factory=dict)


class MemoryStore:
    def __init__(self, db_path: str = "memory.db"):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _init_db(self):
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS episodes (
                        episode_id TEXT PRIMARY KEY,
                        revision INTEGER,
                        status TEXT,
                        summary TEXT DEFAULT '',
                        metrics_json TEXT DEFAULT '{}'
                    );
                    CREATE TABLE IF NOT EXISTS tool_invocations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        episode_id TEXT,
                        tool_name TEXT,
                        inputs_json TEXT DEFAULT '{}',
                        output_json TEXT DEFAULT '{}',
                        latency_ms REAL DEFAULT 0,
                        tokens INTEGER DEFAULT 0,
                        status TEXT DEFAULT '',
                        FOREIGN KEY (episode_id) REFERENCES episodes(episode_id)
                    );
                    CREATE TABLE IF NOT EXISTS heuristics (
                        rule_id TEXT PRIMARY KEY,
                        category TEXT DEFAULT '',
                        trigger_pattern TEXT DEFAULT '',
                        parameter_override_json TEXT DEFAULT '{}',
                        parameter_key TEXT DEFAULT '',
                        rationale TEXT DEFAULT '',
                        active INTEGER DEFAULT 1,
                        triggers_json TEXT DEFAULT '[]',
                        confidence REAL DEFAULT 0.5,
                        evidence_json TEXT DEFAULT '[]',
                        times_applied INTEGER DEFAULT 0,
                        times_helped INTEGER DEFAULT 0,
                        times_hurt INTEGER DEFAULT 0
                    );
                    CREATE TABLE IF NOT EXISTS tool_cache (
                        cache_key TEXT PRIMARY KEY,
                        tool_name TEXT,
                        args_hash TEXT,
                        result_json TEXT DEFAULT '{}',
                        created_at REAL,
                        hit_count INTEGER DEFAULT 0
                    );
                """)
                conn.commit()
                self._migrate_columns(conn)
            finally:
                conn.close()

    def _migrate_columns(self, conn):
        existing = {row[1] for row in conn.execute("PRAGMA table_info(heuristics)").fetchall()}
        additions = {
            "triggers_json": "TEXT DEFAULT '[]'",
            "confidence": "REAL DEFAULT 0.5",
            "evidence_json": "TEXT DEFAULT '[]'",
            "times_applied": "INTEGER DEFAULT 0",
            "times_helped": "INTEGER DEFAULT 0",
            "times_hurt": "INTEGER DEFAULT 0",
        }
        for col, ddl in additions.items():
            if col not in existing:
                conn.execute(f"ALTER TABLE heuristics ADD COLUMN {col} {ddl}")
        conn.commit()

    def record_episode(self, episode_id: str, revision: int, status: str,
                       summary: str = "", metrics: dict | None = None):
        metrics = metrics or {}
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO episodes (episode_id, revision, status, summary, metrics_json) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (episode_id, revision, status, summary, json.dumps(metrics)),
                )
                conn.commit()
            finally:
                conn.close()

    def record_tool_invocation(self, episode_id: str, tool_name: str,
                                inputs: dict | None = None, output: dict | None = None,
                                latency_ms: float = 0, tokens: int = 0, status: str = ""):
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT INTO tool_invocations (episode_id, tool_name, inputs_json, output_json, "
                    "latency_ms, tokens, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (episode_id, tool_name, json.dumps(inputs or {}),
                     json.dumps(output or {}), latency_ms, tokens, status),
                )
                conn.commit()
            finally:
                conn.close()

    def add_heuristic(self, rule_id: str, category: str, trigger_pattern: str,
                      parameter_override: dict | None = None, rationale: str = "",
                      triggers: list[dict] | None = None, confidence: float = 0.5,
                      evidence: list[dict] | None = None):
        parameter_override = parameter_override or {}
        parameter_key = next(iter(parameter_override)) if parameter_override else ""
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO heuristics "
                    "(rule_id, category, trigger_pattern, parameter_override_json, parameter_key, "
                    "rationale, active, triggers_json, confidence, evidence_json, "
                    "times_applied, times_helped, times_hurt) "
                    "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, 0, 0)",
                    (rule_id, category, trigger_pattern,
                     json.dumps(parameter_override), parameter_key, rationale,
                     json.dumps(triggers or []), confidence, json.dumps(evidence or [])),
                )
                conn.commit()
            finally:
                conn.close()

    def get_active_heuristics(self, category: str | None = None) -> list[Heuristic]:
        with self._lock:
            conn = self._connect()
            try:
                base = ("SELECT rule_id, category, trigger_pattern, parameter_override_json, "
                        "parameter_key, rationale, triggers_json, confidence, evidence_json, "
                        "times_applied, times_helped, times_hurt FROM heuristics WHERE active = 1")
                if category:
                    rows = conn.execute(base + " AND category = ?", (category,)).fetchall()
                else:
                    rows = conn.execute(base).fetchall()
                return [self._row_to_heuristic(r) for r in rows]
            finally:
                conn.close()

    def _row_to_heuristic(self, r) -> Heuristic:
        return Heuristic(
            rule_id=r[0], category=r[1], trigger_pattern=r[2],
            parameter_override=json.loads(r[3]),
            parameter_key=r[4], rationale=r[5],
            triggers=json.loads(r[6]),
            confidence=r[7],
            evidence=json.loads(r[8]),
            times_applied=r[9], times_helped=r[10], times_hurt=r[11],
        )

    def retrieve_top_k(self, context: dict | None = None, k: int = 5,
                       category: str | None = None) -> list[Heuristic]:
        candidates = self.get_active_heuristics(category=category)
        if not candidates:
            return []
        if context is None:
            candidates.sort(key=lambda h: h.confidence, reverse=True)
            return candidates[:k]

        scored = []
        for h in candidates:
            match_score = self._match_triggers(h, context)
            if match_score > 0 or not h.triggers:
                trigger_match = match_score if h.triggers else 0.5
                score = h.confidence * 0.6 + trigger_match * 0.4
                scored.append((score, h))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [h for _, h in scored[:k]]

    def _match_triggers(self, h: Heuristic, context: dict) -> float:
        if not h.triggers:
            if h.trigger_pattern:
                pattern_lower = h.trigger_pattern.lower()
                context_str = json.dumps(context).lower()
                keywords = [w for w in pattern_lower.replace("<", " ").replace(">", " ").split() if len(w) > 2]
                if keywords and any(kw in context_str for kw in keywords):
                    return 0.7
            return 0.0

        matched = 0
        for trigger in h.triggers:
            tool_match = True
            if "tool" in trigger:
                tool_match = context.get("tool") == trigger["tool"] or \
                             trigger["tool"] in str(context.get("tool_name", ""))
            condition_match = True
            if "condition" in trigger:
                cond = trigger["condition"]
                for key, threshold in cond.items():
                    val = context.get(key)
                    if val is not None and isinstance(val, (int, float)) and isinstance(threshold, (int, float)):
                        if val >= threshold:
                            condition_match = False
            if tool_match and condition_match:
                matched += 1
        return matched / len(h.triggers) if h.triggers else 0.0

    def update_outcome(self, rule_id: str, helped: bool):
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT times_applied, times_helped, times_hurt, confidence FROM heuristics WHERE rule_id = ?",
                    (rule_id,),
                ).fetchone()
                if not row:
                    return
                applied, helped_count, hurt_count, conf = row
                applied += 1
                if helped:
                    helped_count += 1
                else:
                    hurt_count += 1
                new_conf = min(0.99, conf + (0.05 if helped else -0.1))
                new_conf = max(0.01, new_conf)
                conn.execute(
                    "UPDATE heuristics SET times_applied=?, times_helped=?, times_hurt=?, confidence=? "
                    "WHERE rule_id=?",
                    (applied, helped_count, hurt_count, new_conf, rule_id),
                )
                conn.commit()
            finally:
                conn.close()

    def prune_rules(self, min_applied: int = 3, min_help_rate: float = 0.3) -> list[str]:
        pruned = []
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    "SELECT rule_id, times_applied, times_helped, confidence FROM heuristics WHERE active = 1"
                ).fetchall()
                for rule_id, applied, helped, conf in rows:
                    if applied >= min_applied:
                        rate = helped / applied if applied > 0 else 0
                        if rate < min_help_rate:
                            conn.execute(
                                "UPDATE heuristics SET active = 0 WHERE rule_id = ?", (rule_id,)
                            )
                            pruned.append(rule_id)
                conn.commit()
            finally:
                conn.close()
        return pruned

    def cache_get(self, tool_name: str, args: dict, version: str = "") -> dict | None:
        args_hash = hashlib.sha256(json.dumps(args, sort_keys=True).encode()).hexdigest()
        cache_key = f"{tool_name}:{version}:{args_hash}"
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT result_json FROM tool_cache WHERE cache_key = ?", (cache_key,)
                ).fetchone()
                if row:
                    conn.execute(
                        "UPDATE tool_cache SET hit_count = hit_count + 1 WHERE cache_key = ?",
                        (cache_key,),
                    )
                    conn.commit()
                    return json.loads(row[0])
                return None
            finally:
                conn.close()

    def cache_put(self, tool_name: str, args: dict, result: dict, version: str = ""):
        import time
        args_hash = hashlib.sha256(json.dumps(args, sort_keys=True).encode()).hexdigest()
        cache_key = f"{tool_name}:{version}:{args_hash}"
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO tool_cache (cache_key, tool_name, args_hash, result_json, created_at, hit_count) "
                    "VALUES (?, ?, ?, ?, ?, COALESCE((SELECT hit_count FROM tool_cache WHERE cache_key=?), 0))",
                    (cache_key, tool_name, args_hash, json.dumps(result), time.time(), cache_key),
                )
                conn.commit()
            finally:
                conn.close()

    def cache_invalidate(self, tool_name: str | None = None, version: str | None = None):
        with self._lock:
            conn = self._connect()
            try:
                if tool_name and version:
                    conn.execute("DELETE FROM tool_cache WHERE tool_name = ? AND cache_key LIKE ?",
                                 (tool_name, f"%:{version}:%"))
                elif tool_name:
                    conn.execute("DELETE FROM tool_cache WHERE tool_name = ?", (tool_name,))
                elif version:
                    conn.execute("DELETE FROM tool_cache WHERE cache_key LIKE ?",
                                 (f"%:{version}:%",))
                else:
                    conn.execute("DELETE FROM tool_cache")
                conn.commit()
            finally:
                conn.close()

    def cache_stats(self) -> dict:
        with self._lock:
            conn = self._connect()
            try:
                total = conn.execute("SELECT COUNT(*) FROM tool_cache").fetchone()[0]
                total_hits = conn.execute("SELECT COALESCE(SUM(hit_count),0) FROM tool_cache").fetchone()[0]
                return {"entries": total, "total_hits": total_hits}
            finally:
                conn.close()

    def apply_heuristics_to_spec(self, spec_dict: dict, context: dict | None = None) -> tuple[dict, list[Heuristic]]:
        heuristics = self.retrieve_top_k(context=context, k=50) if context else self.get_active_heuristics()
        if not heuristics:
            return dict(spec_dict), []

        adjusted = dict(spec_dict)
        applied = []
        overrides_by_key: dict[str, list] = {}
        for h in heuristics:
            for key, value in h.parameter_override.items():
                overrides_by_key.setdefault(key, []).append((value, h))

        for key, entries in overrides_by_key.items():
            if key in adjusted:
                safest_value = max(v for v, _ in entries)
                if safest_value > adjusted[key]:
                    adjusted[key] = safest_value
                    for _, h in entries:
                        if h not in applied:
                            applied.append(h)

        return adjusted, applied

    def get_memory_stats(self) -> dict:
        with self._lock:
            conn = self._connect()
            try:
                total_rules = conn.execute("SELECT COUNT(*) FROM heuristics WHERE active = 1").fetchone()[0]
                total_episodes = conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0]
                cache = self.cache_stats()
                return {
                    "active_rules": total_rules,
                    "total_episodes": total_episodes,
                    "cache_entries": cache["entries"],
                    "cache_hits": cache["total_hits"],
                }
            finally:
                conn.close()

    def export_json(self, telemetry_path: str, memory_bank_path: str):
        with self._lock:
            conn = self._connect()
            try:
                episodes = []
                for row in conn.execute(
                    "SELECT episode_id, revision, status, summary, metrics_json FROM episodes ORDER BY revision"
                ):
                    metrics = json.loads(row[4])
                    episodes.append({
                        "episode_id": row[0],
                        "revision": row[1],
                        "status": row[2],
                        "summary": row[3],
                        **metrics,
                    })

                rules = []
                for row in conn.execute(
                    "SELECT rule_id, category, trigger_pattern, parameter_override_json, "
                    "parameter_key, rationale, triggers_json, confidence, evidence_json, "
                    "times_applied, times_helped, times_hurt FROM heuristics WHERE active = 1"
                ):
                    rules.append({
                        "rule_id": row[0],
                        "category": row[1],
                        "trigger_pattern": row[2],
                        "parameter_override": json.loads(row[3]),
                        "parameter_key": row[4],
                        "rationale": row[5],
                        "triggers": json.loads(row[6]),
                        "confidence": row[7],
                        "evidence": json.loads(row[8]),
                        "times_applied": row[9],
                        "times_helped": row[10],
                        "times_hurt": row[11],
                    })
            finally:
                conn.close()

        with open(telemetry_path, "w") as f:
            json.dump(episodes, f, indent=2)
        with open(memory_bank_path, "w") as f:
            json.dump(rules, f, indent=2)
