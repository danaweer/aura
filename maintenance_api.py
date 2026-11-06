"""Small local reporting API. Demo roles are workflow labels, not authentication."""
import json
import sqlite3
from urllib.parse import parse_qs, urlsplit

from maintenance import ConflictError
from maintenance_reports import EMERGENCY_INSTRUCTION, PILOT


def handle_maintenance(handler, store):
    route = urlsplit(handler.path)
    if not route.path.startswith("/api/maintenance/"):
        return False
    try:
        if handler.command == "GET":
            query = parse_qs(route.query)
            if set(query) != {"project_id"} or len(query["project_id"]) != 1:
                raise ValueError("Exactly one project_id is required")
            project = query["project_id"][0]
            if project != "atrium-building":
                raise LookupError("Maintenance pilot is not available in this project")
            if route.path == "/api/maintenance/overview":
                handler.json_response(200, {"assets": [store.get_asset(project,PILOT)],
                    "rooms": store.reports.rooms(project), "reports": store.reports.list(project),
                    "work_orders": store.list_work_orders(project,PILOT,500),
                    "emergency_instruction": EMERGENCY_INSTRUCTION})
            elif route.path.startswith("/api/maintenance/reports/"):
                report_id = route.path.removeprefix("/api/maintenance/reports/")
                report = store.reports.get(project,report_id)
                if report is None:
                    raise LookupError("Report not found")
                handler.json_response(200, {"report":report,"events":store.reports.events(project,report_id),
                    "work_order":store.get_work_order(project,report["work_order_id"]) if report["work_order_id"] else None})
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
            if route.path == "/api/maintenance/reports":
                required = {"project_id","room_id","reporter","symptom","observed_at","impact","description","request_key"}
                if not required <= set(body) or set(body) - required - {"asset_id","potential_hazard"}:
                    raise ValueError("Invalid report fields")
                report = store.reports.submit(**body)
            elif route.path.startswith("/api/maintenance/reports/") and route.path.endswith("/triage"):
                if handler.headers.get("X-AURA-Demo-Role") != "manager":
                    handler.json_response(403,{"error":"Select the Manager demo role to triage. Demo role is not authentication."})
                    return True
                required = {"project_id","expected_version","priority","reason"}
                if not required <= set(body) or set(body) - required - {"asset_id","link_mode","work_order_id","expected_work_order_version"}:
                    raise ValueError("Invalid triage fields")
                report_id = route.path[len("/api/maintenance/reports/"):-len("/triage")]
                report = store.reports.triage(report_id=report_id,**body)
            else:
                raise LookupError("Maintenance endpoint not found")
            handler.json_response(200,{"report":report})
        else:
            raise LookupError("Maintenance endpoint not found")
    except ConflictError as exc:
        handler.json_response(409,{"error":str(exc)})
    except LookupError as exc:
        handler.json_response(404,{"error":str(exc)})
    except (ValueError,UnicodeError,TimeoutError) as exc:
        handler.json_response(400,{"error":str(exc)})
    except sqlite3.Error:
        handler.json_response(503,{"error":"Maintenance storage is unavailable; retry with the same submission key."})
    return True
