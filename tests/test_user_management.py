"""Administrator user management, forced password setup and migration boundaries."""
import json
import secrets
import sqlite3
import threading
import unittest
from http.server import ThreadingHTTPServer

from auth import AuthError, AuthStore, digest
from history import HistoryStore
from server import TelemetryHub, make_handler
from tests.test_auth import Client, PASSWORD, PROJECT, report_body

NEW_PASSWORD=secrets.token_urlsafe(28)


class UserManagementStorageTests(unittest.TestCase):
    def setUp(self):
        self.history=HistoryStore(":memory:"); self.addCleanup(self.history.close)
        self.auth=self.history.auth
        self.admin=self.auth.bootstrap_admin("admin","Administrator",PASSWORD)
        self.actor=self.admin["user_id"]

    def test_v2_upgrade_preserves_accounts_grants_sessions_and_reports(self):
        user=self.auth.create_user(self.actor,"existing","Existing employee",PASSWORD,"employee",[PROJECT])
        token,_=self.auth.anonymous_session(); token,_=self.auth.login(token,"existing",PASSWORD,"fixture")
        report=self.history.maintenance.reports.submit(**report_body(),reporter="Legacy name")
        stored=self.history.connection.execute("SELECT password_hash FROM auth_users WHERE user_id=?",(user["user_id"],)).fetchone()
        with self.history.connection:
            for column in ("version","temporary_password_expires_at","must_change_password"):
                self.history.connection.execute(f"ALTER TABLE auth_users DROP COLUMN {column}")
            self.history.connection.execute("DELETE FROM auth_schema_migrations WHERE version=2")
        upgraded=AuthStore(self.history.connection,self.history.lock)
        current=upgraded.session(token)["user"]
        self.assertEqual(current["user_id"],user["user_id"])
        self.assertFalse(current["must_change_password"])
        self.assertEqual(current["projects"],[PROJECT])
        self.assertEqual(self.history.connection.execute("SELECT password_hash FROM auth_users WHERE user_id=?",(user["user_id"],)).fetchone(),stored)
        self.assertEqual(self.history.maintenance.reports.get(PROJECT,report["report_id"]),report)
        AuthStore(self.history.connection,self.history.lock)
        self.assertEqual(self.history.connection.execute("SELECT version FROM auth_schema_migrations ORDER BY version").fetchall(),[(1,),(2,)])

    def test_last_ready_administrator_protected_and_changes_audited(self):
        for role,status in (("employee","active"),("administrator","disabled")):
            with self.assertRaises(AuthError) as error:
                self.auth.update_user(self.actor,self.actor,1,role,status,[PROJECT])
            self.assertEqual(error.exception.status,409)
        # An uninitialized or expired setup account is not a usable admin fallback.
        pending=self.auth.provision_user(self.actor,"pending-admin","Pending admin","administrator",[PROJECT])
        with self.assertRaises(AuthError): self.auth.update_user(self.actor,self.actor,1,"employee","active",[PROJECT])
        with self.assertRaises(AuthError): self.auth.reset_password(self.actor,self.actor,1)
        second=self.auth.create_user(self.actor,"second-admin","Second administrator",PASSWORD,"administrator",[PROJECT])
        self.auth.update_user(self.actor,self.actor,1,"manager","active",[PROJECT])
        with self.assertRaises(AuthError): self.auth.list_users(self.actor)
        users=self.auth.list_users(second["user_id"])
        self.assertEqual(len(users),3)
        events=self.history.connection.execute("SELECT action,actor_user_id,details FROM auth_audit_events").fetchall()
        self.assertTrue(any(row[0]=="role_changed" and row[1]==self.actor for row in events))
        self.assertNotIn(pending["temporary_password"],json.dumps(events))

    def test_atomic_concurrent_admin_demotions_cannot_remove_last_admin(self):
        second=self.auth.create_user(self.actor,"second","Second admin",PASSWORD,"administrator",[PROJECT])
        barrier=threading.Barrier(2); results=[]
        def demote(user_id):
            barrier.wait()
            try: self.auth.update_user(user_id,user_id,1,"employee","active",[PROJECT]); results.append(200)
            except AuthError as error: results.append(error.status)
        threads=[threading.Thread(target=demote,args=(user_id,)) for user_id in (self.actor,second["user_id"])]
        for thread in threads: thread.start()
        for thread in threads: thread.join(5)
        self.assertEqual(sorted(results),[200,409])
        self.assertEqual(self.history.connection.execute("SELECT COUNT(*) FROM auth_users WHERE role='administrator' AND status='active' AND must_change_password=0").fetchone()[0],1)

    def test_temporary_expiry_and_failed_password_change_throttling(self):
        now=[1000.0]; self.auth.clock=lambda:now[0]
        created=self.auth.provision_user(self.actor,"new-user","Employee","employee",[PROJECT])
        token,_=self.auth.anonymous_session()
        token,_=self.auth.login(token,"new-user",created["temporary_password"],"fixture")
        for _ in range(5):
            with self.assertRaises(AuthError) as error: self.auth.change_password(token,"wrong",NEW_PASSWORD)
            self.assertEqual(error.exception.status,400)
        with self.assertRaises(AuthError) as error: self.auth.change_password(token,created["temporary_password"],NEW_PASSWORD)
        self.assertEqual(error.exception.status,429)
        now[0]+=86401
        self.assertIsNone(self.auth.session(token))
        token,_=self.auth.anonymous_session()
        with self.assertRaises(AuthError) as error: self.auth.login(token,"new-user",created["temporary_password"],"fixture")
        self.assertEqual(error.exception.status,401)


class UserManagementApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hub=TelemetryHub("fixture",502,1,1,1,True)
        cls.store=cls.hub.store.auth
        cls.admin=cls.store.bootstrap_admin("admin","Administrator",PASSWORD)
        cls.employee=cls.store.create_user(cls.admin["user_id"],"employee","Employee",PASSWORD,"employee",[PROJECT])
        cls.server=ThreadingHTTPServer(("127.0.0.1",0),make_handler(cls.hub))
        cls.server.daemon_threads=True
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True); cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.hub.stop.set(); cls.server.shutdown(); cls.server.server_close(); cls.thread.join(2); cls.hub.store.close()

    def client(self,username="admin",password=PASSWORD):
        client=Client(self.server); self.assertEqual(client.login(username,password)[0],200); return client

    def create(self,client,role="employee",projects=None):
        body=dict(username="user-"+secrets.token_hex(5),name="New "+role,role=role,projects=[PROJECT] if projects is None else projects)
        status,result=client.call("/api/admin/users",body)
        self.assertEqual(status,201); return result

    def test_role_authorization_csrf_and_server_validation(self):
        anonymous=Client(self.server)
        self.assertEqual(anonymous.call("/api/admin/users")[0],401)
        employee=self.client("employee")
        body=dict(username="forged",name="Forged",role="administrator",projects=[PROJECT])
        self.assertEqual(employee.call("/api/admin/users",headers={"X-AURA-Demo-Role":"administrator"})[0],403)
        self.assertEqual(employee.call("/api/admin/users",body)[0],403)
        admin=self.client()
        self.assertEqual(admin.call("/api/admin/users",body,headers={"X-CSRF-Token":"bad"})[0],403)
        self.assertEqual(admin.call("/api/admin/users",body,headers={"Origin":"https://untrusted.example"})[0],403)
        for changes in ({"role":"superuser"},{"projects":["missing"]},{"projects":[{}]},{"projects":"atrium-building"},{"projects":[PROJECT,PROJECT]},{"password":"client-chosen"},{"must_change_password":False},{"username":"a"}):
            self.assertEqual(admin.call("/api/admin/users",{**body,**changes})[0],400,changes)
        status,result=admin.call("/api/admin/users",body); self.assertEqual(status,201)
        self.assertEqual(admin.call("/api/admin/users",body)[0],409)
        target=result["user"]["user_id"]
        change=dict(expected_version=1,role="manager",status="active",projects=[])
        self.assertEqual(employee.call("/api/admin/users/"+target,change)[0],403)
        self.assertEqual(employee.call("/api/admin/users/"+target+"/reset-password",{"expected_version":1})[0],403)
        self.assertEqual(admin.call("/api/admin/users/"+target,change,headers={"X-CSRF-Token":"bad"})[0],403)
        self.assertEqual(admin.call("/api/admin/users/"+target+"/reset-password",{"expected_version":1},headers={"X-CSRF-Token":"bad"})[0],403)
        self.assertEqual(admin.call("/api/admin/users/"+target,method="DELETE")[0],501)

    def test_all_roles_list_sanitization_and_forced_password_change(self):
        admin=self.client()
        for role in ("administrator","manager","technician","employee","viewer"):
            created=self.create(admin,role)
            username=created["user"]["username"]
            temporary=created["temporary_password"]
            self.assertEqual(len(temporary),32)
            pending=self.client(username,temporary)
            self.assertTrue(pending.call("/api/auth/me")[1]["user"]["must_change_password"])
            for route in ("/api/projects","/api/admin/users","/api/maintenance/overview?project_id="+PROJECT):
                self.assertEqual(pending.call(route)[0],403)
            self.assertEqual(pending.call("/api/maintenance/reports",report_body())[0],403)
            change={"current_password":temporary,"new_password":NEW_PASSWORD}
            self.assertEqual(pending.call("/api/auth/change-password",change,headers={"X-CSRF-Token":""})[0],403)
            self.assertEqual(pending.call("/api/auth/change-password",{**change,"new_password":temporary})[0],400)
            self.assertEqual(pending.call("/api/auth/change-password",{**change,"current_password":"wrong"})[0],400)
            self.assertEqual(pending.call("/api/auth/change-password",change)[0],200)
            self.assertEqual(pending.call("/api/auth/me")[0],401)
            authenticated=self.client(username,NEW_PASSWORD)
            self.assertFalse(authenticated.call("/api/auth/me")[1]["user"]["must_change_password"])
            self.assertEqual(authenticated.call("/api/projects")[0],200)
            old=Client(self.server); self.assertEqual(old.login(username,temporary)[0],401)
        directory=admin.call("/api/admin/users")[1]
        for user in directory["users"]:
            self.assertEqual(set(user),{"user_id","username","name","role","status","version","must_change_password","projects","permissions"})
        serialized=json.dumps(directory)
        self.assertNotIn("password_hash",serialized); self.assertNotIn("token_hash",serialized)
        self.assertNotIn("temporary_password",serialized)

    def test_project_role_status_changes_reset_and_session_invalidation(self):
        admin=self.client(); created=self.create(admin)
        user=created["user"]; username=user["username"]; target=user["user_id"]
        pending=self.client(username,created["temporary_password"])
        pending.call("/api/auth/change-password",{"current_password":created["temporary_password"],"new_password":NEW_PASSWORD})
        employee=self.client(username,NEW_PASSWORD); another=self.client(username,NEW_PASSWORD)
        version=employee.call("/api/auth/me")[1]["user"]["version"]
        path="/api/admin/users/"+target
        changed=dict(expected_version=version,role="technician",status="active",projects=["meeting-room"])
        status,result=admin.call(path,changed); self.assertEqual(status,200)
        self.assertEqual(employee.call("/api/auth/me")[0],401); self.assertEqual(another.call("/api/auth/me")[0],401)
        self.assertEqual(admin.call(path,changed)[0],409)
        version=result["user"]["version"]
        technician=self.client(username,NEW_PASSWORD)
        self.assertEqual(technician.call("/api/maintenance/overview?project_id="+PROJECT)[0],403)
        self.assertEqual(technician.call("/api/state")[0],200)
        status,result=admin.call(path,dict(expected_version=version,role="technician",status="disabled",projects=[]))
        self.assertEqual(status,200); self.assertEqual(technician.call("/api/auth/me")[0],401)
        attempt=Client(self.server); self.assertEqual(attempt.login(username,NEW_PASSWORD)[0],401)
        listed=admin.call("/api/admin/users")[1]["users"]
        self.assertEqual(next(u for u in listed if u["user_id"]==target)["status"],"disabled")
        status,result=admin.call(path,dict(expected_version=result["user"]["version"],role="employee",status="active",projects=[PROJECT]))
        self.assertEqual(status,200)
        signed_in=self.client(username,NEW_PASSWORD)
        status,reset=admin.call(path+"/reset-password",{"expected_version":result["user"]["version"]})
        self.assertEqual(status,200); self.assertEqual(signed_in.call("/api/auth/me")[0],401)
        attempt=Client(self.server); self.assertEqual(attempt.login(username,NEW_PASSWORD)[0],401)
        pending=self.client(username,reset["temporary_password"])
        self.assertEqual(pending.call("/api/projects")[0],403)
        status,reset2=admin.call(path+"/reset-password",{"expected_version":reset["user"]["version"]})
        self.assertEqual(status,200); self.assertNotEqual(reset["temporary_password"],reset2["temporary_password"])
        self.assertEqual(pending.call("/api/auth/me")[0],401)
        with self.hub.store.lock:
            events=self.hub.store.connection.execute("SELECT action,actor_user_id,details FROM auth_audit_events WHERE target_user_id=?",(target,)).fetchall()
        actions={row[0] for row in events}
        self.assertTrue({"user_created","role_changed","project_grants_changed","account_disabled","account_enabled","password_reset","password_changed"}<=actions)
        self.assertTrue(all(row[1]==self.admin["user_id"] for row in events if row[0] in {"role_changed","password_reset","account_disabled"}))
        serialized=json.dumps(events)
        for secret in (NEW_PASSWORD,created["temporary_password"],reset["temporary_password"],reset2["temporary_password"]): self.assertNotIn(secret,serialized)


if __name__=="__main__": unittest.main()
