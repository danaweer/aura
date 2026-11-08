"""Administrator-only account operations using the existing cookie/CSRF boundary."""
import re
import sqlite3
from urllib.parse import urlsplit

from auth import AuthError, ROLES
from auth_http import cookie_token, json_body, require_permission
from projects import project_catalog


def handle_user_management(handler, room):
    path=urlsplit(handler.path).path
    if not path.startswith("/api/admin/"): return False
    try:
        require_permission(handler.auth_user,"administration")
        store=handler.auth_store
        actor=handler.auth_user["user_id"]
        token=cookie_token(handler)
        if handler.command=="GET" and path=="/api/admin/users":
            users=store.list_users(actor,token)
            projects=[{"id":p["id"],"name":p["name"]} for p in project_catalog(room)["projects"]]
            handler.json_response(200,{"users":users,"roles":list(ROLES),"projects":projects})
        elif handler.command=="POST" and path=="/api/admin/users":
            body=json_body(handler,8192)
            if set(body)!={"username","name","role","projects"}: raise ValueError("Username, name, role and projects are required")
            result=store.provision_user(actor,**body,token=token)
            handler.json_response(201,result)
        elif handler.command=="POST" and (match:=re.fullmatch(r"/api/admin/users/([a-f0-9-]{36})(/reset-password)?",path)):
            body=json_body(handler,8192)
            if match[2]:
                if set(body)!={"expected_version"}: raise ValueError("Only the current account version is required")
                result=store.reset_password(actor,match[1],**body,token=token)
            else:
                if set(body)!={"expected_version","role","status","projects"}: raise ValueError("Role, status, projects and current version are required")
                result={"user":store.update_user(actor,match[1],**body,token=token)}
            handler.json_response(200,result)
        else: raise AuthError(404,"Account endpoint not found")
    except AuthError as exc: handler.json_response(exc.status,{"error":str(exc)})
    except sqlite3.IntegrityError:
        handler.json_response(409,{"error":"Username already exists or the account change conflicts with stored data"})
    except (ValueError,UnicodeError,TimeoutError) as exc: handler.json_response(400,{"error":str(exc)})
    except sqlite3.Error: handler.json_response(503,{"error":"Account storage is unavailable"})
    return True
