import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as d3 from "d3";
import { api } from "../api.js";

// ── color / label maps ────────────────────────────────────────────────────────
const TYPE_COLOR = {
  module:   "#3b82f6",
  class:    "#a855f7",
  function: "#06b6d4",
  method:   "#10b981",
};
function nodeColor(type) { return TYPE_COLOR[type] ?? "#94a3b8"; }
const TYPE_LABEL = { module:"Module", class:"Class", function:"Function", method:"Method" };

// ── node sizing ───────────────────────────────────────────────────────────────
function nodeRadius(d) {
  // collapsed module node in module-overview mode
  if (d._nodeCount != null) return Math.min(20 + Math.sqrt(d._nodeCount) * 3.5, 52);
  const base = d.type === "module" ? 16 : d.type === "class" ? 11 : d.type === "method" ? 9 : 7;
  return Math.min(base + Math.log1p(d.blast_radius ?? 0) * 2.5, 30);
}

// ── module key ────────────────────────────────────────────────────────────────
function moduleKey(node) {
  if (!node) return "";
  const dotted = (node.id || "").split(":")[1] || "";
  return dotted.split(".")[0] || node.id || "";
}

// ── D3 cluster force ──────────────────────────────────────────────────────────
function forceCluster(strength = 0.12) {
  let nodes;
  function force(alpha) {
    const centroids = {};
    nodes.forEach(n => {
      const k = moduleKey(n);
      if (!centroids[k]) centroids[k] = { x: 0, y: 0, count: 0 };
      centroids[k].x += n.x || 0;
      centroids[k].y += n.y || 0;
      centroids[k].count++;
    });
    for (const c of Object.values(centroids)) { c.x /= c.count; c.y /= c.count; }
    nodes.forEach(n => {
      const c = centroids[moduleKey(n)];
      if (!c) return;
      n.vx += (c.x - n.x) * strength * alpha;
      n.vy += (c.y - n.y) * strength * alpha;
    });
  }
  force.initialize = ns => { nodes = ns; };
  return force;
}

// ── Connected components (union-find) ─────────────────────────────────────────
function connectedComponents(nodes, rawEdges) {
  const parent = Object.fromEntries(nodes.map(n => [n.id, n.id]));
  function find(x) { if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; }
  function union(a, b) { if (a in parent && b in parent) parent[find(a)] = find(b); }
  (rawEdges || []).forEach(e => union(e.source, e.target));
  const groups = {};
  nodes.forEach(n => { const r = find(n.id); if (!groups[r]) groups[r] = []; groups[r].push(n); });
  return Object.values(groups);
}

// ── Isolated nodes: degree 0 ──────────────────────────────────────────────────
function findIsolated(nodes, rawEdges) {
  const connected = new Set();
  (rawEdges || []).forEach(e => { connected.add(e.source); connected.add(e.target); });
  return nodes.filter(n => !connected.has(n.id));
}

// ── Smooth convex hull ────────────────────────────────────────────────────────
function smoothHull(pts, pad) {
  const hull = d3.polygonHull(pts);
  if (!hull) return null;
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
  const expanded = hull.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [x + (dx / len) * pad, y + (dy / len) * pad];
  });
  return d3.line().x(d => d[0]).y(d => d[1])
    .curve(d3.curveCatmullRomClosed.alpha(0.5))(expanded);
}

const CLUSTER_FILL   = ["rgba(59,130,246,.08)","rgba(168,85,247,.07)","rgba(6,182,212,.07)","rgba(16,185,129,.07)","rgba(245,158,11,.07)","rgba(236,72,153,.07)"];
const CLUSTER_STROKE = ["rgba(59,130,246,.22)","rgba(168,85,247,.2)","rgba(6,182,212,.2)","rgba(16,185,129,.2)","rgba(245,158,11,.2)","rgba(236,72,153,.2)"];

// ── Graph computation helpers ─────────────────────────────────────────────────

