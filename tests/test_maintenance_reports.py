import http.client
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer

from history import HistoryStore
from maintenance import AssetNotFoundError, ConflictError, MIGRATIONS, ASSET_FIELDS, load_asset_catalog
from server import TelemetryHub, make_handler

PROJECT = "atrium-building"
def payload(**changes):
    return dict(project_id=PROJECT, room_id="L1-01", reporter="Office employee",
                symptom="Office too warm", observed_at="2026-01-02T09:30:00+02:00",
                impact="Team workspace affected", description="Ventilation seems weak.",
                request_key="report-1", asset_id=None, **changes)


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "maintenance.sqlite3"
        self.history = HistoryStore(self.path)
        self.addCleanup(self.history.close)
        self.store = self.history.maintenance
        self.reports = self.store.reports

    def test_unknown_equipment_review_mapping_and_link_survive_reopen(self):
        report = self.reports.submit(**payload())
        self.assertIsNone(report["asset_id"])
        reviewed = self.reports.triage(PROJECT,report["report_id"],1,"High","Workspace affected")
        self.assertEqual(reviewed["status"],"Reviewed")
        self.assertIsNone(reviewed["asset_id"])
        self.assertEqual(self.store.list_work_orders(PROJECT),[])
        linked = self.reports.triage(PROJECT,report["report_id"],2,"High","Mapped after review",asset_id="AHU-L1-01",link_mode="new")
        self.assertEqual(linked["status"],"Linked")
        self.assertIsNone(linked["reported_asset_id"])
        self.assertEqual(linked["asset_id"],"AHU-L1-01")
        job = self.store.get_work_order(PROJECT,linked["work_order_id"])
        self.assertEqual((job["state"],job["origin"],job["priority"]),("Triaged","problem-report","High"))
        reopened = HistoryStore(self.path)
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.maintenance.reports.get(PROJECT,report["report_id"]),linked)
        self.assertEqual(len(reopened.maintenance.reports.events(PROJECT,report["report_id"])),3)
        self.assertEqual(reopened.maintenance.get_work_order(PROJECT,job["work_order_id"]),job)

    def test_duplicate_submits_and_related_reports_keep_one_job(self):
        first = self.reports.submit(**payload())
        self.assertEqual(self.reports.submit(**payload()),first)
        changed=payload(); changed["description"]="Different"
        with self.assertRaises(ConflictError): self.reports.submit(**changed)
        first=self.reports.triage(PROJECT,first["report_id"],1,"Normal","Inspect AHU",asset_id="AHU-L1-01",link_mode="new")
        second_payload=payload(); second_payload["request_key"]="report-2"
        second=self.reports.submit(**second_payload)
        with self.assertRaises(ConflictError):
            self.reports.triage(PROJECT,second["report_id"],1,"High","Same issue",asset_id="AHU-L1-01",link_mode="existing",work_order_id=first["work_order_id"],expected_work_order_version=99)
        second=self.reports.triage(PROJECT,second["report_id"],1,"High","Same issue; impact increased",asset_id="AHU-L1-01",link_mode="existing",work_order_id=first["work_order_id"],expected_work_order_version=1)
        self.assertEqual(first["work_order_id"],second["work_order_id"])
        self.assertEqual(len(self.store.list_work_orders(PROJECT)),1)
        self.assertEqual(len(self.reports.list(PROJECT)),2)
        self.assertEqual(self.store.get_work_order(PROJECT,first["work_order_id"])["priority"],"High")
        with self.assertRaises(ConflictError):
            self.reports.triage(PROJECT,second["report_id"],1,"Low","Stale",asset_id="AHU-L1-01",link_mode="new")

    def test_validation_project_scoping_and_reason_rules(self):
        for changes,error in [({"project_id":"meeting-room"},LookupError),({"room_id":"missing"},LookupError),
                              ({"asset_id":"missing"},AssetNotFoundError),({"asset_id":"FP-01"},AssetNotFoundError),
                              ({"observed_at":"not-a-time"},ValueError),({"observed_at":"2026-01-01T00:00:00"},ValueError),
                              ({"potential_hazard":"false"},ValueError),({"observed_at":"2999-01-01T00:00:00Z"},ValueError)]:
            args=payload(); args.update(changes)
            with self.assertRaises(error): self.reports.submit(**args)
        report=self.reports.submit(**payload())
        self.assertIsNone(self.reports.get("meeting-room",report["report_id"]))
        self.assertEqual(self.reports.list("meeting-room"),[])
        with self.assertRaises(LookupError): self.reports.triage("meeting-room",report["report_id"],1,"Normal","Review")
        with self.assertRaises(ValueError): self.reports.triage(PROJECT,report["report_id"],1,"High","")
        with self.assertRaises(ValueError): self.reports.triage(PROJECT,report["report_id"],1,"High","Review",link_mode="new")
        wrong_job=self.store.create_work_order(PROJECT,"BS-G-01","Domestic equipment job")
        with self.assertRaises(ValueError):
            self.reports.triage(PROJECT,report["report_id"],1,"High","Wrong equipment",asset_id="AHU-L1-01",link_mode="existing",work_order_id=wrong_job["work_order_id"],expected_work_order_version=1)
        self.assertEqual(self.reports.get(PROJECT,report["report_id"])["version"],1)

    def test_failed_triage_rolls_back_job_report_and_both_audits(self):
        report=self.reports.submit(**payload())
        with patch.object(self.reports,"_event",side_effect=sqlite3.OperationalError("disk full")):
            with self.assertRaises(sqlite3.OperationalError):
                self.reports.triage(PROJECT,report["report_id"],1,"High","Investigate",asset_id="AHU-L1-01",link_mode="new")
        self.assertEqual(self.store.list_work_orders(PROJECT),[])
        self.assertEqual(self.reports.get(PROJECT,report["report_id"]),report)
        self.assertEqual(len(self.reports.events(PROJECT,report["report_id"])),1)

    def test_version_one_database_upgrades_without_losing_orders(self):
        path=Path(self.folder.name)/"v1.sqlite3"
        connection=sqlite3.connect(path)
        try:
            with connection:
                for sql in MIGRATIONS[0][1]: connection.execute(sql)
                connection.execute("CREATE TABLE maintenance_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)")
                connection.execute("INSERT INTO maintenance_schema_migrations VALUES (1,'old')")
                for asset in load_asset_catalog():
                    connection.execute(f"INSERT INTO maintenance_assets VALUES ({','.join('?' for _ in ASSET_FIELDS)})",tuple(asset[f] for f in ASSET_FIELDS))
                connection.execute("""INSERT INTO maintenance_work_orders(project_id,work_order_id,asset_id,title,description,priority,created_at,updated_at,created_by)
                    VALUES ('atrium-building','legacy-job','AHU-L1-01','Old order','Original','Normal','old','old','operator')""")
        finally: connection.close()
        upgraded=HistoryStore(path); self.addCleanup(upgraded.close)
        self.assertEqual(upgraded.maintenance.get_work_order(PROJECT,"legacy-job")["description"],"Original")
        self.assertGreater(len(upgraded.maintenance.reports.rooms(PROJECT)),0)
        self.assertEqual(upgraded.connection.execute("SELECT version FROM maintenance_schema_migrations ORDER BY version").fetchall(),[(1,),(2,)])


class ReportApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hub=TelemetryHub("fixture",502,1,1,1,True)
        cls.server=ThreadingHTTPServer(("127.0.0.1",0),make_handler(cls.hub))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True); cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(2); cls.hub.store.close()
    def call(self,path,body=None,role="employee"):
        connection=http.client.HTTPConnection("127.0.0.1",self.server.server_address[1],timeout=3)
        try:
            connection.request("POST" if body is not None else "GET",path,body=json.dumps(body) if body is not None else None,
                headers={"Content-Type":"application/json","X-AURA-Demo-Role":role})
            response=connection.getresponse(); return response.status,json.loads(response.read())
        finally: connection.close()
    def test_api_role_validation_conflicts_and_persisted_lookup(self):
        status,overview=self.call("/api/maintenance/overview?project_id=atrium-building")
        self.assertEqual(status,200); self.assertGreater(len(overview["rooms"]),0)
        status,result=self.call("/api/maintenance/reports",payload())
        self.assertEqual(status,200); report=result["report"]
        path=f'/api/maintenance/reports/{report["report_id"]}/triage'
        triage=dict(project_id=PROJECT,expected_version=1,priority="High",reason="Manager reviewed",asset_id="AHU-L1-01",link_mode="new")
        self.assertEqual(self.call(path,triage)[0],403)
        self.assertEqual(self.call(path,triage,"manager")[0],200)
        self.assertEqual(self.call(path,triage,"manager")[0],409)
        status,detail=self.call(f'/api/maintenance/reports/{report["report_id"]}?project_id=atrium-building')
        self.assertEqual(status,200); self.assertEqual(detail["report"]["status"],"Linked")
        self.assertEqual(detail["work_order"]["asset_id"],"AHU-L1-01")
        self.assertEqual(self.call("/api/maintenance/overview?project_id=meeting-room")[0],404)
        bad=payload(); bad["unexpected"]="field"
        self.assertEqual(self.call("/api/maintenance/reports",bad)[0],400)
        self.assertEqual(self.call("/api/maintenance/overview")[0],400)


if __name__ == "__main__": unittest.main()
