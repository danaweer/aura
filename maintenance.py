"""Project-scoped maintenance storage; no scheduling, telemetry or workflow engine."""

import hashlib
import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


CATALOG = Path(__file__).parent / "projects" / "atrium-building" / "maintenance-assets.json"
ASSET_FIELDS = (
    "project_id", "asset_id", "name", "system", "room_id", "floor",
    "parent_asset_id", "criticality", "model_ref", "design_state", "commissioning_state",
)
PRIORITIES = ("Emergency", "High", "Normal", "Low")

# Each future revision appends a migration. Never use the telemetry retention tables
# or SQLite's global user_version for the maintenance schema.
MIGRATIONS = ((1, (
    """CREATE TABLE maintenance_assets (
        project_id TEXT NOT NULL, asset_id TEXT NOT NULL,
        name TEXT NOT NULL, system TEXT NOT NULL, room_id TEXT NOT NULL,
        floor INTEGER NOT NULL CHECK(floor >= 0), parent_asset_id TEXT,
        criticality TEXT NOT NULL, model_ref TEXT NOT NULL,
        design_state TEXT NOT NULL, commissioning_state TEXT NOT NULL,
        PRIMARY KEY(project_id, asset_id),
        FOREIGN KEY(project_id, parent_asset_id)
            REFERENCES maintenance_assets(project_id, asset_id)
    )""",
    """CREATE INDEX maintenance_assets_location
        ON maintenance_assets(project_id, floor, room_id)""",
    """CREATE TABLE maintenance_work_orders (
        project_id TEXT NOT NULL, work_order_id TEXT NOT NULL, asset_id TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'manual', action_type TEXT NOT NULL DEFAULT 'corrective',
        title TEXT NOT NULL CHECK(length(trim(title)) > 0), description TEXT NOT NULL,
        priority TEXT NOT NULL CHECK(priority IN ('Emergency', 'High', 'Normal', 'Low')),
        state TEXT NOT NULL DEFAULT 'New' CHECK(state IN
            ('New', 'Triaged', 'Assigned', 'In progress', 'Waiting for parts',
             'Waiting for access', 'Completed', 'Verified/Closed', 'Cancelled')),
        assignee_id TEXT, original_due_at TEXT, due_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
        acknowledged_at TEXT, started_at TEXT, completed_at TEXT, closed_at TEXT,
        version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
        request_key TEXT, request_hash TEXT,
        PRIMARY KEY(project_id, work_order_id), UNIQUE(project_id, request_key),
        FOREIGN KEY(project_id, asset_id) REFERENCES maintenance_assets(project_id, asset_id)
    )""",
    """CREATE INDEX maintenance_work_orders_asset
        ON maintenance_work_orders(project_id, asset_id, created_at, work_order_id)""",
    """CREATE INDEX maintenance_work_orders_state
        ON maintenance_work_orders(project_id, state, created_at, work_order_id)""",
    """CREATE TABLE maintenance_notes (
        project_id TEXT NOT NULL, note_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
        body TEXT NOT NULL CHECK(length(trim(body)) > 0), actor TEXT NOT NULL, at TEXT NOT NULL,
        PRIMARY KEY(project_id, note_id),
        FOREIGN KEY(project_id, work_order_id)
            REFERENCES maintenance_work_orders(project_id, work_order_id)
    )""",
    """CREATE INDEX maintenance_notes_order
        ON maintenance_notes(project_id, work_order_id, at, note_id)""",
    """CREATE TABLE maintenance_audit_events (
        project_id TEXT NOT NULL, event_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
        actor TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL,
        before_json TEXT, after_json TEXT NOT NULL,
        PRIMARY KEY(project_id, event_id),
        FOREIGN KEY(project_id, work_order_id)
            REFERENCES maintenance_work_orders(project_id, work_order_id)
    )""",
    """CREATE INDEX maintenance_audit_order
        ON maintenance_audit_events(project_id, work_order_id, at, event_id)""",
)),)


