"""
Visual Codebase Mapping Platform - REST API server

Built on Python stdlib (http.server + sqlite3) — no external dependencies.
Drop-in swap to FastAPI/uvicorn when available: the route signatures and
JSON schema are identical to what FastAPI would generate.

Start:
    python server.py [--host 0.0.0.0] [--port 8000] [--db codemap.db]

Endpoints:
    GET    /health
    POST   /projects              trigger analysis (async)
    GET    /projects              list all projects
    GET    /projects/{id}         project metadata + status
    GET    /projects/{id}/graph   graph JSON (only when status=done)
    DELETE /projects/{id}         remove project and graph
    POST   /projects/{id}/reanalyze  re-run analysis (CI webhook target)
"""
import argparse
import http.server
import json
import os
import re
import socketserver
import threading
import traceback
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import urlparse

import engine.store as store
from engine.ingest import IngestError, cleanup, ingest
from engine.analyzer import analyze_repo, analyze_repo_incremental
from engine.graph_builder import to_json

# ---------------------------------------------------------------------------
# API key authentication
# Set CODEMAP_API_KEY env var to require X-Api-Key header on all protected
# routes.  /health, GET /sync, POST /sync, and OPTIONS are always public so
# that the VS Code extension and browser CORS preflight work without a key.
# ---------------------------------------------------------------------------

_API_KEY: str = os.environ.get("CODEMAP_API_KEY", "").strip()

# When CODEMAP_REQUIRE_LOGIN=1 and no API key is set, every non-public route
# requires a valid X-Session-Token header (obtained via POST /auth/login).
# When CODEMAP_API_KEY is set it is the sole auth mechanism; session auth is
# then advisory only (login still works, it just isn't enforced for access).
_REQUIRE_LOGIN: bool = bool(os.environ.get("CODEMAP_REQUIRE_LOGIN", "").strip())

# Routes that bypass auth entirely (method, exact-path)
_PUBLIC_ROUTES: set = {
    ("GET",     "/health"),
    ("GET",     "/sync"),
    ("POST",    "/sync"),
    ("POST",    "/auth/register"),
    ("POST",    "/auth/login"),
    ("POST",    "/auth/logout"),
    ("GET",     "/auth/me"),
    ("GET",     "/auth/status"),
    ("OPTIONS", "*"),        # matched by do_OPTIONS before _handle is called
}


# ---------------------------------------------------------------------------
# Background analysis
# ---------------------------------------------------------------------------

def _run_analysis(pid: str, source: str, confidential: bool,
                  trace_cmd: Optional[str], incremental: bool = False) -> None:
    """
    Runs in a daemon thread. Updates the DB as it goes.

    incremental=True: load the per-file parse cache from the DB and skip
    re-parsing unchanged files.  Has no effect for confidential jobs (no DB).
    """
    store.set_running(pid)
    result = None
    try:
        result = ingest(source, confidential=confidential)

        if incremental and not confidential:
            old_cache = store.get_file_cache(pid)
            graph_obj, new_cache = analyze_repo_incremental(result.working_dir, old_cache)
            store.set_file_cache(pid, new_cache)
        else:
            graph_obj = analyze_repo(result.working_dir)

        trace_data = None
        if trace_cmd:
            from engine.tracer import run_with_trace, to_trace_json
            raw = run_with_trace(
                result.working_dir,
                trace_cmd.split(),
                confidential=confidential,
            )
            trace_data = to_trace_json(raw, graph_obj)

        data = to_json(graph_obj, trace=trace_data)
        store.set_done(pid, data)
        n, e = len(data["nodes"]), len(data["edges"])
        mode = "incr" if (incremental and not confidential) else "full"
        print(f"  [{mode}]   {source!r:40s} -> {n} nodes, {e} edges")

    except Exception:
        err = traceback.format_exc()
        store.set_failed(pid, err)
        print(f"  [failed] {source!r}: {err.splitlines()[-1]}")
    finally:
        if result:
            cleanup(result)