// Collapse everything into one node-per-module with inter-module edges
function buildModuleGraph(nodes, edges) {
  const mods = {};
  nodes.forEach(n => {
    const mk = moduleKey(n);
    if (!mods[mk]) mods[mk] = { id: `module:${mk}`, name: mk, type: "module", _nodeCount: 0, blast_radius: 0 };
    mods[mk]._nodeCount++;
    mods[mk].blast_radius = Math.max(mods[mk].blast_radius, n.blast_radius ?? 0);
  });

  const edgeSet = new Set();
  const modEdges = [];
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));
  edges.forEach(e => {
    const s = moduleKey(nodeById[e.source]);
    const t = moduleKey(nodeById[e.target]);
    if (s && t && s !== t) {
      const key = `${s}→${t}:${e.type}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        modEdges.push({ source: `module:${s}`, target: `module:${t}`, type: e.type });
      }
    }
  });
  return { nodes: Object.values(mods), edges: modEdges };
}

// Module + its immediate cross-module neighbours
function buildModuleDetail(modName, nodes, edges) {
  const inMod = new Set(nodes.filter(n => moduleKey(n) === modName).map(n => n.id));
  const neighborIds = new Set();
  edges.forEach(e => {
    if (inMod.has(e.source) && !inMod.has(e.target)) neighborIds.add(e.target);
    if (inMod.has(e.target) && !inMod.has(e.source)) neighborIds.add(e.source);
  });
  const visible = new Set([...inMod, ...neighborIds]);
  return {
    nodes: nodes.filter(n => visible.has(n.id)).map(n => ({ ...n, _dimmed: !inMod.has(n.id) })),
    edges: edges.filter(e => visible.has(e.source) && visible.has(e.target)),
  };
}

// BFS reachability from root, up to maxHops hops (bidirectional)
function bfsSubgraph(rootId, nodes, edges, maxHops) {
  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; });
  edges.forEach(e => {
    if (adj[e.source]) adj[e.source].push(e.target);
    if (adj[e.target]) adj[e.target].push(e.source);
  });
  const visited = new Set([rootId]);
  let frontier = [rootId];
  for (let h = 0; h < maxHops; h++) {
    const next = [];
    frontier.forEach(id => (adj[id] || []).forEach(nb => { if (!visited.has(nb)) { visited.add(nb); next.push(nb); } }));
    frontier = next;
    if (!frontier.length) break;
  }
  return {
    nodes: nodes.filter(n => visited.has(n.id)),
    edges: edges.filter(e => visited.has(e.source) && visited.has(e.target)),
  };
}

// Entry points = nodes with no incoming edges
function findEntryPoints(nodes, edges) {
  const hasIncoming = new Set(edges.map(e => e.target));
  return nodes.filter(n => !hasIncoming.has(n.id));
}

// ── IsolatedPanel ─────────────────────────────────────────────────────────────
function IsolatedPanel({ nodes, onFlyTo }) {
  const [open, setOpen] = useState(true);
  if (!nodes.length) return null;
  return (
    <div style={{ background:"var(--surface)", border:"1px solid rgba(245,158,11,.35)", borderRadius:"var(--r)", overflow:"hidden", boxShadow:"0 8px 24px rgba(0,0,0,.35)" }}>
      <button onClick={() => setOpen(o => !o)} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"9px 12px", background:"none", border:"none", cursor:"pointer", color:"var(--amber)", fontSize:12, fontWeight:600, textAlign:"left", fontFamily:"var(--sans)" }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        {nodes.length} unconnected file{nodes.length !== 1 ? "s" : ""}
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft:"auto", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition:"transform .2s" }}><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {open && (
        <div style={{ borderTop:"1px solid rgba(245,158,11,.2)", maxHeight:180, overflowY:"auto" }}>
          {nodes.map(n => (
            <div key={n.id} onClick={() => onFlyTo(n)} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 12px", cursor:"pointer", fontSize:12, color:"var(--text-dim)", borderBottom:"1px solid var(--border)", transition:"background .12s" }}
              onMouseEnter={e => e.currentTarget.style.background="var(--surface-2)"}
              onMouseLeave={e => e.currentTarget.style.background=""}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:nodeColor(n.type), flexShrink:0, border:"1.5px dashed rgba(245,158,11,.7)" }} />
              <span style={{ fontFamily:"var(--mono)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{n.name}</span>
              <span style={{ color:"var(--text-muted)", fontSize:10, marginLeft:"auto", flexShrink:0 }}>{TYPE_LABEL[n.type] ?? n.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── EntryPointPanel ────────────────────────────────────────────────────────────
function EntryPointPanel({ graphData, onExplore }) {
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => {
    if (!graphData) return [];
    return findEntryPoints(graphData.nodes, graphData.edges)
      .sort((a, b) => (b.blast_radius ?? 0) - (a.blast_radius ?? 0))
      .slice(0, 12);
  }, [graphData]);

  if (!entries.length) return null;

  return (
    <div style={{ background:"var(--surface)", border:"1px solid rgba(6,182,212,.3)", borderRadius:"var(--r)", overflow:"hidden", boxShadow:"0 8px 24px rgba(0,0,0,.35)" }}>
      <button onClick={() => setOpen(o => !o)} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"9px 12px", background:"none", border:"none", cursor:"pointer", color:"var(--cyan)", fontSize:12, fontWeight:600, textAlign:"left", fontFamily:"var(--sans)" }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
        Explore from entry point
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft:"auto", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition:"transform .2s" }}><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {open && (
        <div style={{ borderTop:"1px solid rgba(6,182,212,.2)", maxHeight:210, overflowY:"auto" }}>
          {entries.map(n => (
            <div key={n.id} onClick={() => { onExplore(n); setOpen(false); }}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 12px", cursor:"pointer", fontSize:12, color:"var(--text-dim)", borderBottom:"1px solid var(--border)" }}
              onMouseEnter={e => e.currentTarget.style.background="var(--surface-2)"}
              onMouseLeave={e => e.currentTarget.style.background=""}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:nodeColor(n.type), flexShrink:0 }} />
              <span style={{ fontFamily:"var(--mono)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{n.name}</span>
              <span style={{ color:"var(--text-muted)", fontSize:10, marginLeft:"auto", flexShrink:0 }}>→</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── GraphCanvas ────────────────────────────────────────────────────────────────
function GraphCanvas({ graphData, selected, onSelect, searchHit, isolatedIds }) {
  const svgRef  = useRef(null);
  const simRef  = useRef(null);
  const zoomRef = useRef(null);
  const nodesRef = useRef(null);

  function fitView(duration = 700) {
    const nodes = nodesRef.current;
    const el    = svgRef.current;
    if (!nodes?.length || !el || !zoomRef.current) return;
    const xs = nodes.map(n => n.x).filter(v => v != null);
    const ys = nodes.map(n => n.y).filter(v => v != null);
    if (!xs.length) return;
    const pad = 80;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
    const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const W = el.clientWidth || 900, H = el.clientHeight || 600;
    const scale = Math.min(W / (x1 - x0), H / (y1 - y0), 1.6) * 0.92;
    const tx = W / 2 - scale * (x0 + x1) / 2;
    const ty = H / 2 - scale * (y0 + y1) / 2;
    d3.select(el).transition().duration(duration).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
  }

  useEffect(() => {
    if (!graphData || !svgRef.current) return;
    const { nodes: rawNodes, edges: rawEdges } = graphData;
    if (!rawNodes?.length) return;

    const el = svgRef.current;
    d3.select(el).selectAll("*").remove();

    const W = el.clientWidth || 900, H = el.clientHeight || 600;
    const svg = d3.select(el).attr("width", W).attr("height", H);

    // Dot-grid background
    const defs = svg.append("defs");
    defs.append("pattern").attr("id","dot-grid").attr("width",28).attr("height",28).attr("patternUnits","userSpaceOnUse")
      .append("circle").attr("cx",1.5).attr("cy",1.5).attr("r",1).attr("fill","rgba(255,255,255,.04)");
    svg.append("rect").attr("width","100%").attr("height","100%").attr("fill","url(#dot-grid)").attr("pointer-events","none");

    const g = svg.append("g");
    const zoom = d3.zoom().scaleExtent([0.04, 5]).on("zoom", e => g.attr("transform", e.transform));
    zoomRef.current = zoom;
    svg.call(zoom);

    const nodes = rawNodes.map(d => ({ ...d }));
    const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));
    nodesRef.current = nodes;

    // Pre-position by module
    const modules  = [...new Set(nodes.map(moduleKey))];
    const modIndex = Object.fromEntries(modules.map((m, i) => [m, i]));
    const spread   = Math.max(100, modules.length * 50);
    nodes.forEach(n => {
      const angle = (modIndex[moduleKey(n)] / modules.length) * 2 * Math.PI;
      n.x = W / 2 + Math.cos(angle) * spread + (Math.random() - .5) * 60;
      n.y = H / 2 + Math.sin(angle) * spread + (Math.random() - .5) * 60;
    });

    const links = (rawEdges || [])
      .filter(e => nodeById[e.source] && nodeById[e.target])
      .map(e => ({ ...e }));

    // Cluster hulls
    const components = connectedComponents(nodes, rawEdges || []).filter(c => c.length >= 3).sort((a, b) => b.length - a.length);
    const hullGroup = g.append("g").attr("class","hulls");
    const hullPaths = hullGroup.selectAll("path").data(components).join("path")
      .attr("fill",         (_, i) => CLUSTER_FILL[i   % CLUSTER_FILL.length])
      .attr("stroke",       (_, i) => CLUSTER_STROKE[i % CLUSTER_STROKE.length])
      .attr("stroke-width", 1.2).attr("stroke-dasharray","7 4").attr("opacity",0)
      .attr("pointer-events","fill").style("cursor","pointer")
      .on("click", (event, comp) => { event.stopPropagation(); onSelect(comp.find(n => n.type === "module") ?? comp[0]); });

    function updateHulls() {
      hullPaths.attr("d", comp => smoothHull(comp.map(n => [n.x, n.y]), 32));
    }

    // Edges
    const linkSel = g.append("g").selectAll("line").data(links).join("line")
      .attr("stroke", d => d.type === "calls" ? "rgba(168,85,247,.28)" : "rgba(59,130,246,.18)")
      .attr("stroke-width", d => d.type === "calls" ? 1 : 0.7)
      .attr("stroke-dasharray", d => d.type === "imports" ? "5 3" : null);

    // Node groups
    const nodeSel = g.append("g").selectAll("g").data(nodes).join("g")
      .attr("cursor","pointer")
      .attr("opacity", d => d._dimmed ? 0.35 : 1)
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) simRef.current?.alphaTarget(.15).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag",  (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end",   (e, d) => { if (!e.active) simRef.current?.alphaTarget(0); }))
      .on("click", (e, d) => { e.stopPropagation(); onSelect(d); });

    // Glow ring
    nodeSel.append("circle").attr("r", d => nodeRadius(d) + 6).attr("fill", d => nodeColor(d.type)).attr("fill-opacity",.07).attr("stroke","none").attr("pointer-events","none");

    // Isolated dashed ring
    nodeSel.filter(d => isolatedIds?.has(d.id))
      .append("circle").attr("r", d => nodeRadius(d) + 10).attr("fill","none")
      .attr("stroke","rgba(245,158,11,.55)").attr("stroke-width",1.5).attr("stroke-dasharray","4 3").attr("pointer-events","none");

    // Main circle
    nodeSel.append("circle").classed("main-circle",true).attr("r", nodeRadius)
      .attr("fill", d => nodeColor(d.type)).attr("fill-opacity",.2)
      .attr("stroke", d => nodeColor(d.type)).attr("stroke-width",1.8).attr("stroke-opacity",.85);

    // Module-overview badge (node count inside circle)
    nodeSel.filter(d => d._nodeCount != null)
      .append("text").text(d => d._nodeCount)
      .attr("text-anchor","middle").attr("dy","0.35em")
      .attr("fill", d => nodeColor(d.type)).attr("font-size","11px").attr("font-weight","700")
      .attr("font-family","var(--mono)").attr("pointer-events","none");

    // Label halo
    nodeSel.append("text").text(d => d.name)
      .attr("dy", d => nodeRadius(d) + 14).attr("text-anchor","middle")
      .attr("fill","none").attr("stroke","#020617").attr("stroke-width",4).attr("stroke-linejoin","round")
      .attr("font-size", d => d._nodeCount != null ? 12 : d.type === "module" ? 11 : 9)
      .attr("font-family","JetBrains Mono, monospace").attr("font-weight", d => d.type === "module" ? "600" : "400")
      .attr("pointer-events","none");

    // Label fill
    nodeSel.append("text").text(d => d.name)
      .attr("dy", d => nodeRadius(d) + 14).attr("text-anchor","middle")
      .attr("fill", d => nodeColor(d.type))
      .attr("font-size", d => d._nodeCount != null ? 12 : d.type === "module" ? 11 : 9)
      .attr("font-family","JetBrains Mono, monospace").attr("font-weight", d => d.type === "module" ? "600" : "400")
      .attr("pointer-events","none");

    // Hover: dim non-neighbours
    const getId = d => (typeof d === "object" ? d.id : d);
    nodeSel
      .on("mouseover", (_, hovered) => {
        const neighborIds = new Set([hovered.id]);
        const adjEdges    = new Set();
        links.forEach((lk, i) => {
          const src = getId(lk.source), tgt = getId(lk.target);
          if (src === hovered.id || tgt === hovered.id) { neighborIds.add(src); neighborIds.add(tgt); adjEdges.add(i); }
        });
        nodeSel.attr("opacity", nd => nd._dimmed ? 0.1 : neighborIds.has(nd.id) ? 1 : 0.08);
        linkSel
          .attr("opacity",      (_, i) => adjEdges.has(i) ? 1 : 0.04)
          .attr("stroke",       (lk, i) => adjEdges.has(i) ? (lk.type === "calls" ? "rgba(168,85,247,.9)" : "rgba(59,130,246,.7)") : "rgba(100,100,100,.1)")
          .attr("stroke-width", (lk, i) => adjEdges.has(i) ? (lk.type === "calls" ? 2.5 : 1.8) : 0.5);
      })
      .on("mouseout", () => {
        nodeSel.attr("opacity", d => d._dimmed ? 0.35 : 1);
        linkSel.attr("opacity",1).attr("stroke", d => d.type === "calls" ? "rgba(168,85,247,.28)" : "rgba(59,130,246,.18)").attr("stroke-width", d => d.type === "calls" ? 1 : 0.7);
      });

    // Simulation
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(d => moduleKey(d.source) === moduleKey(d.target) ? 40 : 85).strength(0.75))
      .force("charge", d3.forceManyBody().strength(d => d._nodeCount != null ? -800 : d.type === "module" ? -450 : -160).distanceMax(350))
      .force("center", d3.forceCenter(W / 2, H / 2).strength(0.04))
      .force("collision", d3.forceCollide(d => nodeRadius(d) + 10))
      .force("cluster", forceCluster(0.14))
      .on("tick", () => {
        updateHulls();
        linkSel.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
      });

    simRef.current = sim;
    sim.on("end", () => nodes.forEach(n => { n.fx = n.x; n.fy = n.y; }));
    svg.on("click", () => onSelect(null));

    const hullTimer = setTimeout(() => hullPaths.transition().duration(700).attr("opacity", 1), 1200);
    const fitTimer  = setTimeout(() => fitView(750), 1500);
    return () => { sim.stop(); clearTimeout(hullTimer); clearTimeout(fitTimer); };
  }, [graphData, isolatedIds]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight selected
  useEffect(() => {
    if (!svgRef.current) return;
    d3.select(svgRef.current).selectAll(".main-circle")
      .attr("stroke-width",  d => d?.id === selected?.id ? 3.5 : 1.8)
      .attr("fill-opacity",  d => d?.id === selected?.id ? 0.45 : 0.2)
      .attr("stroke-opacity",d => d?.id === selected?.id ? 1 : 0.85);
  }, [selected]);

  // Pan to search hit
  useEffect(() => {
    if (!svgRef.current || !searchHit || !zoomRef.current) return;
    const node = nodesRef.current?.find(n => n.id === searchHit);
    if (!node?.x) return;
    const el = svgRef.current;
    d3.select(el).transition().duration(600).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(el.clientWidth / 2 - node.x * 1.4, el.clientHeight / 2 - node.y * 1.4).scale(1.4)
    );
  }, [searchHit]);

  return (
    <div style={{ position:"relative", width:"100%", height:"100%" }}>
      <svg ref={svgRef} style={{ width:"100%", height:"100%", display:"block", background:"var(--bg)" }} />
      <button onClick={() => fitView(600)} title="Fit to screen"
        style={{ position:"absolute", bottom:20, right:20, fontFamily:"var(--sans)", background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:"var(--r)", color:"var(--text-dim)", padding:"8px 14px", cursor:"pointer", fontSize:12, fontWeight:600, display:"flex", alignItems:"center", gap:6, boxShadow:"0 4px 16px rgba(0,0,0,.3)" }}
        onMouseEnter={e => { e.currentTarget.style.borderColor="var(--border-2)"; e.currentTarget.style.color="var(--text)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)";   e.currentTarget.style.color="var(--text-dim)"; }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 9V4h5M21 9V4h-5M3 15v5h5M21 15v5h-5"/></svg>
        Fit view
      </button>
    </div>
  );
}

// ── SearchBar ─────────────────────────────────────────────────────────────────
function SearchBar({ nodes, onHit }) {
  const [q, setQ]           = useState("");
  const [results, setResults] = useState([]);
  const ref = useRef(null);

  function search(val) {
    setQ(val);
    if (!val.trim()) { setResults([]); return; }
    const lower = val.toLowerCase();
    setResults((nodes || []).filter(n => n.name?.toLowerCase().includes(lower)).slice(0, 8));
  }

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setResults([]); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <div style={{ position:"relative" }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ position:"absolute", left:11, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input className="input" style={{ paddingLeft:32, fontSize:13, background:"var(--surface-2)" }} placeholder="Search components…" value={q} onChange={e => search(e.target.value)} />
      </div>
      {results.length > 0 && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:"var(--r)", overflow:"hidden", zIndex:50, boxShadow:"0 12px 32px rgba(0,0,0,.4)" }}>
          {results.map(n => (
            <div key={n.id} onClick={() => { onHit(n); setResults([]); setQ(""); }}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 12px", cursor:"pointer", borderBottom:"1px solid var(--border)" }}
              onMouseEnter={e => e.currentTarget.style.background="var(--surface-3)"}
              onMouseLeave={e => e.currentTarget.style.background=""}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:nodeColor(n.type), flexShrink:0 }} />
              <span style={{ fontSize:13, fontFamily:"var(--mono)", color:"var(--text)" }}>{n.name}</span>
              <span style={{ fontSize:11, color:"var(--text-muted)", marginLeft:"auto" }}>{TYPE_LABEL[n.type] ?? n.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── DetailPanel ───────────────────────────────────────────────────────────────
function DetailPanel({ node, graphData, onClose, onDrillDown }) {
  if (!node) return null;
  const inEdges  = (graphData?.edges || []).filter(e => e.target === node.id);
  const outEdges = (graphData?.edges || []).filter(e => e.source === node.id);
  const isIsolated = inEdges.length === 0 && outEdges.length === 0;

  return (
    <div style={{ background:"var(--surface)", borderLeft:"1px solid var(--border)", width:280, flexShrink:0, overflowY:"auto", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:13, fontWeight:600, color:"var(--text-dim)" }}>Details</span>
        <button onClick={onClose} style={{ color:"var(--text-muted)", background:"none", border:"none", fontSize:18, cursor:"pointer", lineHeight:1, padding:2 }}>×</button>
      </div>
      <div style={{ padding:20, display:"flex", flexDirection:"column", gap:16 }}>
        <div>
          <span className="tag" style={{ fontSize:10, marginBottom:8, display:"inline-block" }}>{TYPE_LABEL[node.type] ?? node.type}</span>
          <h3 style={{ fontSize:17, fontWeight:700, letterSpacing:"-.3px", wordBreak:"break-word", fontFamily:"var(--mono)" }}>{node.name}</h3>
        </div>

        {/* Module-overview extra info */}
        {node._nodeCount != null && (
          <div style={{ padding:12, borderRadius:"var(--r)", background:"var(--surface-2)", border:"1px solid var(--border)" }}>
            <p style={{ fontSize:22, fontWeight:800, color:"var(--cyan)" }}>{node._nodeCount}</p>
            <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:2 }}>components inside</p>
            {onDrillDown && (
              <button onClick={() => onDrillDown(node)} className="btn btn-ghost"
                style={{ marginTop:10, fontSize:12, padding:"6px 12px", width:"100%", justifyContent:"center" }}>
                Drill into module →
              </button>
            )}
          </div>
        )}

        {isIsolated && (
          <div style={{ padding:10, borderRadius:"var(--r)", background:"rgba(245,158,11,.08)", border:"1px solid rgba(245,158,11,.25)", display:"flex", gap:8, alignItems:"flex-start" }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" style={{ flexShrink:0, marginTop:1 }}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <p style={{ fontSize:12, color:"var(--amber)", lineHeight:1.5 }}>No connections — not imported or called by anything else.</p>
          </div>
        )}

        {node.file   && <Row label="File"          value={node.file}   mono />}
        {node.lineno && <Row label="Line"          value={node.lineno} />}
        {node.loc    && <Row label="Lines of code" value={node.loc}    />}

        {!isIsolated && node._nodeCount == null && (
          <div style={{ padding:14, borderRadius:"var(--r)", background:"var(--surface-2)", border:"1px solid var(--border)" }}>
            <p style={{ fontSize:11, color:"var(--text-muted)", marginBottom:8, fontWeight:600, textTransform:"uppercase", letterSpacing:".06em" }}>Impact</p>
            <div style={{ display:"flex", gap:24 }}>
              <div>
                <p style={{ fontSize:22, fontWeight:800, color: inEdges.length > 5 ? "var(--red)" : inEdges.length > 2 ? "var(--amber)" : "var(--green)" }}>{node.blast_radius ?? inEdges.length}</p>
                <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:2 }}>things call this</p>
              </div>
              <div>
                <p style={{ fontSize:22, fontWeight:800, color:"var(--cyan)" }}>{outEdges.length}</p>
                <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:2 }}>dependencies</p>
              </div>
            </div>
          </div>
        )}

        {inEdges.length  > 0 && <EdgeList title="Called by"       edges={inEdges}  dir="source" />}
        {outEdges.length > 0 && <EdgeList title="Calls / imports" edges={outEdges} dir="target" />}
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div>
      <p style={{ fontSize:11, color:"var(--text-muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:".06em", marginBottom:3 }}>{label}</p>
      <p style={{ fontSize:13, color:"var(--text-dim)", fontFamily: mono ? "var(--mono)" : undefined, wordBreak:"break-all" }}>{value}</p>
    </div>
  );
}

function EdgeList({ title, edges, dir }) {
  return (
    <div>
      <p style={{ fontSize:11, color:"var(--text-muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:".06em", marginBottom:8 }}>{title}</p>
      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
        {edges.slice(0, 12).map((e, i) => (
          <div key={i} style={{ fontSize:12, color:"var(--text-dim)", fontFamily:"var(--mono)", padding:"4px 8px", background:"var(--surface-2)", borderRadius:6, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e[dir]}</div>
        ))}
        {edges.length > 12 && <p style={{ fontSize:11, color:"var(--text-muted)", textAlign:"center", marginTop:4 }}>+{edges.length - 12} more</p>}
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
      {Object.entries(TYPE_COLOR).map(([type, col]) => (
        <span key={type} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"var(--text-muted)" }}>
          <span style={{ width:8, height:8, borderRadius:"50%", background:col, display:"inline-block" }} />
          {TYPE_LABEL[type]}
        </span>
      ))}
    </div>
  );
}

// ── View toggle button ────────────────────────────────────────────────────────
function ViewBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding:"5px 14px", borderRadius:6, fontSize:12, fontWeight:600,
      border:"none", cursor:"pointer", fontFamily:"var(--sans)",
      background: active ? "var(--surface-3)" : "none",
      color:      active ? "var(--text)"      : "var(--text-muted)",
      transition:"background .15s, color .15s",
    }}>
      {label}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function GraphViewer() {
  const { id }  = useParams();
  const nav     = useNavigate();
  const [mapData,      setMapData]      = useState(null);
  const [graphData,    setGraphData]    = useState(null);
  const [selected,     setSelected]     = useState(null);
  const [searchHit,    setSearchHit]    = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [err,          setErr]          = useState("");
  // view state
  const [viewMode,     setViewMode]     = useState(null);   // null = auto
  const [activeModule, setActiveModule] = useState(null);
  const [entryNode,    setEntryNode]    = useState(null);
  const [hops,         setHops]         = useState(3);

  useEffect(() => {
    Promise.all([api.getMap(id), api.getGraph(id)])
      .then(([m, g]) => { setMapData(m); setGraphData(g); })
      .catch(ex => setErr(ex.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Auto mode: default to module view when repo is large
  const rawNodeCount = graphData?.nodes?.length ?? 0;
  const effectiveMode = viewMode ?? (rawNodeCount > 60 ? "modules" : "full");

  // Compute the sliced graph for the current view
  const currentViewData = useMemo(() => {
    if (!graphData) return null;
    if (effectiveMode === "modules")       return buildModuleGraph(graphData.nodes, graphData.edges);
    if (effectiveMode === "module-detail") return buildModuleDetail(activeModule, graphData.nodes, graphData.edges);
    if (effectiveMode === "entrypoint" && entryNode) return bfsSubgraph(entryNode.id, graphData.nodes, graphData.edges, hops);
    return graphData;
  }, [graphData, effectiveMode, activeModule, entryNode, hops]);

  const isolated    = useMemo(() => currentViewData ? findIsolated(currentViewData.nodes, currentViewData.edges) : [], [currentViewData]);
  const isolatedIds = useMemo(() => new Set(isolated.map(n => n.id)), [isolated]);

  // Search over the CURRENT view's nodes
  const searchNodes = currentViewData?.nodes ?? [];

  function switchMode(mode) { setViewMode(mode); setActiveModule(null); setEntryNode(null); setSelected(null); }

  const handleHit = useCallback(node => {
    setSelected(node);
    setSearchHit(node.id);
    setTimeout(() => setSearchHit(null), 800);
  }, []);

  // In module view, clicking a node drills in; otherwise selects
  const handleNodeClick = useCallback(node => {
    if (!node) { setSelected(null); return; }
    if (effectiveMode === "modules") {
      setActiveModule(node.name);
      setViewMode("module-detail");
      setSelected(null);
    } else {
      setSelected(node);
    }
  }, [effectiveMode]);

  function exploreFrom(node) { setEntryNode(node); setViewMode("entrypoint"); setSelected(null); }

  const vCount = currentViewData?.nodes?.length ?? 0;
  const eCount = currentViewData?.edges?.length ?? 0;

  if (loading) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"var(--bg)" }}><span className="spinner" style={{ width:32, height:32, borderWidth:3 }} /></div>;
  if (err) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"var(--bg)", flexDirection:"column", gap:16 }}>
      <p style={{ color:"var(--red)", fontSize:16 }}>{err}</p>
      <button className="btn btn-ghost" onClick={() => nav("/dashboard")}>← Back to dashboard</button>
    </div>
  );

  const breadcrumb = (() => {
    if (effectiveMode === "module-detail") return (
      <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13 }}>
        <button onClick={() => { setViewMode("modules"); setActiveModule(null); setSelected(null); }}
          style={{ color:"var(--text-muted)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--sans)", fontSize:13, padding:0 }}>
          ← All modules
        </button>
        <span style={{ color:"var(--border-2)" }}>›</span>
        <span style={{ color:"var(--cyan)", fontFamily:"var(--mono)", fontWeight:600 }}>{activeModule}</span>
      </div>
    );
    if (effectiveMode === "entrypoint") return (
      <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13 }}>
        <button onClick={() => switchMode("full")}
          style={{ color:"var(--text-muted)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--sans)", fontSize:13, padding:0 }}>
          ← Full graph
        </button>
        <span style={{ color:"var(--border-2)" }}>›</span>
        <span style={{ color:"var(--cyan)", fontFamily:"var(--mono)", fontWeight:600 }}>{entryNode?.name}</span>
        <div style={{ display:"flex", alignItems:"center", gap:4, marginLeft:8, background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:6, padding:"2px 4px" }}>
          <button onClick={() => setHops(h => Math.max(1, h - 1))} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--text-dim)", fontSize:14, padding:"0 4px", fontFamily:"var(--sans)" }}>−</button>
          <span style={{ fontSize:12, color:"var(--text-dim)", minWidth:40, textAlign:"center" }}>{hops} hops</span>
          <button onClick={() => setHops(h => Math.min(8, h + 1))} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--text-dim)", fontSize:14, padding:"0 4px", fontFamily:"var(--sans)" }}>+</button>
        </div>
      </div>
    );
    return null;
  })();

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>
      {/* Toolbar */}
      <div style={{ height:56, flexShrink:0, background:"var(--surface)", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", padding:"0 16px", gap:12 }}>
        <button onClick={() => nav("/dashboard")}
          style={{ display:"flex", alignItems:"center", gap:6, color:"var(--text-muted)", background:"none", border:"none", cursor:"pointer", fontSize:13, fontFamily:"var(--sans)", flexShrink:0 }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Dashboard
        </button>
        <div style={{ width:1, height:24, background:"var(--border)", flexShrink:0 }} />
        <h1 style={{ fontSize:15, fontWeight:700, letterSpacing:"-.3px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:200, flexShrink:0 }}>
          {mapData?.name ?? "Code map"}
        </h1>

        {/* Breadcrumb (module-detail or entry-point mode) */}
        {breadcrumb && (
          <>
            <div style={{ width:1, height:24, background:"var(--border)", flexShrink:0 }} />
            {breadcrumb}
          </>
        )}

        <div style={{ display:"flex", gap:12, marginLeft:"auto", alignItems:"center", flexShrink:0 }}>
          <span style={{ fontSize:12, color:"var(--text-muted)", fontFamily:"var(--mono)" }}>
            {vCount} · {eCount}
            {vCount !== rawNodeCount && <span style={{ color:"var(--text-muted)", opacity:.6 }}> / {rawNodeCount} total</span>}
          </span>

          {/* View toggle */}
          <div style={{ display:"flex", gap:2, padding:2, background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:8 }}>
            <ViewBtn label="Modules"    active={effectiveMode === "modules" || effectiveMode === "module-detail"} onClick={() => switchMode("modules")} />
            <ViewBtn label="Full graph" active={effectiveMode === "full" || effectiveMode === "entrypoint"}       onClick={() => switchMode("full")} />
          </div>

          <Legend />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex:1, display:"flex", overflow:"hidden", position:"relative" }}>
        {/* Left overlay */}
        <div style={{ position:"absolute", top:16, left:16, zIndex:20, width:260, display:"flex", flexDirection:"column", gap:10 }}>
          <SearchBar nodes={searchNodes} onHit={handleHit} />
          <IsolatedPanel nodes={isolated} onFlyTo={handleHit} />
          {(effectiveMode === "full" || effectiveMode === "modules") && (
            <EntryPointPanel graphData={graphData} onExplore={exploreFrom} />
          )}
        </div>

        {/* Graph canvas — receives the sliced data for current view */}
        <div style={{ flex:1, overflow:"hidden" }}>
          <GraphCanvas
            graphData={currentViewData}
            selected={selected}
            onSelect={handleNodeClick}
            searchHit={searchHit}
            isolatedIds={isolatedIds}
          />
        </div>

        {/* Detail panel — always uses full graphData for edge counts */}
        {selected && (
          <DetailPanel
            node={selected}
            graphData={graphData}
            onClose={() => setSelected(null)}
            onDrillDown={effectiveMode === "modules" ? node => { setActiveModule(node.name); setViewMode("module-detail"); setSelected(null); } : null}
          />
        )}
      </div>
    </div>
  );
}
