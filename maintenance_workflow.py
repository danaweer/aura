"""Assigned corrective work with independent manager review after completion."""
import json
import time
import uuid
from datetime import datetime, timezone

from auth import AuthError, digest
from maintenance import ConflictError, WorkOrderNotFoundError, _now, _text

WORK_FIELDS=("findings","cause_status","diagnosis","repair_action","materials_used",
             "work_duration_minutes","post_work_checks","post_work_result")
TECH_ACTIONS=("acknowledge","start","wait_parts","wait_access","resume","record","complete")
REVIEW_ACTIONS=("verify","return_rework")


class WorkOrderWorkflow:
    def __init__(self, store): self.s=store

    def _actor(self, actor_id, project=None, roles=("technician",), token=None):
        user=self.s._one("SELECT user_id,role,status,must_change_password FROM auth_users WHERE user_id=?",(actor_id,))
        if not user or user["status"]!="active" or user["must_change_password"] or user["role"] not in roles:
            raise AuthError(403,"This work-order operation is not permitted")
        if project is not None and not self.s._one("SELECT project_id FROM auth_user_projects WHERE user_id=? AND project_id=?",(actor_id,project)):
            raise AuthError(403,"Project access denied")
        if token is not None:
            session=self.s._one("SELECT user_id,expires_at FROM auth_sessions WHERE token_hash=?",(digest(token),))
            if not session or session["user_id"]!=actor_id or session["expires_at"]<=time.time():
                raise AuthError(401,"Session invalidated; please sign in again")
        return user

    def tasks(self, actor_id, token=None):
        with self.s.lock:
            self._actor(actor_id,token=token)
            return self.s._many("""SELECT w.*,a.name AS equipment_name,a.room_id,a.floor
                FROM maintenance_work_orders w JOIN maintenance_assets a
                ON a.project_id=w.project_id AND a.asset_id=w.asset_id
                WHERE w.assignee_id=? AND EXISTS (SELECT 1 FROM auth_user_projects p
                    WHERE p.user_id=? AND p.project_id=w.project_id)
                ORDER BY w.assigned_at DESC,w.created_at DESC,w.work_order_id""",(actor_id,actor_id))

    def technicians(self, actor_id, project, token=None):
        with self.s.lock:
            self._actor(actor_id,project,("manager","administrator"),token)
            return self.s._many("""SELECT u.user_id,u.name,u.username FROM auth_users u
                JOIN auth_user_projects p ON p.user_id=u.user_id WHERE p.project_id=?
                AND u.role='technician' AND u.status='active' ORDER BY u.name,u.user_id""",(project,))

    def detail(self, actor_id, project, order_id, token=None):
        with self.s.lock:
            user=self._actor(actor_id,project,("technician","manager","administrator"),token)
            order=self.s._get_order(project,order_id)
            if not order or (user["role"]=="technician" and order["assignee_id"]!=actor_id):
                raise WorkOrderNotFoundError("Task not found")
            asset=self.s._one("SELECT * FROM maintenance_assets WHERE project_id=? AND asset_id=?",(project,order["asset_id"]))
            events=self.s._many("""SELECT e.*,u.name AS actor_name FROM maintenance_audit_events e
                LEFT JOIN auth_users u ON u.user_id=e.actor WHERE e.project_id=? AND e.work_order_id=?
                ORDER BY e.at,e.event_id""",(project,order_id))
            for event in events:
                raw=event.pop("before_json")
                event["before"]=json.loads(raw) if raw else None
                event["after"]=json.loads(event.pop("after_json"))
            notes=self.s._many("SELECT * FROM maintenance_notes WHERE project_id=? AND work_order_id=? ORDER BY at,note_id",(project,order_id))
            return {"work_order":order,"asset":asset,"events":events,"notes":notes}

    def action(self, actor_id, project, order_id, expected_version, action, note="", token=None, **fields):
        _text(project,"project_id")
        _text(note,"work note",10000,empty=True)
        if action!="assign" and action not in TECH_ACTIONS+REVIEW_ACTIONS: raise ValueError("Unsupported work-order action")
        allowed={"assignee_id","due_at"} if action=="assign" else set(WORK_FIELDS) if action in ("record","complete") else set()
        if set(fields)-allowed: raise ValueError("Unexpected action fields")
        with self.s._write():
            roles=("manager","administrator") if action=="assign" or action in REVIEW_ACTIONS else ("technician",)
            self._actor(actor_id,project,roles,token)
            # Check assignment before version to avoid leaking another technician's task state.
            found=self.s._get_order(project,order_id)
            if not found or (action in TECH_ACTIONS and found["assignee_id"]!=actor_id): raise WorkOrderNotFoundError("Task not found")
            before=self.s._checked_order(project,order_id,expected_version)
            changes={};at=_now();state=before["state"]
            if action in REVIEW_ACTIONS:
                if state!="Completed": raise ConflictError("Only completed work awaiting verification can be reviewed")
                _text(note,"review note",10000)
                completion=self.s._one("""SELECT actor FROM maintenance_audit_events
                    WHERE project_id=? AND work_order_id=? AND action='complete'
                    ORDER BY at DESC,event_id DESC LIMIT 1""",(project,order_id))
                if actor_id==before["assignee_id"] or (completion and completion["actor"]==actor_id):
                    raise AuthError(403,"Independent review required; you cannot review your own repair")
                if action=="verify": changes.update(state="Verified/Closed",closed_at=at)
                else: changes.update(state="In progress",completed_at=None,closed_at=None)
            elif action=="assign":
                if state not in ("Triaged","Assigned"): raise ConflictError("Only triaged or not-yet-started assigned work can be assigned")
                _text(note,"assignment reason",10000)
                target=fields.get("assignee_id")
                if not isinstance(target,str): raise ValueError("Select a technician")
                technician=self.s._one("""SELECT u.user_id FROM auth_users u JOIN auth_user_projects p ON p.user_id=u.user_id
                    WHERE u.user_id=? AND u.role='technician' AND u.status='active' AND p.project_id=?""",(target,project))
                if not technician: raise ValueError("Select an active technician with access to this project")
                due=fields.get("due_at",before["due_at"])
                if due is not None:
                    _text(due,"due date",64)
                    try:
                        parsed=datetime.fromisoformat(due.replace("Z","+00:00"))
                        if parsed.tzinfo is None or parsed.utcoffset() is None: raise ValueError()
                        due=parsed.astimezone(timezone.utc).isoformat().replace("+00:00","Z")
                    except (ValueError,OverflowError): raise ValueError("Due date must include a valid timezone") from None
                changes.update(state="Assigned",assignee_id=target,assigned_at=at,acknowledged_at=None,
                               due_at=due,original_due_at=before["original_due_at"] or due)
            elif action=="acknowledge":
                if state!="Assigned" or before["acknowledged_at"]: raise ConflictError("Only an unacknowledged assignment can be acknowledged")
                changes["acknowledged_at"]=at
            elif action=="start":
                if state!="Assigned" or not before["acknowledged_at"]: raise ConflictError("Acknowledge the assignment before starting")
                changes.update(state="In progress",started_at=at)
            elif action in ("wait_parts","wait_access"):
                if state!="In progress": raise ConflictError("Only work in progress can be placed on hold")
                _text(note,"reason for waiting",10000)
                changes["state"]="Waiting for parts" if action=="wait_parts" else "Waiting for access"
            elif action=="resume":
                if state not in ("Waiting for parts","Waiting for access"): raise ConflictError("Only waiting work can be resumed")
                _text(note,"resume note",10000); changes["state"]="In progress"
            else:
                if state not in (("In progress",) if action=="complete" else ("In progress","Waiting for parts","Waiting for access")):
                    raise ConflictError("Start or resume work before this action")
                _text(note,"work note",10000)
                for name in WORK_FIELDS:
                    value=fields.get(name,before[name])
                    if name=="cause_status":
                        if value not in ("Diagnosed","Undetermined"): raise ValueError("Explicitly select Diagnosed or Undetermined cause")
                    elif name=="post_work_result":
                        if value not in (None,"Passed","Not restored"): raise ValueError("Invalid post-work result")
                    elif name=="work_duration_minutes":
                        if type(value) is not int or not 0<=value<=1000000: raise ValueError("Work duration must be whole minutes")
                    else: _text(value,name,10000,empty=name not in ("findings","diagnosis"))
                    changes[name]=value
                if action=="complete":
                    for name in ("repair_action","materials_used","post_work_checks"): _text(changes[name],name,10000)
                    if changes["work_duration_minutes"]<=0: raise ValueError("Record actual work duration before completion")
                    if changes["post_work_result"]!="Passed": raise ValueError("Record satisfactory post-work checks before submitting completion; keep unresolved work actionable")
                    changes.update(state="Completed",completed_at=at)
            changes.update(updated_at=at)
            self.s.connection.execute("UPDATE maintenance_work_orders SET "+",".join(f"{key}=?" for key in changes)+",version=version+1 WHERE project_id=? AND work_order_id=? AND version=?",
                tuple(changes.values())+(project,order_id,expected_version))
            after=self.s._get_order(project,order_id)
            if note.strip(): self.s.connection.execute("INSERT INTO maintenance_notes VALUES (?,?,?,?,?,?)",(project,str(uuid.uuid4()),order_id,note,actor_id,at))
            self.s._audit(project,order_id,actor_id,action,before,{"work_order":after,"note":note},at)
            return after