def _spawn_analysis(pid: str, source: str, confidential: bool = False,
                    trace_cmd: Optional[str] = None,
                    incremental: bool = False) -> None:
    t = threading.Thread(
        target=_run_analysis,
        args=(pid, source, confidential, trace_cmd, incremental),
        daemon=True,
    )
    t.start()


# ---------------------------------------------------------------------------
# Route handlers  ->  return (status_code, response_dict | None)
# ---------------------------------------------------------------------------

def _health(_body) -> Tuple[int, dict]:
    return 200, {"status": "ok", "version": "0.2.0"}


def _list_projects(_body) -> Tuple[int, list]:
    return 200, store.list_projects()


def _post_projects(body) -> Tuple[int, dict]:
    if not body or "source" not in body:
        return 400, {"error": "'source' is required"}

    source = body["source"]
    raw_name = (body.get("name") or "").strip().strip('"\'').strip()
    name = raw_name or Path(source.rstrip("/\\")).name.replace(".git", "").strip().strip('"\'').strip()
    confidential = bool(body.get("confidential", False))
    trace_cmd = body.get("trace_cmd")

    if confidential:
        # Confidential: run synchronously, return graph inline, store nothing
        result = None
        try:
            result = ingest(source, confidential=True)
            graph_obj = analyze_repo(result.working_dir)
            data = to_json(graph_obj)
        except IngestError as e:
            return 422, {"error": str(e)}
        except Exception as e:
            return 500, {"error": str(e)}
        finally:
            if result:
                cleanup(result)
        return 200, {"id": None, "status": "ephemeral", "graph": data}

    pid = store.create_project(source, name)
    _spawn_analysis(pid, source, confidential=False, trace_cmd=trace_cmd)
    return 202, {"id": pid, "status": "pending"}


def _get_project(pid: str, _body) -> Tuple[int, dict]:
    project = store.get_project(pid)
    if not project:
        return 404, {"error": "Project not found"}
    return 200, project


def _get_graph(pid: str, _body) -> Tuple[int, dict]:
    project = store.get_project(pid)
    if not project:
        return 404, {"error": "Project not found"}
    if project["status"] != "done":
        return 409, {"error": f"Graph not ready — status: {project['status']}"}
    graph = store.get_graph(pid)
    if not graph:
        return 404, {"error": "Graph data missing"}
    return 200, graph


def _delete_project(pid: str, _body) -> Tuple[int, None]:
    if not store.delete_project(pid):
        return 404, {"error": "Project not found"}
    return 204, None


def _reanalyze(pid: str, _body) -> Tuple[int, dict]:
    """Re-run analysis on an existing project. This is the CI webhook target."""
    project = store.get_project(pid)
    if not project:
        return 404, {"error": "Project not found"}
    store.set_pending(pid)
    _spawn_analysis(pid, project["source"], incremental=True)
    return 202, {"id": pid, "status": "pending"}


def _webhook_github(body) -> Tuple[int, dict]:
    """
    GitHub push event webhook (Settings -> Webhooks -> push event).
    Triggers reanalysis for any tracked project whose source URL matches
    the pushed repository. Only acts on branch pushes (not tag pushes).
    """
    if not body:
        return 400, {"error": "Empty payload"}

    ref = body.get("ref", "")
    if not ref.startswith("refs/heads/"):
        return 200, {"message": "Not a branch push — ignored"}

    branch = ref[len("refs/heads/"):]
    repo = body.get("repository", {})
    clone_url = repo.get("clone_url") or repo.get("html_url", "")
    if not clone_url:
        return 400, {"error": "No repository URL in payload"}

    projects = store.find_projects_by_source(clone_url)
    if not projects:
        return 200, {"message": f"No project tracked for {clone_url}"}

    triggered = []
    for p in projects:
        store.set_pending(p["id"])
        _spawn_analysis(p["id"], p["source"], incremental=True)
        triggered.append(p["id"])
        print(f"  [ci]     reanalysis triggered for '{p['name']}' (branch: {branch})")

    return 202, {"branch": branch, "repository": clone_url, "triggered": triggered}


