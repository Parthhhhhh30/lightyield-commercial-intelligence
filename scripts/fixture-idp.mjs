// FIXTURE identity provider for local tests. Mimics the GitHub OAuth endpoints the Worker uses and ENFORCES
// PKCE (S256), single-use codes, client secret and redirect_uri. It is NOT GitHub; passing against it does not
// verify the real GitHub registration.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
const PORT = Number(process.env.IDP_PORT || 9099), CLIENT_ID = process.env.GITHUB_CLIENT_ID || "fixture-client", SECRET = process.env.GITHUB_CLIENT_SECRET || "fixture-secret-local-only";
let identity = { id: Number(process.env.FIXTURE_USER_ID || 1001), login: "fixture-user" };
const codes = new Map(), tokens = new Map();
const s256 = (v) => createHash("sha256").update(v).digest("base64url");
const json = (res, o, st = 200) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); });
createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname === "/_identity" && req.method === "POST") { identity = await body(req); return json(res, identity); } // test control
  if (u.pathname === "/login/oauth/authorize") {
    const q = u.searchParams;
    if (q.get("client_id") !== CLIENT_ID || !q.get("redirect_uri") || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return json(res, { error: "bad_request" }, 400);
    const code = randomBytes(16).toString("hex");
    codes.set(code, { challenge: q.get("code_challenge"), redirect: q.get("redirect_uri"), user: { ...identity }, used: false });
    const back = new URL(q.get("redirect_uri")); back.searchParams.set("code", code); back.searchParams.set("state", q.get("state") || "");
    res.writeHead(302, { location: back.toString() }); return res.end();
  }
  if (u.pathname === "/login/oauth/access_token" && req.method === "POST") {
    const b = await body(req), c = codes.get(b.code);
    if (b.client_id !== CLIENT_ID || b.client_secret !== SECRET) return json(res, { error: "incorrect_client_credentials" });
    if (!c || c.used || c.redirect !== b.redirect_uri) return json(res, { error: "bad_verification_code" });
    c.used = true; // replay of the same code fails
    if (!b.code_verifier || s256(b.code_verifier) !== c.challenge) return json(res, { error: "bad_verification_code", error_description: "PKCE verification failed" });
    const t = randomBytes(20).toString("hex"); tokens.set(t, c.user); return json(res, { access_token: t, token_type: "bearer", scope: "" });
  }
  if (u.pathname === "/user") { const t = (req.headers.authorization || "").replace("Bearer ", ""); const usr = tokens.get(t); return usr ? json(res, usr) : json(res, { message: "Bad credentials" }, 401); }
  json(res, { error: "not found" }, 404);
}).listen(PORT, () => console.log(`fixture IdP on :${PORT}`));