MIGRATIONS += ((2, (
    """CREATE TABLE maintenance_rooms (
        project_id TEXT NOT NULL, room_id TEXT NOT NULL, name TEXT NOT NULL, floor INTEGER NOT NULL,
        PRIMARY KEY(project_id, room_id))""",
    """CREATE TABLE maintenance_reports (
        project_id TEXT NOT NULL, report_id TEXT NOT NULL, reporter TEXT NOT NULL,
        room_id TEXT NOT NULL, reported_asset_id TEXT, asset_id TEXT,
        symptom TEXT NOT NULL, observed_at TEXT NOT NULL, impact TEXT NOT NULL,
        description TEXT NOT NULL, potential_hazard INTEGER NOT NULL CHECK(potential_hazard IN (0,1)),
        status TEXT NOT NULL DEFAULT 'Submitted' CHECK(status IN ('Submitted','Reviewed','Linked')),
        priority TEXT CHECK(priority IN ('Emergency','High','Normal','Low')),
        triage_reason TEXT, reviewed_by TEXT, reviewed_at TEXT, work_order_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
        PRIMARY KEY(project_id, report_id), UNIQUE(project_id, request_key),
        FOREIGN KEY(project_id, room_id) REFERENCES maintenance_rooms(project_id, room_id),
        FOREIGN KEY(project_id, reported_asset_id) REFERENCES maintenance_assets(project_id, asset_id),
        FOREIGN KEY(project_id, asset_id) REFERENCES maintenance_assets(project_id, asset_id),
        FOREIGN KEY(project_id, work_order_id) REFERENCES maintenance_work_orders(project_id, work_order_id))""",
    "CREATE INDEX maintenance_reports_queue ON maintenance_reports(project_id, created_at, report_id)",
    """CREATE TABLE maintenance_report_events (
        project_id TEXT NOT NULL, event_id TEXT NOT NULL, report_id TEXT NOT NULL,
        actor TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL,
        before_json TEXT, after_json TEXT NOT NULL, reason TEXT NOT NULL,
        PRIMARY KEY(project_id,event_id),
        FOREIGN KEY(project_id,report_id) REFERENCES maintenance_reports(project_id,report_id))""",
    "CREATE INDEX maintenance_report_events_order ON maintenance_report_events(project_id,report_id,at,event_id)",
)),)

class AssetNotFoundError(LookupError):
    """The referenced asset is not registered in this project (mapping error)."""


class WorkOrderNotFoundError(LookupError):
    pass


class ConflictError(ValueError):
    """A stale version or reused submission key conflicts with persisted data."""


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _text(value, field, maximum=200, empty=False):
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value.strip()):
        raise ValueError(f"Invalid {field}")
    return value


def load_asset_catalog(path=CATALOG):
    catalog = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(catalog, dict) or type(catalog.get("schema_version")) is not int or catalog["schema_version"] != 1 or not isinstance(catalog.get("assets"), list):
        raise ValueError("Unsupported maintenance asset catalog")
    seen = set()
    for asset in catalog["assets"]:
        if not isinstance(asset, dict) or set(asset) != set(ASSET_FIELDS):
            raise ValueError("Invalid maintenance asset fields")
        for field in ASSET_FIELDS:
            if field not in ("floor", "parent_asset_id"):
                _text(asset[field], field, 500)
        if type(asset["floor"]) is not int or asset["floor"] < 0:
            raise ValueError("Invalid asset floor")
        if asset["parent_asset_id"] is not None:
            _text(asset["parent_asset_id"], "parent_asset_id")
        key = (asset["project_id"], asset["asset_id"])
        if key in seen:
            raise ValueError(f"Duplicate maintenance asset {key}")
        seen.add(key)
    return catalog["assets"]


