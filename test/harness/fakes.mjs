// DISPOSABLE, credential-free test environment: the REAL Worker code runs in-process against
//   - an in-memory SQLite database with the real migrations (D1-compatible shim),
//   - a stateful FAKE HubSpot (companies, tasks, associations) with controllable faults, delays and pauses,
//   - a FAKE Workers AI.
// Nothing here touches Cloudflare, HubSpot, GitHub or the network. Set LY_ROOT to run the same tests against another checkout
// (used to prove a regression test FAILS on the old code and PASSES on the corrected code).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
// Workers-only extension used by src/auth.js; faithful semantics (equal byte lengths required) for the Node harness.
if (!globalThis.crypto.subtle.timingSafeEqual) globalThis.crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a.buffer ?? a, a.byteOffset ?? 0, a.byteLength), Buffer.from(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength));
export const ROOT = process.env.LY_ROOT || new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

export function createD1(root = ROOT) {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(`${root}/migrations`).filter((x) => x.endsWith(".sql")).sort()) db.exec(readFileSync(`${root}/migrations/${f}`, "utf8"));
  const prepare = (sql) => { const st = db.prepare(sql); let args = []; const o = {
    bind: (...a) => { args = a.map((x) => (x === undefined ? null : typeof x === "boolean" ? Number(x) : x)); return o; },
    first: async () => st.get(...args) ?? null,
    all: async () => ({ results: st.all(...args), meta: {} }),
    run: async () => { const r = st.run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; return o; };
  return { prepare, exec: async (sql) => db.exec(sql), raw: db,
    batch: async (stmts) => { db.exec("BEGIN"); try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } },
    q: (sql, ...a) => db.prepare(sql).all(...a), one: (sql, ...a) => db.prepare(sql).get(...a) ?? null };
}

