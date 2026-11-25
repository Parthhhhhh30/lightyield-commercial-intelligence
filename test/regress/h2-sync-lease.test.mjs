// H2: concurrent company sync / lease ownership. In-process Worker + fake D1/HubSpot (no remote writes). LY_ROOT=<checkout> to target other code.
import assert from "node:assert";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("H2 sync lease ownership");
const markers = (T, coId) => [...T.hs.companies.values()].filter((c) => (c.properties.description || "").includes(`[LY-CO:${coId}]`)).length;
const hasCol = (T, table, col) => T.DB.q(`PRAGMA table_info(${table})`).some((c) => c.name === col);
const pathSync = (runId) => `/api/runs/${runId}/sync`;

t("REPRODUCES CODEX H2: identity resolution during an active sync must not let a second sync create a duplicate company", async () => {
  // A owns the lease but its company-scan RESPONSE is delayed/stale (processed before B exists, delivered after). Identity resolution then
  // runs; in the old code it reset sync_status so B could claim the same company, create it, and A (acting on its stale scan) created a second.
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Race Ltd");
  const h = T.hs.holdAfter(/^GET \/crm\/v3\/objects\/companies$/);
  const syncA = T.post(s, pathSync(a.runId), {}); await h.arrived; // A holds the lease; its (empty) scan result is in flight
  const resolve = await T.post(s, `/api/companies/${a.coId}/resolve`, { action: "create" });
  const syncB = await T.post(s, pathSync(a.runId), {});
  h.release(); const A = await syncA;
  assert.equal(markers(T, a.coId), 1, `exactly one HubSpot company expected, got ${markers(T, a.coId)} (resolve=${resolve.status}, B=${syncB.status}, A=${A.status})`);
  assert.ok(resolve.status === 409 || syncB.status === 409, "either identity resolution or the second sync must be refused while A owns the lease");
  T.restore();
});
t("write-ahead flag still protects when A is already inside the create call (old behaviour preserved)", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Inflight Ltd");
  const h = T.hs.hold(/^POST \/crm\/v3\/objects\/companies$/); const A = T.post(s, pathSync(a.runId), {}); await h.arrived;
  await T.post(s, `/api/companies/${a.coId}/resolve`, { action: "create" }); const B = await T.post(s, pathSync(a.runId), {}); h.release(); await A;
  assert.equal(markers(T, a.coId), 1); assert.equal(B.status, 409); T.restore();
});
t("three simultaneous syncs create exactly one company", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Triple Ltd");
  const rs = await Promise.all([1, 2, 3].map(() => T.post(s, pathSync(a.runId), {})));
  assert.ok(rs.some((r) => r.status === 200)); assert.ok(rs.every((r) => [200, 409].includes(r.status))); assert.equal(markers(T, a.coId), 1); T.restore();
});
t("delayed provider response: a parallel attempt is refused and only one company results", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Slow Ltd");
  const h = T.hs.hold(/^POST \/crm\/v3\/objects\/companies$/); const A = T.post(s, pathSync(a.runId), {}); await h.arrived;
  const B = await T.post(s, pathSync(a.runId), {}); assert.equal(B.status, 409); h.release(); assert.equal((await A).status, 200); assert.equal(markers(T, a.coId), 1); T.restore();
});
t("a STALE operation cannot complete over a takeover (lease expired, another operation finished)", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Stale Ltd");
  const h = T.hs.hold(/^GET \/crm\/v3\/objects\/companies\/\d+$/); const A = T.post(s, pathSync(a.runId), {}); await h.arrived; // A: company created, inside read-back
  await T.DB.prepare("UPDATE companies SET lease_until=? WHERE id=?").bind(Date.now() - 1000, a.coId).run(); // A's lease expires
  const B = await T.post(s, pathSync(a.runId), {}); assert.equal(B.status, 200, "B takes over and finishes (adopts by marker)");
  h.release(); const Ares = await A;
  assert.notEqual(Ares.status, 200, "A lost its lease; it must not report success or overwrite B's result"); assert.equal(markers(T, a.coId), 1);
  const acct = await T.get(s, `/api/accounts/${a.coId}`); assert.equal(acct.j.company.sync_status, "synced"); T.restore();
});
t("a stale operation finishing late must not release the lease now held by another operation", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Release Ltd");
  const h1 = T.hs.hold(/^GET \/crm\/v3\/objects\/companies\/\d+$/); const A = T.post(s, pathSync(a.runId), {}); await h1.arrived;
  await T.DB.prepare("UPDATE companies SET lease_until=? WHERE id=?").bind(Date.now() - 1000, a.coId).run();
  const h2 = T.hs.hold(/^GET \/crm\/v3\/objects\/companies\/\d+$/); const B = T.post(s, pathSync(a.runId), {}); await h2.arrived; // B now owns the lease and is in flight
  h1.release(); await A; // A (stale) finishes
  const C = await T.post(s, pathSync(a.runId), {}); assert.equal(C.status, 409, "B still owns the lease; C must be refused");
  h2.release(); assert.equal((await B).status, 200); assert.equal(markers(T, a.coId), 1); T.restore();
});
t("a dead owner's expired lease is taken over; a live lease is respected", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Dead Ltd");
  const own = hasCol(T, "companies", "lease_owner");
  await T.DB.prepare(`UPDATE companies SET sync_status='syncing', lease_until=?${own ? ", lease_owner='dead-owner'" : ""} WHERE id=?`).bind(Date.now() - 5000, a.coId).run();
  assert.equal((await T.post(s, pathSync(a.runId), {})).status, 200, "expired lease is taken over"); assert.equal(markers(T, a.coId), 1);
  const b = await T.research(s, "ZZ Live Ltd");
  await T.DB.prepare(`UPDATE companies SET sync_status='syncing', lease_until=?${own ? ", lease_owner='other-live-owner'" : ""} WHERE id=?`).bind(Date.now() + 60000, b.coId).run();
  assert.equal((await T.post(s, pathSync(b.runId), {})).status, 409, "a live lease must be respected"); assert.equal(markers(T, b.coId), 0); T.restore();
});
t("crash after create (id never saved) is reconciled by marker with no duplicate", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Crash Ltd");
  const f = await T.post(s, pathSync(a.runId), {}, { "x-fault": "crash-after-create" }); assert.equal(f.status, 502);
  assert.equal((await T.post(s, pathSync(a.runId), {})).status, 200); assert.equal(markers(T, a.coId), 1); T.restore();
});
t("identity resolution is refused while a sync owns the lease, and works when idle", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Resolve Ltd");
  const h = T.hs.hold(/^POST \/crm\/v3\/objects\/companies$/); const A = T.post(s, pathSync(a.runId), {}); await h.arrived;
  const busy = await T.post(s, `/api/companies/${a.coId}/resolve`, { action: "create" }); h.release(); await A;
  assert.equal(busy.status, 409, "resolve must not mutate state under another operation's lease");
  const c = await T.research(s, "ZZ Idle Ltd"); T.hs.addCompany({ name: "ZZ Idle Ltd", description: "HUMAN" });
  const amb = await T.post(s, pathSync(c.runId), {}); assert.equal(amb.status, 409); assert.equal(amb.j.needs_identity, true);
  assert.equal((await T.post(s, `/api/companies/${c.coId}/resolve`, { action: "create" })).status, 200); T.restore();
});
await done();
