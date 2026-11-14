"""Assigned-task lifecycle, scope, audit, persistence and completion boundaries."""
import json
import secrets
import sqlite3
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from auth import AuthError

from history import HistoryStore
from server import TelemetryHub,make_handler
from tests.test_auth import Client,PASSWORD,PROJECT,report_body


def work_record(**changes):
    return dict(findings="Filter obstruction observed",cause_status="Diagnosed",
                diagnosis="Filter blockage confirmed during inspection",repair_action="Replaced filter",
                materials_used="One approved filter",work_duration_minutes=35,
                post_work_checks="Checked airflow and fan operation against site procedure",
                post_work_result="Passed",note="Service restored after inspection",**changes)


class TechnicianTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=tempfile.TemporaryDirectory(); cls.path=Path(cls.folder.name)/"aura.sqlite3"
        cls.history=HistoryStore(cls.path)
        cls.hub=TelemetryHub("fixture",502,1,1,1,True,cls.history)
        cls.store=cls.history.maintenance
        admin=cls.history.auth.bootstrap_admin("admin","Administrator",PASSWORD)
        cls.users={}
        for name,role,projects in [("manager","manager",[PROJECT]),("tech","technician",[PROJECT]),("other","technician",[PROJECT]),("employee","employee",[PROJECT]),("viewer","viewer",[PROJECT]),("outside","technician",["meeting-room"]),("foreign-manager","manager",["meeting-room"])]:
            cls.users[name]=cls.history.auth.create_user(admin["user_id"],name,name,PASSWORD,role,projects)
        cls.server=ThreadingHTTPServer(("127.0.0.1",0),make_handler(cls.hub));cls.server.daemon_threads=True
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.hub.stop.set();cls.server.shutdown();cls.server.server_close();cls.thread.join(2);cls.history.close();cls.folder.cleanup()

    def client(self,name):
        client=Client(self.server);self.assertEqual(client.login(name)[0],200);return client

    def order(self):
        payload=report_body(secrets.token_hex(8));payload["reporter"]="Legacy observation"
        report=self.store.reports.submit(**payload)
        linked=self.store.reports.triage(PROJECT,report["report_id"],1,"High","Inspect AHU",asset_id="AHU-L1-01",link_mode="new",actor=self.users["manager"]["user_id"])
        return self.store.get_work_order(PROJECT,linked["work_order_id"])

    def action(self,client,order,action,**fields):
        body=dict(project_id=PROJECT,expected_version=order["version"],action=action,**fields)
        return client.call(f'/api/maintenance/work-orders/{order["work_order_id"]}/actions',body)

    def assign(self,order,technician="tech",due_at=None):
        status,data=self.action(self.client("manager"),order,"assign",assignee_id=self.users[technician]["user_id"],due_at=due_at,note="Assigned after manager review")
        self.assertEqual(status,200,data);return data["work_order"]

    def detail(self,client,order,project=PROJECT):
        return client.call(f'/api/maintenance/work-orders/{order["work_order_id"]}?project_id={project}')

    def completed_order(self, technician="tech"):
        order=self.assign(self.order(),technician);client=self.client(technician)
        for action,fields in (("acknowledge",{}),("start",{}),("complete",work_record())):
            status,data=self.action(client,order,action,**fields)
            self.assertEqual(status,200,data);order=data["work_order"]
        return order

    def test_full_lifecycle_persists_and_completion_is_not_closure(self):
        order=self.assign(self.order(),due_at="2027-01-02T12:00:00+02:00");tech=self.client("tech")
        self.assertIsNotNone(order["assigned_at"])
        self.assertEqual(order["due_at"],order["original_due_at"])
        for action,fields in [("acknowledge",{}),("start",{}),("record",work_record()),("wait_parts",{"note":"Replacement part required"}),("resume",{"note":"Part received"}),("wait_access",{"note":"Room occupied"}),("resume",{"note":"Access approved"}),("complete",work_record())]:
            status,result=self.action(tech,order,action,**fields);self.assertEqual(status,200,result);order=result["work_order"]
        self.assertEqual(order["state"],"Completed");self.assertIsNone(order["closed_at"])
        for field in ("acknowledged_at","started_at","completed_at"): self.assertIsNotNone(order[field])
        events=self.detail(tech,order)[1]["events"]
        self.assertEqual([e["action"] for e in events][-8:],["acknowledge","start","record","wait_parts","resume","wait_access","resume","complete"])
        self.assertTrue(all(e["actor"]==self.users["tech"]["user_id"] and e["at"] for e in events[-8:]))
        self.assertEqual(events[-1]["after"]["work_order"]["repair_action"],"Replaced filter")
        reopened=HistoryStore(self.path)
        try:
            self.assertEqual(reopened.maintenance.get_work_order(PROJECT,order["work_order_id"]),order)
            self.assertGreaterEqual(len(reopened.maintenance.list_notes(PROJECT,order["work_order_id"])),6)
        finally: reopened.close()
        for action in ("record","start","complete","close"):
            self.assertIn(self.action(tech,order,action)[0],(400,409))
        self.assertEqual(self.action(tech,order,"verify",note="Not permitted")[0],403)

    def test_manager_and_administrator_close_with_persistent_audit(self):
        for role in ("manager","admin"):
            with self.subTest(role=role):
                order=self.completed_order();reviewer=self.client(role)
                self.assertEqual(self.action(reviewer,order,"verify",note="  ")[0],400)
                status,data=self.action(reviewer,order,"verify",note="Post-work evidence checked; restoration verified")
                self.assertEqual(status,200,data);closed=data["work_order"]
                self.assertEqual(closed["state"],"Verified/Closed")
                self.assertIsNotNone(closed["closed_at"])
                self.assertEqual(closed["completed_at"],order["completed_at"])
                self.assertEqual(closed["assignee_id"],order["assignee_id"])
                events=self.detail(reviewer,closed)[1]["events"];event=events[-1]
                reviewer_id=reviewer.call("/api/auth/me")[1]["user"]["user_id"]
                self.assertEqual((event["action"],event["actor"],event["at"]),("verify",reviewer_id,closed["closed_at"]))
                self.assertEqual(event["before"],order)
                self.assertEqual(event["after"]["note"],"Post-work evidence checked; restoration verified")
                reopened=HistoryStore(self.path)
                try:
                    self.assertEqual(reopened.maintenance.get_work_order(PROJECT,closed["work_order_id"]),closed)
                    self.assertEqual(reopened.maintenance.list_audit_events(PROJECT,closed["work_order_id"])[-1]["actor"],reviewer_id)
                finally: reopened.close()
                for action in ("verify","return_rework"):
                    self.assertEqual(self.action(reviewer,order,action,note="Stale decision")[0],409)
                    self.assertEqual(self.action(reviewer,closed,action,note="Repeated decision")[0],409)
                for action in ("record","start","resume","complete"):
                    self.assertEqual(self.action(self.client("tech"),closed,action,note="Closed repair")[0],409)

    def test_return_recomplete_and_close_preserves_prior_completion_evidence(self):
        order=self.completed_order();manager=self.client("manager")
        self.assertEqual(self.action(manager,order,"return_rework",note="")[0],400)
        status,data=self.action(manager,order,"return_rework",note="Repeat the airflow check under load")
        self.assertEqual(status,200,data);returned=data["work_order"]
        self.assertEqual(returned["state"],"In progress")
        self.assertEqual(returned["assignee_id"],order["assignee_id"])
        self.assertIsNone(returned["completed_at"]);self.assertIsNone(returned["closed_at"])
        self.assertEqual(returned["repair_action"],order["repair_action"])
        event=self.detail(manager,returned)[1]["events"][-1]
        self.assertEqual(event["action"],"return_rework")
        self.assertEqual(event["before"],order)
        self.assertEqual(event["after"]["note"],"Repeat the airflow check under load")
        self.assertEqual(self.action(manager,returned,"verify",note="Not completed yet")[0],409)
        fields=work_record();fields.update(repair_action="Adjusted and retested after review",work_duration_minutes=50,note="Rework and checks recorded")
        status,data=self.action(self.client("tech"),returned,"complete",**fields)
        self.assertEqual(status,200,data);recompleted=data["work_order"]
        self.assertNotEqual(recompleted["completed_at"],order["completed_at"])
        self.assertEqual(self.action(manager,order,"verify",note="Old review tab")[0],409)
        status,data=self.action(manager,recompleted,"verify",note="Rework evidence satisfactory")
        self.assertEqual(status,200,data)
        reopened=HistoryStore(self.path)
        try:
            events=reopened.maintenance.list_audit_events(PROJECT,order["work_order_id"])
            completions=[json.loads(e["after_json"])["work_order"] for e in events if e["action"]=="complete"]
            self.assertEqual([w["repair_action"] for w in completions],["Replaced filter","Adjusted and retested after review"])
            self.assertEqual(completions[0]["completed_at"],order["completed_at"])
        finally: reopened.close()

    def test_review_authorization_session_and_self_review(self):
        order=self.completed_order()
        for action in ("verify","return_rework"):
            for role in ("tech","other","employee","viewer","outside","foreign-manager"):
                self.assertEqual(self.action(self.client(role),order,action,note="Unauthorized review")[0],403,(role,action))
            anonymous=Client(self.server)
            self.assertEqual(self.action(anonymous,order,action,note="Anonymous")[0],401)
            manager=self.client("manager")
            path=f'/api/maintenance/work-orders/{order["work_order_id"]}/actions'
            body=dict(project_id=PROJECT,expected_version=order["version"],action=action,note="Review")
            self.assertEqual(manager.call(path,body,headers={"X-CSRF-Token":"bad"})[0],403)
            self.assertEqual(manager.call(path,{**body,"project_id":"meeting-room"})[0],403)
        manager=self.client("manager");token=manager.cookie.split("=",1)[1]
        manager_id=manager.call("/api/auth/me")[1]["user"]["user_id"]
        self.assertEqual(manager.call("/api/auth/logout",method="POST")[0],200)
        self.assertEqual(self.action(manager,order,"verify",note="Logged out")[0],401)
        with self.assertRaises(AuthError) as error:
            self.store.workflow.action(manager_id,PROJECT,order["work_order_id"],order["version"],"verify",note="Invalidated token",token=token)
        self.assertEqual(error.exception.status,401)
        admin_id=self.history.connection.execute("SELECT user_id FROM auth_users WHERE username='admin'").fetchone()[0]
        name="promoted-"+secrets.token_hex(4)
        user=self.history.auth.create_user(admin_id,name,"Promoted technician",PASSWORD,"technician",[PROJECT])
        self.users[name]=user
        own=self.completed_order(name)
        self.history.auth.update_user(admin_id,user["user_id"],user["version"],"manager","active",[PROJECT])
        for action in ("verify","return_rework"):
            self.assertEqual(self.action(self.client(name),own,action,note="Own repair")[0],403)

    def test_review_audit_failure_rolls_back_decision_and_note(self):
        for action in ("verify","return_rework"):
            order=self.completed_order();manager=self.client("manager")
            notes=self.store.list_notes(PROJECT,order["work_order_id"])
            events=self.store.list_audit_events(PROJECT,order["work_order_id"])
            with patch.object(self.store,"_audit",side_effect=sqlite3.OperationalError("disk full")):
                self.assertEqual(self.action(manager,order,action,note="Atomic review")[0],503)
            self.assertEqual(self.store.get_work_order(PROJECT,order["work_order_id"]),order)
            self.assertEqual(self.store.list_notes(PROJECT,order["work_order_id"]),notes)
            self.assertEqual(self.store.list_audit_events(PROJECT,order["work_order_id"]),events)

    def test_scope_role_csrf_and_identity_spoofing(self):
        order=self.assign(self.order());tech=self.client("tech")
        for name in ("employee","viewer","manager","foreign-manager"):
            client=self.client(name)
            self.assertEqual(client.call("/api/maintenance/my-tasks")[0],403)
            self.assertEqual(self.action(client,order,"acknowledge")[0],403)
        self.assertEqual(self.detail(self.client("other"),order)[0],404)
        self.assertEqual(self.action(self.client("other"),order,"start")[0],404)
        outside=self.client("outside")
        self.assertEqual(outside.call("/api/maintenance/my-tasks")[1]["work_orders"],[])
        self.assertEqual(self.detail(outside,order)[0],403)
        self.assertEqual(self.detail(tech,order,"meeting-room")[0],403)
        self.assertEqual(tech.call("/api/maintenance/my-tasks?user_id=other")[0],400)
        tasks=tech.call("/api/maintenance/my-tasks")[1]["work_orders"]
        self.assertTrue(all(w["assignee_id"]==self.users["tech"]["user_id"] and w["project_id"]==PROJECT for w in tasks))
        self.assertTrue(any(w["work_order_id"]==order["work_order_id"] and w["equipment_name"] and w["room_id"]=="L1-M01" for w in tasks))
        for name in ("actor_id","actor","user_id","token","assignee_id","closed_at","state"):
            self.assertEqual(self.action(tech,order,"acknowledge",**{name:"forged"})[0],400)
        body=dict(project_id=PROJECT,expected_version=order["version"],action="acknowledge")
        path=f'/api/maintenance/work-orders/{order["work_order_id"]}/actions'
        self.assertEqual(tech.call(path,body,headers={"X-CSRF-Token":"bad"})[0],403)
        self.assertEqual(tech.call(path,body,headers={"Origin":"https://untrusted.example"})[0],403)
        anonymous=Client(self.server);self.assertEqual(anonymous.call(path,body)[0],401)

    def test_assignment_reassignment_deadline_and_validation(self):
        manager=self.client("manager");original=self.order()
        for target in ("employee","outside"):
            self.assertEqual(self.action(manager,original,"assign",assignee_id=self.users[target]["user_id"],note="Assign")[0],400)
        self.assertEqual(self.action(manager,original,"assign",assignee_id=self.users["tech"]["user_id"],note="")[0],400)
        self.assertEqual(self.action(manager,original,"assign",assignee_id=self.users["tech"]["user_id"],note="Assign",due_at="2027-01-01")[0],400)
        order=self.assign(original,due_at="2027-01-01T10:00:00Z")
        self.assertEqual(self.action(manager,original,"assign",assignee_id=self.users["tech"]["user_id"],note="Stale")[0],409)
        tech=self.client("tech");order=self.action(tech,order,"acknowledge")[1]["work_order"]
        reassigned=self.assign(order,"other","2027-01-02T10:00:00Z")
        self.assertIsNone(reassigned["acknowledged_at"])
        self.assertEqual(reassigned["original_due_at"],"2027-01-01T10:00:00Z")
        self.assertEqual(self.detail(tech,reassigned)[0],404)
        other=self.client("other")
        acknowledged=self.action(other,reassigned,"acknowledge")[1]["work_order"]
        started=self.action(other,acknowledged,"start")[1]["work_order"]
        self.assertEqual(self.action(manager,started,"assign",assignee_id=self.users["tech"]["user_id"],note="Unsafe reassignment")[0],409)

    def test_transition_completion_requirements_and_undetermined_cause(self):
        order=self.assign(self.order());tech=self.client("tech")
        self.assertEqual(self.action(tech,order,"start")[0],409)
        self.assertEqual(self.action(tech,order,"complete",**work_record())[0],409)
        order=self.action(tech,order,"acknowledge")[1]["work_order"]
        old=order;order=self.action(tech,order,"start")[1]["work_order"]
        self.assertEqual(self.action(tech,old,"start")[0],409)
        self.assertEqual(self.action(tech,order,"resume",note="Invalid")[0],409)
        self.assertEqual(self.action(tech,order,"wait_parts",note="")[0],400)
        for field,value in [("findings",""),("diagnosis",""),("cause_status",None),("repair_action",""),("materials_used",""),("work_duration_minutes",0),("work_duration_minutes",True),("post_work_checks",""),("post_work_result","Not restored"),("note","")]:
            fields=work_record();fields[field]=value
            self.assertEqual(self.action(tech,order,"complete",**fields)[0],400,field)
        fields=work_record();fields.update(cause_status="Undetermined",diagnosis="Cause remains undetermined; recommend inspection during next occupied period",materials_used="None")
        status,result=self.action(tech,order,"complete",**fields)
        self.assertEqual(status,200,result);self.assertEqual(result["work_order"]["cause_status"],"Undetermined")
        self.assertIsNone(result["work_order"]["closed_at"])

    def test_audit_failure_rolls_back_whole_transition(self):
        order=self.assign(self.order());tech=self.client("tech")
        with patch.object(self.store,"_audit",side_effect=sqlite3.OperationalError("disk full")):
            self.assertEqual(self.action(tech,order,"acknowledge",note="Must roll back")[0],503)
        self.assertEqual(self.store.get_work_order(PROJECT,order["work_order_id"]),order)
        self.assertFalse(any(n["body"]=="Must roll back" for n in self.store.list_notes(PROJECT,order["work_order_id"])))

    def test_permission_revocation_removes_tasks_and_blocks_mutation(self):
        order=self.assign(self.order());tech=self.client("tech")
        # Use a separate account so other tests retain their fixture grants.
        admin_id=self.history.connection.execute("SELECT user_id FROM auth_users WHERE username='admin'").fetchone()[0]
        user=self.history.auth.create_user(admin_id,"revoked-"+secrets.token_hex(3),"Revoked technician",PASSWORD,"technician",[PROJECT])
        assigned=self.action(self.client("manager"),order,"assign",assignee_id=user["user_id"],note="Scope test")[1]["work_order"]
        client=self.client(user["username"])
        self.history.auth.update_user(admin_id,user["user_id"],user["version"],"technician","active",[])
        self.assertEqual(self.action(client,assigned,"acknowledge")[0],401)
        self.assertEqual(self.client(user["username"]).call("/api/maintenance/my-tasks")[1]["work_orders"],[])

    def test_version_two_upgrade_preserves_original_work_and_notes(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/"v2.sqlite3"
            old=HistoryStore(path)
            order=old.maintenance.create_work_order(PROJECT,"AHU-L1-01","Preserved legacy job")
            old.maintenance.add_note(PROJECT,order["work_order_id"],1,"Original note")
            with old.connection:
                old.connection.execute("DROP INDEX maintenance_work_orders_assignee")
                for column in ("assigned_at","findings","cause_status","diagnosis","repair_action","materials_used","work_duration_minutes","post_work_checks","post_work_result"):
                    old.connection.execute(f"ALTER TABLE maintenance_work_orders DROP COLUMN {column}")
                old.connection.execute("DELETE FROM maintenance_schema_migrations WHERE version=3")
            legacy=old.maintenance.get_work_order(PROJECT,order["work_order_id"])
            old.close()
            migrated=HistoryStore(path)
            try:
                current=migrated.maintenance.get_work_order(PROJECT,order["work_order_id"])
                self.assertEqual({key:current[key] for key in legacy},legacy)
                self.assertIsNone(current["assigned_at"])
                self.assertEqual(current["findings"],"")
                self.assertEqual(migrated.maintenance.list_notes(PROJECT,order["work_order_id"])[0]["body"],"Original note")
            finally: migrated.close()


if __name__=="__main__": unittest.main()
