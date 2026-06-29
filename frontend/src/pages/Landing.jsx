import { Link } from "react-router-dom";
import { useAuth } from "../App.jsx";

// ── tiny icon components ──────────────────────────────────────────────────────
const Icon = ({ d, size = 20, stroke = "currentColor", fill = "none" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

// ── section: hero ─────────────────────────────────────────────────────────────
function Hero() {
  const { user } = useAuth();
  return (
    <section style={{ position:"relative", overflow:"hidden", padding:"120px 32px 96px", textAlign:"center" }}>
      {/* mesh gradient blobs */}
      <div style={{
        position:"absolute", inset:0, pointerEvents:"none",
        background:`
          radial-gradient(ellipse 60% 50% at 20% -10%, rgba(168,85,247,.25) 0%, transparent 60%),
          radial-gradient(ellipse 50% 60% at 80% 110%, rgba(6,182,212,.2) 0%, transparent 60%),
          radial-gradient(ellipse 40% 40% at 50% 50%, rgba(59,130,246,.12) 0%, transparent 70%)
        `,
      }} />
      {/* subtle grid lines */}
      <div style={{
        position:"absolute", inset:0, pointerEvents:"none", opacity:.04,
        backgroundImage:`linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)`,
        backgroundSize:"64px 64px",
      }} />

      <div style={{ position:"relative", maxWidth:760, margin:"0 auto" }}>
        <div style={{ display:"inline-block", marginBottom:24 }}>
          <span className="tag">Visual Codebase Intelligence</span>
        </div>

        <h1 style={{ fontSize:"clamp(40px,7vw,72px)", fontWeight:800, lineHeight:1.1, letterSpacing:"-2px", marginBottom:24 }}>
          Understand any codebase{" "}
          <span className="gt">in minutes</span>
        </h1>

        <p style={{ fontSize:"clamp(16px,2vw,20px)", color:"var(--text-dim)", lineHeight:1.7, maxWidth:580, margin:"0 auto 40px" }}>
          Drop in a repository and get an interactive map that shows how everything connects —
          which parts matter most, what breaks what, and where new engineers should start.
        </p>

        <div style={{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap" }}>
          {user ? (
            <Link to="/dashboard" className="btn btn-primary" style={{ fontSize:16, padding:"14px 32px" }}>
              Open Dashboard
              <Icon d="M5 12h14M12 5l7 7-7 7" size={18} />
            </Link>
          ) : (
            <>
              <Link to="/signup" className="btn btn-primary" style={{ fontSize:16, padding:"14px 32px" }}>
                Map your codebase — free
                <Icon d="M5 12h14M12 5l7 7-7 7" size={18} />
              </Link>
              <Link to="/login" className="btn btn-ghost" style={{ fontSize:16, padding:"14px 28px" }}>
                Sign in
              </Link>
            </>
          )}
        </div>

        <p style={{ marginTop:20, fontSize:12, color:"var(--text-muted)" }}>
          Works with Python, JavaScript, TypeScript · No credit card required
        </p>
      </div>

      {/* fake graph preview */}
      <GraphPreview />
    </section>
  );
}

function GraphPreview() {
  const nodes = [
    { x:50,  y:55, r:14, label:"auth",     col:"#a855f7" },
    { x:30,  y:35, r:10, label:"users",    col:"#3b82f6" },
    { x:70,  y:35, r:10, label:"routes",   col:"#3b82f6" },
    { x:20,  y:60, r:8,  label:"db",       col:"#06b6d4" },
    { x:80,  y:60, r:8,  label:"models",   col:"#06b6d4" },
    { x:50,  y:78, r:7,  label:"utils",    col:"#10b981" },
    { x:38,  y:72, r:6,  label:"config",   col:"#10b981" },
    { x:63,  y:72, r:6,  label:"mailer",   col:"#f59e0b" },
  ];
  const edges = [
    [0,1],[0,2],[0,3],[1,3],[2,4],[4,3],[0,5],[5,6],[2,7]
  ];
  return (
    <div style={{ position:"relative", maxWidth:700, margin:"64px auto 0", borderRadius:20, overflow:"hidden", border:"1px solid var(--border)", background:"var(--surface)", boxShadow:"0 40px 120px rgba(0,0,0,.5)" }}>
      {/* fake browser chrome */}
      <div style={{ background:"var(--surface-2)", padding:"12px 16px", display:"flex", alignItems:"center", gap:8, borderBottom:"1px solid var(--border)" }}>
        <div style={{ width:10, height:10, borderRadius:"50%", background:"#ff5f57" }} />
        <div style={{ width:10, height:10, borderRadius:"50%", background:"#ffbd2e" }} />
        <div style={{ width:10, height:10, borderRadius:"50%", background:"#28c840" }} />
        <div style={{ flex:1, background:"var(--surface-3)", borderRadius:6, padding:"4px 12px", fontSize:11, color:"var(--text-muted)", marginLeft:8 }}>
          codemap.app/map/my-repo
        </div>
      </div>
      <svg viewBox="0 0 100 100" style={{ width:"100%", height:340, display:"block" }}>
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(168,85,247,.2)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill="url(#glow)" />
        {edges.map(([a, b], i) => {
          const A = nodes[a], B = nodes[b];
          return (
            <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y}
              stroke="rgba(168,85,247,.2)" strokeWidth=".4"
            />
          );
        })}
        {nodes.map((n, i) => (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={n.r + 3} fill={n.col} opacity=".08" />
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.col} opacity=".25" stroke={n.col} strokeWidth=".5" />
            <text x={n.x} y={n.y + .4} textAnchor="middle" dominantBaseline="middle"
              fill={n.col} fontSize={n.r * .7} fontFamily="JetBrains Mono,monospace" fontWeight="600"
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, var(--surface) 0%, transparent 60%)", pointerEvents:"none" }} />
    </div>
  );
}

// ── section: features ─────────────────────────────────────────────────────────
const features = [
  {
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
    col: "#a855f7",
    title: "Interactive visual map",
    body: "Every file, class, and function appears as a node in a live graph. Click anything to see what it connects to and what it depends on.",
  },
  {
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    col: "#06b6d4",
    title: "Impact analysis — instantly",
    body: "Before touching any file, see exactly how many other things call it. Change with confidence, not with crossed fingers.",
  },
  {
    icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
    col: "#3b82f6",
    title: "Onboarding in hours, not weeks",
    body: "New engineers follow guided paths through the most important parts of your system — auto-generated from the structure of the code itself.",
  },
  {
    icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z",
    col: "#10b981",
    title: "Always up to date",
    body: "Connect your CI pipeline and the map regenerates automatically on every merge. No stale diagrams, no manual upkeep.",
  },
  {
    icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    col: "#f59e0b",
    title: "Confidential mode",
    body: "For sensitive repos: analysis runs in an isolated, temporary environment and is wiped completely the moment it finishes. Nothing is stored.",
  },
  {
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    col: "#ec4899",
    title: "Capture expert knowledge",
    body: "Engineers heading out the door can annotate graph nodes with their hard-won context — pinned permanently to the right part of the codebase.",
  },
];

function Features() {
  return (
    <section style={{ padding:"96px 32px", background:"var(--bg-2)", borderTop:"1px solid var(--border)", borderBottom:"1px solid var(--border)" }}>
      <div style={{ maxWidth:1200, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:64 }}>
          <span className="tag" style={{ marginBottom:16, display:"inline-block" }}>Features</span>
          <h2 style={{ fontSize:"clamp(28px,4vw,44px)", fontWeight:800, letterSpacing:"-1px" }}>
            Everything your team needs to<br />
            <span className="gt">stay in sync with the code</span>
          </h2>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))", gap:24 }}>
          {features.map((f, i) => (
            <div key={i} className="card" style={{
              background:"var(--surface)",
              backgroundImage:"var(--grad-card)",
              display:"flex", flexDirection:"column", gap:14,
            }}>
              <div style={{ width:44, height:44, borderRadius:12, background:`${f.col}18`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={f.col} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={f.icon} />
                </svg>
              </div>
              <h3 style={{ fontSize:17, fontWeight:700, letterSpacing:"-.3px" }}>{f.title}</h3>
              <p style={{ fontSize:14, color:"var(--text-dim)", lineHeight:1.7 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── section: how it works ─────────────────────────────────────────────────────
const steps = [
  { n:"01", title:"Point at your repo",   body:"Paste a Git URL or drop in a local path. CodeMap handles cloning and cleanup automatically." },
  { n:"02", title:"We map everything",    body:"Our engine parses every file, traces how modules connect, and builds a complete picture of your system." },
  { n:"03", title:"Explore interactively",body:"Search, click, and filter your way through the graph. Zoom in on any component or view the full system at once." },
];

function HowItWorks() {
  return (
    <section style={{ padding:"96px 32px", textAlign:"center" }}>
      <div style={{ maxWidth:900, margin:"0 auto" }}>
        <span className="tag" style={{ marginBottom:16, display:"inline-block" }}>How it works</span>
        <h2 style={{ fontSize:"clamp(28px,4vw,44px)", fontWeight:800, letterSpacing:"-1px", marginBottom:64 }}>
          One action. Full picture.
        </h2>
        <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display:"flex", gap:32, textAlign:"left", position:"relative", paddingBottom:i < steps.length-1 ? 48 : 0 }}>
              {/* connector line */}
              {i < steps.length-1 && (
                <div style={{ position:"absolute", left:28, top:64, width:1, height:"calc(100% - 32px)", background:"var(--border)" }} />
              )}
              <div style={{ width:56, height:56, borderRadius:16, background:"var(--grad)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontFamily:"var(--mono)", fontWeight:700, fontSize:14, color:"#fff", boxShadow:"0 0 24px rgba(168,85,247,.3)", zIndex:1 }}>
                {s.n}
              </div>
              <div style={{ paddingTop:12 }}>
                <h3 style={{ fontSize:20, fontWeight:700, letterSpacing:"-.3px", marginBottom:8 }}>{s.title}</h3>
                <p style={{ fontSize:15, color:"var(--text-dim)", lineHeight:1.7 }}>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── section: dual audience ────────────────────────────────────────────────────
function Audiences() {
  return (
    <section style={{ padding:"96px 32px", background:"var(--bg-2)", borderTop:"1px solid var(--border)", borderBottom:"1px solid var(--border)" }}>
      <div style={{ maxWidth:1100, margin:"0 auto", display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:32, alignItems:"start" }}>
        <AudienceCard
          emoji="🧑‍💻"
          title="For engineers"
          col="#a855f7"
          items={[
            "See all callers before you refactor anything",
            "Trace data from entrypoint to persistence",
            "Find dead code that's safe to delete",
            "Understand a new service in a single session",
          ]}
        />
        <AudienceCard
          emoji="📊"
          title="For engineering managers"
          col="#06b6d4"
          items={[
            "See which parts of the system carry the most risk",
            "Onboard new hires faster with structured exploration paths",
            "Preserve knowledge when senior engineers move on",
            "Visualise technical debt without reading code",
          ]}
        />
      </div>
    </section>
  );
}

function AudienceCard({ emoji, title, col, items }) {
  return (
    <div className="card" style={{ backgroundImage:"var(--grad-card)" }}>
      <div style={{ fontSize:40, marginBottom:16 }}>{emoji}</div>
      <h3 style={{ fontSize:22, fontWeight:700, letterSpacing:"-.4px", marginBottom:20, color:col }}>{title}</h3>
      <ul style={{ listStyle:"none", display:"flex", flexDirection:"column", gap:12 }}>
        {items.map((item, i) => (
          <li key={i} style={{ display:"flex", gap:10, fontSize:15, color:"var(--text-dim)", lineHeight:1.6 }}>
            <span style={{ color:col, flexShrink:0, marginTop:2 }}>✓</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── section: CTA ──────────────────────────────────────────────────────────────
function CTA() {
  const { user } = useAuth();
  return (
    <section style={{ padding:"120px 32px", textAlign:"center", position:"relative", overflow:"hidden" }}>
      <div style={{
        position:"absolute", inset:0, pointerEvents:"none",
        background:`radial-gradient(ellipse 60% 80% at 50% 50%, rgba(168,85,247,.12) 0%, transparent 70%)`,
      }} />
      <div style={{ position:"relative", maxWidth:600, margin:"0 auto" }}>
        <h2 style={{ fontSize:"clamp(28px,4.5vw,52px)", fontWeight:800, letterSpacing:"-1.5px", lineHeight:1.1, marginBottom:20 }}>
          Ready to finally understand<br /><span className="gt">your codebase?</span>
        </h2>
        <p style={{ fontSize:18, color:"var(--text-dim)", marginBottom:40, lineHeight:1.7 }}>
          Works on any Python, JavaScript, or TypeScript repository. See your first map in under 60 seconds.
        </p>
        {user ? (
          <Link to="/dashboard" className="btn btn-primary" style={{ fontSize:17, padding:"16px 40px" }}>
            Go to Dashboard
            <Icon d="M5 12h14M12 5l7 7-7 7" />
          </Link>
        ) : (
          <Link to="/signup" className="btn btn-primary" style={{ fontSize:17, padding:"16px 40px" }}>
            Get started free
            <Icon d="M5 12h14M12 5l7 7-7 7" />
          </Link>
        )}
      </div>
    </section>
  );
}

// ── nav + footer ──────────────────────────────────────────────────────────────
function Navbar() {
  const { user } = useAuth();
  return (
    <nav className="nav">
      <Link to="/" className="nav-logo">
        <div className="nav-logo-mark">CM</div>
        CodeMap
      </Link>
      <div className="nav-spacer" />
      {user ? (
        <Link to="/dashboard" className="btn btn-primary" style={{ padding:"8px 20px", fontSize:14 }}>
          Dashboard
        </Link>
      ) : (
        <>
          <Link to="/login" style={{ fontSize:14, color:"var(--text-dim)", fontWeight:500 }}>Sign in</Link>
          <Link to="/signup" className="btn btn-primary" style={{ padding:"8px 20px", fontSize:14 }}>
            Get started
          </Link>
        </>
      )}
    </nav>
  );
}

function Footer() {
  return (
    <footer style={{ borderTop:"1px solid var(--border)", padding:"40px 32px", textAlign:"center" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:12 }}>
        <div className="nav-logo-mark" style={{ width:24, height:24, fontSize:11 }}>CM</div>
        <span style={{ fontWeight:700, fontSize:14 }}>CodeMap</span>
      </div>
      <p style={{ fontSize:13, color:"var(--text-muted)" }}>
        Visual Codebase Intelligence · Built for teams who care about their systems
      </p>
    </footer>
  );
}

// ── page export ───────────────────────────────────────────────────────────────
export default function Landing() {
  return (
    <>
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <Audiences />
      <CTA />
      <Footer />
    </>
  );
}
