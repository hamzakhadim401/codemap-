# Frontend SPA — Architecture Reference

> Last updated: 2026-06-30

---

## Stack

| Tool | Version | Purpose |
|---|---|---|
| React | 18.3.1 | UI framework |
| React Router DOM | 6.23.1 | Client-side routing (HashRouter) |
| D3 | 7.9.0 | Force-directed graph simulation and SVG rendering |
| Vite | 5.3.1 | Build tool + dev server |
| @vitejs/plugin-react | 4.3.1 | JSX transform |

**Why HashRouter?** The server only needs to serve `GET /` — all route navigation happens client-side via the URL hash (`/#/dashboard`, `/#/map/42`). This means no server-side route handling needed beyond serving `index.html`.

---

## Project Structure

```
frontend/
├── index.html                  # Vite entry point
├── package.json
├── vite.config.js              # Dev proxy config
├── src/
│   ├── main.jsx                # React root mount
│   ├── App.jsx                 # Router + AuthProvider + route guard
│   ├── api.js                  # Central API client
│   └── styles/
│       └── globals.css         # Full design system (CSS custom properties)
│   └── pages/
│       ├── Landing.jsx         # Public marketing page
│       ├── Login.jsx           # Auth form
│       ├── Signup.jsx          # Registration form
│       ├── Dashboard.jsx       # Map list + create modal
│       ├── GraphViewer.jsx     # Core visualization (most complex)
│       └── Settings.jsx        # User settings
└── dist/                       # Vite build output (served by server.py)
```

---

## Routing (`App.jsx`)

```
/#/           → Landing         (public)
/#/login      → Login           (public)
/#/signup     → Signup          (public)
/#/dashboard  → Dashboard       (requires auth)
/#/map/:id    → GraphViewer     (requires auth)
/#/settings   → Settings        (requires auth)
```

**Auth guard:** `AuthContext` stores `{ user, token }`. `PrivateRoute` wrapper redirects unauthenticated users to `/#/login`.

Token is persisted to `localStorage` as `cm_token`. On app load, `AuthProvider` reads it back to restore session.

---

## API Client (`api.js`)

All HTTP calls go through this module. Never use `fetch` directly in components.

```js
api.register(email, name, password)   // POST /auth/register
api.login(email, password)            // POST /auth/login
api.logout()                          // POST /auth/logout
api.me()                              // GET  /auth/me

api.listMaps()                        // GET  /projects
api.createMap(source, name, conf)     // POST /projects  { source, name, confidential }
api.getMap(id)                        // GET  /projects/:id
api.deleteMap(id)                     // DELETE /projects/:id
api.getGraph(id)                      // GET  /projects/:id/graph
api.getQuests(id)                     // GET  /projects/:id/quests
api.queryGraph(id, q)                 // GET  /projects/:id/query?q=...
api.getAnnotations(id)                // GET  /projects/:id/annotations
api.addAnnotation(id, nodeId, text)   // POST /projects/:id/annotations
api.deleteAnnotation(id, annId)       // DELETE /projects/:id/annotations/:annId
api.getSync()                         // GET  /sync
api.postSync(nodeId)                  // POST /sync
```

**Auth header:** Every request automatically includes `X-Session-Token: <token>` via the `hdrs()` helper.

**Zip upload** (raw, not via api.js):
```js
fetch("/projects/upload", {
  method: "POST",
  headers: { "Content-Type": "application/zip", "X-Map-Name": name, "X-Session-Token": token },
  body: zipFileBytes
})
```

---

## Dev Proxy (`vite.config.js`)

In development, the Vite dev server proxies API calls to the Python server:

```
/projects  →  http://localhost:8000
/auth      →  http://localhost:8000
/health    →  http://localhost:8000
/sync      →  http://localhost:8000
/webhook   →  http://localhost:8000
```

This means `npm run dev` + `python server.py` is the full local dev setup.

---

## Design System (`globals.css`)

Everything uses CSS custom properties. Never hardcode colours.