def _webhook_generic(body) -> Tuple[int, dict]:
    """
    Generic CI webhook — works with any CI system (GitLab, Bitbucket, Jenkins, etc.).
    Accepts:
      {"project_id": "<uuid>"}            — reanalyze existing project
      {"source": "<path_or_url>", ...}    — reanalyze by source, or create if unknown
    """
    if not body:
        return 400, {"error": "Empty payload"}

    if "project_id" in body:
        project = store.get_project(body["project_id"])
        if not project:
            return 404, {"error": "Project not found"}
        store.set_pending(project["id"])
        _spawn_analysis(project["id"], project["source"])
        return 202, {"id": project["id"], "status": "pending"}

    if "source" in body:
        source = body["source"]
        projects = store.find_projects_by_source(source)
        if projects:
            triggered = []
            for p in projects:
                store.set_pending(p["id"])
                _spawn_analysis(p["id"], p["source"])
                triggered.append(p["id"])
            return 202, {"triggered": triggered}
        # First time seeing this source — register and analyze
        name = body.get("name") or Path(source.rstrip("/\\")).name.replace(".git", "")
        pid = store.create_project(source, name)
        _spawn_analysis(pid, source)
        return 202, {"id": pid, "status": "pending", "created": True}

    return 400, {"error": "Provide 'project_id' or 'source'"}


# ---------------------------------------------------------------------------
# Router — maps (method, path) -> handler
# ---------------------------------------------------------------------------

_ID = r"[0-9a-f\-]+"

# ---------------------------------------------------------------------------
# Annotations (Stage 5 — Human Knowledge Capture)
# ---------------------------------------------------------------------------

def _get_annotations(pid: str, _body) -> Tuple[int, list]:
    project = store.get_project(pid)
    if not project:
        return 404, {"error": "Project not found"}
    return 200, store.get_annotations(pid)


def _post_annotation(pid: str, body) -> Tuple[int, dict]:
    if not body or not body.get("node_id") or not body.get("content"):
        return 400, {"error": "'node_id' and 'content' are required"}
    project = store.get_project(pid)
    if not project:
        return 404, {"error": "Project not found"}
    ann = store.add_annotation(
        pid,
        body["node_id"],
        body["content"],
        body.get("author", "anonymous"),
    )
    return 201, ann


def _delete_annotation(pid: str, ann_id: str, _body) -> Tuple[int, None]:
    if not store.delete_annotation(ann_id, pid):
        return 404, {"error": "Annotation not found"}
    return 204, None


# ---------------------------------------------------------------------------
# Editor sync (Stage 8 — VS Code bidirectional click-sync)
# GET  /sync        -> current selection {node_id, file, line, seq}
# POST /sync        -> set selection {node_id, file, line}
# The VS Code extension polls GET /sync; the web graph POSTs on node click.
# seq increments on every POST so the extension detects changes cheaply.
# ---------------------------------------------------------------------------

_sync_state = {"node_id": None, "file": None, "line": 1, "seq": 0}
_sync_lock = __import__("threading").Lock()


def _get_sync(_body) -> Tuple[int, dict]:
    with _sync_lock:
        return 200, dict(_sync_state)


def _post_sync(body) -> Tuple[int, dict]:
    if not body:
        return 400, {"error": "Empty body"}
    with _sync_lock:
        _sync_state["node_id"] = body.get("node_id")
        _sync_state["file"]    = body.get("file")
        _sync_state["line"]    = int(body.get("line") or 1)
        _sync_state["seq"]    += 1
        return 200, dict(_sync_state)


# ---------------------------------------------------------------------------
# ML Introspection (Stage 4)
# ---------------------------------------------------------------------------

