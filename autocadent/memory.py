"""Persistent structured memory for the self-improving learning loop."""
import json
import sqlite3
import threading
from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class Heuristic:
    rule_id: str
    category: str
    trigger_pattern: str
    parameter_override: dict = field(default_factory=dict)
    rationale: str = ""


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
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS episodes (
                        episode_id TEXT PRIMARY KEY,
                        revision INTEGER NOT NULL,
                        status TEXT NOT NULL,
                        summary TEXT DEFAULT '',
                        metrics_json TEXT DEFAULT '{}'
                    );
                    CREATE TABLE IF NOT EXISTS tool_invocations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        episode_id TEXT NOT NULL,
                        tool_name TEXT NOT NULL,
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
                        rationale TEXT DEFAULT ''
                    );
                """)
                conn.commit()
            finally:
                conn.close()

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
                                inputs: Any = None, output: Any = None,
                                latency_ms: float = 0, tokens: int = 0,
                                status: str = ""):
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT INTO tool_invocations "
                    "(episode_id, tool_name, inputs_json, output_json, latency_ms, tokens, status) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (episode_id, tool_name, json.dumps(inputs or {}),
                     json.dumps(output or {}), latency_ms, tokens, status),
                )
                conn.commit()
            finally:
                conn.close()

    def add_heuristic(self, rule_id: str, category: str, trigger_pattern: str,
                      parameter_override: dict | None = None, rationale: str = ""):
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO heuristics "
                    "(rule_id, category, trigger_pattern, parameter_override_json, rationale) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (rule_id, category, trigger_pattern,
                     json.dumps(parameter_override or {}), rationale),
                )
                conn.commit()
            finally:
                conn.close()

    def get_active_heuristics(self, category: str | None = None) -> list[Heuristic]:
        conn = self._connect()
        try:
            if category:
                rows = conn.execute(
                    "SELECT rule_id, category, trigger_pattern, parameter_override_json, rationale "
                    "FROM heuristics WHERE category = ?", (category,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT rule_id, category, trigger_pattern, parameter_override_json, rationale "
                    "FROM heuristics"
                ).fetchall()
            return [
                Heuristic(
                    rule_id=r["rule_id"],
                    category=r["category"],
                    trigger_pattern=r["trigger_pattern"],
                    parameter_override=json.loads(r["parameter_override_json"]),
                    rationale=r["rationale"],
                )
                for r in rows
            ]
        finally:
            conn.close()

    def apply_heuristics_to_spec(self, spec_dict: dict) -> tuple[dict, list[Heuristic]]:
        heuristics = self.get_active_heuristics()
        if not heuristics:
            return dict(spec_dict), []

        adjusted = dict(spec_dict)
        applied: list[Heuristic] = []
        best_overrides: dict[str, float] = {}

        for h in heuristics:
            for key, value in h.parameter_override.items():
                if key not in best_overrides or value > best_overrides[key]:
                    best_overrides[key] = value

        for key, value in best_overrides.items():
            if key in adjusted and adjusted[key] < value:
                adjusted[key] = value

        for h in heuristics:
            for key in h.parameter_override:
                if key in best_overrides and adjusted.get(key) == best_overrides[key]:
                    if h not in applied:
                        applied.append(h)

        return adjusted, applied

    def export_json(self, telemetry_path: str, memory_bank_path: str):
        conn = self._connect()
        try:
            ep_rows = conn.execute(
                "SELECT episode_id, revision, status, summary, metrics_json FROM episodes ORDER BY revision"
            ).fetchall()
            episodes = []
            for r in ep_rows:
                m = json.loads(r["metrics_json"])
                episodes.append({
                    "episode_id": r["episode_id"],
                    "revision": r["revision"],
                    "status": r["status"],
                    "summary": r["summary"],
                    **m,
                })

            h_rows = conn.execute(
                "SELECT rule_id, category, trigger_pattern, parameter_override_json, rationale FROM heuristics"
            ).fetchall()
            rules = [
                {
                    "rule_id": r["rule_id"],
                    "category": r["category"],
                    "trigger_pattern": r["trigger_pattern"],
                    "parameter_override": json.loads(r["parameter_override_json"]),
                    "rationale": r["rationale"],
                }
                for r in h_rows
            ]
        finally:
            conn.close()

        with open(telemetry_path, "w") as f:
            json.dump({"episodes": episodes}, f, indent=2)
        with open(memory_bank_path, "w") as f:
            json.dump({"rules": rules}, f, indent=2)
