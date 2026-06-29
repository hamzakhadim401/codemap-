import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import * as d3 from "d3";
import { api } from "../api.js";

// ── color per node type ───────────────────────────────────────────────────────
const TYPE_COLOR = {
  module:   "#3b82f6",
  class:    "#a855f7",
  function: "#06b6d4",
  method:   "#10b981",
};
function nodeColor(type) { return TYPE_COLOR[type] ?? "#94a3b8"; }

// ── readable type labels ──────────────────────────────────────────────────────
const TYPE_LABEL = { module:"Module", class:"Class", function:"Function", method:"Method" };

// ── D3 graph component ────────────────────────────────────────────────────────
function GraphCanvas({ graphData, selected, onSelect, searchHit }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);

  useEffect(() => {
    if (!graphData || !svgRef.current) return;

    const { nodes: rawNodes, edges: rawEdges } = graphData;
    if (!rawNodes?.length) return;

    const el = svgRef.current;
    d3.select(el).selectAll("*").remove();

    const W = el.clientWidth  || 800;
    const H = el.clientHeight || 600;

    const svg = d3.select(el)
      .attr("width", W).attr("height", H);

    const g = svg.append("g");

    // zoom
    svg.call(d3.zoom()
      .scaleExtent([.05, 4])
      .on("zoom", e => g.attr("transform", e.transform)));

    // deep copy nodes for simulation
    const nodes = rawNodes.map(d => ({ ...d }));
    const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));

    const links = (rawEdges || [])
      .filter(e => nodeById[e.source] && nodeById[e.target])
      .map(e => ({ ...e, source: e.source, target: e.target }));

    const linkSel = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", d => d.type === "calls" ? "rgba(168,85,247,.35)" : "rgba(59,130,246,.2)")
      .attr("stroke-width", d => d.type === "calls" ? 1.2 : .7)
      .attr("stroke-dasharray", d => d.type === "imports" ? "4 3" : null);

    const nodeSel = g.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) simRef.current?.alphaTarget(.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag",  (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end",   (e, d) => { if (!e.active) simRef.current?.alphaTarget(0); d.fx = null; d.fy = null; }))
      .on("click", (e, d) => { e.stopPropagation(); onSelect(d); });

    const r = d => {
      const base = d.type === "module" ? 9 : d.type === "class" ? 7 : 5;
      const br = Math.log1p(d.blast_radius ?? 0);
      return Math.min(base + br * 1.5, 20);
    };

    nodeSel.append("circle")
      .attr("r", r)
      .attr("fill", d => nodeColor(d.type))
      .attr("fill-opacity", .22)
      .attr("stroke", d => nodeColor(d.type))
      .attr("stroke-width", 1.5);

    nodeSel.append("text")
      .text(d => d.name)
      .attr("dy", d => r(d) + 10)
      .attr("text-anchor", "middle")
      .attr("fill", "#94a3b8")
      .attr("font-size", 8)
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("pointer-events", "none");

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(60).strength(.6))
      .force("charge", d3.forceManyBody().strength(-180))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide(d => r(d) + 4))
      .on("tick", () => {
        linkSel.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
               .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
      });

    simRef.current = sim;
    svg.on("click", () => onSelect(null));
    return () => { sim.stop(); };
  }, [graphData]);

  // Highlight selected
  useEffect(() => {
    if (!svgRef.current) return;
    d3.select(svgRef.current).selectAll("circle")
      .attr("stroke-width", d => d.id === selected?.id ? 3 : 1.5)
      .attr("stroke-opacity", d => d.id === selected?.id ? 1 : .85);
  }, [selected]);

  // Highlight search hit
  useEffect(() => {
    if (!svgRef.current || !searchHit) return;
    const node = d3.select(svgRef.current).selectAll("g[cursor=pointer]")
      .filter(d => d.id === searchHit);
    if (!node.empty()) {
      const d = node.datum();
      if (d?.x != null) {
        const W = svgRef.current.clientWidth;
        const H = svgRef.current.clientHeight;
        const t = d3.zoomIdentity.translate(W/2 - d.x, H/2 - d.y).scale(1.2);
        d3.select(svgRef.current).transition().duration(600).call(
          d3.zoom().transform, t
        );
      }
    }
  }, [searchHit]);

  return (
    <svg
      ref={svgRef}
      style={{ width:"100%", height:"100%", background:"var(--bg)", display:"block" }}
    />
  );
}

