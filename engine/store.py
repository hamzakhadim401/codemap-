"""
Persistent storage layer — SQLite (default) or PostgreSQL.

Backend is selected at startup from the DATABASE_URL environment variable:
  - Not set / empty  ->  SQLite (file-based, zero config, good for local dev)
  - postgresql://... ->  PostgreSQL via psycopg2-binary (production)

The public API (create_project, get_project, …) is identical for both
backends so server.py never needs to know which one is active.

Implementation detail: all SQL is written with ? placeholders (SQLite style).
The _PGConn wrapper translates ? -> %s before handing queries to psycopg2,
so none of the query functions need two versions.
"""
import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

# ---------------------------------------------------------------------------
# Backend detection
# ---------------------------------------------------------------------------

_DB_URL: str = os.environ.get("DATABASE_URL", "").strip()
_IS_PG: bool = _DB_URL.startswith(("postgresql://", "postgres://"))
_DB_PATH: Path = Path("codemap.db")   # used only when _IS_PG is False

# ---------------------------------------------------------------------------
# Schema (ANSI SQL — works on both backends)
# ---------------------------------------------------------------------------

_SCHEMA_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        source      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        node_count  INTEGER DEFAULT 0,
        edge_count  INTEGER DEFAULT 0,
        error       TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS graphs (
        project_id  TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        data        TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS annotations (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        node_id     TEXT NOT NULL,
        author      TEXT NOT NULL DEFAULT 'anonymous',
        content     TEXT NOT NULL,
        created_at  TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_ann_project_node ON annotations(project_id, node_id)",
    """CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        email       TEXT UNIQUE NOT NULL,
        name        TEXT NOT NULL,
        pw_hash     TEXT NOT NULL,
        pw_salt     TEXT NOT NULL,
        created_at  TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS file_cache (
        project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        rel_path             TEXT NOT NULL,
        content_hash         TEXT NOT NULL,
        nodes_json           TEXT NOT NULL DEFAULT '[]',
        edges_json           TEXT NOT NULL DEFAULT '[]',
        pending_calls_json   TEXT NOT NULL DEFAULT '[]',
        pending_imports_json TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (project_id, rel_path)
    )""",
]


# ---------------------------------------------------------------------------
# PostgreSQL wrapper — makes psycopg2 look like sqlite3's conn.execute() API
# ---------------------------------------------------------------------------

class _PGConn:
    """
    Thin adapter so all query functions can use conn.execute("...?...", params)
    regardless of backend. Translates ? -> %s and wraps the psycopg2 cursor
    so .fetchall() / .fetchone() / .rowcount chain the same way they do on
    a sqlite3 cursor.
    """
    def __init__(self, raw):
        import psycopg2.extras
        self._conn = raw
        self._cur = raw.cursor(cursor_factory=psycopg2.extras.DictCursor)

    @staticmethod
    def _q(sql: str) -> str:
        return sql.replace("?", "%s")

    def execute(self, sql: str, params=()):
        self._cur.execute(self._q(sql), params or ())
        return self._cur          # psycopg2 cursor has .fetchall/.fetchone/.rowcount

    def executemany(self, sql: str, seq):
        self._cur.executemany(self._q(sql), seq)

    def executescript(self, statements):
        """Run a list of SQL statements inside the current transaction."""
        for stmt in statements:
            if stmt.strip():
                self._cur.execute(stmt)

    def commit(self):   self._conn.commit()
    def rollback(self): self._conn.rollback()
    def close(self):    self._conn.close()


# ---------------------------------------------------------------------------
# Connection context manager
# ---------------------------------------------------------------------------

@contextmanager
def _conn():
    """Open a per-call connection. Thread-safe — each call gets its own."""
    if _IS_PG:
        import psycopg2
        raw = psycopg2.connect(_DB_URL)
        conn = _PGConn(raw)
    else:
        raw = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
        raw.row_factory = sqlite3.Row
        raw.execute("PRAGMA journal_mode=WAL")
        raw.execute("PRAGMA foreign_keys=ON")
        conn = raw

    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------

def init_db(db_path: Optional[Path] = None) -> None:
    """
    Create tables if they don't exist.
    db_path: ignored when DATABASE_URL is set (Postgres mode).
    """
    global _DB_PATH
    if not _IS_PG and db_path:
        _DB_PATH = db_path

    if _IS_PG:
        with _conn() as conn:
            conn.executescript(_SCHEMA_STATEMENTS)
    else:
        with _conn() as conn:
            conn.executescript("\n;\n".join(_SCHEMA_STATEMENTS))


# ---------------------------------------------------------------------------
# Upsert helper (INSERT OR REPLACE is SQLite-only)
# ---------------------------------------------------------------------------

def _upsert_graph(conn, pid: str, data: str) -> None:
    if _IS_PG:
        conn.execute(
            "INSERT INTO graphs (project_id, data) VALUES (?,?) "
            "ON CONFLICT (project_id) DO UPDATE SET data=EXCLUDED.data",
            (pid, data),
        )
    else:
        conn.execute(
            "INSERT OR REPLACE INTO graphs (project_id, data) VALUES (?,?)",
            (pid, data),
        )


# ---------------------------------------------------------------------------
# Write operations
# ---------------------------------------------------------------------------

def create_project(source: str, name: str) -> str:
    pid = str(uuid.uuid4())
    now = _now()
    with _conn() as conn:
        conn.execute(
            "INSERT INTO projects (id, name, source, created_at, updated_at, status)"
            " VALUES (?,?,?,?,?,?)",
            (pid, name, source, now, now, "pending"),
        )
    return pid


def set_running(pid: str) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE projects SET status=?, updated_at=? WHERE id=?",
            ("running", _now(), pid),
        )


