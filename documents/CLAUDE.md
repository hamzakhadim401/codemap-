# Visual Codebase Mapping Platform — Full Project Status

> **This is the living status document.** Update it at the end of every working session.
> Last updated: 2026-06-30

---

## What This Product Does

When veteran engineers leave, their intuitive understanding of the system leaves with them.
New developers are left navigating large repos with only static text documentation that
doesn't convey how things actually connect: data flow, call relationships, blast radius,
and (for ML repos) how the network behaves at runtime.

This platform replaces that text documentation with an **interactive, visual map** of any
codebase — generated automatically from source code, kept current automatically, and able
to capture the departing engineer's own judgment before they leave.

**Core promise:** One action (upload a repo → get a visual map). No manual configuration.

---

## Pipeline Architecture — 10 Stages

| # | Stage | Status | Notes |
|---|---|---|---|
| 1 | Ingestion | ✅ Done | Local paths + git URLs; confidential mode; unconditional cleanup |
| 2 | Static analysis | ✅ Done | Python via `ast`; JS/TS via tree-sitter; incremental file-hash cache |
| 3 | Runtime tracing | ✅ Partial | `sys.settrace` test-suite tracing done; OpenTelemetry/staging traffic not yet |
| 4 | ML introspection | ✅ Partial | PyTorch + Keras hooks done; auto-detection of model files not yet |
| 5 | Human knowledge capture | ✅ Partial | REST API done; guided exit-interview UI not yet |
| 6 | Unification | ✅ Done | Merges all stages into one knowledge graph keyed by stable node IDs |
| 7 | Visualization engine | ✅ Major upgrade | See Frontend section — multi-view, hulls, hover, isolated panel |
| 8 | Interactive delivery | ✅ Done | Full React SPA + VS Code extension + NL query; JetBrains not started |
| 9 | Onboarding quests | ✅ Partial | Quest generation + REST endpoint done; progress tracking not yet |
| 10 | CI feedback loop | ✅ Done | GitHub + generic webhooks; incremental file-hash cache |

---

## Backend — What Is Built

### Server (`server.py`)
REST API built on Python's built-in `http.server` (no framework dependency).

Key additions since initial build:
- **Zip upload endpoint** — `POST /projects/upload` accepts raw `application/zip` body, extracts to temp dir, runs analysis, cleans up zip temp dir unconditionally via `_zip_tmp` parameter on `_run_analysis`
- **Flexible `source` field** — `POST /projects` now accepts `source`, `repo_url`, or `repo_path` interchangeably (prevents "source required" errors from older clients)
- **Serves the React SPA** — `GET /` and any non-API path serves `frontend/dist/index.html`; `/assets/*` serves Vite build assets
- **CORS headers** include `Content-Type, X-Api-Key, X-Session-Token, X-Map-Name`

### Engine Modules (`engine/`)
All modules remain in `engine/` package per working agreement.

| File | Stage | Status |
|---|---|---|
| `engine/ingest.py` | 1 — Ingestion | Done. Handles local paths, git URLs, confidential mode cleanup |
| `engine/analyzer.py` | 2 — Static analysis | Done. Python AST + JS/TS dispatcher; incremental via file-hash cache |
| `engine/analyzers/js_ts.py` | 2 — JS/TS plugin | Done. tree-sitter; gracefully skipped if packages absent |
| `engine/tracer.py` | 3 — Runtime tracing | Done (partial). `sys.settrace` subprocess runner |
| `engine/ml_introspect.py` | 4 — ML introspection | Done (partial). PyTorch + Keras; optional imports |
| `engine/graph_builder.py` | 6 — Unification | Done. Canonical JSON schema merger |
| `engine/store.py` | 6 — Persistence | Done. SQLite default; PostgreSQL via `DATABASE_URL` |
| `engine/visualize.py` | 7 — Viz (legacy) | Done. Self-contained HTML for CLI output |
| `engine/quests.py` | 9 — Onboarding | Done (partial). Quest generation; no progress tracking yet |
| `engine/query.py` | 8 — NL query | Done. Keyword search always; Claude Haiku when API key set |

### CLI (`cli.py`)
Full pipeline orchestrator: `ingest → analyze → [trace] → unify → visualize`
Writes HTML output to `outputs/`.

**Baseline verification:**
```bash
python cli.py samples/python_only --name "Sample App"
# Expected: 39 nodes, 90 edges, HTML written to outputs/Sample_App.html

python cli.py samples/python_and_js --name "Mixed Repo"
# Validates JS/TS analyzer path (requires tree-sitter packages)

python server.py
curl http://localhost:8000/health
# -> {"status": "ok", "version": "0.2.0"}
```

