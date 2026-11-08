"""Cookie/CSRF boundary for the existing HTTP server; no trusted proxy headers."""
import hmac
import json
import sqlite3
from dataclasses import dataclass
from http.cookies import SimpleCookie, CookieError
from urllib.parse import urlsplit

from auth import AuthError


@dataclass(frozen=True)
class AuthSettings:
    public_origin: str | None = None
    secure_cookies: bool = False
    session_seconds: int = 28800
    idle_seconds: int = 1800

    def __post_init__(self):
        if self.public_origin:
            parsed = urlsplit(self.public_origin)
            if parsed.scheme not in ("http","https") or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
                raise ValueError("Public origin must be an http(s) origin without a path")
            if parsed.scheme == "https":
                object.__setattr__(self,"secure_cookies",True)
        if self.secure_cookies and (not self.public_origin or urlsplit(self.public_origin).scheme != "https"):
            raise ValueError("Secure cookies require an explicit HTTPS public origin")
        if not 60 <= self.session_seconds <= 86400 or not 60 <= self.idle_seconds <= self.session_seconds:
            raise ValueError("Invalid session expiration settings")

    @property
    def cookie_name(self):
        return "__Host-aura_session" if self.secure_cookies else "aura_session"


def origins(handler):
    settings = handler.auth_settings
    if settings.public_origin:
        return {settings.public_origin}
    port = handler.server.server_address[1]
    return {f"http://127.0.0.1:{port}",f"http://localhost:{port}"}


def trusted_host(handler):
    if handler.headers.get("Host","").lower() not in {urlsplit(o).netloc.lower() for o in origins(handler)}:
        raise AuthError(403,"Untrusted request host")


def cookie_token(handler):
    raw = handler.headers.get("Cookie","")
    if len(raw)>8192:
        return ""
    try:
        cookies=SimpleCookie(); cookies.load(raw)
        value=cookies.get(handler.auth_settings.cookie_name)
        return value.value if value else ""
    except CookieError:
        return ""


def cookie_header(settings, token="", max_age=0):
    cookie=SimpleCookie(); cookie[settings.cookie_name]=token
    item=cookie[settings.cookie_name]
    item["path"]="/"; item["httponly"]=True; item["samesite"]="Strict"; item["max-age"]=str(max_age)
    if settings.secure_cookies: item["secure"]=True
    return item.OutputString()


def check_csrf(handler, session):
    if handler.headers.get("Origin") not in origins(handler):
        raise AuthError(403,"Request origin is not permitted")
    supplied=handler.headers.get("X-CSRF-Token","")
    if not session or not supplied or not hmac.compare_digest(supplied.encode("utf-8"),session["csrf_token"].encode("ascii")):
        raise AuthError(403,"Invalid CSRF token; refresh the session before retrying")


def json_body(handler, maximum=65536):
    if handler.headers.get("Transfer-Encoding"):
        raise ValueError("Chunked bodies are not supported")
    length=int(handler.headers.get("Content-Length","0"))
    if not 1 <= length <= maximum or handler.headers.get_content_type() != "application/json":
        raise ValueError("A bounded application/json request body is required")
    handler.connection.settimeout(5)
    def invalid(_): raise ValueError("Invalid JSON value")
    body=json.loads(handler.rfile.read(length),parse_constant=invalid)
    if not isinstance(body,dict): raise ValueError("JSON body must be an object")
    return body


def require_project(user, project):
    if project not in user["projects"]:
        raise AuthError(403,"Project access denied")


def require_permission(user, permission):
    if not user["permissions"].get(permission):
        raise AuthError(403,"You do not have permission for this operation")


def authenticate(handler, write=False):
    trusted_host(handler)
    token=cookie_token(handler)
    session=handler.auth_store.session(token,handler.auth_settings.idle_seconds)
    if not session or not session["user"]:
        raise AuthError(401,"Authentication required or session expired")
    if write: check_csrf(handler,session)
    if session["user"]["must_change_password"]:
        raise AuthError(403,"Password change required before accessing AURA")
    handler.auth_user=session["user"]
    handler.auth_session=session
    return session["user"]


def handle_auth(handler):
    path=urlsplit(handler.path).path
    if not path.startswith("/api/auth/"): return False
    try:
        trusted_host(handler)
        token=cookie_token(handler)
        session=handler.auth_store.session(token,handler.auth_settings.idle_seconds,touch=False)
        if handler.command == "GET" and path == "/api/auth/session":
            if not session:
                token,session=handler.auth_store.anonymous_session()
                session["user"]=None
                handler.pending_cookie=cookie_header(handler.auth_settings,token,600)
            handler.json_response(200,{**session,"bootstrap_required":not handler.auth_store.initialized()})
        elif handler.command == "GET" and path == "/api/auth/me":
            if not session or not session["user"]: raise AuthError(401,"Session expired or not signed in")
            handler.json_response(200,session)
        elif handler.command == "POST" and path == "/api/auth/login":
            check_csrf(handler,session)
            body=json_body(handler,4096)
            if set(body) != {"username","password"}: raise ValueError("Username and password are required")
            token,result=handler.auth_store.login(token,body["username"],body["password"],handler.client_address[0],handler.auth_settings.session_seconds)
            handler.pending_cookie=cookie_header(handler.auth_settings,token,handler.auth_settings.session_seconds)
            handler.json_response(200,result)
        elif handler.command == "POST" and path == "/api/auth/logout":
            if not session or not session["user"]: raise AuthError(401,"Session expired or not signed in")
            check_csrf(handler,session)
            handler.auth_store.logout(token)
            handler.pending_cookie=cookie_header(handler.auth_settings)
            handler.json_response(200,{"logged_out":True})
        elif handler.command == "POST" and path == "/api/auth/change-password":
            if not session or not session["user"]: raise AuthError(401,"Session expired or not signed in")
            check_csrf(handler,session)
            body=json_body(handler,4096)
            if set(body)!={"current_password","new_password"}: raise ValueError("Current and new password are required")
            handler.auth_store.change_password(token,**body)
            handler.pending_cookie=cookie_header(handler.auth_settings)
            handler.json_response(200,{"password_changed":True,"sign_in_required":True})
        else: raise AuthError(404,"Authentication endpoint not found")
    except AuthError as exc:
        handler.json_response(exc.status,{"error":str(exc)})
    except (ValueError,UnicodeError,TimeoutError) as exc:
        handler.json_response(400,{"error":str(exc)})
    except sqlite3.Error:
        handler.json_response(503,{"error":"Authentication storage is unavailable"})
    return True