def _post_ml_introspect(pid: str, body) -> Tuple[int, dict]:
    """
    Run ML model introspection and merge the layer graph into the project's
    existing static-analysis graph.

    Body (JSON):
      {
        "model_path":   "path/to/model.pt",   # PyTorch .pt/.pth file
        "model_name":   "MyModel",             # display name (optional)
        "input_shape":  [1, 3, 224, 224],      # sample input shape
        "framework":    "pytorch"              # "pytorch" | "keras" (default: pytorch)
      }

    The layer graph is stored in a separate "ml_graph" field in the project's
    graph JSON so it can be toggled independently in the UI.
    """
    if not body or not body.get("model_path"):
        return 400, {"error": "'model_path' is required"}

    project = store.get_project(pid)
    if not project:
        return 404, {"error": "Project not found"}

    model_path  = body["model_path"].strip().strip('"\'')
    model_name  = body.get("model_name", "model")
    input_shape = body.get("input_shape", [1, 3, 224, 224])
    framework   = body.get("framework", "pytorch").lower()

    try:
        from engine.ml_introspect import introspect_pytorch, introspect_keras, to_ml_graph_json
        import torch

        if framework == "pytorch":
            model = torch.load(model_path, map_location="cpu", weights_only=False)
            model.eval()
            sample = torch.zeros(input_shape)
            records = introspect_pytorch(model, sample)
        elif framework == "keras":
            # tensorflow import lives inside introspect_keras — raises ImportError
            # with a clear message if TF is not installed (graceful degradation)
            import numpy as np
            import tensorflow as tf  # type: ignore[import-untyped]
            model = tf.keras.models.load_model(model_path)
            sample = np.zeros(input_shape, dtype=np.float32)
            records = introspect_keras(model, sample)
        else:
            return 400, {"error": f"Unsupported framework: {framework!r}. Use 'pytorch' or 'keras'"}

        ml_graph = to_ml_graph_json(records, model_name=model_name)

        # Merge ml_graph into the project's existing graph (or store standalone)
        existing = store.get_graph(pid) or {"nodes": [], "edges": []}
        merged = {
            "nodes": existing["nodes"] + ml_graph["nodes"],
            "edges": existing["edges"] + ml_graph["edges"],
            "ml_layers": len([n for n in ml_graph["nodes"] if n["type"] == "ml_layer"]),
        }
        store.set_done(pid, merged)

        return 200, {
            "model_name":  model_name,
            "layer_count": len(records),
            "total_params": sum(r.get("param_count", 0) for r in records),
            "layers": [
                {
                    "name":        r["name"],
                    "layer_type":  r["layer_type"],
                    "param_count": r["param_count"],
                    "input_shape":  r["input_shape"],
                    "output_shape": r["output_shape"],
                    "grad_norm":   r.get("grad_norm"),
                    "attn_pattern": r.get("attn_pattern"),
                }
                for r in records
            ],
        }

    except ImportError as e:
        return 422, {"error": str(e)}
    except FileNotFoundError:
        return 404, {"error": f"Model file not found: {model_path}"}
    except Exception as e:
        return 500, {"error": f"Introspection failed: {e}"}


# ---------------------------------------------------------------------------
# User auth  (sessions are token-based: frontend stores token in localStorage
# and sends it as X-Session-Token header; no server-side cookies needed)
# ---------------------------------------------------------------------------