---

## Frontend — Full React SPA

A complete redesign replacing the old single-file `frontend/index.html` with a proper React 18 + Vite SPA.

**Stack:** React 18.3.1 · React Router DOM 6 (HashRouter) · D3 v7 · Vite 5.3

**Build:**
```bash
cd frontend
npm install
npm run build        # output goes to frontend/dist/
npm run dev          # dev server with proxy to localhost:8000
```

### Pages / Routes

| Route | Page | Description |
|---|---|---|
| `/#/` | Landing | Public marketing page — hero, feature grid, how-it-works, CTA |
| `/#/login` | Login | Auth form → POST /auth/login → redirect to dashboard |
| `/#/signup` | Signup | Registration form → POST /auth/register → redirect to dashboard |
| `/#/dashboard` | Dashboard | Map list with polling, create-map modal, zip upload |
| `/#/map/:id` | GraphViewer | Full graph visualization — the core product |
| `/#/settings` | Settings | Profile, password, API token display, sign-out |

All routes except Landing/Login/Signup are protected by a private route guard (`AuthContext`).

### GraphViewer — Multi-View Visualization System

The most complex component. Supports four view modes:

**1. Module overview (default for repos > 60 nodes)**
- Collapses all classes/functions into their parent module file
- Each module = one large bubble, sized by component count (number shown inside)
- Inter-module import/call edges shown between bubbles
- Click a module bubble → drills into that module (Module detail view)
- Result: a 400-node repo becomes ~15 readable bubbles

**2. Module detail**
- Shows all nodes inside the selected module + their immediate cross-module neighbours (dimmed to 35% opacity)
- Breadcrumb in toolbar: `← All modules › engine`
- Click "← All modules" to return to module overview

**3. Full graph**
- Everything — all nodes and edges at once
- Default for small repos (≤ 60 nodes)
- Toolbar toggle: "Modules | Full graph"

**4. Entry-point exploration**
- Accessible via "Explore from entry point" collapsible panel (left overlay)
- Lists top 12 nodes with no incoming edges (true entry points), sorted by blast radius
- Click any entry point → BFS subgraph from that root
- Toolbar shows hop controls: `− 3 hops +` (1–8 hops)
- Breadcrumb: `← Full graph › main`

**Graph visual features (all views):**
- **Connected-component hulls** — BFS/union-find finds true connected components; convex hull drawn as a smooth colored blob behind each cluster (≥ 3 nodes); fades in after 1.2s once simulation settles; 6-color palette (blue/purple/cyan/green/amber/pink)
- **Isolated node panel** — nodes with zero connections shown with dashed amber ring on graph AND listed in a collapsible amber panel (top-left overlay) with click-to-fly navigation
- **Hover path highlighting** — mouseover a node: everything else dims to 8% opacity; direct edges + immediate neighbours stay at 100% with thicker, brighter strokes; mouseout restores full graph
- **Layout freeze** — after simulation settles, all node positions are locked (`fx/fy`); clicking a node to view details never restarts the simulation
- **Drag to reposition** — nodes can be dragged to new positions and stay pinned there
- **Auto fit-to-view** — after 1.5s the camera auto-fits the graph; "Fit view" button always available
- **Module clustering force** — custom D3 force pulls same-module nodes toward each other during simulation
- **Pre-positioning** — nodes pre-placed in circular layout by module before simulation starts (prevents random scatter)
- **Dot-grid background** — subtle SVG pattern
- **Double-text labels** — dark stroke pass + colored fill pass for readability on any background

**Left overlay panel:**
- Search bar — filters all components in current view, click result to fly to node
- Unconnected files panel (amber) — isolated nodes list with click-to-navigate
- Entry points panel (cyan) — entry point list with click-to-explore

**Detail panel (right sidebar):**
- Appears on node click
- Shows: type, name, file, line, lines of code, blast radius, dependency count
- In-edges ("Called by") and out-edges ("Calls / imports")
- Isolated node warning with amber callout
- In module-overview mode: shows component count + "Drill into module →" button

### Dashboard

- Card-based map list with status chips (pending/running/done/failed)
- **Create map modal** with two tabs:
  - "Git URL / Local path" — sends `{ source, name, confidential }` to `POST /projects`
  - "Upload zip" — sends raw zip bytes to `POST /projects/upload` with `X-Map-Name` header
- **Polling** — every 3s when any map has `pending` or `running` status; stops automatically when all done
- Delete map with confirmation dialog

### Design System (`frontend/src/styles/globals.css`)

