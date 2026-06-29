import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { createContext, useContext, useEffect, useState } from "react";
import { api, setToken } from "./api.js";

import Landing     from "./pages/Landing.jsx";
import Login       from "./pages/Login.jsx";
import Signup      from "./pages/Signup.jsx";
import Dashboard   from "./pages/Dashboard.jsx";
import GraphViewer from "./pages/GraphViewer.jsx";
import Settings    from "./pages/Settings.jsx";

// ── Auth context ─────────────────────────────────────────────────────────────
export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me()
      .then(u => { if (u?.email) setUser(u); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function login(u, token) {
    setToken(token);
    setUser(u);
  }

  function logout() {
    api.logout().catch(() => {});
    setToken(null);
    setUser(null);
  }

  if (loading) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#020617" }}>
        <div className="spinner" style={{ width:28, height:28, borderWidth:3 }} />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Route guard ───────────────────────────────────────────────────────────────
function Private({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Routes>
          <Route path="/"          element={<Landing />} />
          <Route path="/login"     element={<Login />} />
          <Route path="/signup"    element={<Signup />} />
          <Route path="/dashboard" element={<Private><Dashboard /></Private>} />
          <Route path="/map/:id"   element={<Private><GraphViewer /></Private>} />
          <Route path="/settings"  element={<Private><Settings /></Private>} />
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </HashRouter>
  );
}