def _dispatch_auth(method: str, path: str, body: Optional[dict],
                   session_token: Optional[str]) -> tuple:
    """Handles all /auth/* routes."""
    if method == "POST" and path == "/auth/register":
        if not body:
            return 400, {"error": "Request body required"}
        email    = (body.get("email") or "").strip()
        name     = (body.get("name") or "").strip()
        password = (body.get("password") or "").strip()
        if not email or not name or not password:
            return 400, {"error": "email, name, and password are all required"}
        if len(password) < 8:
            return 400, {"error": "Password must be at least 8 characters"}
        user = store.create_user(email, name, password)
        if not user:
            return 409, {"error": "An account with that email already exists"}
        token = store.create_session(user["id"])
        return 201, {"user": user, "token": token}

    if method == "POST" and path == "/auth/login":
        if not body:
            return 400, {"error": "Request body required"}
        email    = (body.get("email") or "").strip()
        password = (body.get("password") or "").strip()
        if not email or not password:
            return 400, {"error": "email and password are required"}
        user = store.verify_user(email, password)
        if not user:
            return 401, {"error": "Incorrect email or password"}
        token = store.create_session(user["id"])
        return 200, {"user": user, "token": token}

    if method == "POST" and path == "/auth/logout":
        store.delete_session(session_token)
        return 200, {"ok": True}

    if method == "GET" and path == "/auth/me":
        user = store.get_session_user(session_token)
        if not user:
            return 401, {"error": "Not authenticated"}
        return 200, user

    if method == "GET" and path == "/auth/status":
        return 200, {
            "user_count": store.user_count(),
            "auth_required": bool(os.environ.get("CODEMAP_REQUIRE_LOGIN", "")),
        }

    return 404, {"error": "Not found"}


# ---------------------------------------------------------------------------
# Natural-language query (Phase 5)
# ---------------------------------------------------------------------------

def _post_query(pid: str, body) -> Tuple[int, dict]:
    """
    POST /projects/{id}/query  {query: "how does auth work"}

    Searches the project's graph using keyword matching (always) or Claude Haiku
    (when ANTHROPIC_API_KEY is set).  The frontend calls this on Enter in the
    command palette; instant local search still runs client-side on every keystroke.
    """
    if not body or not (body.get("query") or "").strip():
        return 400, {"error": "'query' is required"}
    project = store.get_project(pid)
    if not project:
        return 404, {"error": "Project not found"}
    if project["status"] != "done":
        return 409, {"error": f"Graph not ready — status: {project['status']}"}
    graph = store.get_graph(pid)
    if not graph:
        return 404, {"error": "Graph data missing"}

    from engine.query import search_graph
    result = search_graph(graph, body["query"].strip())
    return 200, result


# ---------------------------------------------------------------------------
# Quests (Stage 9 — Onboarding UX)
# ---------------------------------------------------------------------------

def _get_quests(pid: str, _body) -> Tuple[int, object]:
    from engine.quests import generate_quests
    project = store.get_project(pid)
    if not project:
        return 404, {"error": "Project not found"}
    if project["status"] != "done":
        return 409, {"error": f"Graph not ready — status: {project['status']}"}
    graph = store.get_graph(pid)
    if not graph:
        return 404, {"error": "Graph data missing"}
    return 200, generate_quests(graph)


# ---------------------------------------------------------------------------
# Router — maps (method, path) -> handler
# Handler signature: (body, **url_groups) so multi-capture routes work cleanly
# ---------------------------------------------------------------------------

_ID = r"[0-9a-f\-]+"

