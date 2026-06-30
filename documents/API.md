# REST API Reference

> Last updated: 2026-06-30
> Server: `server.py` — Python `http.server` (no framework dependency)
> Base URL: `http://localhost:8000` (dev) or wherever deployed

---

## Authentication

All API endpoints (except `/health`) accept an optional session token via:
```
X-Session-Token: <token>
```

Auth is controlled by `CODEMAP_REQUIRE_LOGIN` environment variable. When set, routes enforce authentication. When unset (default), all routes are open — useful for local/single-user deployments.

---

## Auth Endpoints

### `POST /auth/register`
Create a new user account.

**Body:**
```json
{ "email": "you@company.com", "name": "Alex", "password": "mypassword" }
```

**Response `201`:**
```json
{ "user": { "id": 1, "email": "you@company.com", "name": "Alex" }, "token": "abc123..." }
```

---

### `POST /auth/login`
Log in and receive a session token.

**Body:**
```json
{ "email": "you@company.com", "password": "mypassword" }
```

**Response `200`:**
```json
{ "user": { "id": 1, "email": "...", "name": "..." }, "token": "abc123..." }
```

---

### `POST /auth/logout`
Invalidate the current session token.

**Response `200`:** `{ "ok": true }`

---

### `GET /auth/me`
Get current user info.

**Response `200`:** `{ "id": 1, "email": "...", "name": "..." }`

---

## Projects (Maps) Endpoints

### `GET /projects`
List all code maps.

**Response `200`:**
```json
[
  {
    "id": 1,
    "name": "My Repo",
    "source": "/path/to/repo",
    "status": "done",
    "created_at": "2026-06-30T03:00:00Z",
    "node_count": 391,
    "edge_count": 953
  }
]
```

Status values: `pending` · `running` · `done` · `failed`

---

### `POST /projects`
Create a new map from a local path or git URL.

**Body:**
```json
{
  "source": "/path/to/local/repo",
  "name": "My Repo",
  "confidential": false
}
```

- `source` field accepts any of: `source`, `repo_url`, or `repo_path` (all treated identically)
- `confidential: true` → ephemeral processing, nothing persisted, unconditional cleanup
- Returns immediately with `status: "pending"` while analysis runs in background

**Response `202`:**
```json
{ "id": 1, "status": "pending", "name": "My Repo" }
```

---

### `POST /projects/upload`
Upload a zip file containing the repo.

**Headers:**
```
Content-Type: application/zip
X-Map-Name: My Repo
Content-Length: <byte count>
```

**Body:** Raw zip file bytes (max 500 MB)

**Behaviour:**
- Zip is extracted to a temp directory
- Top-level directory inside the zip is used as the repo root (or the temp dir itself if flat)
- Analysis runs in background; zip temp dir is deleted unconditionally when done

**Response `202`:**
```json
{ "id": 1, "status": "pending", "name": "My Repo" }
```

**Error `400`:** Content-Type was not `application/zip`
**Error `413`:** File exceeds 500 MB limit

---

### `GET /projects/:id`
Get map details.

**Response `200`:**
```json
{
  "id": 1,
  "name": "My Repo",
  "source": "/path/to/repo",
  "status": "done",
  "created_at": "...",
  "node_count": 391,
  "edge_count": 953,
  "error": null
}
```

---

### `DELETE /projects/:id`
Delete a map and its graph data.

**Response `200`:** `{ "ok": true }`

---

## Graph Endpoints

### `GET /projects/:id/graph`
Get the full knowledge graph for a map.

**Response `200`:**
```json
{
  "nodes": [
    {
      "id": "function:app.auth.login",
      "name": "login",
      "type": "function",
      "file": "app/auth.py",
      "lineno": 42,
      "loc": 18,
      "blast_radius": 7,
      "call_count": 0
    }
  ],
  "edges": [
    {
      "source": "module:app.auth",
      "target": "function:app.auth.login",
      "type": "contains"
    },
    {
      "source": "function:app.views.index",
      "target": "function:app.auth.login",
      "type": "calls"
    }
  ]
}
```

