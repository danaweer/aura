"""Account/session foundation. Passwords use argon2-cffi; session secrets stay out of SQLite."""
import hashlib
import json
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from projects import PROJECT_IDS

ROLES = ("administrator", "manager", "technician", "employee", "viewer")
HASHER = PasswordHasher()
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(32))
HASH_SLOTS = threading.BoundedSemaphore(2)
SCHEMA = (
    """CREATE TABLE auth_users (
        user_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL, password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('administrator','manager','technician','employee','viewer')),
        status TEXT NOT NULL CHECK(status IN ('active','disabled')),
        created_at REAL NOT NULL, updated_at REAL NOT NULL)""",
    """CREATE TABLE auth_user_projects (
        user_id TEXT NOT NULL REFERENCES auth_users(user_id), project_id TEXT NOT NULL,
        PRIMARY KEY(user_id,project_id))""",
    """CREATE TABLE auth_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES auth_users(user_id),
        csrf_token TEXT NOT NULL, created_at REAL NOT NULL, last_seen REAL NOT NULL,
        expires_at REAL NOT NULL)""",
    "CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at)",
    """CREATE TABLE auth_login_limits (
        bucket TEXT PRIMARY KEY, failures INTEGER NOT NULL,
        started_at REAL NOT NULL, blocked_until REAL NOT NULL)""",
    """CREATE TABLE auth_audit_events (
        event_id TEXT PRIMARY KEY, actor_user_id TEXT REFERENCES auth_users(user_id),
        target_user_id TEXT REFERENCES auth_users(user_id), at REAL NOT NULL,
        action TEXT NOT NULL, details TEXT NOT NULL)""",
    "ALTER TABLE maintenance_reports ADD COLUMN owner_user_id TEXT REFERENCES auth_users(user_id)",
    "CREATE INDEX maintenance_reports_owner ON maintenance_reports(project_id,owner_user_id,created_at)",
)


class AuthError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def capabilities(role):
    return {
        "submit_reports": role in ("administrator", "manager", "employee"),
        "triage_reports": role in ("administrator", "manager"),
        "system_operations": role in ("administrator", "manager"),
        "administration": role == "administrator",
    }


