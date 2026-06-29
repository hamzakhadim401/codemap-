"""
Stage 6/7 - Visualization + delivery (MVP)

Renders the unified graph JSON as a single self-contained HTML file:
no build step, no server, no dependency beyond the D3 CDN script tag --
you can open the output directly in a browser or host it anywhere.

This is intentionally the "Visualization engine" and "Interactive
delivery" pipeline stages collapsed into one static file for the MVP.
Phase 2 splits these apart: the engine becomes a service that streams
incremental graph updates, and delivery becomes a real web app + IDE
extension that both read from the same live graph.
"""
import json

_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>__REPO_NAME__ - codemap</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<style>
  :root {
    --bg: #0b0e14;
    --panel: #11151c;
    --panel-2: #161b24;
    --border: #1f2530;
    --text: #e8eaed;
    --text-dim: #8b92a1;
    --text-faint: #545d6e;
    --module: #5b8def;
    --class: #e0a858;
    --function: #5fc9a8;
    --edge-contains: #2a3142;
    --edge-imports: #7c6fe0;
    --edge-calls: #3ddc97;
    --focus: #ff6b5b;
    --mono: "JetBrains Mono", monospace;
    --sans: "Inter", sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--sans); }
  #app { display: grid; grid-template-columns: 280px 1fr 320px; grid-template-rows: 56px 1fr; height: 100vh; }
  header {
    grid-column: 1 / 4; display: flex; align-items: center; gap: 14px;
    padding: 0 20px; border-bottom: 1px solid var(--border); background: var(--panel);
  }
  header .title { font-family: var(--mono); font-weight: 600; font-size: 14px; }
  header .stats { color: var(--text-dim); font-size: 13px; font-family: var(--mono); }
  header .badge {
    margin-left: auto; font-size: 11px; padding: 4px 10px; border-radius: 4px;
    border: 1px solid #2a4a3a; color: #6fd9a8; background: #102019; font-family: var(--mono);
  }
  aside.sidebar {
    border-right: 1px solid var(--border); background: var(--panel); padding: 18px; overflow-y: auto;
  }
  aside.detail {
    border-left: 1px solid var(--border); background: var(--panel); padding: 18px; overflow-y: auto;
  }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); margin: 0 0 10px; font-weight: 600; }
  input#search {
    width: 100%; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); padding: 8px 10px; font-family: var(--sans); font-size: 13px; margin-bottom: 22px;
  }
  input#search:focus { outline: none; border-color: var(--module); }
  .legend-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-dim); margin-bottom: 7px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .legend-edge { width: 18px; height: 0; border-top: 1.5px solid; flex-shrink: 0; }
  section.canvas-wrap { position: relative; overflow: hidden; background: var(--bg); }
  svg#graph { width: 100%; height: 100%; cursor: grab; }
  svg#graph:active { cursor: grabbing; }
  .node-label { font-family: var(--mono); font-size: 10px; fill: var(--text-dim); pointer-events: none; }
  .hint { position: absolute; bottom: 16px; left: 16px; font-size: 12px; color: var(--text-faint); font-family: var(--mono); }
  .empty-detail { color: var(--text-faint); font-size: 13px; line-height: 1.6; }
  .detail-name { font-family: var(--mono); font-size: 15px; font-weight: 600; margin-bottom: 4px; word-break: break-word; }
  .detail-type { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 4px; margin-bottom: 14px; font-family: var(--mono); }
  .detail-row { display: flex; justify-content: space-between; font-size: 13px; padding: 7px 0; border-bottom: 1px solid var(--border); color: var(--text-dim); }
  .detail-row b { color: var(--text); font-weight: 500; font-family: var(--mono); font-size: 12px; }
  .neighbor-list { margin-top: 16px; }
  .neighbor-item {
    font-family: var(--mono); font-size: 12px; padding: 7px 9px; border-radius: 5px; margin-bottom: 4px;
    background: var(--panel-2); cursor: pointer; color: var(--text-dim); border: 1px solid transparent;
  }
  .neighbor-item:hover { border-color: var(--module); color: var(--text); }
  .type-pill { font-size: 10px; opacity: 0.7; margin-right: 6px; }
  .call-badge { font-size: 10px; color: var(--function); opacity: 0.75; margin-left: 6px; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<div id="app">
  <header>
    <span class="title">__REPO_NAME__</span>
    <span class="stats">__NODE_COUNT__ nodes &middot; __EDGE_COUNT__ edges</span>
    __CONFIDENTIAL_BADGE__
  </header>

  <aside class="sidebar">
    <h3>Search</h3>
    <input id="search" type="text" placeholder="Find a module, class, function..." />

    <h3>Node types</h3>
    <div class="legend-row"><span class="dot" style="background:var(--module)"></span>Module</div>
    <div class="legend-row"><span class="dot" style="background:var(--class)"></span>Class</div>
    <div class="legend-row"><span class="dot" style="background:var(--function)"></span>Function</div>

    <h3 style="margin-top:22px">Edge types</h3>
    <div class="legend-row"><span class="legend-edge" style="border-color:var(--edge-contains)"></span>Contains</div>
    <div class="legend-row"><span class="legend-edge" style="border-color:var(--edge-imports)"></span>Imports</div>
    <div class="legend-row"><span class="legend-edge" style="border-color:var(--edge-calls)"></span>Calls</div>
  </aside>

  <section class="canvas-wrap">
    <svg id="graph"></svg>
    <div class="hint">Click a node to focus &middot; scroll to zoom &middot; drag to pan</div>
  </section>

  <aside class="detail" id="detail-panel">
    <div class="empty-detail">Click any node to see its file location, size, and direct dependencies.</div>
  </aside>
</div>

<script>
const graphData = __GRAPH_DATA__;
const typeColor = { module: "var(--module)", class: "var(--class)", "function": "var(--function)" };
const edgeColor = { contains: "var(--edge-contains)", imports: "var(--edge-imports)", calls: "var(--edge-calls)" };

const svg = d3.select("#graph");
const g = svg.append("g");
const nodeById = new Map(graphData.nodes.map(n => [n.id, n]));

function resize() {
  const rect = svg.node().parentElement.getBoundingClientRect();
  svg.attr("viewBox", `0 0 ${rect.width} ${rect.height}`);
  return rect;
}
let { width, height } = resize();
window.addEventListener("resize", () => { ({ width, height } = resize()); });

svg.call(d3.zoom().scaleExtent([0.15, 4]).on("zoom", (ev) => g.attr("transform", ev.transform)));

const sizeScale = d3.scaleSqrt().domain([0, d3.max(graphData.nodes, d => d.loc || 1) || 1]).range([5, 16]);

const sim = d3.forceSimulation(graphData.nodes)
  .force("link", d3.forceLink(graphData.edges).id(d => d.id)
    .distance(e => e.type === "contains" ? 50 : 90)
    .strength(e => e.type === "contains" ? 0.7 : 0.25))
  .force("charge", d3.forceManyBody().strength(-160))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collide", d3.forceCollide(d => sizeScale(d.loc || 1) + 6));

const link = g.append("g").selectAll("line")
  .data(graphData.edges).join("line")
  .attr("stroke", d => edgeColor[d.type] || "#333")
  .attr("stroke-width", d => d.type === "contains" ? 1 : (d.call_count ? Math.min(1.3 + Math.log(d.call_count + 1) * 0.7, 6) : 1.3))
  .attr("stroke-dasharray", d => d.type === "calls" ? "3,3" : null)
  .attr("opacity", d => d.type === "contains" ? 0.3 : (d.call_count ? 0.85 : 0.55));

const node = g.append("g").selectAll("circle")
  .data(graphData.nodes).join("circle")
  .attr("r", d => sizeScale(d.loc || 1))
  .attr("fill", d => typeColor[d.type] || "#888")
  .attr("stroke", "var(--bg)")
  .attr("stroke-width", 1.5)
  .style("cursor", "pointer")
  .call(d3.drag()
    .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
    .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
    .on("end", (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }))
  .on("click", (ev, d) => focusNode(d));

const label = g.append("g").selectAll("text")
  .data(graphData.nodes).join("text")
  .attr("class", "node-label")
  .attr("dy", d => -(sizeScale(d.loc || 1) + 4))
  .attr("text-anchor", "middle")
  .text(d => d.name);

sim.on("tick", () => {
  link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
  node.attr("cx", d => d.x).attr("cy", d => d.y);
  label.attr("x", d => d.x).attr("y", d => d.y);
});

const neighborsOf = id => {
  const out = [], inc = [];
  graphData.edges.forEach(e => {
    if (e.source.id === id || e.source === id) out.push(e);
    if (e.target.id === id || e.target === id) inc.push(e);
  });
  return { out, inc };
};

function focusNode(d) {
  const { out, inc } = neighborsOf(d.id);
  const related = new Set([d.id, ...out.map(e => (e.target.id || e.target)), ...inc.map(e => (e.source.id || e.source))]);

  node.attr("opacity", n => related.has(n.id) ? 1 : 0.12)
      .attr("stroke", n => n.id === d.id ? "var(--focus)" : "var(--bg)")
      .attr("stroke-width", n => n.id === d.id ? 3 : 1.5);
  link.attr("opacity", e => (e.source.id === d.id || e.target.id === d.id) ? 0.9 : 0.05);
  label.attr("opacity", n => related.has(n.id) ? 1 : 0.08);

  renderDetail(d, out, inc);
}

function renderDetail(d, out, inc) {
  const panel = document.getElementById("detail-panel");
  const allNeighbors = [...out.map(e => ({ id: e.target.id || e.target, rel: "→ " + e.type, count: e.call_count })),
                         ...inc.map(e => ({ id: e.source.id || e.source, rel: "← " + e.type, count: e.call_count }))];
  const seen = new Set();
  const rows = allNeighbors.filter(n => {
    if (seen.has(n.id + n.rel)) return false;
    seen.add(n.id + n.rel);
    return true;
  }).map(n => {
    const target = nodeById.get(n.id);
    if (!target) return "";
    return `<div class="neighbor-item" onclick="jumpTo('${target.id.replace(/'/g, "\\\\'")}')">
      <span class="type-pill">${n.rel}</span>${target.name}${n.count ? `<span class="call-badge">${n.count}\xd7</span>` : ""}
    </div>`;
  }).join("");

  panel.innerHTML = `
    <div class="detail-name">${d.name}</div>
    <div class="detail-type" style="background:${typeColor[d.type]}22;color:${typeColor[d.type]}">${d.type}</div>
    <div class="detail-row"><span>File</span><b>${d.file}</b></div>
    <div class="detail-row"><span>Line</span><b>${d.line}</b></div>
    ${d.loc ? `<div class="detail-row"><span>Size</span><b>${d.loc} lines</b></div>` : ""}
    <div class="detail-row"><span>Blast radius</span><b>${d.blast_radius} dependents</b></div>
    ${d.call_count ? `<div class="detail-row"><span>Runtime calls</span><b>${d.call_count}\xd7</b></div>` : ""}
    <div class="neighbor-list"><h3>Direct connections (${rows ? allNeighbors.length : 0})</h3>${rows || '<div class="empty-detail">No direct connections found.</div>'}</div>
  `;
}

window.jumpTo = function(id) {
  const target = graphData.nodes.find(n => n.id === id);
  if (target) focusNode(target);
};

document.getElementById("search").addEventListener("input", (ev) => {
  const q = ev.target.value.trim().toLowerCase();
  if (!q) {
    node.attr("opacity", 1); link.attr("opacity", 0.55); label.attr("opacity", 1);
    return;
  }
  const matches = new Set(graphData.nodes.filter(n => n.name.toLowerCase().includes(q)).map(n => n.id));
  node.attr("opacity", n => matches.has(n.id) ? 1 : 0.08);
  label.attr("opacity", n => matches.has(n.id) ? 1 : 0.08);
  link.attr("opacity", e => matches.has(e.source.id) && matches.has(e.target.id) ? 0.7 : 0.03);
});
</script>
</body>
</html>
"""


def render_html(graph_data: dict, repo_name: str, output_path: str, confidential: bool = False) -> None:
    badge = (
        '<span class="badge">confidential mode &middot; not persisted</span>'
        if confidential else ""
    )
    html = (
        _TEMPLATE
        .replace("__REPO_NAME__", repo_name)
        .replace("__NODE_COUNT__", str(len(graph_data["nodes"])))
        .replace("__EDGE_COUNT__", str(len(graph_data["edges"])))
        .replace("__CONFIDENTIAL_BADGE__", badge)
        .replace("__GRAPH_DATA__", json.dumps(graph_data))
    )
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
