# Visual Codebase Mapping Platform

## The problem this solves

When veteran engineers leave, their intuitive understanding of the system leaves with them.
New developers are left navigating large repos with only static text documentation, which
doesn't convey how things actually connect: data flow, call relationships, blast radius,
and (for ML repos) how the network itself behaves at runtime.

This project replaces that text documentation with an interactive, visual map of the
codebase that is generated automatically, stays current automatically, and can also capture
the departing engineer's own judgment before they leave.

## Product framing (do not lose this in implementation)

- **One action for the user**: upload a repo (local, zip, or git URL) -> get a visual map back.
  Everything else happens automatically. Never reintroduce manual configuration steps into
  the core flow.
- **Confidential mode is a real architectural property, not a UI checkbox.** When enabled:
  processing happens in an ephemeral temp directory only, nothing is persisted, nothing is
  logged verbatim (especially git/auth error output, which can leak tokens or file contents),
  and the working directory is deleted unconditionally when the job ends (success or failure).
  This guarantee lives in `engine/ingest.py` / `cleanup()` and is propagated through
  `server.py` and `engine/tracer.py` -- preserve it in every future phase.

## Full pipeline architecture (10 stages)

1. **Ingestion** - accept local path or git URL, normalize into a working copy — **✓ built**
2. **Static analysis** - parse source into modules/classes/functions + contains/imports/calls edges — **✓ built** (Python via `ast`; JS/TS via tree-sitter)
3. **Runtime tracing** - instrument test runs to get real call frequency and data shapes — **✓ built** (opt-in via `--trace` / `--trace-cmd`; staging traffic tracing not yet done)
4. **Model introspection** - for ML repos, capture live layer shapes, weights, gradients, attention — **✓ built** (PyTorch + Keras; auto-detection of model files not yet done)
5. **Human knowledge capture** - annotations pinned to specific graph nodes by departing engineers — **✓ built** (REST API; structured exit-interview flow UI not yet done)
6. **Unification** - merge all of the above into one knowledge graph, keyed by stable node IDs — **✓ built**
7. **Visualization engine** - D3 force-directed graph, search, click-to-focus, detail panel — **✓ built** (2D only; 3D and streaming incremental updates not yet done)
8. **Interactive delivery** - web app, VS Code extension with bidirectional click-sync, NL query — **✓ built** (VS Code only; JetBrains extension not yet done)
9. **Onboarding UX** - auto-generated guided "quests" through the highest-blast-radius parts — **✓ built** (quest generation + REST endpoint; progress tracking / gap detection not yet done)
10. **CI feedback loop** - re-run stages 1-4 incrementally on every merge to main — **✓ built** (GitHub + generic webhooks; incremental file-hash cache in the DB)

## Current file layout (all stages built)

All engine modules live under the `engine/` package. `cli.py` and `server.py` are at root.

| File | Pipeline stage | Notes |
|---|---|---|
| `engine/ingest.py` | Stage 1 — Ingestion | Local paths + git URLs; confidential mode; unconditional cleanup |
| `engine/analyzer.py` | Stage 2 — Static analysis | Python (`ast`) + JS/TS dispatcher; incremental re-analysis via file-hash cache |
| `engine/analyzers/js_ts.py` | Stage 2 — JS/TS plugin | tree-sitter; gracefully skipped if tree-sitter not installed |
| `engine/tracer.py` | Stage 3 — Runtime tracing | `sys.settrace` runner subprocess; detects pytest/unittest/main.py automatically |
| `engine/ml_introspect.py` | Stage 4 — ML introspection | PyTorch forward/backward hooks + Keras; graceful `ImportError` if framework absent |
| `engine/graph_builder.py` | Stage 6 — Unification | Merges static graph + trace data + ML layers into the canonical JSON schema |
| `engine/store.py` | Stage 6 — Persistence | SQLite (default) or PostgreSQL (`DATABASE_URL`); file-hash cache for incremental runs |
| `engine/visualize.py` | Stage 7 — Visualization | Self-contained HTML output; D3 v7 force-directed; call_count thickens edges |
| `engine/quests.py` | Stage 9 — Onboarding quests | Generates Critical Components / Module Tour / Hot Path quest lists from graph data |
| `engine/query.py` | Stage 8 — NL query | Keyword search always; Claude Haiku when `ANTHROPIC_API_KEY` is set |
| `frontend/index.html` | Stage 8 — Web UI | Single-file React-less web app; polls REST API; bidirectional VS Code sync |
| `vscode-extension/` | Stage 8 — IDE extension | Polls `GET /sync`; opens file at line when graph node is clicked |
| `cli.py` | Orchestrator (CLI) | `ingest -> analyze -> [trace] -> unify -> visualize`; writes to `outputs/` |
| `server.py` | Orchestrator (API) | REST API + GitHub/generic webhooks; runs analysis in daemon threads |
| `samples/python_only/` | Test fixture | Multi-file Python app; used to validate the full CLI pipeline |
| `samples/python_and_js/` | Test fixture | Mixed Python + JS repo; validates the JS/TS analyzer path |

