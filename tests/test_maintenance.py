import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import maintenance
from history import HistoryStore
from maintenance import AssetNotFoundError, ConflictError, WorkOrderNotFoundError


PROJECT = "atrium-building"


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "aura.sqlite3"
        self.history = HistoryStore(self.path, retention=2)
        self.addCleanup(self.history.close)
        self.store = self.history.maintenance

    def create(self, **kwargs):
        return self.store.create_work_order(PROJECT, "AHU-L1-01", "Inspect AHU", **kwargs)

    def test_catalog_seed_and_project_scoped_asset_lookup(self):
        assets = self.store.list_assets(PROJECT)
        self.assertEqual([a["asset_id"] for a in assets], ["AHU-L1-01", "BS-G-01", "FP-01"])
        self.assertEqual(self.store.get_asset(PROJECT, "AHU-L1-01")["room_id"], "L1-M01")
        self.assertEqual(self.store.get_asset(PROJECT, "AHU-L1-01")["floor"], 1)
        self.assertEqual(self.store.get_asset(PROJECT, "FP-01")["system"], "fire-water")
        self.assertEqual(self.store.get_asset(PROJECT, "BS-G-01")["system"], "domestic-water")
        self.assertEqual(self.store.list_assets("meeting-room"), [])
        self.assertIsNone(self.store.get_asset("meeting-room", "FP-01"))
        self.assertIsNone(self.store.get_asset(PROJECT, "FP-01' OR 1=1 --"))
        self.assertEqual(self.history.connection.execute("PRAGMA foreign_keys").fetchone()[0], 1)
        for asset in assets:
            self.assertEqual(asset["design_state"], "concept")
            self.assertEqual(asset["commissioning_state"], "not_connected")
            self.assertEqual(asset["criticality"], "unassessed")
            self.assertIsNone(asset["parent_asset_id"])

    def test_orders_notes_and_audit_survive_restart_and_telemetry_cleanup(self):
        order = self.create()
        self.assertEqual(order["state"], "New")
        self.assertEqual(order["origin"], "manual")
        self.assertEqual(order["action_type"], "corrective")
        self.assertIsNone(order["due_at"])
        note = self.store.add_note(PROJECT, order["work_order_id"], 1, "Reported noisy fan")
        updated = self.store.update_work_order(PROJECT, order["work_order_id"], 2, description="Investigate on site")
        self.assertEqual(updated["version"], 3)
        for i in range(5):
            self.history.add_sample("live", {"id": str(i)})
            self.history.add_alarm("live", {"id": str(i)})
        self.assertEqual(len(self.history.samples("live")), 2)
        self.assertEqual(len(self.history.alarms("live")), 2)
        with self.history.connection:
            self.history.connection.execute(
                "UPDATE maintenance_assets SET criticality='site-reviewed' WHERE project_id=? AND asset_id=?",
                (PROJECT, "AHU-L1-01"))
        # Reopen through a second connection: the API uses the same persisted DB.
        reopened = HistoryStore(self.path)
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.maintenance.get_work_order(PROJECT, order["work_order_id"]), updated)
        self.assertEqual(reopened.maintenance.list_notes(PROJECT, order["work_order_id"]), [note])
        audit = reopened.maintenance.list_audit_events(PROJECT, order["work_order_id"])
        self.assertEqual([a["action"] for a in audit], ["created", "note_added", "edited"])
        self.assertEqual(json.loads(audit[-1]["before_json"])["description"], "")
        self.assertEqual(json.loads(audit[-1]["after_json"])["description"], "Investigate on site")
        self.assertEqual(len(reopened.maintenance.list_assets(PROJECT)), 3)
        self.assertEqual(reopened.maintenance.get_asset(PROJECT, "AHU-L1-01")["criticality"], "site-reviewed")
        self.assertEqual(reopened.connection.execute("SELECT version FROM maintenance_schema_migrations").fetchall(), [(1,), (2,)])

    def test_invalid_cross_project_references_and_stale_writes_are_rejected(self):
        for project, asset in [(PROJECT, "missing"), ("meeting-room", "FP-01")]:
            with self.assertRaises(AssetNotFoundError):
                self.store.create_work_order(project, asset, "Inspect")
        order = self.create()
        key = order["work_order_id"]
        self.assertIsNone(self.store.get_work_order("meeting-room", key))
        self.assertEqual(self.store.list_work_orders("meeting-room"), [])
        with self.assertRaises(WorkOrderNotFoundError):
            self.store.update_work_order("meeting-room", key, 1, title="Wrong project")
        with self.assertRaises(WorkOrderNotFoundError):
            self.store.add_note("meeting-room", key, 1, "Wrong project")
        self.store.update_work_order(PROJECT, key, 1, title="Updated")
        with self.assertRaises(ConflictError):
            self.store.add_note(PROJECT, key, 1, "Stale note")
        with self.assertRaises(ConflictError):
            self.store.update_work_order(PROJECT, key, 1, title="Stale edit")
        for kwargs in [{"title": " "}, {"priority": "Urgent"}, {"request_key": ""}]:
            with self.assertRaises(ValueError):
                self.store.create_work_order(PROJECT, "FP-01", **({"title": "Inspect"} | kwargs))
        with self.assertRaises(TypeError):
            self.store.update_work_order(PROJECT, key, 2, state="Completed")
        self.assertEqual(self.store.get_work_order(PROJECT, key)["state"], "New")
        self.assertEqual(self.store.list_notes(PROJECT, key), [])

    def test_duplicate_submits_create_one_order_and_conflicting_reuse_fails(self):
        with ThreadPoolExecutor(max_workers=2) as workers:
            orders = list(workers.map(lambda _: self.create(request_key="submit-1"), range(2)))
        self.assertEqual(orders[0], orders[1])
        self.assertEqual(len(self.store.list_work_orders(PROJECT)), 1)
        self.assertEqual(len(self.store.list_audit_events(PROJECT, orders[0]["work_order_id"])), 1)
        with self.assertRaises(ConflictError):
            self.create(description="Different request", request_key="submit-1")

    def test_two_connections_cannot_overwrite_a_stale_version(self):
        other = HistoryStore(self.path)
        self.addCleanup(other.close)
        order = self.create()
        def edit(store):
            try:
                store.update_work_order(PROJECT, order["work_order_id"], 1, title="Concurrent edit")
                return "updated"
            except ConflictError:
                return "conflict"
        with ThreadPoolExecutor(max_workers=2) as workers:
            self.assertCountEqual(list(workers.map(edit, [self.store, other.maintenance])), ["updated", "conflict"])
        self.assertEqual(self.store.get_work_order(PROJECT, order["work_order_id"])["version"], 2)

    def test_audit_failure_rolls_back_whole_write(self):
        with patch.object(self.store, "_audit", side_effect=sqlite3.OperationalError("disk full")):
            with self.assertRaises(sqlite3.OperationalError):
                self.create()
        self.assertEqual(self.store.list_work_orders(PROJECT), [])
        order = self.create()
        with patch.object(self.store, "_audit", side_effect=sqlite3.OperationalError("disk full")):
            with self.assertRaises(sqlite3.OperationalError):
                self.store.add_note(PROJECT, order["work_order_id"], 1, "Must roll back")
            with self.assertRaises(sqlite3.OperationalError):
                self.store.update_work_order(PROJECT, order["work_order_id"], 1, description="Must roll back")
        self.assertEqual(self.store.get_work_order(PROJECT, order["work_order_id"]), order)
        self.assertEqual(self.store.list_notes(PROJECT, order["work_order_id"]), [])

    def test_migrations_are_atomic_and_refuse_unknown_future_versions(self):
        order = self.create()
        bad_revision = (3, ("CREATE TABLE maintenance_probe (id INTEGER)", "INVALID SQL"))
        with patch.object(maintenance, "MIGRATIONS", maintenance.MIGRATIONS + (bad_revision,)):
            with self.assertRaises(sqlite3.OperationalError):
                HistoryStore(self.path)
        self.assertIsNone(self.history.connection.execute("SELECT name FROM sqlite_master WHERE name='maintenance_probe'").fetchone())
        self.assertEqual(self.store.get_work_order(PROJECT, order["work_order_id"]), order)
        with self.history.connection:
            self.history.connection.execute("INSERT INTO maintenance_schema_migrations VALUES (99, 'future')")
        with self.assertRaisesRegex(ValueError, "no downgrade"):
            HistoryStore(self.path)
        self.assertEqual(self.history.connection.execute("SELECT version FROM maintenance_schema_migrations ORDER BY version").fetchall(), [(1,), (2,), (99,)])

    def test_database_enforces_composite_foreign_keys(self):
        order = self.create()
        with self.assertRaises(sqlite3.IntegrityError), self.history.connection:
            self.history.connection.execute(
                "UPDATE maintenance_work_orders SET project_id='meeting-room' WHERE work_order_id=?",
                (order["work_order_id"],))
        self.assertEqual(self.store.get_work_order(PROJECT, order["work_order_id"]), order)
        self.assertEqual(self.history.connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_malformed_and_duplicate_catalog_entries_are_rejected(self):
        path = Path(self.folder.name) / "bad-catalog.json"
        path.write_text("[]", encoding="utf-8")
        with self.assertRaises(ValueError):
            maintenance.load_asset_catalog(path)
        asset = maintenance.load_asset_catalog()[0]
        path.write_text(json.dumps({"schema_version": 1, "assets": [asset, asset]}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            maintenance.load_asset_catalog(path)


class LegacyMigrationTests(unittest.TestCase):
    def test_existing_history_and_global_schema_version_are_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "legacy.sqlite3"
            with sqlite3.connect(path) as connection:
                connection.executescript("""
                    PRAGMA user_version=7;
                    CREATE TABLE samples(row_id INTEGER PRIMARY KEY, source TEXT NOT NULL, id TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
                    CREATE TABLE alarms(row_id INTEGER PRIMARY KEY, source TEXT NOT NULL, id TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
                    INSERT INTO samples VALUES(1, 'live', 's1', '{"id":"s1","temperature_c":21}');
                    INSERT INTO alarms VALUES(1, 'live', 'a1', '{"id":"a1"}');
                """)
            connection.close()
            store = HistoryStore(path)
            try:
                self.assertEqual(store.samples("live"), [{"id": "s1", "temperature_c": 21}])
                self.assertEqual(store.alarms("live"), [{"id": "a1"}])
                self.assertEqual(store.connection.execute("PRAGMA user_version").fetchone()[0], 7)
                self.assertEqual(len(store.maintenance.list_assets(PROJECT)), 3)
            finally:
                store.close()


if __name__ == "__main__":
    unittest.main()