class AuthStore:
    def __init__(self, connection, lock, clock=None):
        self.connection, self.lock = connection, lock
        self.clock = clock or time.time
        with self._write():
            self.connection.execute("CREATE TABLE IF NOT EXISTS auth_schema_migrations (version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)")
            versions = self.connection.execute("SELECT version FROM auth_schema_migrations ORDER BY version").fetchall()
            if versions not in ([], [(1,)], [(1,), (2,)]):
                raise ValueError("Unsupported authentication schema; no downgrade performed")
            if not versions:
                for sql in SCHEMA:
                    self.connection.execute(sql)
                self.connection.execute("INSERT INTO auth_schema_migrations VALUES (1,?)", (self.clock(),))
            if (2,) not in versions:
                self.connection.execute("ALTER TABLE auth_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1))")
                self.connection.execute("ALTER TABLE auth_users ADD COLUMN temporary_password_expires_at REAL")
                self.connection.execute("ALTER TABLE auth_users ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
                self.connection.execute("INSERT INTO auth_schema_migrations VALUES (2,?)", (self.clock(),))

    @contextmanager
    def _write(self):
        with self.lock, self.connection:
            self.connection.execute("BEGIN IMMEDIATE")
            yield

    def _one(self, sql, parameters=()):
        cursor = self.connection.execute(sql, parameters)
        row = cursor.fetchone()
        return dict(zip((c[0] for c in cursor.description), row)) if row else None

    def _audit(self, action, actor=None, target=None, **details):
        self.connection.execute("INSERT INTO auth_audit_events VALUES (?,?,?,?,?,?)",
            (str(uuid.uuid4()), actor, target, self.clock(), action, json.dumps(details)))

    def initialized(self):
        with self.lock:
            return bool(self.connection.execute("SELECT 1 FROM auth_users LIMIT 1").fetchone())

    def _public_user(self, row, include_disabled=False):
        if row is None or (row["status"] != "active" and not include_disabled):
            return None
        fields = {k: row[k] for k in ("user_id", "username", "name", "role", "status", "version")}
        fields["must_change_password"] = bool(row["must_change_password"])
        fields["projects"] = [r[0] for r in self.connection.execute(
            "SELECT project_id FROM auth_user_projects WHERE user_id=? ORDER BY project_id", (row["user_id"],))]
        fields["permissions"] = capabilities(row["role"])
        return fields

    def _create_user(self, username, name, password, role, projects, actor=None):
        if not isinstance(username, str) or not re.fullmatch(r"[a-zA-Z0-9@._+\-]{3,128}", username):
            raise ValueError("Username must be 3–128 ASCII letters, digits or @ . _ + -")
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            raise ValueError("A display name of at most 200 characters is required")
        if not isinstance(password, str) or not 15 <= len(password) <= 128:
            raise ValueError("Password must be 15–128 characters")
        self._validate_access(role, "active", projects)
        user_id, now = str(uuid.uuid4()), self.clock()
        self.connection.execute("INSERT INTO auth_users (user_id,username,name,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?)",
            (user_id, username.lower(), name.strip(), HASHER.hash(password), role, now, now))
        self.connection.executemany("INSERT INTO auth_user_projects VALUES (?,?)", [(user_id,p) for p in sorted(set(projects))])
        self._audit("user_created", actor, user_id, role=role, projects=sorted(set(projects)))
        return self._public_user(self._one("SELECT * FROM auth_users WHERE user_id=?", (user_id,)))

    def bootstrap_admin(self, username, name, password):
        with self._write():
            if self.connection.execute("SELECT 1 FROM auth_users LIMIT 1").fetchone():
                raise ValueError("Bootstrap is closed: an account already exists")
            return self._create_user(username, name, password, "administrator", PROJECT_IDS)

    def create_user(self, actor_id, username, name, password, role, projects):
        """Trusted internal provisioning for local fixtures; the UI uses forced setup."""
        with self._write():
            self._administrator(actor_id)
            return self._create_user(username, name, password, role, projects, actor_id)

    def _session(self, user_id, lifetime):
        token, csrf, now = secrets.token_urlsafe(32), secrets.token_urlsafe(32), self.clock()
        self.connection.execute("DELETE FROM auth_sessions WHERE expires_at<=?", (now,))
        self.connection.execute("INSERT INTO auth_sessions VALUES (?,?,?,?,?,?)",
            (digest(token),user_id,csrf,now,now,now+lifetime))
        return token, {"csrf_token":csrf,"expires_at":now+lifetime}

    def anonymous_session(self):
        with self._write():
            return self._session(None,600)

    def session(self, token, idle_seconds=1800, touch=True):
        if not isinstance(token,str) or not 32 <= len(token) <= 128:
            return None
        with self._write():
            row = self._one("SELECT * FROM auth_sessions WHERE token_hash=?", (digest(token),))
            if not row:
                return None
            now = self.clock()
            user = self._public_user(self._one("SELECT * FROM auth_users WHERE user_id=?", (row["user_id"],))) if row["user_id"] else None
            if row["expires_at"] <= now or now-row["last_seen"] >= idle_seconds or (row["user_id"] and user is None):
                self.connection.execute("DELETE FROM auth_sessions WHERE token_hash=?", (row["token_hash"],))
                self._audit("session_invalidated", row["user_id"], row["user_id"])
                return None
            if touch:
                self.connection.execute("UPDATE auth_sessions SET last_seen=? WHERE token_hash=?", (now,row["token_hash"]))
            return {"user":user,"csrf_token":row["csrf_token"],"expires_at":row["expires_at"]}

    def login(self, token, username, password, address, lifetime=28800):
        if not isinstance(username,str) or len(username)>128 or not isinstance(password,str) or not 1 <= len(password)<=128:
            raise AuthError(400,"Invalid sign-in request")
        username = username.lower()
        buckets = [(digest("user:"+username),5), (digest("ip:"+address),20)]
        now = self.clock()
        with self.lock:
            for bucket,_ in buckets:
                limit = self._one("SELECT * FROM auth_login_limits WHERE bucket=?", (bucket,))
                if limit and limit["blocked_until"]>now:
                    raise AuthError(429,"Too many sign-in attempts. Wait five minutes before retrying.")
            user = self._one("SELECT * FROM auth_users WHERE username=?", (username,))
        if not HASH_SLOTS.acquire(blocking=False):
            raise AuthError(429,"Sign-in is busy. Please try again shortly.")
        try:
            try:
                valid = HASHER.verify(user["password_hash"] if user else DUMMY_HASH, password)
            except (VerificationError,InvalidHashError):
                valid = False
            new_hash = HASHER.hash(password) if valid and user and HASHER.check_needs_rehash(user["password_hash"]) else None
        finally:
            HASH_SLOTS.release()
        with self._write():
            prior = self._one("SELECT expires_at FROM auth_sessions WHERE token_hash=?", (digest(token),))
            if not prior or prior["expires_at"] <= self.clock():
                raise AuthError(403,"Sign-in session expired; refresh before retrying")
            current = self._one("SELECT * FROM auth_users WHERE user_id=?", (user["user_id"],)) if user else None
            if not valid or not current or current["status"] != "active" or current["password_hash"] != user["password_hash"] or (current["must_change_password"] and (current["temporary_password_expires_at"] or 0) <= self.clock()):
                for bucket,threshold in buckets:
                    old = self._one("SELECT * FROM auth_login_limits WHERE bucket=?", (bucket,))
                    count = old["failures"]+1 if old and now-old["started_at"]<300 else 1
                    start = old["started_at"] if old and now-old["started_at"]<300 else now
                    self.connection.execute("INSERT INTO auth_login_limits VALUES (?,?,?,?) ON CONFLICT(bucket) DO UPDATE SET failures=excluded.failures,started_at=excluded.started_at,blocked_until=excluded.blocked_until",
                        (bucket,count,start,now+300 if count>=threshold else 0))
                self._audit("login_failed", target=current["user_id"] if current else None, username=username)
            else:
                # Rotate and invalidate the anonymous/prior session; no fixation.
                self.connection.execute("DELETE FROM auth_sessions WHERE token_hash=?", (digest(token),))
                self.connection.execute("DELETE FROM auth_login_limits WHERE bucket=?", (buckets[0][0],))
                if new_hash:
                    self.connection.execute("UPDATE auth_users SET password_hash=?,updated_at=? WHERE user_id=?", (new_hash,now,current["user_id"]))
                if current["must_change_password"]:
                    lifetime = min(lifetime,900,current["temporary_password_expires_at"]-self.clock())
                new_token, result = self._session(current["user_id"],lifetime)
                result["user"] = self._public_user(current)
                self._audit("login_succeeded", current["user_id"], current["user_id"])
                return new_token, result
        raise AuthError(401,"Invalid username or password")

    def logout(self, token):
        with self._write():
            row = self._one("SELECT user_id FROM auth_sessions WHERE token_hash=?", (digest(token),))
            self.connection.execute("DELETE FROM auth_sessions WHERE token_hash=?", (digest(token),))
            if row:
                self._audit("logout",row["user_id"],row["user_id"])

    @staticmethod
    def _validate_access(role, status, projects):
        if not isinstance(role,str) or role not in ROLES or status not in ("active","disabled"):
            raise ValueError("Select a valid role and account status")
        if not isinstance(projects,list) and not isinstance(projects,tuple):
            raise ValueError("Projects must be a list of existing project IDs")
        if any(not isinstance(p,str) or p not in PROJECT_IDS for p in projects) or len(set(projects)) != len(projects):
            raise ValueError("Select distinct existing projects")

    def _administrator(self, actor_id, token=None):
        actor = self._one("SELECT * FROM auth_users WHERE user_id=?",(actor_id,))
        if not actor or actor["status"] != "active" or actor["role"] != "administrator" or actor["must_change_password"]:
            raise AuthError(403,"Administrator permission required")
        if token is not None:
            session = self._one("SELECT * FROM auth_sessions WHERE token_hash=? AND user_id=?",(digest(token),actor_id))
            if not session or session["expires_at"] <= self.clock():
                raise AuthError(401,"Session invalidated; please sign in again")

    def list_users(self, actor_id, token=None):
        with self.lock:
            self._administrator(actor_id,token)
            rows=self.connection.execute("SELECT user_id FROM auth_users ORDER BY username").fetchall()
            return [self._public_user(self._one("SELECT * FROM auth_users WHERE user_id=?",row),True) for row in rows]

    def provision_user(self, actor_id, username, name, role, projects, token=None):
        temporary=secrets.token_urlsafe(24)
        with self._write():
            self._administrator(actor_id,token)
            user=self._create_user(username,name,temporary,role,projects,actor_id)
            expires=self.clock()+86400
            self.connection.execute("UPDATE auth_users SET must_change_password=1,temporary_password_expires_at=? WHERE user_id=?",(expires,user["user_id"]))
            self._audit("temporary_password_setup",actor_id,user["user_id"],expires_at=expires)
            user=self._public_user(self._one("SELECT * FROM auth_users WHERE user_id=?",(user["user_id"],)))
            return {"user":user,"temporary_password":temporary,"expires_at":expires}

    def _target_version(self, user_id, expected_version):
        if type(expected_version) is not int or expected_version < 1:
            raise ValueError("A positive account version is required")
        row=self._one("SELECT * FROM auth_users WHERE user_id=?",(user_id,))
        if not row: raise AuthError(404,"User not found")
        if row["version"] != expected_version: raise AuthError(409,"Account changed; refresh users before retrying")
        return row

    def update_user(self, actor_id, user_id, expected_version, role, status, projects, token=None):
        self._validate_access(role,status,projects)
        with self._write():
            self._administrator(actor_id,token)
            before=self._target_version(user_id,expected_version)
            old=self._public_user(before,True)
            if before["role"]=="administrator" and before["status"]=="active" and not before["must_change_password"] and (role!="administrator" or status!="active"):
                count=self.connection.execute("SELECT COUNT(*) FROM auth_users WHERE role='administrator' AND status='active' AND must_change_password=0").fetchone()[0]
                if count<=1: raise AuthError(409,"The final active administrator cannot be disabled or demoted")
            changes=[]
            if before["role"]!=role: changes.append(("role_changed",{"before":before["role"],"after":role}))
            if before["status"]!=status: changes.append(("account_disabled" if status=="disabled" else "account_enabled",{}))
            if old["projects"]!=sorted(projects): changes.append(("project_grants_changed",{"before":old["projects"],"after":sorted(projects)}))
            if changes:
                self.connection.execute("UPDATE auth_users SET role=?,status=?,updated_at=?,version=version+1 WHERE user_id=?",(role,status,self.clock(),user_id))
                self.connection.execute("DELETE FROM auth_user_projects WHERE user_id=?",(user_id,))
                self.connection.executemany("INSERT INTO auth_user_projects VALUES (?,?)",[(user_id,p) for p in projects])
                self.connection.execute("DELETE FROM auth_sessions WHERE user_id=?",(user_id,))
                for action,details in changes: self._audit(action,actor_id,user_id,**details)
            return self._public_user(self._one("SELECT * FROM auth_users WHERE user_id=?",(user_id,)),True)

    def reset_password(self, actor_id, user_id, expected_version, token=None):
        temporary=secrets.token_urlsafe(24)
        with self._write():
            self._administrator(actor_id,token)
            self._target_version(user_id,expected_version)
            if actor_id==user_id:
                raise AuthError(400,"Ask another administrator to reset your password; self-reset is not available here")
            expires=self.clock()+86400
            self.connection.execute("UPDATE auth_users SET password_hash=?,must_change_password=1,temporary_password_expires_at=?,updated_at=?,version=version+1 WHERE user_id=?",(HASHER.hash(temporary),expires,self.clock(),user_id))
            self.connection.execute("DELETE FROM auth_sessions WHERE user_id=?",(user_id,))
            username=self._one("SELECT username FROM auth_users WHERE user_id=?",(user_id,))["username"]
            self.connection.execute("DELETE FROM auth_login_limits WHERE bucket IN (?,?)",(digest("user:"+username),digest("change:"+user_id)))
            self._audit("password_reset",actor_id,user_id,expires_at=expires)
            return {"user":self._public_user(self._one("SELECT * FROM auth_users WHERE user_id=?",(user_id,)),True),"temporary_password":temporary,"expires_at":expires}

    def change_password(self, token, current_password, new_password):
        if not isinstance(current_password,str) or not 1<=len(current_password)<=128:
            raise ValueError("Current password is required")
        if not isinstance(new_password,str) or not 15<=len(new_password)<=128 or new_password==current_password:
            raise ValueError("Choose a different password of 15–128 characters")
        session=self.session(token)
        if not session or not session["user"]: raise AuthError(401,"Session expired; please sign in again")
        user_id=session["user"]["user_id"]
        bucket=digest("change:"+user_id)
        with self.lock:
            user=self._one("SELECT * FROM auth_users WHERE user_id=?",(user_id,))
            limit=self._one("SELECT * FROM auth_login_limits WHERE bucket=?",(bucket,))
            if limit and limit["blocked_until"]>self.clock(): raise AuthError(429,"Too many password attempts; wait five minutes")
        if not HASH_SLOTS.acquire(blocking=False): raise AuthError(429,"Password service is busy; retry shortly")
        try:
            try: valid=HASHER.verify(user["password_hash"],current_password)
            except (VerificationError,InvalidHashError): valid=False
            hashed=HASHER.hash(new_password) if valid else None
        finally: HASH_SLOTS.release()
        with self._write():
            active=self._one("SELECT * FROM auth_sessions WHERE token_hash=? AND user_id=?",(digest(token),user_id))
            current=self._one("SELECT * FROM auth_users WHERE user_id=?",(user_id,))
            if not active or active["expires_at"]<=self.clock() or current["status"]!="active" or current["version"]!=user["version"]:
                raise AuthError(401,"Account or session changed; please sign in again")
            if valid:
                self.connection.execute("UPDATE auth_users SET password_hash=?,must_change_password=0,temporary_password_expires_at=NULL,updated_at=?,version=version+1 WHERE user_id=?",(hashed,self.clock(),user_id))
                self.connection.execute("DELETE FROM auth_sessions WHERE user_id=?",(user_id,))
                self.connection.execute("DELETE FROM auth_login_limits WHERE bucket=?",(bucket,))
                self._audit("password_changed",user_id,user_id)
                return
            now=self.clock()
            old=self._one("SELECT * FROM auth_login_limits WHERE bucket=?",(bucket,))
            recent=old and now-old["started_at"]<300
            count=old["failures"]+1 if recent else 1
            start=old["started_at"] if recent else now
            self.connection.execute("INSERT OR REPLACE INTO auth_login_limits VALUES (?,?,?,?)",(bucket,count,start,now+300 if count>=5 else 0))
            self._audit("password_change_failed",user_id,user_id)
        raise AuthError(400,"Current password is incorrect")