## Baseline verification

Run this any time before starting new work to confirm the core pipeline is intact:

```
python cli.py samples/python_only --name "Sample App"
```

Expected: **39 nodes, 90 edges**, no errors, HTML written to `outputs/Sample_App.html`.

To validate the JS/TS analyzer path (requires tree-sitter packages):
```
python cli.py samples/python_and_js --name "Mixed Repo"
```

To validate the server:
```
python server.py          # starts on http://localhost:8000
curl http://localhost:8000/health   # -> {"status": "ok", "version": "0.2.0"}
```

Confidential mode verification: run with `--confidential` and confirm no `codemap_*`
directory is left in the system temp dir after the run completes.

## The node ID scheme is the integration seam

Every stage attaches its data to the same stable node IDs (e.g. `function:app.auth.login`,
`module:app.db`, `class:app.models.User`). This is what lets runtime counts, ML layer data,
and human annotations all merge into one graph without any stage needing to know about
the others. **Never introduce a new identity scheme for a stage — always attach to existing IDs.**

## What is still to build

These are the remaining gaps within already-started stages, not new phases:

- **Stage 3** — Staging/production traffic tracing via OpenTelemetry. Today only test-suite
  tracing (`sys.settrace`) is implemented. Opt-in only; never run against production without
  explicit user consent.
- **Stage 4** — Auto-detection of ML model files in a repo. Today the user must supply
  `model_path` and `input_shape` manually via the API.
- **Stage 5** — Structured exit-interview UI. The annotation REST API (`POST /projects/{id}/annotations`)
  is built; what's missing is a guided UI flow that prompts a departing engineer through
  the highest-blast-radius nodes and collects their notes.
- **Stage 7** — 3D visualization and streaming incremental graph updates. Today the D3
  graph is 2D and the full graph JSON is fetched once on page load.
- **Stage 8** — JetBrains extension. VS Code is done; IntelliJ/PyCharm is not started.
- **Stage 9** — Quest progress tracking and gap detection across multiple onboardings
  (i.e. "node X was never visited by any engineer in the last 3 onboardings").
- **Zip upload** — The frontend accepts a local path or git URL; drag-and-drop zip
  upload to the web UI is not yet implemented.
- **Auth enforcement** — `CODEMAP_REQUIRE_LOGIN` env var is read but the server does
  not currently enforce it on all routes. User/session tables exist in the DB.

## Known, accepted limitations (do not "fix" without discussion)

- Call resolution is name-based, not a full symbol table. Ambiguous on repos with many
  same-named functions. Precise disambiguation (LSP / type inference) is a future task.
- JS/TS analysis requires `tree-sitter`, `tree-sitter-javascript`, and
  `tree-sitter-typescript` to be installed. The analyzer degrades gracefully (skips
  JS/TS files) if they are absent — this is intentional, not a bug.
- ML introspection requires `torch` or `tensorflow` to be installed. Both are optional
  and the module raises `ImportError` with a clear message if the framework is absent.
- No incremental streaming — the full graph is re-sent to the browser on each page load.
  Incremental graph diffing is deferred to a future iteration of Stage 7.

## Non-functional requirements ("rock solid" bar — apply to every phase)

- Incremental processing only — never reparse/reprocess an entire large repo on every change
- Language-agnostic core data model — the `Node`/`Edge` schema must not assume Python
- Every stage degrades gracefully on partial failure (e.g. no runtime access -> static-only mode)
  rather than failing the whole pipeline
- Schema versioning on the unified graph from day one — never assume a field exists without a
  migration path
- On-prem / VPC deployment must remain architecturally possible — SQLite for local dev,
  PostgreSQL via `DATABASE_URL` for production; no hard dependency on a managed cloud service
- The pipeline must be able to report its own health (which stage failed, on what file, why)

## Working agreement for this codebase

- All engine logic lives in `engine/`. Do not add new top-level Python modules for pipeline
  stages — put them in the package and import from `server.py` / `cli.py`.
- Any new language analyzer goes into `engine/analyzers/<lang>.py` and must produce the same
  `Node`/`Edge` shape that `engine/analyzer.py` produces, so `graph_builder.py` and
  `visualize.py` require no changes.
- Confidential mode's guarantees (ephemeral storage, no verbatim logging, unconditional cleanup)
  apply to anything new that touches the repo's source — including future runtime tracing and
  model introspection, which will see even more sensitive data than static analysis does.
- The node ID scheme (`type:dotted.module.path`) is frozen. Future stages attach data to
  existing IDs; they never introduce a parallel identity system.
