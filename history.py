"""Bounded, local SQLite history; telemetry sources and simulation stay separate."""

import json
import sqlite3
import threading
from pathlib import Path


class HistoryStore:
    def __init__(self, path, retention=10000):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(path), check_same_thread=False)
        self.lock = threading.Lock()
        self.retention = retention
        with self.connection:
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS samples (
                    row_id INTEGER PRIMARY KEY,
                    source TEXT NOT NULL,
                    id TEXT NOT NULL UNIQUE,
                    body TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS samples_source ON samples(source, row_id);
                CREATE TABLE IF NOT EXISTS alarms (
                    row_id INTEGER PRIMARY KEY,
                    source TEXT NOT NULL,
                    id TEXT NOT NULL UNIQUE,
                    body TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS alarms_source ON alarms(source, row_id);
                """
            )

    def _append(self, table, source, item):
        # table is selected only by the two public methods below.
        body = json.dumps(item, allow_nan=False, separators=(",", ":"))
        with self.lock, self.connection:
            self.connection.execute(
                f"INSERT OR IGNORE INTO {table}(source, id, body) VALUES (?, ?, ?)",
                (source, item["id"], body),
            )
            self.connection.execute(
                f"DELETE FROM {table} WHERE source = ? AND row_id NOT IN "
                f"(SELECT row_id FROM {table} WHERE source = ? ORDER BY row_id DESC LIMIT ?)",
                (source, source, self.retention),
            )

    def add_sample(self, source, sample):
        self._append("samples", source, sample)

    def add_alarm(self, source, event):
        self._append("alarms", source, event)

    def _recent(self, table, source, limit):
        with self.lock:
            rows = self.connection.execute(
                f"SELECT body FROM {table} WHERE source = ? ORDER BY row_id DESC LIMIT ?",
                (source, min(max(1, limit), self.retention)),
            ).fetchall()
        return [json.loads(row[0]) for row in reversed(rows)]

    def samples(self, source, limit=60):
        return self._recent("samples", source, limit)

    def alarms(self, source, limit=100):
        return self._recent("alarms", source, limit)

    def close(self):
        with self.lock:
            self.connection.close()