class MaintenanceStore:
    """Shares HistoryStore's connection and lock; HistoryStore owns their lifetime."""

    def __init__(self, connection, lock):
        self.connection, self.lock = connection, lock
        from maintenance_reports import ReportStore, load_rooms
        assets = load_asset_catalog()
        rooms = load_rooms()
        with self.lock:
            # Must precede BEGIN: SQLite ignores this pragma within a transaction.
            self.connection.execute("PRAGMA foreign_keys = ON")
        with self._write():
            self.connection.execute("""CREATE TABLE IF NOT EXISTS maintenance_schema_migrations (
                version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)""")
            versions = [r[0] for r in self.connection.execute(
                "SELECT version FROM maintenance_schema_migrations ORDER BY version")]
            if versions != list(range(1, len(versions) + 1)) or len(versions) > len(MIGRATIONS):
                raise ValueError("Unsupported maintenance migration history; no downgrade performed")
            for version, statements in MIGRATIONS:
                if version in versions:
                    continue
                for statement in statements:
                    self.connection.execute(statement)
                self.connection.execute(
                    "INSERT INTO maintenance_schema_migrations VALUES (?, ?)", (version, _now()))
            # Preserve persisted asset metadata on restart; future changes need explicit migrations/operations.
            for asset in assets:
                self.connection.execute(
                    f"INSERT INTO maintenance_assets ({', '.join(ASSET_FIELDS)}) "
                    f"VALUES ({', '.join('?' for _ in ASSET_FIELDS)}) "
                    "ON CONFLICT(project_id, asset_id) DO NOTHING",
                    tuple(asset[f] for f in ASSET_FIELDS),
                )

            for room in rooms:
                self.connection.execute(
                    "INSERT INTO maintenance_rooms VALUES (?, ?, ?, ?) ON CONFLICT(project_id,room_id) DO NOTHING",
                    (room["project_id"],room["room_id"],room["name"],room["floor"]))
        self.reports = ReportStore(self)

    @contextmanager
    def _write(self):
        with self.lock, self.connection:
            self.connection.execute("BEGIN IMMEDIATE")
            yield

    def _one(self, sql, parameters):
        cursor = self.connection.execute(sql, parameters)
        row = cursor.fetchone()
        return dict(zip((d[0] for d in cursor.description), row)) if row is not None else None

    def _many(self, sql, parameters):
        cursor = self.connection.execute(sql, parameters)
        fields = [d[0] for d in cursor.description]
        return [dict(zip(fields, row)) for row in cursor.fetchall()]

    def get_asset(self, project_id, asset_id):
        with self.lock:
            return self._one("SELECT * FROM maintenance_assets WHERE project_id=? AND asset_id=?",
                             (project_id, asset_id))

    def list_assets(self, project_id):
        with self.lock:
            return self._many("SELECT * FROM maintenance_assets WHERE project_id=? ORDER BY asset_id",
                              (project_id,))

    def get_work_order(self, project_id, work_order_id):
        with self.lock:
            return self._get_order(project_id, work_order_id)

    def _get_order(self, project_id, work_order_id):
        return self._one("SELECT * FROM maintenance_work_orders WHERE project_id=? AND work_order_id=?",
                         (project_id, work_order_id))

    def list_work_orders(self, project_id, asset_id=None, limit=100):
        if type(limit) is not int or not 1 <= limit <= 500:
            raise ValueError("limit must be between 1 and 500")
        with self.lock:
            return self._many(
                "SELECT * FROM maintenance_work_orders WHERE project_id=? "
                "AND (? IS NULL OR asset_id=?) ORDER BY created_at DESC, work_order_id DESC LIMIT ?",
                (project_id, asset_id, asset_id, limit))

    def _audit(self, project_id, work_order_id, actor, action, before, after, at):
        self.connection.execute(
            "INSERT INTO maintenance_audit_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (project_id, str(uuid.uuid4()), work_order_id, actor, at, action,
             json.dumps(before) if before is not None else None, json.dumps(after, allow_nan=False)))

    def create_work_order(self, project_id, asset_id, title, description="", *,
                          priority="Normal", actor="local-operator", request_key=None):
        _text(project_id, "project_id")
        _text(asset_id, "asset_id")
        _text(title, "title", 500)
        _text(description, "description", 10000, empty=True)
        _text(actor, "actor")
        if priority not in PRIORITIES:
            raise ValueError("Invalid priority")
        if request_key is not None:
            _text(request_key, "request_key")
        fingerprint = hashlib.sha256(json.dumps(
            [asset_id, title, description, priority, actor], ensure_ascii=False).encode()).hexdigest()
        with self._write():
            if request_key is not None:
                existing = self._one(
                    "SELECT * FROM maintenance_work_orders WHERE project_id=? AND request_key=?",
                    (project_id, request_key))
                if existing:
                    if existing["request_hash"] != fingerprint:
                        raise ConflictError("Submission key already used for different work-order data")
                    return existing
            if not self._one("SELECT asset_id FROM maintenance_assets WHERE project_id=? AND asset_id=?",
                             (project_id, asset_id)):
                raise AssetNotFoundError(f"Asset mapping error: {project_id}/{asset_id}")
            return self._insert_work_order(project_id,asset_id,title,description,priority,actor,
                                           request_key,fingerprint if request_key is not None else None)

    def _insert_work_order(self, project_id, asset_id, title, description, priority, actor,
                           request_key, request_hash, *, origin="manual", state="New"):
        # Caller owns the write transaction and validates every reference.
        order_id, at = str(uuid.uuid4()), _now()
        self.connection.execute(
            """INSERT INTO maintenance_work_orders
            (project_id,work_order_id,asset_id,title,description,priority,created_at,updated_at,
             created_by,request_key,request_hash,origin,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (project_id,order_id,asset_id,title,description,priority,at,at,actor,request_key,request_hash,origin,state))
        order = self._get_order(project_id,order_id)
        self._audit(project_id,order_id,actor,"created",None,order,at)
        return order

    def _checked_order(self, project_id, work_order_id, expected_version):
        if type(expected_version) is not int or expected_version < 1:
            raise ValueError("A positive expected_version is required")
        order = self._get_order(project_id, work_order_id)
        if order is None:
            raise WorkOrderNotFoundError(f"Unknown work order in project {project_id}")
        if order["version"] != expected_version:
            raise ConflictError("Stale work-order version; reload before editing")
        return order

    def update_work_order(self, project_id, work_order_id, expected_version, *,
                          title=None, description=None, actor="local-operator"):
        # Workflow-sensitive fields deliberately have no generic setter. Later
        # triage/assignment/transition commands must implement the section-4 rules.
        if title is None and description is None:
            raise ValueError("No editable fields provided")
        if title is not None:
            _text(title, "title", 500)
        if description is not None:
            _text(description, "description", 10000, empty=True)
        _text(actor, "actor")
        with self._write():
            before = self._checked_order(project_id, work_order_id, expected_version)
            at = _now()
            self.connection.execute(
                """UPDATE maintenance_work_orders SET title=?, description=?, updated_at=?, version=version+1
                WHERE project_id=? AND work_order_id=? AND version=?""",
                (before["title"] if title is None else title,
                 before["description"] if description is None else description, at,
                 project_id, work_order_id, expected_version))
            after = self._get_order(project_id, work_order_id)
            self._audit(project_id, work_order_id, actor, "edited", before, after, at)
            return after

    def add_note(self, project_id, work_order_id, expected_version, body, *, actor="local-operator"):
        _text(body, "note", 10000)
        _text(actor, "actor")
        with self._write():
            self._checked_order(project_id, work_order_id, expected_version)
            at, note_id = _now(), str(uuid.uuid4())
            self.connection.execute("INSERT INTO maintenance_notes VALUES (?, ?, ?, ?, ?, ?)",
                                    (project_id, note_id, work_order_id, body, actor, at))
            self.connection.execute(
                "UPDATE maintenance_work_orders SET updated_at=?, version=version+1 "
                "WHERE project_id=? AND work_order_id=? AND version=?",
                (at, project_id, work_order_id, expected_version))
            note = dict(project_id=project_id, note_id=note_id, work_order_id=work_order_id,
                        body=body, actor=actor, at=at)
            self._audit(project_id, work_order_id, actor, "note_added", None, note, at)
            return note

    def list_notes(self, project_id, work_order_id):
        with self.lock:
            return self._many("SELECT * FROM maintenance_notes WHERE project_id=? AND work_order_id=? "
                              "ORDER BY at, note_id", (project_id, work_order_id))

    def list_audit_events(self, project_id, work_order_id):
        with self.lock:
            return self._many("SELECT * FROM maintenance_audit_events WHERE project_id=? AND work_order_id=? "
                              "ORDER BY at, event_id", (project_id, work_order_id))
