# Visual Codebase Mapping Platform

> **Full project status and architecture:** see [`documents/CLAUDE.md`](documents/CLAUDE.md)
> **Frontend architecture:** see [`documents/FRONTEND.md`](documents/FRONTEND.md)
> **REST API reference:** see [`documents/API.md`](documents/API.md)

---

## Working Rules (AI must follow these every session)

### File organisation
- All engine logic lives in `engine/`. Never add new top-level Python modules for pipeline stages.
- Any new language analyzer goes into `engine/analyzers/<lang>.py` and must produce the same `Node`/`Edge` shape as `engine/analyzer.py`. `graph_builder.py` and `visualize.py` must require no changes.
- Frontend pages go in `frontend/src/pages/`. Design tokens go in `frontend/src/styles/globals.css`.

### Node ID scheme — frozen, never change
Format: `type:dotted.module.path`  
Examples: `function:app.auth.login` · `module:app.db` · `class:app.models.User`

Every stage attaches data to these same IDs. Never introduce a parallel identity scheme.

### Confidential mode — preserve in every phase
When `--confidential` / `confidential: true`:
- Processing in ephemeral temp dir only — nothing persisted, nothing logged verbatim
- Working directory deleted unconditionally on job end (success or failure)
- Guarantee lives in `engine/ingest.py → cleanup()`. Propagate it to every new stage.

### Product promise — never break this
**One action for the user:** upload a repo → get a visual map. Never reintroduce manual configuration steps into the core flow.

### Non-functional minimums (every change)
- Incremental processing only — never reparse a whole large repo on every change
- Language-agnostic data model — `Node`/`Edge` schema must not assume Python
- Every stage degrades gracefully on partial failure (static-only mode if no runtime access)
- On-prem/VPC deployment must remain possible — SQLite for dev, PostgreSQL via `DATABASE_URL` for prod

---

## Quick Verification

```bash
# Backend pipeline check
python cli.py samples/python_only --name "Sample App"
# Expected: 39 nodes, 90 edges, HTML in outputs/Sample_App.html

# Server check
python server.py
curl http://localhost:8000/health
# -> {"status": "ok", "version": "0.2.0"}

# Frontend build
cd frontend && npm run build
# -> dist/ ready; server.py serves it automatically
```

---

## Update the docs folder after every session
When a session ends, update `documents/CLAUDE.md` with what was built or changed.
The documents folder is the source of truth for project status.