def set_done(pid: str, graph_data: dict) -> None:
    node_count = len(graph_data.get("nodes", []))
    edge_count = len(graph_data.get("edges", []))
    with _conn() as conn:
        conn.execute(
            "UPDATE projects SET status=?, updated_at=?, node_count=?, edge_count=? WHERE id=?",
            ("done", _now(), node_count, edge_count, pid),
        )
        _upsert_graph(conn, pid, json.dumps(graph_data))


def set_failed(pid: str, error: str) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE projects SET status=?, updated_at=?, error=? WHERE id=?",
            ("failed", _now(), error[:2000], pid),
        )


def set_pending(pid: str) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE projects SET status=?, updated_at=?, error=NULL WHERE id=?",
            ("pending", _now(), pid),
        )


def delete_project(pid: str) -> bool:
    with _conn() as conn:
        result = conn.execute("DELETE FROM projects WHERE id=?", (pid,))
    return result.rowcount > 0


# ---------------------------------------------------------------------------
# Read operations
# ---------------------------------------------------------------------------

def list_projects() -> List[Dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, name, source, status, node_count, edge_count,"
            "       created_at, updated_at, error"
            " FROM projects ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_project(pid: str) -> Optional[Dict]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM projects WHERE id=?", (pid,)
        ).fetchone()
    return dict(row) if row else None


def get_graph(pid: str) -> Optional[Dict]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT data FROM graphs WHERE project_id=?", (pid,)
        ).fetchone()
    return json.loads(row["data"]) if row else None


# ---------------------------------------------------------------------------
# Annotations (Stage 5 — Human Knowledge Capture)
# ---------------------------------------------------------------------------

def add_annotation(pid: str, node_id: str, content: str,
                   author: str = "anonymous") -> Dict:
    ann_id = str(uuid.uuid4())
    now    = _now()
    author = (author or "anonymous").strip() or "anonymous"
    with _conn() as conn:
        conn.execute(
            "INSERT INTO annotations"
            " (id, project_id, node_id, author, content, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (ann_id, pid, node_id, author, content.strip(), now),
        )
    return {
        "id": ann_id, "project_id": pid, "node_id": node_id,
        "author": author, "content": content.strip(), "created_at": now,
    }


def delete_annotation(ann_id: str, pid: str) -> bool:
    with _conn() as conn:
        r = conn.execute(
            "DELETE FROM annotations WHERE id=? AND project_id=?", (ann_id, pid)
        )
    return r.rowcount > 0


