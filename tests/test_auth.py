"""Focused account/session, CSRF, project and maintenance ownership regressions."""
import http.client
import json
import secrets
import tempfile
import threading
import unittest
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer
from pathlib import Path

from auth import AuthError, AuthStore, digest
from auth_http import AuthSettings, cookie_header
from history import HistoryStore
from server import TelemetryHub, make_handler

PROJECT = "atrium-building"
PASSWORD = secrets.token_urlsafe(24)


def report_body(key="report-1"):
    return dict(project_id=PROJECT, room_id="L1-01", symptom="Office too warm",
                observed_at="2026-01-02T09:30:00+02:00", impact="Team workspace",
                description="Ventilation seems weak.", request_key=key, asset_id=None)


class Client:
    def __init__(self, server):
        self.port = server.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"
        self.cookie = ""
        self.csrf = ""

    def call(self, path, body=None, method=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        request_headers = {"Content-Type": "application/json", "Cookie": self.cookie,
                           "Origin": self.origin, "X-CSRF-Token": self.csrf}
        request_headers.update(headers or {})
        try:
            connection.request(method or ("POST" if body is not None else "GET"), path,
                               json.dumps(body) if body is not None else None, request_headers)
            response = connection.getresponse()
            cookie = response.getheader("Set-Cookie")
            self.last_cookie = cookie
            if cookie:
                parsed = SimpleCookie(); parsed.load(cookie)
                self.cookie = "; ".join(f"{k}={v.value}" for k,v in parsed.items())
            raw = response.read()
            data = json.loads(raw) if "application/json" in response.getheader("Content-Type", "") else raw
            if isinstance(data,dict) and "csrf_token" in data:
                self.csrf = data["csrf_token"]
            return response.status,data
        finally:
            connection.close()

    def login(self, username, password=PASSWORD):
        self.call("/api/auth/session")
        return self.call("/api/auth/login", {"username": username, "password": password})


class AuthStorageTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(); self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name)/"aura.sqlite3"
        self.history = HistoryStore(self.path); self.addCleanup(self.history.close)
        self.auth = self.history.auth

    def test_bootstrap_password_hash_and_persistent_session(self):
        admin = self.auth.bootstrap_admin("admin", "Local administrator", PASSWORD)
        with self.assertRaises(ValueError): self.auth.bootstrap_admin("other", "Other", PASSWORD)
        password_hash = self.history.connection.execute("SELECT password_hash FROM auth_users").fetchone()[0]
        self.assertTrue(password_hash.startswith("$argon2id$")); self.assertNotIn(PASSWORD,password_hash)
        token,_ = self.auth.anonymous_session()
        authenticated,result = self.auth.login(token,"ADMIN",PASSWORD,"test")
        self.assertIsNone(self.auth.session(token))
        stored = self.history.connection.execute("SELECT token_hash FROM auth_sessions").fetchone()[0]
        self.assertEqual(stored,digest(authenticated)); self.assertNotEqual(stored,authenticated)
        reopened = HistoryStore(self.path); self.addCleanup(reopened.close)
        self.assertEqual(reopened.auth.session(authenticated)["user"]["user_id"],admin["user_id"])
        self.assertNotIn("password_hash",result["user"])
        reopened.auth.logout(authenticated)
        self.assertIsNone(self.auth.session(authenticated))

    def test_expiration_disabled_accounts_and_throttling(self):
        now = [1000.0]; self.auth.clock = lambda: now[0]
        admin = self.auth.bootstrap_admin("admin", "Admin", PASSWORD)
        token,_ = self.auth.anonymous_session()
        token,_ = self.auth.login(token,"admin",PASSWORD,"test",lifetime=100)
        now[0] += 101
        self.assertIsNone(self.auth.session(token))
        token,_ = self.auth.anonymous_session()
        token,_ = self.auth.login(token,"admin",PASSWORD,"test")
        now[0] += 61
        self.assertIsNone(self.auth.session(token,idle_seconds=60))
        token,_ = self.auth.anonymous_session()
        token,_ = self.auth.login(token,"admin",PASSWORD,"test")
        with self.history.connection:
            self.history.connection.execute("UPDATE auth_users SET status='disabled' WHERE user_id=?",(admin["user_id"],))
        self.assertIsNone(self.auth.session(token))
        token,_ = self.auth.anonymous_session()
        for _ in range(5):
            with self.assertRaises(AuthError) as error: self.auth.login(token,"missing","wrong","test")
            self.assertEqual(error.exception.status,401)
        with self.assertRaises(AuthError) as error: self.auth.login(token,"missing","wrong","test")
        self.assertEqual(error.exception.status,429)

    def test_migration_preserves_legacy_reports_history_orders_and_identity(self):
        body = report_body(); body["reporter"] = "Legacy reporter"
        report = self.history.maintenance.reports.submit(**body)
        linked = self.history.maintenance.reports.triage(PROJECT,report["report_id"],1,"Normal","Legacy review",asset_id="AHU-L1-01",link_mode="new")
        self.history.add_sample("fixture",{"id":"old-sample","temperature_c":23})
        self.history.add_alarm("fixture",{"id":"old-alarm","alarm_on":True})
        # Recreate the immediately previous schema, then run the migration again.
        with self.history.connection:
            self.history.connection.execute("DROP INDEX maintenance_reports_owner")
            self.history.connection.execute("ALTER TABLE maintenance_reports DROP COLUMN owner_user_id")
            for table in ("auth_sessions","auth_user_projects","auth_audit_events","auth_users","auth_login_limits","auth_schema_migrations"):
                self.history.connection.execute(f"DROP TABLE {table}")
        upgraded = AuthStore(self.history.connection,self.history.lock)
        upgraded.bootstrap_admin("admin","Legacy reporter",PASSWORD)
        preserved = self.history.maintenance.reports.get(PROJECT,report["report_id"])
        self.assertIsNone(preserved["owner_user_id"])
        self.assertEqual(preserved["reporter"],"Legacy reporter")
        self.assertEqual(preserved["work_order_id"],linked["work_order_id"])
        self.assertEqual(len(self.history.maintenance.reports.events(PROJECT,report["report_id"])),2)
        self.assertEqual(len(self.history.samples("fixture")),1)
        self.assertEqual(len(self.history.alarms("fixture")),1)
        AuthStore(self.history.connection,self.history.lock)
        self.assertEqual(self.history.connection.execute("SELECT version FROM auth_schema_migrations ORDER BY version").fetchall(),[(1,),(2,)])

    def test_secure_deployment_settings(self):
        settings = AuthSettings(public_origin="https://aura.example")
        cookie = cookie_header(settings,"test-token",100)
        for text in ("__Host-aura_session=", "HttpOnly", "Secure", "SameSite=Strict", "Path=/"):
            self.assertIn(text,cookie)
        self.assertNotIn("Domain",cookie)
        with self.assertRaises(ValueError): AuthSettings(secure_cookies=True)
        with self.assertRaises(ValueError): AuthSettings(public_origin="https://aura.example/path")


class AuthApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hub = TelemetryHub("fixture",502,1,1,1,True)
        cls.auth = cls.hub.store.auth
        cls.admin = cls.auth.bootstrap_admin("admin","Administrator",PASSWORD)
        cls.users = {}
        for role in ("manager","employee","viewer","technician"):
            cls.users[role] = cls.auth.create_user(cls.admin["user_id"],role,"Office user",PASSWORD,role,[PROJECT])
        cls.users["other"] = cls.auth.create_user(cls.admin["user_id"],"other","Office user",PASSWORD,"employee",[PROJECT])
        cls.users["meeting"] = cls.auth.create_user(cls.admin["user_id"],"meeting","Meeting employee",PASSWORD,"employee",["meeting-room"])
        cls.server = ThreadingHTTPServer(("127.0.0.1",0),make_handler(cls.hub))
        cls.thread = threading.Thread(target=cls.server.serve_forever,daemon=True); cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.hub.stop.set(); cls.server.shutdown(); cls.server.server_close(); cls.thread.join(2); cls.hub.store.close()

    def client(self, username=None):
        client = Client(self.server)
        if username: self.assertEqual(client.login(username)[0],200)
        return client

    def test_login_failure_success_rotation_logout_expiry(self):
        client = self.client()
        for route in ("/api/auth/me","/api/projects","/api/history","/api/state","/api/events","/api/maintenance/overview?project_id="+PROJECT):
            self.assertEqual(client.call(route)[0],401)
        self.assertEqual(client.call("/api/auth/signup",{})[0],404)
        client.call("/api/auth/session"); anonymous = client.cookie
        self.assertEqual(client.call("/api/auth/login",{"username":"admin","password":"wrong"})[0],401)
        status,result = client.call("/api/auth/login",{"username":"admin","password":PASSWORD})
        self.assertEqual(status,200); self.assertNotEqual(anonymous,client.cookie)
        self.assertIn("HttpOnly",client.last_cookie); self.assertIn("SameSite=Strict",client.last_cookie)
        authenticated = client.cookie
        self.assertEqual(client.call("/api/auth/me")[1]["user"]["role"],"administrator")
        self.assertEqual(client.call("/api/auth/logout",method="POST")[0],200)
        client.cookie = authenticated
        self.assertEqual(client.call("/api/auth/me")[0],401)
        client.login("admin")
        token = client.cookie.split("=",1)[1]
        with self.hub.store.lock,self.hub.store.connection:
            self.hub.store.connection.execute("UPDATE auth_sessions SET expires_at=0 WHERE token_hash=?",(digest(token),))
        self.assertEqual(client.call("/api/projects")[0],401)

    def test_csrf_login_logout_report_and_operation(self):
        client = self.client(); client.call("/api/auth/session")
        credentials = {"username":"admin","password":PASSWORD}
        for headers in ({"X-CSRF-Token":""},{"X-CSRF-Token":"é"},{"Origin":"https://untrusted.example"},{"Origin":""}):
            self.assertEqual(client.call("/api/auth/login",credentials,headers=headers)[0],403)
        self.assertEqual(client.call("/api/auth/login",credentials)[0],200)
        for path,body in (("/api/maintenance/reports",report_body()),("/api/auth/logout",{}),("/api/demo/toggle-alarm",{})):
            self.assertEqual(client.call(path,body,headers={"X-CSRF-Token":"bad"})[0],403)
            self.assertEqual(client.call(path,body,headers={"Origin":"https://untrusted.example"})[0],403)
        self.assertEqual(client.call("/api/projects",headers={"Host":"untrusted.example"})[0],403)

    def test_ownership_manager_triage_and_legacy_name_not_claimed(self):
        employee = self.client("employee"); other = self.client("other"); manager = self.client("manager")
        body = report_body("owned")
        status,result = employee.call("/api/maintenance/reports",body)
        self.assertEqual(status,200); report = result["report"]
        self.assertEqual(report["owner_user_id"],self.users["employee"]["user_id"])
        self.assertEqual(employee.call("/api/maintenance/reports",body)[1]["report"]["report_id"],report["report_id"])
        self.assertNotEqual(other.call("/api/maintenance/reports",body)[1]["report"]["report_id"],report["report_id"])
        detail = f'/api/maintenance/reports/{report["report_id"]}?project_id={PROJECT}'
        self.assertEqual(other.call(detail)[0],404)
        for spoof in ("reporter","owner_user_id","role"):
            self.assertEqual(employee.call("/api/maintenance/reports",{**body,spoof:"administrator"})[0],400)
        path = f'/api/maintenance/reports/{report["report_id"]}/triage'
        review = dict(project_id=PROJECT,expected_version=1,priority="High",reason="Inspect the AHU",asset_id="AHU-L1-01",link_mode="new")
        self.assertEqual(employee.call(path,review,headers={"X-AURA-Demo-Role":"manager"})[0],403)
        status,linked = manager.call(path,review)
        self.assertEqual(status,200)
        self.assertEqual(linked["report"]["reviewed_by"],self.users["manager"]["user_id"])
        self.assertIsNotNone(employee.call(detail)[1]["work_order"])
        events = manager.call(detail)[1]["events"]
        self.assertEqual(events[-1]["actor"],self.users["manager"]["user_id"])
        legacy = self.hub.store.maintenance.reports.submit(**report_body("legacy"),reporter="Office user")
        legacy_detail = f'/api/maintenance/reports/{legacy["report_id"]}?project_id={PROJECT}'
        self.assertEqual(employee.call(legacy_detail)[0],404)
        self.assertIsNone(manager.call(legacy_detail)[1]["report"]["owner_user_id"])

    def test_project_viewer_and_technician_permissions(self):
        employee = self.client("employee"); meeting = self.client("meeting")
        self.assertEqual(employee.call("/api/projects")[1]["projects"][0]["id"],PROJECT)
        self.assertEqual(len(employee.call("/api/projects")[1]["projects"]),1)
        for route in ("/api/state","/api/history","/api/events","/api/history.csv"):
            self.assertEqual(employee.call(route)[0],403)
        self.assertEqual(meeting.call("/api/state")[0],200)
        self.assertEqual(meeting.call("/api/demo/toggle-alarm",{})[0],403)
        self.assertEqual(meeting.call("/api/maintenance/overview?project_id="+PROJECT)[0],403)
        self.assertEqual(meeting.call("/api/maintenance/reports",report_body())[0],403)
        viewer = self.client("viewer"); technician = self.client("technician")
        self.assertEqual(viewer.call("/api/maintenance/overview?project_id="+PROJECT)[0],200)
        for client in (viewer,technician):
            self.assertEqual(client.call("/api/maintenance/reports",report_body())[0],403)
        body = report_body("assigned"); report = employee.call("/api/maintenance/reports",body)[1]["report"]
        path = f'/api/maintenance/reports/{report["report_id"]}/triage'
        review = dict(project_id=PROJECT,expected_version=1,priority="Normal",reason="Assign later",asset_id="AHU-L1-01",link_mode="new")
        self.assertEqual(viewer.call(path,review)[0],403)
        self.assertEqual(technician.call(path,review)[0],403)
        linked = self.client("manager").call(path,review)[1]["report"]
        self.assertEqual(technician.call("/api/maintenance/overview?project_id="+PROJECT)[1]["reports"],[])
        # Exercise assignment scoping without introducing an assignment workflow.
        with self.hub.store.lock,self.hub.store.connection:
            self.hub.store.connection.execute("UPDATE maintenance_work_orders SET assignee_id=? WHERE work_order_id=?",(self.users["technician"]["user_id"],linked["work_order_id"]))
        assigned = technician.call("/api/maintenance/overview?project_id="+PROJECT)[1]
        self.assertEqual([r["report_id"] for r in assigned["reports"]],[report["report_id"]])
        self.assertEqual(len(assigned["work_orders"]),1)


if __name__ == "__main__": unittest.main()
