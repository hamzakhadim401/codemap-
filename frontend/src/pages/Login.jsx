import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../App.jsx";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr]         = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const data = await api.login(email, password);
      login(data.user, data.token);
      nav("/dashboard", { replace: true });
    } catch (ex) {
      setErr(ex.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", display:"flex", flexDirection:"column" }}>
      {/* minimal nav */}
      <nav style={{ padding:"0 32px", height:64, display:"flex", alignItems:"center", borderBottom:"1px solid var(--border)", background:"rgba(2,6,23,.85)", backdropFilter:"blur(16px)" }}>
        <Link to="/" style={{ display:"flex", alignItems:"center", gap:10, fontWeight:700, fontSize:16 }}>
          <div className="nav-logo-mark">CM</div>
          CodeMap
        </Link>
      </nav>

      {/* mesh accent */}
      <div style={{
        position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
        background:`radial-gradient(ellipse 50% 60% at 10% 30%, rgba(168,85,247,.14) 0%, transparent 60%), radial-gradient(ellipse 40% 50% at 90% 80%, rgba(6,182,212,.1) 0%, transparent 60%)`,
      }} />

      <div className="page-center" style={{ position:"relative", zIndex:1 }}>
        <div style={{ width:"100%", maxWidth:420 }}>
          {/* header */}
          <div style={{ textAlign:"center", marginBottom:32 }}>
            <h1 style={{ fontSize:30, fontWeight:800, letterSpacing:"-1px", marginBottom:8 }}>Welcome back</h1>
            <p style={{ color:"var(--text-dim)", fontSize:15 }}>Sign in to your CodeMap account</p>
          </div>

          {/* card */}
          <div className="card" style={{ padding:32 }}>
            <form onSubmit={submit}>
              <div className="field">
                <label className="label" htmlFor="email">Email address</label>
                <input
                  id="email"
                  className={`input${err ? " error" : ""}`}
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={e => { setEmail(e.target.value); setErr(""); }}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="password">Password</label>
                <input
                  id="password"
                  className={`input${err ? " error" : ""}`}
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => { setPassword(e.target.value); setErr(""); }}
                />
              </div>

              {err && <p className="err-msg" style={{ marginBottom:16 }}>{err}</p>}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{ width:"100%", justifyContent:"center", padding:"13px", fontSize:15, marginTop:4 }}
              >
                {loading ? <span className="spinner" /> : "Sign in"}
              </button>
            </form>
          </div>

          {/* footer link */}
          <p style={{ textAlign:"center", marginTop:20, fontSize:14, color:"var(--text-muted)" }}>
            Don't have an account?{" "}
            <Link to="/signup" style={{ color:"var(--purple)", fontWeight:600 }}>
              Create one free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
