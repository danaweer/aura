"""Task routes reuse the existing authenticated maintenance HTTP boundary."""
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit
from auth import AuthError
from auth_http import cookie_token, json_body
from maintenance import ConflictError
from maintenance_workflow import WORK_FIELDS


def handle_tasks(handler, store):
    route=urlsplit(handler.path)
    if route.path not in ("/api/maintenance/my-tasks","/api/maintenance/technicians") and not route.path.startswith("/api/maintenance/work-orders/"): return False
    try:
        actor=handler.auth_user["user_id"];token=cookie_token(handler)
        workflow=store.workflow
        if handler.command=="GET" and route.path=="/api/maintenance/my-tasks":
            if route.query: raise ValueError("My Tasks derives identity and projects from the authenticated account")
            result={"work_orders":workflow.tasks(actor,token)}
        elif handler.command=="GET":
            query=parse_qs(route.query)
            if set(query)!={"project_id"} or len(query["project_id"])!=1: raise ValueError("Exactly one project_id is required")
            project=query["project_id"][0]
            if route.path=="/api/maintenance/technicians": result={"technicians":workflow.technicians(actor,project,token)}
            elif match:=re.fullmatch(r"/api/maintenance/work-orders/([a-f0-9-]{36})",route.path):
                result=workflow.detail(actor,project,match[1],token)
            else: raise LookupError("Task endpoint not found")
        elif handler.command=="POST" and (match:=re.fullmatch(r"/api/maintenance/work-orders/([a-f0-9-]{36})/actions",route.path)):
            body=json_body(handler)
            required={"project_id","expected_version","action"}
            if not required<=set(body) or set(body)-required-{"note","assignee_id","due_at"}-set(WORK_FIELDS): raise ValueError("Invalid work-order action fields")
            # Workflow validates action-specific fields, including rejection of supplied actor IDs.
            result={"work_order":workflow.action(actor,order_id=match[1],project=body.pop("project_id"),token=token,**body)}
        else: raise LookupError("Task endpoint not found")
        handler.json_response(200,result)
    except AuthError as exc: handler.json_response(exc.status,{"error":str(exc)})
    except ConflictError as exc: handler.json_response(409,{"error":str(exc)})
    except LookupError as exc: handler.json_response(404,{"error":str(exc)})
    except (ValueError,UnicodeError,TimeoutError) as exc: handler.json_response(400,{"error":str(exc)})
    except sqlite3.Error: handler.json_response(503,{"error":"Maintenance storage is unavailable; refresh the task before retrying"})
    return True