// ── search bar ────────────────────────────────────────────────────────────────
function SearchBar({ nodes, onHit }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const ref = useRef(null);

  function search(val) {
    setQ(val);
    if (!val.trim()) { setResults([]); return; }
    const lower = val.toLowerCase();
    setResults((nodes || []).filter(n => n.name?.toLowerCase().includes(lower)).slice(0, 8));
  }

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setResults([]); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <div style={{ position:"relative" }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ position:"absolute", left:11, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="input"
          style={{ paddingLeft:32, fontSize:13, background:"var(--surface-2)" }}
          placeholder="Search components…"
          value={q}
          onChange={e => search(e.target.value)}
        />
      </div>
      {results.length > 0 && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:"var(--r)", overflow:"hidden", zIndex:50, boxShadow:"0 12px 32px rgba(0,0,0,.4)" }}>
          {results.map(n => (
            <div
              key={n.id}
              onClick={() => { onHit(n); setResults([]); setQ(""); }}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 12px", cursor:"pointer", borderBottom:"1px solid var(--border)", transition:"background .12s" }}
              onMouseEnter={e => e.currentTarget.style.background="var(--surface-3)"}
              onMouseLeave={e => e.currentTarget.style.background=""}
            >
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

// ── detail panel ──────────────────────────────────────────────────────────────
function DetailPanel({ node, graphData, onClose }) {
  if (!node) return null;

  const inEdges  = (graphData?.edges || []).filter(e => e.target === node.id);
  const outEdges = (graphData?.edges || []).filter(e => e.source === node.id);
  const callers  = inEdges.filter(e => e.type === "calls").length;

  return (
    <div style={{ background:"var(--surface)", borderLeft:"1px solid var(--border)", width:280, flexShrink:0, overflowY:"auto", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:13, fontWeight:600, color:"var(--text-dim)" }}>Details</span>
        <button onClick={onClose} style={{ color:"var(--text-muted)", background:"none", border:"none", fontSize:18, cursor:"pointer", lineHeight:1, padding:2 }}>×</button>
      </div>

      <div style={{ padding:20, display:"flex", flexDirection:"column", gap:20 }}>
        <div>
          <div style={{ display:"flex", align:"center", gap:8, marginBottom:6 }}>
            <span style={{ width:10, height:10, borderRadius:"50%", background:nodeColor(node.type), display:"inline-block", marginTop:2 }} />
            <span className="tag" style={{ fontSize:10 }}>{TYPE_LABEL[node.type] ?? node.type}</span>
          </div>
          <h3 style={{ fontSize:17, fontWeight:700, letterSpacing:"-.3px", wordBreak:"break-word", fontFamily:"var(--mono)" }}>{node.name}</h3>
        </div>

        <Row label="File" value={node.file} mono />
        {node.lineno && <Row label="Line" value={node.lineno} />}
        {node.loc     && <Row label="Lines of code" value={node.loc} />}

        <div style={{ padding:14, borderRadius:"var(--r)", background:"var(--surface-2)", border:"1px solid var(--border)" }}>
          <p style={{ fontSize:12, color:"var(--text-muted)", marginBottom:8, fontWeight:600, textTransform:"uppercase", letterSpacing:".06em" }}>Impact</p>
          <div style={{ display:"flex", gap:24 }}>
            <div>
              <p style={{ fontSize:22, fontWeight:800, color: callers > 5 ? "var(--red)" : callers > 2 ? "var(--amber)" : "var(--green)" }}>
                {node.blast_radius ?? callers}
              </p>
              <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:2 }}>things call this</p>
            </div>
            <div>
              <p style={{ fontSize:22, fontWeight:800, color:"var(--cyan)" }}>{outEdges.length}</p>
              <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:2 }}>dependencies</p>
            </div>
          </div>
          <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:10, lineHeight:1.5 }}>
            {callers > 5 ? "High impact — many things depend on this." : callers > 0 ? "Moderate impact — changes here will affect a few places." : "Low impact — safe to change independently."}
          </p>
        </div>

        {inEdges.length > 0 && (
          <EdgeList title="Called by" edges={inEdges} dir="source" />
        )}
        {outEdges.length > 0 && (
          <EdgeList title="Calls / imports" edges={outEdges} dir="target" />
        )}
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
          <div key={i} style={{ fontSize:12, color:"var(--text-dim)", fontFamily:"var(--mono)", padding:"4px 8px", background:"var(--surface-2)", borderRadius:6, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {e[dir]}
          </div>
        ))}
        {edges.length > 12 && (
          <p style={{ fontSize:11, color:"var(--text-muted)", textAlign:"center", marginTop:4 }}>+{edges.length - 12} more</p>
        )}
      </div>
    </div>
  );
}