export class FakeHubspot {
  constructor({ portalId = 111, accountType = "DEVELOPER_TEST" } = {}) { Object.assign(this, { portalId, accountType, companies: new Map(), tasks: new Map(), assoc: new Map(), calls: [], rules: [], seq: 1000 }); this.fetch = this.fetch.bind(this); }
  // fault rules match "METHOD /path" with a RegExp. fail: return HTTP status before any effect. lose: perform the effect, then throw (lost response).
  // hold: block BEFORE processing until release() is called (deterministic interleavings).
  failOnce(match, status = 503) { this.rules.push({ match, action: "fail", status, times: 1 }); }
  // garbleOnce: the provider answers HTTP 200 with a body that is not the expected shape (proxy page / truncated JSON): verification must treat it as UNKNOWN.
  garbleOnce(match) { this.rules.push({ match, action: "garble", times: 1 }); }
  loseOnce(match) { this.rules.push({ match, action: "lose", times: 1 }); }
  hold(match) { let release; const gate = new Promise((r) => (release = r)); let reached; const arrived = new Promise((r) => (reached = r)); this.rules.push({ match, action: "hold", gate, reached, times: 1 }); return { release, arrived }; }
  // holdAfter: the request is PROCESSED immediately but its RESPONSE is delayed (models a slow/stale provider response).
  holdAfter(match) { let release; const gate = new Promise((r) => (release = r)); let reached; const arrived = new Promise((r) => (reached = r)); this.rules.push({ match, action: "hold-after", gate, reached, times: 1 }); return { release, arrived }; }
  count(re) { return this.calls.filter((c) => re.test(c)).length; }
  addCompany(properties) { const id = String(++this.seq); this.companies.set(id, { id, properties: { name: "", domain: "", description: "", ...properties } }); return id; }
  async fetch(url, init = {}) {
    const u = new URL(url), method = (init.method || "GET").toUpperCase(), path = u.pathname, key = `${method} ${path}`; this.calls.push(key);
    if (this.latency) await new Promise((r) => setTimeout(r, this.latency)); // optional uniform provider latency
    const rule = this.rules.find((r) => r.times > 0 && (r.match.test(key) || r.match.test(key + u.search)));
    if (rule) { rule.times--; if (rule.action === "fail") return json({ message: "simulated" }, rule.status); if (rule.action === "garble") return new Response("<html>gateway page</html>", { status: 200 }); if (rule.action === "hold") { rule.reached(); await rule.gate; } }
    const res = await this.handle(method, path, u, init.body ? JSON.parse(init.body) : null);
    if (rule?.action === "hold-after") { rule.reached(); await rule.gate; }
    if (rule?.action === "lose") throw new TypeError("simulated lost response");
    return res;
  }
  // Realistic pagination: `pageSize` (default 100) items per page, opaque offset cursor in paging.next.after.
  page(items, u) { const size = this.pageSize || Number(u.searchParams.get("limit")) || 100, start = Number(u.searchParams.get("after") || 0), slice = items.slice(start, start + size); return json({ results: slice, ...(start + size < items.length ? { paging: { next: { after: String(start + size) } } } : {}) }); }
  props(o, want) { const p = { ...o.properties }; if ("hs_task_subject" in p || "hs_task_status" in p) p.hs_task_body ??= null; else { p.name ??= null; p.description ??= null; } return { id: o.id, properties: p }; } // like HubSpot: requested-but-empty identity properties come back as null
  async handle(method, path, u, body) {
    let m;
    if (path === "/account-info/v3/details") return json({ accountType: this.accountType, portalId: this.portalId, uiDomain: "app-eu1.hubspot.com" });
    if (path === "/crm/v3/objects/companies" && method === "GET") return this.page([...this.companies.values()].map((c) => this.props(c)), u);
    if (path === "/crm/v3/objects/companies" && method === "POST") { const id = String(++this.seq); this.companies.set(id, { id, properties: { name: "", domain: "", description: "", ...body.properties } }); return json({ id, properties: this.companies.get(id).properties }, 201); }
    if ((m = path.match(/^\/crm\/v3\/objects\/companies\/(\d+)$/))) { const c = this.companies.get(m[1]); if (!c) return json({ message: "not found" }, 404); if (method === "PATCH") { Object.assign(c.properties, body.properties); return json(this.props(c)); } if (method === "DELETE") { this.companies.delete(m[1]); return new Response(null, { status: 204 }); } return json(this.props(c)); }
    if (path === "/crm/v3/objects/tasks" && method === "GET") return this.page([...this.tasks.values()].map((t) => this.props(t)), u); // paginated like HubSpot: limit + paging.next.after
    if (path === "/crm/v3/objects/tasks" && method === "POST") { const id = String(++this.seq); this.tasks.set(id, { id, properties: { hs_task_status: "NOT_STARTED", ...body.properties } }); this.assoc.set(id, (body.associations || []).map((a) => String(a.to.id))); return json({ id, properties: this.tasks.get(id).properties }, 201); }
    if (path === "/crm/v3/objects/tasks/batch/read") return json({ results: (body.inputs || []).map((i) => this.tasks.get(i.id)).filter(Boolean).map((t) => this.props(t)) });
    if ((m = path.match(/^\/crm\/v3\/objects\/tasks\/(\d+)$/))) { const t = this.tasks.get(m[1]); if (!t) return json({ message: "not found" }, 404); if (method === "PATCH") { Object.assign(t.properties, body.properties); return json(this.props(t)); } if (method === "DELETE") { this.tasks.delete(m[1]); return new Response(null, { status: 204 }); } return json(this.props(t)); }
    if ((m = path.match(/^\/crm\/v4\/objects\/tasks\/(\d+)\/associations\/companies$/))) return !this.tasks.has(m[1]) ? json({ message: "not found" }, 404) : json({ results: (this.assoc.get(m[1]) || []).map((id) => ({ toObjectId: Number(id) })) });
    if ((m = path.match(/^\/crm\/v4\/objects\/tasks\/(\d+)\/associations\/default\/companies\/(\d+)$/))) { this.assoc.set(m[1], [...(this.assoc.get(m[1]) || []), m[2]]); return json({}); }
    return json({ message: "unhandled fake route " + method + " " + path }, 404);
  }
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

export class FakeAI {
  constructor() { this.calls = []; this.extract = ({ name }) => ({ business_name: name, crop_value: "tomatoes", crop_quote: "grows tomatoes", lighting_status: "Unknown", lighting_quote: "", future_plans: "Unknown", future_quote: "", unknown_information: ["lighting not stated"], discovery_questions: ["Do you use LED lighting?", "What is your canopy area?"] }); this.verdict = () => "supported"; this.fail = false; }
  async run(model, input) {
    this.calls.push(input.messages[0].content.slice(0, 20)); if (this.fail) throw new Error("simulated AI outage");
    const sys = input.messages[0].content, user = input.messages.at(-1).content;
    if (sys.includes("strict evidence checker")) return { response: JSON.stringify({ verdict: this.verdict(user), reason: "fake" }), usage: { neurons: 0.5 } };
    if (sys.includes("extract structured facts")) { const name = (user.match(/Business name entered by user: (.*)/) || [])[1]; const source = (user.match(/<source>\n([\s\S]*)\n<\/source>/) || [])[1]; return { response: JSON.stringify(this.extract({ name, source })), usage: { neurons: 1 } }; }
    return { response: JSON.stringify({ questions: ["Which bays would LED cover?", "What is your energy tariff?"] }), usage: { neurons: 0.3 } };
  }
}

const sha = (s) => createHash("sha256").update(s).digest("base64url");
export async function makeApp({ root = ROOT, env: extra = {}, portalId = 111, db, hubspot } = {}) {
  // `db` / `hubspot` let a SECOND app (another code version) run against the SAME database and provider (upgrade rehearsals).
  const DB = db ?? createD1(root), hs = hubspot ?? new FakeHubspot({ portalId }), AI = new FakeAI();
  const realFetch = globalThis.fetch; globalThis.fetch = hs.fetch; // the Worker calls global fetch for HubSpot
  const env = { DB, AI, ASSETS: { fetch: async () => new Response("<html></html>") }, HUBSPOT_TEST_TOKEN: "tok-" + randomBytes(6).toString("hex"), LOCAL_DEV: "1", ALLOWED_GITHUB_IDS: "1001,1002", GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "s", LIMIT_RESEARCH_HOUR: "100000", LIMIT_RESEARCH_DAY: "100000", ...extra };
  const mod = await import(pathToFileURL(`${root}/src/index.js`).href + "?t=" + Math.random()); const base = "http://localhost:8787";
  const sessions = new Map();
  const login = async (githubId = 1001, loginName = "user" + githubId) => { // creates a real session row exactly as the callback would (OAuth itself is covered by auth tests)
    const sid = randomBytes(32).toString("base64url"), csrf = randomBytes(18).toString("base64url"), now = Date.now();
    await DB.prepare("INSERT INTO sessions (id_hash, github_id, login, csrf, created_at, expires_at, last_seen) VALUES (?,?,?,?,?,?,?)").bind(sha(sid), githubId, loginName, csrf, now, now + 8 * 3600e3, now).run();
    const s = { sid, csrf, githubId }; sessions.set(githubId, s); return s;
  };
  const request = async (s, method, path, body, extra = {}) => {
    const headers = { ...(s ? { cookie: `ly_session=${s.sid}` } : {}), origin: base, ...(method !== "GET" ? { "content-type": "application/json" } : {}), ...(s && method !== "GET" ? { "x-csrf-token": s.csrf } : {}), ...extra };
    const r = await mod.default.fetch(new Request(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
    return { status: r.status, j: await r.clone().json().catch(() => ({})), headers: r.headers };
  };
  return { env, DB, hs, AI, login, request, get: (s, p) => request(s, "GET", p), post: (s, p, b, x) => request(s, "POST", p, b ?? {}, x), restore: () => { globalThis.fetch = realFetch; },
    // convenience: research + approve the three sourced findings of a synthetic company
    async research(s, name, { domain, source, approve = true } = {}) {
      const r = await this.post(s, "/api/research", { businessName: name, sourceId: "fixture://t", sourceText: source || `${name} grows tomatoes in glasshouses near Ely. The company website does not state whether supplementary LED lighting is installed.`, force: true, domain });
      if (r.status !== 200) return r; if (approve) for (const k of ["crop", "lighting", "future"]) { const f = r.j.findings.find((x) => x.kind === k); const a = await this.post(s, `/api/findings/${f.id}/review`, { action: "approve" }); if (a.status !== 200) throw new Error(`approve ${k}: ${JSON.stringify(a.j)}`); }
      return { status: 200, runId: r.j.run.id, coId: r.j.company.id, j: r.j }; } };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
