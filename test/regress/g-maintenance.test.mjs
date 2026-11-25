// Release safety: MAINTENANCE is a fail-closed write pause. While on, NO route (api, auth, test, eval, bearer, fixture, static, unknown) can run, even with a valid
// session + CSRF + allowlisted identity, and NOTHING is written to D1 / HubSpot / AI. Hosted mode: anything but exactly "0" pauses the app.
import assert from "node:assert";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { makeApp, ROOT } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("G maintenance write-pause");
const worker = (await import(pathToFileURL(`${ROOT}/src/index.js`).href + "?g=" + Math.random())).default;
const snapshot = (T) => { const h = createHash("sha256"); for (const { name } of T.DB.q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) h.update(name + JSON.stringify(T.DB.q(`SELECT * FROM ${name}`))); return h.digest("hex"); };
const PATHS = ["/", "/index.html", "/assets/app.js", "/api/session", "/api/config", "/api/accounts", "/api/accounts/x", "/api/runs", "/api/runs/x", "/api/runs/x/verify", "/api/research", "/api/findings/x/review", "/api/runs/x/sync", "/api/companies/x/resolve", "/api/accounts/x/tasks", "/api/accounts/x/conversations", "/api/accounts/x/notes", "/api/tasks/x/complete", "/api/tasks/x/resume-completion", "/api/questions/x", "/api/followups", "/api/metrics", "/api/eval/extract", "/auth/login", "/auth/callback?code=a&state=b", "/auth/logout", "/ai-test", "/d1-test", "/fixture/authorize", "/nope", "//api/accounts", "/api/../api/accounts", "/API/accounts", "/health/x"];
const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

t("local MAINTENANCE=1: every path x method is 503 even with a valid session, CSRF, origin, bearer and fault headers; D1, HubSpot and AI are untouched", async () => {
  const T = await makeApp({ env: { MAINTENANCE: "1", SMOKE_TOKEN: "smoke", SMOKE_TOKEN_LOCAL: "smoke" } }), s = await T.login(1001); const before = snapshot(T), hsCalls = T.hs.calls.length, aiCalls = T.AI.calls.length; let n = 0;
  for (const p of PATHS) for (const m of METHODS) {
    const headers = { cookie: `ly_session=${s.sid}; __Host-ly_session=${s.sid}`, origin: "http://localhost:8787", "content-type": "application/json", "x-csrf-token": s.csrf, authorization: "Bearer smoke", "x-fault": "hubspot-5xx" };
    const res = await worker.fetch(new Request("http://localhost:8787" + p, { method: m, headers, body: ["GET", "HEAD", "OPTIONS"].includes(m) ? undefined : "{}" }), T.env, {}); n++;
    assert.equal(res.status, 503, `${m} ${p} => ${res.status}`); if (m !== "HEAD") assert.equal((await res.json()).maintenance, true);
  }
  assert.equal(snapshot(T), before, "no database write"); assert.equal(T.hs.calls.length, hsCalls, "no HubSpot call"); assert.equal(T.AI.calls.length, aiCalls, "no AI call"); assert.ok(n > 200); T.restore();
});
t("/health stays reachable and reports maintenance; it exposes nothing else", async () => {
  const T = await makeApp({ env: { MAINTENANCE: "1" } }); const r = await worker.fetch(new Request("http://localhost:8787/health"), T.env, {}); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, maintenance: true });
  assert.equal((await worker.fetch(new Request("http://localhost:8787/health", { method: "POST", headers: { origin: "http://localhost:8787", "content-type": "application/json" }, body: "{}" }), T.env, {})).status, 503); T.restore();
});
t("local dev is open when MAINTENANCE is absent (only an explicit '1' pauses a local environment)", async () => {
  const T = await makeApp(), s = await T.login(1001); assert.equal((await T.get(s, "/api/accounts")).status, 200); const T2 = await makeApp({ env: { MAINTENANCE: "0" } }); assert.equal((await T2.get(await T2.login(1001), "/api/accounts")).status, 200); T.restore(); T2.restore();
});
t("HOSTED mode FAILS CLOSED: absent, empty, garbled or lookalike MAINTENANCE values all pause the app; only exactly \"0\" opens it", async () => {
  const ORIGIN = "https://lightyield-synthetic.example.workers.dev", boom = { prepare: () => { throw new Error("DB touched during maintenance"); }, batch: () => { throw new Error("DB touched"); } }, assets = { fetch: async () => new Response("<div></div>") };
  const call = (extra, path = "/api/session") => worker.fetch(new Request(ORIGIN + path), { HOSTED: "1", HOSTED_ORIGIN: ORIGIN, HUBSPOT_PORTAL_ID: "1", ASSETS: assets, DB: boom, ...extra }, {});
  for (const v of [undefined, "", "false", "no", "00", " 0", "0 ", "01", "off", "1", "true", null]) { const r = await call(v === undefined ? {} : { MAINTENANCE: v }); assert.equal(r.status, 503, `MAINTENANCE=${JSON.stringify(v)}`); }
  const open = await call({ MAINTENANCE: "0" }); assert.equal(open.status, 200, "exactly '0' is the open state"); assert.equal((await call({ MAINTENANCE: "0" }, "/api/accounts")).status, 401, "open state still requires login");
  const sec = await call({}); assert.ok(sec.headers.get("cache-control") === "no-store" && sec.headers.get("x-content-type-options") === "nosniff", "maintenance responses carry the security headers");
});
t("a session that existed BEFORE maintenance cannot be used during it, and works again after (nothing was invalidated or written)", async () => {
  const T = await makeApp(), s = await T.login(1001); assert.equal((await T.get(s, "/api/accounts")).status, 200); const before = snapshot(T);
  T.env.MAINTENANCE = "1"; assert.equal((await T.get(s, "/api/accounts")).status, 503); assert.equal((await T.post(s, "/api/research", { businessName: "ZZ Paused", sourceId: "s", sourceText: "x".repeat(60) })).status, 503); assert.equal(snapshot(T), before);
  T.env.MAINTENANCE = "0"; assert.equal((await T.get(s, "/api/accounts")).status, 200); T.restore();
});
await done();
