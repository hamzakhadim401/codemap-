import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";

// ── Navbar ────────────────────────────────────────────────────────────────────
function AppNav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setMenu(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleLogout() {
    logout();
    nav("/", { replace: true });
  }

  return (
    <nav className="nav">
      <Link to="/" className="nav-logo">
        <div className="nav-logo-mark">CM</div>
        CodeMap
      </Link>
      <div className="nav-spacer" />
      <Link to="/settings" style={{ fontSize:14, color:"var(--text-dim)", fontWeight:500 }}>Settings</Link>
      <div ref={ref} style={{ position:"relative" }}>
        <button
          onClick={() => setMenu(m => !m)}
          style={{ display:"flex", alignItems:"center", gap:8, background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--r)", padding:"7px 12px", cursor:"pointer", color:"var(--text)" }}
        >
          <div style={{ width:26, height:26, borderRadius:"50%", background:"var(--grad)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff", flexShrink:0 }}>
            {(user?.name || user?.email || "?")[0].toUpperCase()}
          </div>
          <span style={{ fontSize:14, fontWeight:500, maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {user?.name || user?.email}
          </span>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {menu && (
          <div style={{ position:"absolute", right:0, top:"calc(100% + 8px)", background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:"var(--r)", minWidth:180, boxShadow:"0 16px 40px rgba(0,0,0,.4)", zIndex:200, overflow:"hidden" }}>
            <Link to="/settings" onClick={() => setMenu(false)} style={{ display:"block", padding:"11px 16px", fontSize:14, color:"var(--text-dim)", borderBottom:"1px solid var(--border)" }}>
              Settings
            </Link>
            <button onClick={handleLogout} style={{ display:"block", width:"100%", textAlign:"left", padding:"11px 16px", fontSize:14, color:"var(--red)", cursor:"pointer", background:"none", border:"none", fontFamily:"var(--sans)" }}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ status }) {
  const map = {
    done:    { cls:"chip-done",    label:"Ready" },
    running: { cls:"chip-running", label:"Analyzing" },
    pending: { cls:"chip-pending", label:"Queued" },
    failed:  { cls:"chip-failed",  label:"Failed" },
  };
  const s = map[status] || { cls:"chip-done", label:status };
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

// ── Map card ──────────────────────────────────────────────────────────────────
function MapCard({ map, onDelete }) {
  const nav = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e) {
    e.stopPropagation();
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try { await api.deleteMap(map.id); onDelete(map.id); }
    catch (ex) { alert(ex.message); setDeleting(false); }
  }

  const nodeCount = map.node_count ?? 0;
  const edgeCount = map.edge_count ?? 0;

  return (
    <div
      onClick={() => map.status === "done" && nav(`/map/${map.id}`)}
      className="card"
      style={{ cursor: map.status === "done" ? "pointer" : "default", backgroundImage:"var(--grad-card)", display:"flex", flexDirection:"column", gap:16, position:"relative", transition:"border-color .18s, transform .18s, box-shadow .18s" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor="var(--border-2)"; e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow="0 12px 32px rgba(0,0,0,.3)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.transform=""; e.currentTarget.style.boxShadow=""; }}
    >
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
        <div style={{ minWidth:0 }}>
          <h3 style={{ fontSize:17, fontWeight:700, letterSpacing:"-.3px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", marginBottom:4 }}>{map.name}</h3>
          <p style={{ fontSize:12, color:"var(--text-muted)", fontFamily:"var(--mono)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {map.repo_url || map.repo_path || "local"}
          </p>
        </div>
        <StatusChip status={map.status} />
      </div>

      {map.status === "done" && (
        <div style={{ display:"flex", gap:24 }}>
          <Stat label="Components" value={nodeCount} />
          <Stat label="Connections" value={edgeCount} />
        </div>
      )}

      {map.status === "running" && (
        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"var(--text-muted)" }}>
          <span className="spinner" style={{ width:13, height:13 }} />
          Analysis in progress…
        </div>
      )}

      <div style={{ display:"flex", gap:8, marginTop:"auto" }}>
        {map.status === "done" && (
          <button
            onClick={e => { e.stopPropagation(); nav(`/map/${map.id}`); }}
            className="btn btn-outline"
            style={{ padding:"7px 14px", fontSize:13 }}
          >
            Open map
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={deleting}
          className={`btn ${confirmDelete ? "btn-danger" : "btn-ghost"}`}
          style={{ padding:"7px 14px", fontSize:13 }}
        >
          {deleting ? <span className="spinner" /> : confirmDelete ? "Confirm delete" : "Delete"}
        </button>
        {confirmDelete && (
          <button
            onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
            className="btn btn-ghost"
            style={{ padding:"7px 14px", fontSize:13 }}
          >
            Cancel
          </button>
        )}
      </div>

      {map.created_at && (
        <p style={{ fontSize:11, color:"var(--text-muted)", marginTop:-8 }}>
          Created {new Date(map.created_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p style={{ fontSize:22, fontWeight:800, letterSpacing:"-1px", lineHeight:1 }}>{value}</p>
      <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:2 }}>{label}</p>
    </div>
  );
}

// ── Create map modal ──────────────────────────────────────────────────────────
function CreateModal({ onClose, onCreate }) {
  const [name, setName]         = useState("");
  const [source, setSource]     = useState("");
  const [confidential, setConf] = useState(false);
  const [err, setErr]           = useState("");
  const [loading, setLoading]   = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!source.trim()) { setErr("Repository path or URL is required"); return; }
    setLoading(true);
    try {
      const isUrl = source.trim().startsWith("http") || source.trim().startsWith("git@");
      const body = {
        name: name.trim() || source.split("/").pop().replace(".git",""),
        confidential,
      };
      if (isUrl) body.repo_url = source.trim();
      else       body.repo_path = source.trim();
      const map = await api.createMap(body);
      onCreate(map);
      onClose();
    } catch (ex) {
      setErr(ex.message || "Failed to create map");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(2,6,23,.8)", backdropFilter:"blur(8px)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ width:"100%", maxWidth:480, padding:32 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
          <h2 style={{ fontSize:22, fontWeight:800, letterSpacing:"-.5px" }}>Map a repository</h2>
          <button onClick={onClose} style={{ color:"var(--text-muted)", fontSize:20, lineHeight:1, cursor:"pointer", background:"none", border:"none", padding:4 }}>×</button>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label className="label">Repository</label>
            <input
              className={`input${err ? " error" : ""}`}
              autoFocus
              placeholder="https://github.com/org/repo  or  C:\path\to\project"
              value={source}
              onChange={e => { setSource(e.target.value); setErr(""); }}
            />
            <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:6 }}>
              Git URL or local directory path
            </p>
          </div>

          <div className="field">
            <label className="label">Map name (optional)</label>
            <input
              className="input"
              placeholder="Auto-detected from repo name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", marginBottom:24, userSelect:"none" }}>
            <input
              type="checkbox"
              checked={confidential}
              onChange={e => setConf(e.target.checked)}
              style={{ width:16, height:16, accentColor:"var(--purple)" }}
            />
            <span style={{ fontSize:14 }}>
              <strong>Private analysis</strong>
              <span style={{ color:"var(--text-muted)", marginLeft:6 }}>— wipe all data after mapping, nothing stored</span>
            </span>
          </label>

          {err && <p className="err-msg" style={{ marginBottom:16 }}>{err}</p>}

          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ minWidth:120, justifyContent:"center" }}>
              {loading ? <span className="spinner" /> : "Analyze repo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const [maps, setMaps]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    api.listMaps()
      .then(data => setMaps(Array.isArray(data) ? data : (data?.projects ?? [])))
      .catch(ex => setErr(ex.message))
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(map) {
    setMaps(m => [map, ...m]);
  }

  function handleDeleted(id) {
    setMaps(m => m.filter(x => x.id !== id));
  }

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)" }}>
      <AppNav />

      <div className="container" style={{ paddingTop:48, paddingBottom:80 }}>
        {/* header */}
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:40, flexWrap:"wrap", gap:16 }}>
          <div>
            <h1 style={{ fontSize:30, fontWeight:800, letterSpacing:"-1px", marginBottom:6 }}>
              {greeting}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
            </h1>
            <p style={{ color:"var(--text-dim)", fontSize:15 }}>
              {maps.length === 0 ? "Map your first repository to get started" : `You have ${maps.length} code ${maps.length === 1 ? "map" : "maps"}`}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="btn btn-primary"
            style={{ fontSize:15, padding:"11px 24px" }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New map
          </button>
        </div>

        {/* content */}
        {loading && (
          <div style={{ display:"flex", justifyContent:"center", paddingTop:64 }}>
            <span className="spinner" style={{ width:32, height:32, borderWidth:3 }} />
          </div>
        )}

        {!loading && err && (
          <div style={{ padding:20, background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.2)", borderRadius:"var(--r)", color:"var(--red)", fontSize:14 }}>
            {err}
          </div>
        )}

        {!loading && !err && maps.length === 0 && (
          <EmptyState onNew={() => setShowCreate(true)} />
        )}

        {!loading && !err && maps.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:20 }}>
            {maps.map(m => (
              <MapCard key={m.id} map={m} onDelete={handleDeleted} />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreated} />
      )}
    </div>
  );
}

function EmptyState({ onNew }) {
  return (
    <div style={{ textAlign:"center", paddingTop:80, paddingBottom:80 }}>
      <div style={{
        width:80, height:80, borderRadius:20, background:"var(--grad)", margin:"0 auto 24px",
        display:"flex", alignItems:"center", justifyContent:"center",
        boxShadow:"0 0 40px rgba(168,85,247,.3)",
      }}>
        <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
          <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      </div>
      <h2 style={{ fontSize:24, fontWeight:800, letterSpacing:"-.5px", marginBottom:12 }}>No maps yet</h2>
      <p style={{ fontSize:15, color:"var(--text-dim)", maxWidth:400, margin:"0 auto 32px", lineHeight:1.7 }}>
        Add your first repository and we'll build you an interactive visual map in seconds.
      </p>
      <button onClick={onNew} className="btn btn-primary" style={{ fontSize:15, padding:"13px 32px" }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Map a repository
      </button>
    </div>
  );
}
