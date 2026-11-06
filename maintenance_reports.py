"""Corrective-report storage and manager triage for the AHU pilot only."""
import hashlib
import json
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

from maintenance import AssetNotFoundError, ConflictError, PRIORITIES, _now, _text

PILOT = "AHU-L1-01"
ROOM_CATALOG = Path(__file__).parent / "projects/atrium-building/maintenance-rooms.json"
EMERGENCY_INSTRUCTION = (
    "For an immediate hazard, follow your site's emergency procedure and contact the responsible "
    "site team now. This form is not an emergency dispatch service."
)



def load_rooms():
    catalog = json.loads(ROOM_CATALOG.read_text(encoding="utf-8"))
    if not isinstance(catalog,dict) or catalog.get("schema_version") != 1 or not isinstance(catalog.get("rooms"), list):
        raise ValueError("Unsupported reporting room catalog")
    seen = set()
    for room in catalog["rooms"]:
        if not isinstance(room,dict) or set(room) != {"project_id", "room_id", "name", "floor"} or type(room["floor"]) is not int or room["floor"] < 0:
            raise ValueError("Invalid reporting room")
        for field in ("project_id", "room_id", "name"):
            _text(room[field], field)
        key = (room["project_id"], room["room_id"])
        if key in seen:
            raise ValueError("Duplicate reporting room")
        seen.add(key)
    return catalog["rooms"]


