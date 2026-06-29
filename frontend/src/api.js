// Central API client — injects the session token from localStorage automatically.

function getToken() {
  return localStorage.getItem("cm_token") || "";
}

export function setToken(token) {
  if (token) localStorage.setItem("cm_token", token);
  else localStorage.removeItem("cm_token");
}

function hdrs(extra = {}) {
  const h = { "Content-Type": "application/json", ...extra };
  const t = getToken();
  if (t) h["X-Session-Token"] = t;
  return h;
}

async function req(method, path, body) {
  const opts = { method, headers: hdrs() };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────
  register:   (email, name, password) => req("POST", "/auth/register", { email, name, password }),
  login:      (email, password)       => req("POST", "/auth/login",    { email, password }),
  logout:     ()                      => req("POST", "/auth/logout",   {}),
  me:         ()                      => req("GET",  "/auth/me"),
  authStatus: ()                      => req("GET",  "/auth/status"),

  // ── Maps (projects) ──────────────────────────────────────────────────────
  listMaps:     ()           => req("GET",    "/projects"),
  createMap:    (body)       => req("POST",   "/projects", body),
  getMap:       (id)         => req("GET",    `/projects/${id}`),
  deleteMap:    (id)         => req("DELETE", `/projects/${id}`),
  reanalyze:    (id)         => req("POST",   `/projects/${id}/reanalyze`, {}),
  getGraph:     (id)         => req("GET",    `/projects/${id}/graph`),

  // ── Knowledge layer ──────────────────────────────────────────────────────
  getQuests:       (id)              => req("GET",    `/projects/${id}/quests`),
  queryGraph:      (id, query)       => req("POST",   `/projects/${id}/query`, { query }),
  getAnnotations:  (id)              => req("GET",    `/projects/${id}/annotations`),
  addAnnotation:   (id, node_id, content, author) =>
                                        req("POST",   `/projects/${id}/annotations`, { node_id, content, author }),
  deleteAnnotation:(id, ann_id)      => req("DELETE", `/projects/${id}/annotations/${ann_id}`),

  // ── Editor sync ──────────────────────────────────────────────────────────
  getSync:  ()     => req("GET",  "/sync"),
  postSync: (body) => req("POST", "/sync", body),
};