def get_annotations(pid: str) -> List[Dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM annotations WHERE project_id=? ORDER BY created_at ASC",
            (pid,),
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# File cache (Stage 10 — incremental re-analysis)
# ---------------------------------------------------------------------------

def get_file_cache(pid: str) -> Dict[str, Dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT rel_path, content_hash, nodes_json, edges_json,"
            "       pending_calls_json, pending_imports_json"
            " FROM file_cache WHERE project_id=?",
            (pid,),
        ).fetchall()
    return {r["rel_path"]: dict(r) for r in rows}


def set_file_cache(pid: str, cache: Dict[str, Dict]) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM file_cache WHERE project_id=?", (pid,))
        conn.executemany(
            "INSERT INTO file_cache"
            " (project_id, rel_path, content_hash, nodes_json, edges_json,"
            "  pending_calls_json, pending_imports_json)"
            " VALUES (?,?,?,?,?,?,?)",
            [
                (pid, rel,
                 e["content_hash"],
                 e.get("nodes_json", "[]"),
                 e.get("edges_json", "[]"),
                 e.get("pending_calls_json", "[]"),
                 e.get("pending_imports_json", "[]"))
                for rel, e in cache.items()
            ],
        )


def find_projects_by_source(url: str) -> List[Dict]:
    """Return all projects whose source matches url (with/without .git suffix)."""
    base     = url.rstrip("/")
    variants = list({base, base.removesuffix(".git"), base.removesuffix(".git") + ".git"})
    placeholders = ",".join(["?"] * len(variants))
    with _conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM projects WHERE source IN ({placeholders})",
            variants,
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# User accounts
# ---------------------------------------------------------------------------

def _hash_pw(password: str) -> tuple:
    salt = os.urandom(32).hex()
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 100_000)
    return h.hex(), salt


def _verify_pw(password: str, pw_hash: str, pw_salt: str) -> bool:
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(pw_salt), 100_000)
    return h.hex() == pw_hash


def create_user(email: str, name: str, password: str) -> Optional[Dict]:
    """Returns the new user dict, or None if email already taken."""
    uid = str(uuid.uuid4())
    now = _now()
    pw_hash, pw_salt = _hash_pw(password)
    try:
        with _conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, name, pw_hash, pw_salt, created_at)"
                " VALUES (?,?,?,?,?,?)",
                (uid, email.lower().strip(), name.strip(), pw_hash, pw_salt, now),
            )
    except Exception:
        return None
    return {"id": uid, "email": email.lower().strip(), "name": name.strip()}


def get_user_by_email(email: str) -> Optional[Dict]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email=?", (email.lower().strip(),)
        ).fetchone()
    return dict(row) if row else None


def get_user_by_id(uid: str) -> Optional[Dict]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, email, name, created_at FROM users WHERE id=?", (uid,)
        ).fetchone()
    return dict(row) if row else None


def verify_user(email: str, password: str) -> Optional[Dict]:
    """Returns safe user dict on success, None on bad credentials."""
    user = get_user_by_email(email)
    if not user:
        return None
    if not _verify_pw(password, user["pw_hash"], user["pw_salt"]):
        return None
    return {"id": user["id"], "email": user["email"], "name": user["name"]}


def user_count() -> int:
    with _conn() as conn:
        row = conn.execute("SELECT COUNT(*) FROM users").fetchone()
    return row[0] if row else 0


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

_SESSION_DAYS = 30


def create_session(user_id: str) -> str:
    token   = str(uuid.uuid4())
    now     = _now()
    expires = (datetime.now(timezone.utc) + timedelta(days=_SESSION_DAYS)).isoformat()
    with _conn() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at)"
            " VALUES (?,?,?,?)",
            (token, user_id, now, expires),
        )
    return token


def get_session_user(token: str) -> Optional[Dict]:
    """Returns safe user dict if session is valid and not expired, else None."""
    if not token:
        return None
    with _conn() as conn:
        row = conn.execute(
            "SELECT s.user_id, u.email, u.name"
            " FROM sessions s JOIN users u ON u.id = s.user_id"
            " WHERE s.token=? AND s.expires_at > ?",
            (token, _now()),
        ).fetchone()
    if not row:
        return None
    return {"id": row["user_id"], "email": row["email"], "name": row["name"]}


def delete_session(token: str) -> None:
    if not token:
        return
    with _conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))