class ReportStore:
    def __init__(self, store):
        self.store = store

    def rooms(self, project_id):
        with self.store.lock:
            return self.store._many("SELECT * FROM maintenance_rooms WHERE project_id=? ORDER BY floor,room_id", (project_id,))

    def _get(self, project_id, report_id):
        return self.store._one("SELECT * FROM maintenance_reports WHERE project_id=? AND report_id=?", (project_id,report_id))

    def get(self, project_id, report_id):
        with self.store.lock:
            return self._get(project_id,report_id)

    def list(self, project_id):
        with self.store.lock:
            return self.store._many("SELECT * FROM maintenance_reports WHERE project_id=? ORDER BY created_at DESC,report_id DESC LIMIT 200", (project_id,))

    def events(self, project_id, report_id):
        with self.store.lock:
            return self.store._many("SELECT * FROM maintenance_report_events WHERE project_id=? AND report_id=? ORDER BY at,event_id", (project_id,report_id))

    def _event(self, report, actor, action, before, reason):
        self.store.connection.execute("INSERT INTO maintenance_report_events VALUES (?,?,?,?,?,?,?,?,?)", (
            report["project_id"], str(uuid.uuid4()), report["report_id"], actor, _now(), action,
            json.dumps(before) if before else None, json.dumps(report), reason))

    def _asset(self, project_id, asset_id):
        if asset_id != PILOT or not self.store._one(
            "SELECT asset_id FROM maintenance_assets WHERE project_id=? AND asset_id=?", (project_id,asset_id)):
            raise AssetNotFoundError("Asset mapping error: this task supports registered AHU-L1-01 only")

    def submit(self, project_id, room_id, reporter, symptom, observed_at, impact,
               description, request_key, asset_id=None, potential_hazard=False):
        for field,value,limit in [("project_id",project_id,200),("room_id",room_id,200),
                                  ("reporter",reporter,200),("symptom",symptom,500),
                                  ("impact",impact,1000),("description",description,10000),
                                  ("request_key",request_key,200)]:
            _text(value,field,limit)
        if type(potential_hazard) is not bool:
            raise ValueError("potential_hazard must be a boolean")
        _text(observed_at,"observed_at",64)
        try:
            observed = datetime.fromisoformat(observed_at.replace("Z","+00:00"))
            if observed.tzinfo is None or observed.utcoffset() is None:
                raise ValueError()
            observed = observed.astimezone(timezone.utc)
        except (ValueError,OverflowError):
            raise ValueError("Observed time must include a valid timezone") from None
        if observed > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError("Observed time cannot be in the future")
        observed_at = observed.isoformat().replace("+00:00","Z")
        fingerprint = hashlib.sha256(json.dumps([room_id,reporter,symptom,observed_at,impact,description,asset_id,potential_hazard]).encode()).hexdigest()
        s = self.store
        with s._write():
            old = s._one("SELECT * FROM maintenance_reports WHERE project_id=? AND request_key=?",(project_id,request_key))
            if old:
                if old["request_hash"] != fingerprint:
                    raise ConflictError("Submission key already used for a different report")
                return old
            if not s._one("SELECT room_id FROM maintenance_rooms WHERE project_id=? AND room_id=?",(project_id,room_id)):
                raise LookupError("Room mapping error: select a room in this project")
            if asset_id is not None:
                self._asset(project_id,asset_id)
            report_id,at = str(uuid.uuid4()),_now()
            s.connection.execute("""INSERT INTO maintenance_reports
                (project_id,report_id,reporter,room_id,reported_asset_id,asset_id,symptom,observed_at,impact,
                 description,potential_hazard,created_at,updated_at,request_key,request_hash)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (project_id,report_id,reporter,room_id,asset_id,asset_id,
                symptom,observed_at,impact,description,int(potential_hazard),at,at,request_key,fingerprint))
            report = self._get(project_id,report_id)
            self._event(report,reporter,"submitted",None,"Reported observation")
            return report

    def triage(self, project_id, report_id, expected_version, priority, reason, *,
               asset_id=None, link_mode="review", work_order_id=None, expected_work_order_version=None):
        _text(reason,"Review reason",3000)
        if priority not in PRIORITIES or link_mode not in ("review","new","existing"):
            raise ValueError("Invalid priority or linking action")
        if type(expected_version) is not int or expected_version < 1:
            raise ValueError("A positive report version is required")
        if link_mode != "existing" and (work_order_id is not None or expected_work_order_version is not None):
            raise ValueError("Work-order reference requires the existing-work-order action")
        s = self.store
        with s._write():
            before = self._get(project_id,report_id)
            if before is None:
                raise LookupError("Report not found in this project")
            if before["version"] != expected_version or before["status"] == "Linked":
                raise ConflictError("Report changed or is already linked; refresh before reviewing")
            if asset_id is not None:
                self._asset(project_id,asset_id)
            if link_mode != "review" and asset_id is None:
                raise ValueError("Map the report to AHU-L1-01 before linking a work order")
            at = _now()
            linked = None
            if link_mode == "new":
                linked = s._insert_work_order(project_id,asset_id,before["symptom"],
                    before["description"],priority,"local-manager",None,None,origin="problem-report",state="Triaged")
            elif link_mode == "existing":
                linked = s._checked_order(project_id,work_order_id,expected_work_order_version)
                if linked["asset_id"] != asset_id or linked["state"] in ("Completed","Verified/Closed","Cancelled"):
                    raise ValueError("Choose an actionable work order for the mapped AHU")
                s.connection.execute("""UPDATE maintenance_work_orders SET priority=?,state=?,version=version+1,updated_at=?
                    WHERE project_id=? AND work_order_id=? AND version=?""",(priority,
                    "Triaged" if linked["state"] == "New" else linked["state"],at,project_id,work_order_id,expected_work_order_version))
                after_order = s._get_order(project_id,work_order_id)
                s._audit(project_id,work_order_id,"local-manager","report_linked",linked,
                         {"work_order":after_order,"report_id":report_id,"reason":reason},at)
                linked = after_order
            elif work_order_id is not None or expected_work_order_version is not None:
                raise ValueError("Work-order reference requires the existing-work-order action")
            s.connection.execute("""UPDATE maintenance_reports SET asset_id=?,priority=?,triage_reason=?,
                reviewed_by='local-manager',reviewed_at=?,work_order_id=?,status=?,updated_at=?,version=version+1
                WHERE project_id=? AND report_id=? AND version=?""",(asset_id,priority,reason,at,
                linked["work_order_id"] if linked else None,"Linked" if linked else "Reviewed",at,project_id,report_id,expected_version))
            report = self._get(project_id,report_id)
            self._event(report,"local-manager","linked" if linked else "reviewed",before,reason)
            return report