_ROUTES = [
    ("GET",    r"/health",                                                       lambda b, **_: _health(b)),
    ("GET",    r"/sync",                                                         lambda b, **_: _get_sync(b)),
    ("POST",   r"/sync",                                                         lambda b, **_: _post_sync(b)),
    ("GET",    r"/projects",                                                     lambda b, **_: _list_projects(b)),
    ("POST",   r"/projects",                                                     lambda b, **_: _post_projects(b)),
    ("GET",    rf"/projects/(?P<pid>{_ID})",                                     lambda b, **g: _get_project(g["pid"], b)),
    ("DELETE", rf"/projects/(?P<pid>{_ID})",                                     lambda b, **g: _delete_project(g["pid"], b)),
    ("GET",    rf"/projects/(?P<pid>{_ID})/graph",                               lambda b, **g: _get_graph(g["pid"], b)),
    ("POST",   rf"/projects/(?P<pid>{_ID})/reanalyze",                           lambda b, **g: _reanalyze(g["pid"], b)),
    # CI webhooks (Stage 10)
    ("POST",   r"/webhook/github",                                               lambda b, **_: _webhook_github(b)),
    ("POST",   r"/webhook",                                                      lambda b, **_: _webhook_generic(b)),
    # Annotations (Stage 5)
    ("GET",    rf"/projects/(?P<pid>{_ID})/annotations",                         lambda b, **g: _get_annotations(g["pid"], b)),
    ("POST",   rf"/projects/(?P<pid>{_ID})/annotations",                         lambda b, **g: _post_annotation(g["pid"], b)),
    ("DELETE", rf"/projects/(?P<pid>{_ID})/annotations/(?P<ann_id>{_ID})",       lambda b, **g: _delete_annotation(g["pid"], g["ann_id"], b)),
    # Quests (Stage 9)
    ("GET",    rf"/projects/(?P<pid>{_ID})/quests",                              lambda b, **g: _get_quests(g["pid"], b)),
    # ML introspection (Stage 4)
    ("POST",   rf"/projects/(?P<pid>{_ID})/ml-introspect",                       lambda b, **g: _post_ml_introspect(g["pid"], b)),
    # Natural-language query (Phase 5)
    ("POST",   rf"/projects/(?P<pid>{_ID})/query",                               lambda b, **g: _post_query(g["pid"], b)),
]

_COMPILED = [(m, re.compile("^" + p + "$"), fn) for m, p, fn in _ROUTES]


def _dispatch(method: str, path: str, body) -> Tuple[int, object]:
    for route_method, pattern, handler in _COMPILED:
        if route_method != method:
            continue
        m = pattern.match(path)
        if m:
            return handler(body, **m.groupdict())
    return 404, {"error": f"No route for {method} {path}"}


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

_DIST = Path(__file__).parent / "frontend" / "dist"
_FRONTEND = _DIST / "index.html"

_MIME = {
    ".js":   "application/javascript",
    ".mjs":  "application/javascript",
    ".css":  "text/css",
    ".html": "text/html; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
    ".png":  "image/png",
    ".woff2":"font/woff2",
    ".woff": "font/woff",
}


