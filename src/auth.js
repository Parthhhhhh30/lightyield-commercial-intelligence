// GitHub OAuth (authorization-code + state + PKCE S256), server-side D1 sessions, numeric-ID allowlist.
// Only WebCrypto primitives (SHA-256, CSPRNG, timingSafeEqual). The GitHub access token is used once for GET /user and discarded.
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => b64u(await crypto.subtle.digest("SHA-256", enc.encode(s)));
export const SESSION = { absoluteMs: 8 * 3600e3, idleMs: 30 * 60e3, stateMs: 10 * 60e3 };

export const allowlist = (env) => new Set(String(env.ALLOWED_GITHUB_IDS || "").split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number));
const secure = (url) => url.protocol === "https:";
const cname = (url, base) => (secure(url) ? "__Host-" : "") + base;
const cookie = (url, base, val, maxAge) => `${cname(url, base)}=${val}; Path=/; HttpOnly; SameSite=Lax${secure(url) ? "; Secure" : ""}; Max-Age=${maxAge}`;
const readCookie = (req, name) => (req.headers.get("cookie") || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1];
const text = (s, status, extra = {}) => new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra } });

function idp(env) { // endpoint override honoured ONLY in local dev (prevents SSRF/open-redirect in any deployed environment)
  if (env.LOCAL_DEV === "1" && env.IDP_BASE) return { authorize: `${env.IDP_BASE}/login/oauth/authorize`, token: `${env.IDP_BASE}/login/oauth/access_token`, user: `${env.IDP_BASE}/user`, fixture: true };
  return { authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", user: "https://api.github.com/user", fixture: false };
}
const configured = (env) => !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
const rec = (env, action, detail, actor) => env.DB.prepare("INSERT INTO events (id, entity, entity_id, action, detail, at, actor_github_id, actor_login) VALUES (?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), "auth", "-", action, JSON.stringify(detail || {}).slice(0, 500), new Date().toISOString(), actor?.id ?? null, actor?.login ?? null).run();

export async function getSession(req, env, url) {
  const sid = readCookie(req, cname(url, "ly_session"));
  if (!sid || sid.length < 20) return null;
  const h = await sha(sid), now = Date.now();
  const s = await env.DB.prepare("SELECT * FROM sessions WHERE id_hash=?").bind(h).first();
  if (!s) return null;
  const dead = s.expires_at <= now || now - s.last_seen > SESSION.idleMs || !allowlist(env).has(s.github_id); // allowlist re-checked each request => removal revokes access
  if (dead) { await env.DB.prepare("DELETE FROM sessions WHERE id_hash=?").bind(h).run(); return null; }
  if (now - s.last_seen > 60e3) await env.DB.prepare("UPDATE sessions SET last_seen=? WHERE id_hash=?").bind(now, h).run();
  return { id_hash: h, github_id: s.github_id, login: s.login, csrf: s.csrf };
}
export function csrfOk(req, session) {
  const t = req.headers.get("x-csrf-token") || "";
  return t.length === session.csrf.length && crypto.subtle.timingSafeEqual(enc.encode(t), enc.encode(session.csrf));
}

export async function handleAuth(req, env, url) {
  const p = url.pathname;
  if (!configured(env)) return text("Authentication is not configured (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET missing).", 503);
  const ip = idp(env), redirectUri = `${url.origin}/auth/callback`;

  if (p === "/auth/login" && req.method === "GET") {
    const recent = await env.DB.prepare("SELECT count(*) c FROM oauth_states WHERE created_at > ?").bind(Date.now() - 300e3).first();
    if (recent.c > 30) return text("Too many login attempts; try again shortly.", 429);
    const state = rand(24), verifier = rand(48), now = Date.now();
    await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now).run();
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ? OR last_seen < ?").bind(now, now - SESSION.idleMs).run();
    await env.DB.prepare("INSERT INTO oauth_states (state_hash, verifier, created_at, expires_at) VALUES (?,?,?,?)").bind(await sha(state), verifier, now, now + SESSION.stateMs).run();
    const q = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: redirectUri, state, code_challenge: await sha(verifier), code_challenge_method: "S256", allow_signup: "false" }); // no scope: public identity only
    return new Response(null, { status: 302, headers: { location: `${ip.authorize}?${q}`, "set-cookie": cookie(url, "ly_oauth", state, 600), "cache-control": "no-store" } });
  }

  if (p === "/auth/callback" && req.method === "GET") {
    const clear = { "set-cookie": cookie(url, "ly_oauth", "", 0) };
    const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
    const bound = readCookie(req, cname(url, "ly_oauth"));
    if (url.searchParams.get("error")) { await rec(env, "login_denied_by_idp", {}); return text("Sign-in was cancelled or denied.", 400, clear); }
    if (!state || !code || !bound || bound.length !== state.length || !crypto.subtle.timingSafeEqual(enc.encode(bound), enc.encode(state))) { await rec(env, "state_mismatch", {}); return text("Invalid sign-in state (possible forged or cross-browser callback).", 400, clear); }
    const row = await env.DB.prepare("SELECT * FROM oauth_states WHERE state_hash=?").bind(await sha(state)).first();
    if (!row || row.used || row.expires_at < Date.now()) { await rec(env, "state_replay_or_expired", {}); return text("Sign-in state expired or already used.", 400, clear); }
    const claim = await env.DB.prepare("UPDATE oauth_states SET used=1 WHERE state_hash=? AND used=0").bind(row.state_hash).run(); // single use, atomic
    if (!claim.meta.changes) return text("Sign-in state already used.", 400, clear);
    let user;
    try {
      const tr = await fetch(ip.token, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri, code_verifier: row.verifier }), signal: AbortSignal.timeout(8000) });
      const tj = await tr.json();
      if (!tj.access_token) { await rec(env, "token_exchange_failed", { error: String(tj.error || "").slice(0, 60) }); return text("Sign-in failed.", 400, clear); }
      const ur = await fetch(ip.user, { headers: { authorization: `Bearer ${tj.access_token}`, accept: "application/json", "user-agent": "lightyield-commercial-intelligence" }, signal: AbortSignal.timeout(8000) });
      user = await ur.json(); // token goes out of scope here; never stored or returned
      user = { ...user, _scope: String(tj.scope ?? "") };
    } catch { await rec(env, "idp_unreachable", {}); return text("Sign-in provider unreachable.", 502, clear); }
    if (!Number.isInteger(user?.id) || typeof user?.login !== "string") return text("Sign-in failed.", 400, clear);
    if (!allowlist(env).has(user.id)) { await rec(env, "unapproved_user", { github_id: user.id }); return text("This GitHub account is not authorised for this application.", 403, clear); }
    const sid = rand(32), now = Date.now();
    await env.DB.prepare("INSERT INTO sessions (id_hash, github_id, login, csrf, created_at, expires_at, last_seen) VALUES (?,?,?,?,?,?,?)").bind(await sha(sid), user.id, user.login.slice(0, 80), rand(24), now, now + SESSION.absoluteMs, now).run();
    await rec(env, "login", { github_id: user.id, granted_scope: user._scope, idp: ip.fixture ? "fixture" : "github" }, { id: user.id, login: user.login.slice(0, 80) });
    const h = new Headers({ location: "/", "cache-control": "no-store" });
    h.append("set-cookie", cookie(url, "ly_session", sid, SESSION.absoluteMs / 1000)); h.append("set-cookie", cookie(url, "ly_oauth", "", 0));
    return new Response(null, { status: 302, headers: h });
  }

  if (p === "/auth/logout" && req.method === "POST") {
    const s = await getSession(req, env, url);
    if (!s) return text("Not signed in.", 401);
    if (!csrfOk(req, s)) return text("CSRF check failed.", 403);
    await env.DB.prepare("DELETE FROM sessions WHERE id_hash=?").bind(s.id_hash).run();
    await rec(env, "logout", { github_id: s.github_id }, { id: s.github_id, login: s.login });
    return text("ok", 200, { "set-cookie": cookie(url, "ly_session", "", 0) });
  }
  return text("not found", 404);
}
export const authInfo = (env) => ({ configured: configured(env), fixture_idp: idp(env).fixture });