**Node fields:**
- `id` — stable identifier: `type:dotted.module.path`
- `type` — `module` · `class` · `function` · `method`
- `file` — path relative to repo root
- `lineno` — line number of definition
- `loc` — lines of code
- `blast_radius` — number of things that call this node (higher = more impact if changed)
- `call_count` — runtime call frequency (from Stage 3 tracing; 0 if not traced)

**Edge types:**
- `contains` — parent/child containment (module → class → function)
- `imports` — import relationship between modules
- `calls` — call relationship between functions

---

### `GET /projects/:id/quests`
Get auto-generated onboarding quests.

**Response `200`:**
```json
{
  "quests": [
    {
      "title": "Critical Components",
      "description": "Understand the highest blast-radius parts first",
      "nodes": ["function:app.auth.login", "class:app.models.User"]
    },
    {
      "title": "Module Tour",
      "description": "Walk through each module top-to-bottom",
      "nodes": ["module:app", "module:app.auth", "module:app.models"]
    },
    {
      "title": "Hot Path",
      "description": "Follow the most-called execution path",
      "nodes": ["function:app.views.index", "function:app.auth.login"]
    }
  ]
}
```

---

### `GET /projects/:id/query?q=<search>`
Natural-language / keyword search over the graph.

- Always does keyword matching over node names, IDs, and file paths
- If `ANTHROPIC_API_KEY` is set, uses Claude Haiku for semantic search

**Response `200`:**
```json
{
  "results": [
    { "node_id": "function:app.auth.login", "score": 0.92, "reason": "matches 'login'" }
  ]
}
```

---

## Annotations Endpoints

### `GET /projects/:id/annotations`
Get all human annotations for a map.

**Response `200`:**
```json
[
  {
    "id": 1,
    "node_id": "function:app.auth.login",
    "text": "This handles both OAuth and local auth. The fallback order matters.",
    "author": "alice@company.com",
    "created_at": "2026-06-30T03:00:00Z"
  }
]
```

---

### `POST /projects/:id/annotations`
Add an annotation to a specific node.

**Body:**
```json
{ "node_id": "function:app.auth.login", "text": "Important: ..." }
```

**Response `201`:** The created annotation object.

---

### `DELETE /projects/:id/annotations/:annotation_id`
Delete an annotation.

**Response `200`:** `{ "ok": true }`

---

## Sync Endpoint (VS Code Extension)

### `GET /sync`
Poll for the most recently selected node (used by VS Code extension to open the file at the right line).

**Response `200`:**
```json
{ "node_id": "function:app.auth.login", "file": "app/auth.py", "lineno": 42 }
```

---

### `POST /sync`
Set the currently selected node (called by the web app when user clicks a graph node).

**Body:**
```json
{ "node_id": "function:app.auth.login" }
```

**Response `200`:** `{ "ok": true }`

---

## Webhook Endpoints

### `POST /webhook/github`
GitHub push event webhook. Triggers incremental re-analysis of changed files.

**Headers:** `X-GitHub-Event: push` · `X-Hub-Signature-256: sha256=...`

**Body:** GitHub push event payload (JSON)

**Behaviour:**
- Verifies signature against `GITHUB_WEBHOOK_SECRET` env var
- Identifies changed files from the push payload
- Re-analyzes only changed files (incremental via file-hash cache)

---

### `POST /webhook/generic`
Generic webhook for non-GitHub CI systems.

**Body:**
```json
{ "project_id": 1, "changed_files": ["app/auth.py", "app/models.py"] }
```

---

## Health Check

### `GET /health`
Always returns 200. No auth required. Use this to verify the server is up.

**Response `200`:**
```json
{ "status": "ok", "version": "0.2.0" }
```

---

## Static File Serving

The server also serves the React SPA:
- `GET /` → `frontend/dist/index.html`
- `GET /assets/*` → `frontend/dist/assets/*`
- Any other non-API path → `frontend/dist/index.html` (SPA fallback)

This means you don't need a separate static file server in production — `python server.py` serves both the API and the frontend.