CSS custom properties (dark theme):
```
--bg: #020617        (page background)
--surface: #0f172a   (card/panel background)
--surface-2: #1e293b
--surface-3: #172039
--border: #1e3a5f
--border-2: #233b5e
--text: #f1f5f9
--text-dim: #94a3b8
--text-muted: #475569
--purple: #a855f7
--cyan: #06b6d4
--green: #10b981
--amber: #f59e0b
--red: #ef4444
--mono: JetBrains Mono, monospace
--sans: Inter, system-ui, sans-serif
```

Utility classes: `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.input`, `.input.error`, `.card`, `.tag`, `.chip`, `.chip-done/pending/running/failed`, `.spinner`, `.nav`, `.field`, `.label`, `.ok-msg`, `.err-msg`

### API Client (`frontend/src/api.js`)

All API calls go through a central client. Token stored in `localStorage` as `cm_token`, injected via `X-Session-Token` header automatically.

Exports: `api.register`, `api.login`, `api.logout`, `api.me`, `api.listMaps`, `api.createMap`, `api.getMap`, `api.deleteMap`, `api.getGraph`, `api.getQuests`, `api.queryGraph`, `api.getAnnotations`, `api.addAnnotation`, `api.deleteAnnotation`, `api.getSync`, `api.postSync`

---

## What Is Still To Build

### Backend gaps
| Gap | Stage | Notes |
|---|---|---|
| OpenTelemetry/staging traffic tracing | 3 | Opt-in only; never run against prod without explicit consent |
| ML model file auto-detection | 4 | User must currently supply `model_path` and `input_shape` manually |
| Exit-interview UI | 5 | Annotation REST API exists; guided UI flow is missing |
| Auth enforcement on all routes | 8 | `CODEMAP_REQUIRE_LOGIN` env var is read but not enforced everywhere |
| JetBrains extension | 8 | VS Code extension done; IntelliJ/PyCharm not started |
| Quest progress tracking | 9 | Per-engineer visit tracking + gap detection not yet built |

### Frontend / visualization gaps
| Gap | Notes |
|---|---|
| 3D visualization | Currently 2D D3 only |
| Streaming graph updates | Full graph re-fetched on each page load; no incremental diff |
| Annotation UI in GraphViewer | REST API exists; in-graph pin-and-annotate UI not built |
| Quest explorer UI | REST endpoint exists; no quest UI in the SPA |
| NL query panel | `engine/query.py` exists; no UI for it in the SPA yet |

---

## Known Limitations (Accepted — Do Not "Fix" Without Discussion)

- **Call resolution is name-based**, not a full symbol table. Ambiguous on repos with many same-named functions. LSP/type-inference disambiguation is a future task.
- **JS/TS analysis requires** `tree-sitter`, `tree-sitter-javascript`, `tree-sitter-typescript`. Degrades gracefully (skips JS/TS files) if absent — intentional, not a bug.
- **ML introspection requires** `torch` or `tensorflow`. Both optional; module raises `ImportError` with a clear message if absent.
- **No incremental streaming** — full graph JSON sent to browser on each page load. Deferred to Stage 7 iteration.

---

## Non-Functional Requirements (Apply to Every Change)

- Incremental processing only — never reparse an entire large repo on every change
- Language-agnostic core data model — `Node`/`Edge` schema must not assume Python
- Every stage degrades gracefully on partial failure (static-only mode if no runtime access)
- Schema versioning on the unified graph — never assume a field exists without a migration path
- On-prem/VPC deployment must remain possible — SQLite for dev, PostgreSQL via `DATABASE_URL` for prod
- Pipeline must report its own health (which stage failed, on what file, why)
- Confidential mode guarantees apply to ALL future stages that touch source code

---

## Confidential Mode Guarantee

When `--confidential` or `confidential: true` is passed:
- Processing happens in an ephemeral temp directory only
- Nothing is persisted to the database
- Nothing is logged verbatim (git/auth output can leak tokens or file contents)
- Working directory is deleted unconditionally when the job ends (success or failure)

This guarantee lives in `engine/ingest.py → cleanup()` and is propagated through `server.py` and `engine/tracer.py`. **Preserve it in every future phase.**

---

## Node ID Scheme (Frozen — Never Change)

Format: `type:dotted.module.path`

Examples:
- `function:app.auth.login`
- `module:app.db`
- `class:app.models.User`
- `method:app.models.User.save`

Every stage attaches its data to the same stable IDs. This is what lets runtime counts, ML layer data, and human annotations merge into one graph without any stage knowing about the others. **Never introduce a parallel identity scheme.**