// ── legend ────────────────────────────────────────────────────────────────────
function Legend() {
  const items = [
    { col: TYPE_COLOR.module,   label: "Module" },
    { col: TYPE_COLOR.class,    label: "Class" },
    { col: TYPE_COLOR.function, label: "Function" },
    { col: TYPE_COLOR.method,   label: "Method" },
  ];
  return (
    <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
      {items.map(({ col, label }) => (
        <span key={label} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"var(--text-muted)" }}>
          <span style={{ width:8, height:8, borderRadius:"50%", background:col, display:"inline-block" }} />
          {label}
        </span>
      ))}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function GraphViewer() {
  const { id }   = useParams();
  const nav      = useNavigate();
  const [mapData,   setMapData]   = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [selected,  setSelected]  = useState(null);
  const [searchHit, setSearchHit] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [err,       setErr]       = useState("");

  useEffect(() => {
    Promise.all([api.getMap(id), api.getGraph(id)])
      .then(([m, g]) => { setMapData(m); setGraphData(g); })
      .catch(ex => setErr(ex.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleHit = useCallback(node => {
    setSelected(node);
    setSearchHit(node.id);
    setTimeout(() => setSearchHit(null), 800);
  }, []);

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"var(--bg)" }}>
      <span className="spinner" style={{ width:32, height:32, borderWidth:3 }} />
    </div>
  );

  if (err) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"var(--bg)", flexDirection:"column", gap:16 }}>
      <p style={{ color:"var(--red)", fontSize:16 }}>{err}</p>
      <button className="btn btn-ghost" onClick={() => nav("/dashboard")}>← Back to dashboard</button>
    </div>
  );

  const nodeCount = graphData?.nodes?.length ?? 0;
  const edgeCount = graphData?.edges?.length ?? 0;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>
      {/* toolbar */}
      <div style={{ height:56, flexShrink:0, background:"var(--surface)", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", padding:"0 20px", gap:16 }}>
        <button
          onClick={() => nav("/dashboard")}
          style={{ display:"flex", alignItems:"center", gap:6, color:"var(--text-muted)", background:"none", border:"none", cursor:"pointer", fontSize:13, fontFamily:"var(--sans)" }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Dashboard
        </button>

        <div style={{ width:1, height:24, background:"var(--border)" }} />

        <h1 style={{ fontSize:15, fontWeight:700, letterSpacing:"-.3px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:240 }}>
          {mapData?.name ?? "Code map"}
        </h1>

        <div style={{ display:"flex", gap:16, marginLeft:"auto", alignItems:"center" }}>
          <div style={{ fontSize:12, color:"var(--text-muted)", fontFamily:"var(--mono)" }}>
            {nodeCount} components · {edgeCount} connections
          </div>
          <Legend />
        </div>
      </div>

      {/* body */}
      <div style={{ flex:1, display:"flex", overflow:"hidden", position:"relative" }}>
        {/* search + controls overlay */}
        <div style={{ position:"absolute", top:16, left:16, zIndex:20, width:240 }}>
          <SearchBar nodes={graphData?.nodes} onHit={handleHit} />
        </div>

        {/* graph canvas */}
        <div style={{ flex:1, overflow:"hidden" }}>
          <GraphCanvas
            graphData={graphData}
            selected={selected}
            onSelect={setSelected}
            searchHit={searchHit}
          />
        </div>

        {/* detail panel */}
        {selected && (
          <DetailPanel
            node={selected}
            graphData={graphData}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
