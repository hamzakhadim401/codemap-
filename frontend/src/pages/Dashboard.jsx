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
            {map.source || map.repo_url || map.repo_path || "local"}
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

// ── Tab pill helper ───────────────────────────────────────────────────────────
function TabPill({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding:"6px 14px", fontSize:13, fontWeight:600, borderRadius:8, cursor:"pointer",
        border:"none", background: active ? "var(--grad)" : "transparent",
        color: active ? "#fff" : "var(--text-muted)",
        boxShadow: active ? "0 2px 12px rgba(168,85,247,.3)" : "none",
        transition:"all .15s",
      }}
    >
      {label}
    </button>
  );
}

// ── Create map modal ──────────────────────────────────────────────────────────
function CreateModal({ onClose, onCreate }) {
  const [tab, setTab]           = useState("url"); // "url" | "zip"
  const [name, setName]         = useState("");
  const [source, setSource]     = useState("");
  const [zipFile, setZipFile]   = useState(null);
  const [confidential, setConf] = useState(false);
  const [err, setErr]           = useState("");
  const [loading, setLoading]   = useState(false);

  function resetErr() { setErr(""); }

  // ── URL / path submit ─────────────────────────────────────────────────────
  async function submitUrl(e) {
    e.preventDefault();
    setErr("");
    if (!source.trim()) { setErr("Repository path or URL is required"); return; }
    setLoading(true);
    try {
      const map = await api.createMap({
        source: source.trim(),
        name:   name.trim() || undefined,
        confidential,
      });
      onCreate(map);
      onClose();
    } catch (ex) {
      setErr(ex.message || "Failed to create map");
    } finally {
      setLoading(false);
    }
  }

  // ── Zip submit ────────────────────────────────────────────────────────────
  async function submitZip(e) {
    e.preventDefault();
    setErr("");
    if (!zipFile) { setErr("Please select a .zip file"); return; }
    if (!zipFile.name.toLowerCase().endsWith(".zip")) { setErr("Only .zip files are supported"); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem("cm_token") || "";
      const mapName = name.trim() || zipFile.name.replace(/\.zip$/i, "");
      const res = await fetch("/projects/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          "X-Map-Name":   mapName,
          ...(token ? { "X-Session-Token": token } : {}),
        },
        body: zipFile,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onCreate(data);
      onClose();
    } catch (ex) {
      setErr(ex.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{ position:"fixed", inset:0, background:"rgba(2,6,23,.8)", backdropFilter:"blur(8px)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width:"100%", maxWidth:480, padding:32 }}>
        {/* header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h2 style={{ fontSize:22, fontWeight:800, letterSpacing:"-.5px" }}>Map a repository</h2>
          <button onClick={onClose} style={{ color:"var(--text-muted)", fontSize:22, lineHeight:1, cursor:"pointer", background:"none", border:"none", padding:4 }}>×</button>
        </div>

        {/* tab switcher */}
        <div style={{ display:"flex", gap:4, padding:4, background:"var(--surface-2)", borderRadius:10, marginBottom:24, width:"fit-content" }}>
          <TabPill label="Git URL / local path" active={tab === "url"} onClick={() => { setTab("url"); resetErr(); }} />
          <TabPill label="Upload zip"            active={tab === "zip"} onClick={() => { setTab("zip"); resetErr(); }} />
        </div>

        {/* ── URL tab ── */}
        {tab === "url" && (
          <form onSubmit={submitUrl}>
            <div className="field">
              <label className="label">Repository</label>
              <input
                className={`input${err ? " error" : ""}`}
                autoFocus
                placeholder="https://github.com/org/repo  or  C:\path\to\project"
                value={source}
                onChange={e => { setSource(e.target.value); resetErr(); }}
              />
              <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:6 }}>
                Accepts any public Git URL (https / ssh) or a local directory path
              </p>
            </div>

            <NameAndConfidential name={name} setName={setName} confidential={confidential} setConf={setConf} />

            {err && <p className="err-msg" style={{ marginBottom:16 }}>{err}</p>}

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ minWidth:130, justifyContent:"center" }}>
                {loading ? <span className="spinner" /> : "Start mapping"}
              </button>
            </div>
          </form>
        )}

        {/* ── Zip tab ── */}
        {tab === "zip" && (
          <form onSubmit={submitZip}>
            <div className="field">
              <label className="label">Zip file</label>
              <label
                style={{
                  display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                  gap:8, padding:"32px 16px", borderRadius:"var(--r)", cursor:"pointer",
                  border: `2px dashed ${zipFile ? "var(--purple)" : "var(--border)"}`,
                  background: zipFile ? "rgba(168,85,247,.06)" : "var(--surface-2)",
                  transition:"border-color .15s, background .15s",
                }}
              >
                <input
                  type="file"
                  accept=".zip"
                  style={{ display:"none" }}
                  onChange={e => { setZipFile(e.target.files?.[0] ?? null); resetErr(); }}
                />
                {zipFile ? (
                  <>
                    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="1.7">
                      <path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span style={{ fontSize:14, fontWeight:600, color:"var(--purple)" }}>{zipFile.name}</span>
                    <span style={{ fontSize:12, color:"var(--text-muted)" }}>{(zipFile.size / 1024 / 1024).toFixed(1)} MB · click to change</span>
                  </>
                ) : (
                  <>
                    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.7">
                      <path d="M4 16l4-4 4 4m0 0l4-4 4 4M12 12V4" /><rect x="2" y="18" width="20" height="2" rx="1" />
                    </svg>
                    <span style={{ fontSize:14, color:"var(--text-muted)" }}>Click or drag to select a <strong style={{ color:"var(--text-dim)" }}>.zip</strong> file</span>
                    <span style={{ fontSize:12, color:"var(--text-muted)" }}>Max 500 MB</span>
                  </>
                )}
              </label>
            </div>

            <NameAndConfidential name={name} setName={setName} confidential={confidential} setConf={setConf} />

            {err && <p className="err-msg" style={{ marginBottom:16 }}>{err}</p>}

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading || !zipFile} style={{ minWidth:130, justifyContent:"center" }}>
                {loading ? <span className="spinner" /> : "Upload & map"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function NameAndConfidential({ name, setName, confidential, setConf }) {
  return (
    <>
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
    </>
  );
}

const ACTIVE_STATUSES = new Set(["pending", "running"]);

// ── Dashboard page ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const [maps, setMaps]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [showCreate, setShowCreate] = useState(false);

  function normalizeMaps(data) {
    return Array.isArray(data) ? data : (data?.projects ?? []);
  }

  // Initial fetch
  useEffect(() => {
    api.listMaps()
      .then(data => setMaps(normalizeMaps(data)))
      .catch(ex => setErr(ex.message))
      .finally(() => setLoading(false));
  }, []);

  // Poll every 3 s while any map is still processing
  useEffect(() => {
    const hasActive = maps.some(m => ACTIVE_STATUSES.has(m.status));
    if (!hasActive) return;

    const id = setInterval(() => {
      api.listMaps()
        .then(data => setMaps(normalizeMaps(data)))
        .catch(() => {}); // silent — don't overwrite existing data on transient error
    }, 3000);

    return () => clearInterval(id);
  }, [maps]);

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