### Colour tokens

```css
--bg:         #020617    /* deepest background */
--surface:    #0f172a    /* cards, panels, navbar */
--surface-2:  #1e293b    /* input fields, inner cards */
--surface-3:  #172039    /* hover states */
--border:     #1e3a5f
--border-2:   #233b5e    /* hover border */

--text:       #f1f5f9    /* primary text */
--text-dim:   #94a3b8    /* secondary text */
--text-muted: #475569    /* placeholder, labels */

--purple:     #a855f7
--cyan:       #06b6d4
--green:      #10b981
--amber:      #f59e0b
--red:        #ef4444

--mono:   JetBrains Mono, monospace
--sans:   Inter, system-ui, sans-serif
--r:      10px  /* border-radius */
```

### Component classes

```css
.btn            /* base button */
.btn-primary    /* purple gradient, white text */
.btn-ghost      /* transparent + border */
.btn-danger     /* red variant */

.input          /* text/email/password inputs */
.input.error    /* red border variant */

.card           /* surface card with border */
.tag            /* small type badge */
.chip           /* status pill */
.chip-done      /* green */
.chip-running   /* cyan + animation */
.chip-pending   /* amber + pulse animation */
.chip-failed    /* red */

.spinner        /* CSS border-radius loading spinner */
.nav            /* top navigation bar */
.field          /* form field wrapper (adds margin-bottom) */
.label          /* form field label */
.ok-msg         /* green success message */
.err-msg        /* red error message */
```

---

## GraphViewer — Deep Dive

This is the most complex component (~500 lines). Understanding it is essential for any visualization changes.

### View mode system

```
viewMode state: null | "modules" | "module-detail" | "full" | "entrypoint"
effectiveMode:  viewMode ?? (rawNodeCount > 60 ? "modules" : "full")
```

Four modes, all rendered by the same `GraphCanvas` component — only the data fed to it changes:

```
effectiveMode  → currentViewData (what GraphCanvas renders)
──────────────────────────────────────────────────────────
"modules"      → buildModuleGraph(nodes, edges)       // collapsed: 1 node per file
"module-detail"→ buildModuleDetail(modName, n, e)     // module + its neighbours
"entrypoint"   → bfsSubgraph(rootId, n, e, hops)     // BFS reachable subgraph
"full"         → graphData                             // everything
```

### Pure graph functions (module-level, no React)

```js
buildModuleGraph(nodes, edges)
  // Collapses all nodes into their parent module.
  // Returns { nodes: [{ id, name, type:"module", _nodeCount, blast_radius }], edges: [...] }
  // _nodeCount drives the enlarged nodeRadius in module view.

buildModuleDetail(modName, nodes, edges)
  // Returns nodes inside `modName` + their immediate cross-module neighbours.
  // Neighbour nodes get _dimmed: true → GraphCanvas renders them at 35% opacity.

bfsSubgraph(rootId, nodes, edges, maxHops)
  // Bidirectional BFS from rootId up to maxHops hops.
  // Returns the reachable subgraph.

findEntryPoints(nodes, edges)
  // Returns nodes with no incoming edges (nothing calls/imports them).
  // These are the natural starting points for code exploration.

connectedComponents(nodes, rawEdges)
  // Union-find on raw string source/target IDs.
  // Returns array of node arrays, one per component.

findIsolated(nodes, rawEdges)
  // Returns nodes where degree (in + out) === 0.

smoothHull(pts, pad)
  // Computes d3.polygonHull, expands outward from centroid by `pad` pixels,
  // draws with Catmull-Rom closed curve. Returns SVG path string.
```

### Node sizing

```js
function nodeRadius(d) {
  if (d._nodeCount != null)                  // module-overview collapsed node
    return Math.min(20 + Math.sqrt(d._nodeCount) * 3.5, 52);
  const base = { module:16, class:11, method:9, function:7 }[d.type] ?? 7;
  return Math.min(base + Math.log1p(d.blast_radius ?? 0) * 2.5, 30);
}
```

