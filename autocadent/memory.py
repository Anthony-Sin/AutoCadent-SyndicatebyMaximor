"""Structured persistent memory for the learning engine. SQLite-backed."""
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
    parameter_key: str = ""
    rationale: str = ""

    def __post_init__(self):
        if not self.parameter_key and self.parameter_override:
            self.parameter_key = next(iter(self.parameter_override))


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
                        active INTEGER DEFAULT 1
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
                      parameter_override: dict | None = None, rationale: str = ""):
        parameter_override = parameter_override or {}
        parameter_key = next(iter(parameter_override)) if parameter_override else ""
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO heuristics "
                    "(rule_id, category, trigger_pattern, parameter_override_json, parameter_key, rationale, active) "
                    "VALUES (?, ?, ?, ?, ?, ?, 1)",
                    (rule_id, category, trigger_pattern,
                     json.dumps(parameter_override), parameter_key, rationale),
                )
                conn.commit()
            finally:
                conn.close()

    def get_active_heuristics(self, category: str | None = None) -> list[Heuristic]:
        with self._lock:
            conn = self._connect()
            try:
                if category:
                    rows = conn.execute(
                        "SELECT rule_id, category, trigger_pattern, parameter_override_json, "
                        "parameter_key, rationale FROM heuristics WHERE active = 1 AND category = ?",
                        (category,),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT rule_id, category, trigger_pattern, parameter_override_json, "
                        "parameter_key, rationale FROM heuristics WHERE active = 1"
                    ).fetchall()
                return [
                    Heuristic(
                        rule_id=r[0], category=r[1], trigger_pattern=r[2],
                        parameter_override=json.loads(r[3]),
                        parameter_key=r[4], rationale=r[5],
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
                    "parameter_key, rationale FROM heuristics WHERE active = 1"
                ):
                    rules.append({
                        "rule_id": row[0],
                        "category": row[1],
                        "trigger_pattern": row[2],
                        "parameter_override": json.loads(row[3]),
                        "parameter_key": row[4],
                        "rationale": row[5],
                    })
            finally:
                conn.close()

        with open(telemetry_path, "w") as f:
            json.dump(episodes, f, indent=2)
        with open(memory_bank_path, "w") as f:
            json.dump(rules, f, indent=2)