class _Handler(http.server.BaseHTTPRequestHandler):

    def _serve_static(self, file_path: Path) -> None:
        try:
            body = file_path.read_bytes()
        except FileNotFoundError:
            self._serve_frontend()  # SPA fallback for deep routes
            return
        mime = _MIME.get(file_path.suffix, "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        # JS/CSS assets have content-hashed names — cache aggressively
        if file_path.parent.name == "assets":
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(body)

    def _serve_frontend(self) -> None:
        try:
            body = _FRONTEND.read_bytes()
        except FileNotFoundError:
            self._send(404, {"error": "Web UI not built — run: cd frontend && npm install && npm run build"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> Optional[dict]:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode())
        except (json.JSONDecodeError, ValueError):
            return None  # caller checks

    def _send(self, status: int, data) -> None:
        body = json.dumps(data).encode() if data is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _handle(self, method: str) -> None:
        path = urlparse(self.path).path

        # API key auth — skip for public routes
        if _API_KEY and (method, path) not in _PUBLIC_ROUTES:
            client_key = (self.headers.get("X-Api-Key") or "").strip()
            if client_key != _API_KEY:
                self._send(401, {"error": "Missing or invalid X-Api-Key header"})
                return

        # Session auth — enforced when CODEMAP_REQUIRE_LOGIN=1 and no API key
        # is configured (if an API key is set, it is the sole auth mechanism).
        if _REQUIRE_LOGIN and not _API_KEY and (method, path) not in _PUBLIC_ROUTES:
            token = (self.headers.get("X-Session-Token") or "").strip() or None
            user = store.get_session_user(token) if token else None
            if not user:
                self._send(401, {"error": "Login required — POST /auth/login to get a session token"})
                return

        # Auth endpoints — handled separately (need session token from header)
        if path.startswith("/auth/"):
            session_token = (self.headers.get("X-Session-Token") or "").strip() or None
            body = self._read_body() if method in ("POST", "PUT", "PATCH") else None
            try:
                status, data = _dispatch_auth(method, path, body, session_token)
            except Exception:
                status, data = 500, {"error": "Internal server error"}
                traceback.print_exc()
            self._send(status, data)
            return

        body = self._read_body() if method in ("POST", "PUT", "PATCH") else None
        try:
            status, data = _dispatch(method, path, body)
        except Exception:
            status, data = 500, {"error": "Internal server error"}
            traceback.print_exc()
        self._send(status, data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Api-Key")
        self.end_headers()

    def do_GET(self):
        raw_path = urlparse(self.path).path
        # Serve static assets from the Vite dist/ folder
        if raw_path.startswith("/assets/"):
            self._serve_static(_DIST / raw_path.lstrip("/"))
        elif raw_path in ("/", "/index.html") or (
            not raw_path.startswith(("/projects", "/auth", "/health", "/sync", "/webhook"))
            and "." not in raw_path.rsplit("/", 1)[-1]
        ):
            # SPA shell for all non-API, non-asset routes (HashRouter needs only /)
            self._serve_frontend()
        else:
            self._handle("GET")
    def do_POST(self):   self._handle("POST")
    def do_DELETE(self): self._handle("DELETE")

    def log_message(self, fmt, *args):
        # Suppress noisy polling routes
        if self.path in ("/projects", "/sync") and self.command == "GET":
            return
        print(f"  {self.address_string()} {self.command} {self.path} {args[1]}")


class _ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True   # background analysis threads won't block shutdown


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run(host: str = "0.0.0.0", port: int = 8000, db_path: str = "codemap.db") -> None:
    store.init_db(Path(db_path))
    server = _ThreadedServer((host, port), _Handler)
    print(f"CodeMap API  =>  http://{host}:{port}")
    print(f"Web UI       =>  http://localhost:{port}/")
    if store._IS_PG:
        _db_display = "PostgreSQL  (DATABASE_URL)"
    else:
        _db_display = f"SQLite  ({db_path})"
    print(f"Database     =>  {_db_display}")
    if _API_KEY:
        print(f"Auth         =>  API key  (X-Api-Key header)")
    elif _REQUIRE_LOGIN:
        print(f"Auth         =>  user login required  (POST /auth/login -> X-Session-Token header)")
    else:
        print(f"Auth         =>  open  (set CODEMAP_API_KEY or CODEMAP_REQUIRE_LOGIN=1 to restrict)")
    _anth = os.environ.get("ANTHROPIC_API_KEY", "")
    if _anth:
        print(f"NL Query     =>  AI-powered  (Claude Haiku via ANTHROPIC_API_KEY)")
    else:
        print(f"NL Query     =>  keyword-only  (set ANTHROPIC_API_KEY to enable AI)")
    print()
    print("  GET    /health")
    print("  POST   /projects          {source, name?, confidential?, trace_cmd?}")
    print("  GET    /projects")
    print("  GET    /projects/<id>")
    print("  GET    /projects/<id>/graph")
    print("  DELETE /projects/<id>")
    print("  POST   /projects/<id>/reanalyze")
    print()
    print("  CI webhooks (Stage 10):")
    print("  POST   /webhook/github    GitHub push event (add in repo Settings > Webhooks)")
    print("  POST   /webhook           Generic: {project_id} or {source, name?}")
    print()
    print("  Annotations (Stage 5):")
    print("  GET    /projects/<id>/annotations")
    print("  POST   /projects/<id>/annotations   {node_id, content, author?}")
    print("  DELETE /projects/<id>/annotations/<ann_id>")
    print()
    print("  Onboarding (Stage 9):")
    print("  GET    /projects/<id>/quests")
    print()
    print("  ML Introspection (Stage 4):")
    print("  POST   /projects/<id>/ml-introspect  {model_path, input_shape, model_name?, framework?}")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CodeMap REST API server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db",   default="codemap.db")
    args = parser.parse_args()
    run(args.host, args.port, args.db)