### D3 simulation setup

Forces used (in order of priority):
1. `forceLink` — spring between connected nodes; intra-module distance 40px, cross-module 85px
2. `forceManyBody` — repulsion; modules −800, regular modules −450, functions/methods −160
3. `forceCenter` — weak pull to canvas center (strength 0.04)
4. `forceCollide` — prevents overlap; radius = `nodeRadius(d) + 10`
5. `forceCluster` — custom force; pulls same-module nodes toward their module centroid

### Layout stability

Nodes are frozen (`fx = x, fy = y`) once the simulation ends via:
```js
sim.on("end", () => nodes.forEach(n => { n.fx = n.x; n.fy = n.y; }));
```

This means clicking a node NEVER restarts the simulation. Only a view-mode change (which feeds new data to GraphCanvas) triggers a new simulation.

Dragged nodes stay pinned at their new position (drag end does NOT clear `d.fx/d.fy`).

### useMemo for stable references

Critical: `isolatedIds` and `currentViewData` must be memoized or the GraphCanvas `useEffect` re-fires on every click:

```js
const currentViewData = useMemo(() => { ... }, [graphData, effectiveMode, activeModule, entryNode, hops]);
const isolated        = useMemo(() => findIsolated(currentViewData?.nodes, ...), [currentViewData]);
const isolatedIds     = useMemo(() => new Set(isolated.map(n => n.id)), [isolated]);
```

### Refs in GraphCanvas

```js
svgRef   → the SVG DOM element
simRef   → the D3 simulation instance (for drag restart)
zoomRef  → the D3 zoom behaviour (for fitView + searchHit pan)
nodesRef → the live node array (positions update in-place during simulation)
```

### Hover highlighting

On `mouseover` a node:
1. Find all adjacent edges and their endpoints (both directions)
2. `nodeSel.attr("opacity", nd => neighborIds.has(nd.id) ? 1 : 0.08)`
3. `linkSel.attr("opacity", (_, i) => adjEdges.has(i) ? 1 : 0.04)` + brighter stroke + thicker width

On `mouseout`: restore all opacities and stroke styles.

### Search hit panning

When `searchHit` state changes (set by SearchBar or IsolatedPanel click):
- D3 transition pans + zooms to that node's coordinates at scale 1.4
- `searchHit` is cleared after 800ms to allow repeat clicks to re-trigger

---

## Dashboard — Key Details

### Polling

```js
const ACTIVE_STATUSES = new Set(["pending", "running"]);

useEffect(() => {
  const hasActive = maps.some(m => ACTIVE_STATUSES.has(m.status));
  if (!hasActive) return;
  const id = setInterval(() => {
    api.listMaps().then(data => setMaps(normalizeMaps(data))).catch(() => {});
  }, 3000);
  return () => clearInterval(id);
}, [maps]);
```

Polling only runs when at least one map is in an active state. Stops automatically when all are done.

### Create modal — two tabs

**Tab 1: Git URL / local path**
```js
api.createMap({ source: source.trim(), name, confidential })
```
Server accepts `source`, `repo_url`, or `repo_path` (all treated identically).

**Tab 2: Upload zip**
```js
fetch("/projects/upload", {
  method: "POST",
  headers: { "Content-Type": "application/zip", "X-Map-Name": mapName, "X-Session-Token": token },
  body: await file.arrayBuffer()
})
```

### Map card subtitle

Shows `map.source || map.repo_url || map.repo_path || "local"` — checked in that order because the server stores the path as `source`.

---

## Build & Dev Workflow

```bash
# Install
cd frontend
npm install

# Development (hot reload)
npm run dev          # Vite dev server on port 5173
                     # Requires python server.py on port 8000

# Production build
npm run build        # Output: frontend/dist/
                     # server.py serves dist/ automatically

# After any code change that needs testing
npm run build && python server.py
```

**Note on Windows:** If `npm` is not found in PowerShell, run:
```powershell
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
```
