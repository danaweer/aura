"""Project- and account-scoped reporting API."""
import hashlib
import json
import sqlite3
from urllib.parse import parse_qs, urlsplit

from maintenance import ConflictError
from maintenance_reports import EMERGENCY_INSTRUCTION, PILOT
from auth import AuthError
from auth_http import require_project, require_permission


def visible_records(store, project, user, report_id=None):
    params=[project]
    report_where="r.project_id=?"
    order_where="w.project_id=?"
    if user["role"] == "employee":
        report_where += " AND r.owner_user_id=?"
        order_where += " AND EXISTS (SELECT 1 FROM maintenance_reports r WHERE r.project_id=w.project_id AND r.work_order_id=w.work_order_id AND r.owner_user_id=?)"
        params.append(user["user_id"])
    elif user["role"] == "technician":
        report_where += " AND EXISTS (SELECT 1 FROM maintenance_work_orders w WHERE w.project_id=r.project_id AND w.work_order_id=r.work_order_id AND w.assignee_id=?)"
        order_where += " AND w.assignee_id=?"
        params.append(user["user_id"])
    with store.lock:
        reports=store._many("SELECT r.* FROM maintenance_reports r WHERE "+report_where+
            (" AND r.report_id=?" if report_id is not None else "")+" ORDER BY r.created_at DESC,r.report_id DESC LIMIT 200",
            tuple(params+([report_id] if report_id is not None else [])))
        order_params=list(params)
        if report_id is not None:
            order_where += " AND w.work_order_id=?"
            order_params.append(reports[0]["work_order_id"] if reports else None)
        order_params.append(PILOT)
        orders=store._many("SELECT w.* FROM maintenance_work_orders w WHERE "+order_where+
            " AND w.asset_id=? ORDER BY w.created_at DESC,w.work_order_id DESC LIMIT 500",tuple(order_params))
    return reports,orders


def handle_maintenance(handler, store):
    route = urlsplit(handler.path)
    if not route.path.startswith("/api/maintenance/"):
        return False
    try:
        user = handler.auth_user
        if handler.command == "GET":
            query = parse_qs(route.query)
            if set(query) != {"project_id"} or len(query["project_id"]) != 1:
                raise ValueError("Exactly one project_id is required")
            project = query["project_id"][0]
            require_project(user,project)
            if project != "atrium-building":
                raise LookupError("Maintenance pilot is not available in this project")
            if route.path == "/api/maintenance/overview":
                reports,orders=visible_records(store,project,user)
                handler.json_response(200, {"assets": [store.get_asset(project,PILOT)],
                    "rooms": store.reports.rooms(project), "reports": reports,
                    "work_orders": orders,
                    "emergency_instruction": EMERGENCY_INSTRUCTION})
            elif route.path.startswith("/api/maintenance/reports/"):
                report_id = route.path.removeprefix("/api/maintenance/reports/")
                reports,orders=visible_records(store,project,user,report_id)
                report = reports[0] if reports else None
                if report is None:
                    raise LookupError("Report not found")
                handler.json_response(200, {"report":report,"events":store.reports.events(project,report_id),
                    "work_order":next((o for o in orders if o["work_order_id"]==report["work_order_id"]),None)})
            else:
                raise LookupError("Maintenance endpoint not found")
        elif handler.command == "POST":
            if handler.headers.get("Transfer-Encoding"):
                raise ValueError("Chunked request bodies are not supported")
            length = int(handler.headers.get("Content-Length","0"))
            if not 1 <= length <= 65536:
                raise ValueError("Report request must be between 1 and 65536 bytes")
            if handler.headers.get_content_type() != "application/json":
                raise ValueError("Content-Type must be application/json")
            handler.connection.settimeout(5)
            body = json.loads(handler.rfile.read(length), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Invalid JSON number")))
            if not isinstance(body,dict) or body.get("project_id") != "atrium-building":
                raise ValueError("A valid maintenance project_id is required")
            require_project(user,body["project_id"])
            if route.path == "/api/maintenance/reports":
                require_permission(user,"submit_reports")
                required = {"project_id","room_id","symptom","observed_at","impact","description","request_key"}
                if not required <= set(body) or set(body) - required - {"asset_id","potential_hazard"}:
                    raise ValueError("Invalid report fields")
                if not isinstance(body["request_key"],str) or not 1 <= len(body["request_key"]) <= 200:
                    raise ValueError("Invalid request key")
                body["request_key"] = "u:"+user["user_id"]+":"+hashlib.sha256(body["request_key"].encode()).hexdigest()
                report = store.reports.submit(**body,reporter=user["name"],owner_user_id=user["user_id"])
            elif route.path.startswith("/api/maintenance/reports/") and route.path.endswith("/triage"):
                require_permission(user,"triage_reports")
                required = {"project_id","expected_version","priority","reason"}
                if not required <= set(body) or set(body) - required - {"asset_id","link_mode","work_order_id","expected_work_order_version"}:
                    raise ValueError("Invalid triage fields")
                report_id = route.path[len("/api/maintenance/reports/"):-len("/triage")]
                report = store.reports.triage(report_id=report_id,**body,actor=user["user_id"])
            else:
                raise LookupError("Maintenance endpoint not found")
            handler.json_response(200,{"report":report})
        else:
            raise LookupError("Maintenance endpoint not found")
    except AuthError as exc:
        handler.json_response(exc.status,{"error":str(exc)})
    except ConflictError as exc:
        handler.json_response(409,{"error":str(exc)})
    except LookupError as exc:
        handler.json_response(404,{"error":str(exc)})
    except (ValueError,UnicodeError,TimeoutError) as exc:
        handler.json_response(400,{"error":str(exc)})
    except sqlite3.Error:
        handler.json_response(503,{"error":"Maintenance storage is unavailable; retry with the same submission key."})
    return True
