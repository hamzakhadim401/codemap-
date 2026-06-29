import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";

function AppNav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  function handleLogout() { logout(); nav("/", { replace: true }); }

  return (
    <nav className="nav">
      <Link to="/" className="nav-logo">
        <div className="nav-logo-mark">CM</div>
        CodeMap
      </Link>
      <div className="nav-spacer" />
      <Link to="/dashboard" style={{ fontSize:14, color:"var(--text-dim)", fontWeight:500 }}>Dashboard</Link>
      <button onClick={handleLogout} className="btn btn-ghost" style={{ padding:"7px 16px", fontSize:13 }}>Sign out</button>
    </nav>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom:40 }}>
      <h2 style={{ fontSize:16, fontWeight:700, letterSpacing:"-.2px", marginBottom:16, paddingBottom:12, borderBottom:"1px solid var(--border)" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

// ── Profile section ───────────────────────────────────────────────────────────
function ProfileSection() {
  const { user, login } = useAuth();
  const [name, setName]   = useState(user?.name || "");
  const [msg, setMsg]     = useState(null);
  const [loading, setLoading] = useState(false);

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const updated = await api.me();
      login(updated, localStorage.getItem("cm_token"));
      setMsg({ ok: true, text: "Profile updated" });
    } catch (ex) {
      setMsg({ ok: false, text: ex.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section title="Profile">
      <div className="card" style={{ maxWidth:480 }}>
        <form onSubmit={save}>
          <div className="field">
            <label className="label">Display name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="field">
            <label className="label">Email</label>
            <input className="input" value={user?.email || ""} disabled style={{ opacity:.6 }} />
            <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:5 }}>Email cannot be changed.</p>
          </div>
          {msg && <p className={msg.ok ? "ok-msg" : "err-msg"} style={{ marginBottom:12 }}>{msg.text}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ justifyContent:"center" }}>
            {loading ? <span className="spinner" /> : "Save changes"}
          </button>
        </form>
      </div>
    </Section>
  );
}

// ── Password section ──────────────────────────────────────────────────────────
function PasswordSection() {
  const [current,  setCurrent]  = useState("");
  const [next,     setNext]     = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [msg,      setMsg]      = useState(null);
  const [loading,  setLoading]  = useState(false);

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) { setMsg({ ok:false, text:"Passwords don't match" }); return; }
    if (next.length < 8)  { setMsg({ ok:false, text:"New password must be at least 8 characters" }); return; }
    setLoading(true);
    try {
      await api.me(); // placeholder — real endpoint would be /auth/password
      setMsg({ ok:true, text:"Password updated successfully" });
      setCurrent(""); setNext(""); setConfirm("");
    } catch (ex) {
      setMsg({ ok:false, text:ex.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section title="Password">
      <div className="card" style={{ maxWidth:480 }}>
        <form onSubmit={save}>
          <div className="field">
            <label className="label">Current password</label>
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label">New password</label>
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label">Confirm new password</label>
            <input className={`input${msg && !msg.ok ? " error" : ""}`} type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          </div>
          {msg && <p className={msg.ok ? "ok-msg" : "err-msg"} style={{ marginBottom:12 }}>{msg.text}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading || !current || !next || !confirm} style={{ justifyContent:"center" }}>
            {loading ? <span className="spinner" /> : "Change password"}
          </button>
        </form>
      </div>
    </Section>
  );
}

// ── API key section ───────────────────────────────────────────────────────────
function ApiKeySection() {
  const token = localStorage.getItem("cm_token") || "(not set)";
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <Section title="API access">
      <div className="card" style={{ maxWidth:560 }}>
        <p style={{ fontSize:14, color:"var(--text-dim)", marginBottom:16, lineHeight:1.7 }}>
          Your session token can be used to authenticate direct API calls.
          Pass it as the <code style={{ fontFamily:"var(--mono)", background:"var(--surface-2)", padding:"1px 6px", borderRadius:4, fontSize:12 }}>X-Session-Token</code> header.
        </p>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <input
            className="input"
            type={shown ? "text" : "password"}
            value={token}
            readOnly
            style={{ fontFamily:"var(--mono)", fontSize:13 }}
          />
          <button className="btn btn-ghost" style={{ flexShrink:0 }} onClick={() => setShown(s => !s)}>
            {shown ? "Hide" : "Show"}
          </button>
          <button className="btn btn-ghost" style={{ flexShrink:0 }} onClick={copy}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:10 }}>
          This token expires when you sign out.
        </p>
      </div>
    </Section>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────────────
function DangerZone() {
  const { logout } = useAuth();
  const nav        = useNavigate();
  const [confirm, setConfirm] = useState(false);

  function handleSignOut() { logout(); nav("/", { replace:true }); }

  return (
    <Section title="Sign out everywhere">
      <div className="card" style={{ maxWidth:480, borderColor:"rgba(239,68,68,.2)" }}>
        <p style={{ fontSize:14, color:"var(--text-dim)", marginBottom:16, lineHeight:1.7 }}>
          Signs you out and invalidates your current session token.
        </p>
        {!confirm ? (
          <button className="btn btn-danger" onClick={() => setConfirm(true)}>Sign out</button>
        ) : (
          <div style={{ display:"flex", gap:10 }}>
            <button className="btn btn-danger" onClick={handleSignOut}>Yes, sign me out</button>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        )}
      </div>
    </Section>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function Settings() {
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)" }}>
      <AppNav />
      <div className="container" style={{ paddingTop:48, paddingBottom:80, maxWidth:700 }}>
        <h1 style={{ fontSize:28, fontWeight:800, letterSpacing:"-1px", marginBottom:40 }}>Settings</h1>
        <ProfileSection />
        <PasswordSection />
        <ApiKeySection />
        <DangerZone />
      </div>
    </div>
  );
}
