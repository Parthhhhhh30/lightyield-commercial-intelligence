// The behaviours previously protected only by the LIVE crm/workflow suites, ported to the in-process harness (real Worker code, fake D1/HubSpot)
// so the remediated sync/lease code is regression-tested WITHOUT any remote write. Faults are injected (fault header / fake provider rules).
import assert from "node:assert";
import { randomUUID as uuid } from "node:crypto";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("CRM scenarios (ported from live suites)");
const markers = (T, coId) => [...T.hs.companies.values()].filter((c) => (c.properties.description || "").includes(`[LY-CO:${coId}]`)).length;
const sync = (T, s, runId, fault) => T.post(s, `/api/runs/${runId}/sync`, {}, fault ? { "x-fault": fault } : {});
const due = () => new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);

t("lost response after create → 'uncertain'; an immediate retry reconciles by marker (no second company)", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Lost Ltd"); const f = await sync(T, s, a.runId, "hubspot-lost-response");
  assert.equal(f.status, 502); assert.equal(f.j.sync_status, "uncertain"); assert.equal(T.DB.one("SELECT hubspot_id h FROM companies WHERE id=?", a.coId).h, null);
  assert.equal((await sync(T, s, a.runId)).status, 200); assert.equal(markers(T, a.coId), 1); T.restore();
});
t("5xx before the outcome is known → uncertain; guarded wait; after the window a single create", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Five Ltd"); const f = await sync(T, s, a.runId, "hubspot-5xx");
  assert.equal(f.status, 502); assert.equal(f.j.sync_status, "uncertain"); assert.equal(T.hs.companies.size, 0);
  const quick = await sync(T, s, a.runId); assert.equal(quick.status, 409); assert.ok(quick.j.retry_after_s > 0);
  T.DB.raw.exec(`UPDATE companies SET create_sent_at=${Date.now() - 61000} WHERE id='${a.coId}'`); assert.equal((await sync(T, s, a.runId)).status, 200); assert.equal(markers(T, a.coId), 1); T.restore();
});
t("429 and 4xx → recoverable error, nothing created, retry works", async () => {
  const T = await makeApp(), s = await T.login(1001); for (const fault of ["hubspot-429", "hubspot-4xx"]) { const a = await T.research(s, `ZZ ${fault} Ltd`); const f = await sync(T, s, a.runId, fault); assert.equal(f.status, 502); assert.equal(f.j.sync_status, "error"); assert.equal(markers(T, a.coId), 0); assert.equal((await sync(T, s, a.runId)).status, 200); assert.equal(markers(T, a.coId), 1); } T.restore();
});
t("same-name record in HubSpot → needs_identity, NO write, human text untouched; link then sync preserves human text; re-sync is idempotent", async () => {
  const T = await makeApp(), s = await T.login(1001); const hid = T.hs.addCompany({ name: "ZZ Manual Ltd", description: "HUMAN NOTE: met at show" }); const a = await T.research(s, "ZZ Manual Ltd");
  const s1 = await sync(T, s, a.runId); assert.equal(s1.status, 409); assert.equal(s1.j.needs_identity, true); assert.equal(s1.j.candidates[0].id, hid); assert.equal(T.hs.companies.get(hid).properties.description, "HUMAN NOTE: met at show");
  assert.equal((await T.post(s, `/api/companies/${a.coId}/resolve`, { action: "link", hubspot_id: "99999" })).status, 409, "cannot link to a non-candidate");
  assert.equal((await T.post(s, `/api/companies/${a.coId}/resolve`, { action: "link", hubspot_id: hid })).status, 200); assert.equal((await sync(T, s, a.runId)).status, 200);
  const d = T.hs.companies.get(hid).properties.description; assert.ok(d.startsWith("HUMAN NOTE: met at show") && d.includes(`[LY-CO:${a.coId}]`)); assert.equal((await sync(T, s, a.runId)).status, 200); assert.equal(T.hs.companies.get(hid).properties.description, d, "idempotent");
  const b = await T.research(s, "ZZ Manual Twin"); T.DB.raw.exec(`UPDATE companies SET candidates='[{"id":"${hid}","name":"x","domain":""}]' WHERE id='${b.coId}'`); assert.equal((await T.post(s, `/api/companies/${b.coId}/resolve`, { action: "link", hubspot_id: hid })).status, 409, "record already linked to another company"); T.restore();
});
t("domain+name match auto-adopts; same domain different name is ambiguous; a domain owned by another account is refused", async () => {
  const T = await makeApp(), s = await T.login(1001); const hid = T.hs.addCompany({ name: "ZZ Dom Ltd", domain: "dom.synthetic-test.example", description: "HUMAN DOMAIN NOTE" });
  const a = await T.research(s, "ZZ Dom Ltd", { domain: "dom.synthetic-test.example" }); assert.equal((await sync(T, s, a.runId)).status, 200); assert.equal(T.DB.one("SELECT hubspot_id h FROM companies WHERE id=?", a.coId).h, hid); assert.ok(T.hs.companies.get(hid).properties.description.startsWith("HUMAN DOMAIN NOTE"));
  const dup = await T.post(s, "/api/research", { businessName: "ZZ Other Name", sourceId: "x", sourceText: "ZZ Other Name grows tomatoes near Ely in Norfolk.", domain: "dom.synthetic-test.example" }); assert.equal(dup.status, 409); assert.match(dup.j.error, /already belongs/);
  T.hs.addCompany({ name: "ZZ Holdings Ltd", domain: "hold.synthetic-test.example" }); const b = await T.research(s, "ZZ Trading Name", { domain: "hold.synthetic-test.example" }); const r = await sync(T, s, b.runId); assert.equal(r.status, 409); assert.equal(r.j.needs_identity, true); T.restore();
});
t("explicit 'create new' after ambiguity creates one new record and leaves the old one untouched", async () => {
  const T = await makeApp(), s = await T.login(1001); const hid = T.hs.addCompany({ name: "ZZ Forced Ltd", description: "ORIGINAL" }); const a = await T.research(s, "ZZ Forced Ltd"); assert.equal((await sync(T, s, a.runId)).status, 409);
  assert.equal((await T.post(s, `/api/companies/${a.coId}/resolve`, { action: "create" })).status, 200); assert.equal((await sync(T, s, a.runId)).status, 200);
  assert.notEqual(T.DB.one("SELECT hubspot_id h FROM companies WHERE id=?", a.coId).h, hid); assert.equal(T.hs.companies.get(hid).properties.description, "ORIGINAL"); assert.equal([...T.hs.companies.values()].filter((c) => c.properties.name === "ZZ Forced Ltd").length, 2); T.restore();
});
t("a deleted linked HubSpot record is reported, never silently re-created", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Deleted Ltd"); assert.equal((await sync(T, s, a.runId)).status, 200); const hid = T.DB.one("SELECT hubspot_id h FROM companies WHERE id=?", a.coId).h;
  T.hs.companies.delete(hid); const r = await sync(T, s, a.runId); assert.equal(r.status, 409); assert.match(r.j.error, /no longer exists/); assert.equal(T.hs.companies.size, 0); T.restore();
});
t("a legacy Phase 1 block (no end marker) on an adopted record is replaced, not duplicated", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Legacy Ltd");
  const hid = T.hs.addCompany({ name: "ZZ Legacy Ltd", domain: "", description: `HUMAN\n\n[LightYield research - human-approved]\nCrop: Old\nSource: fixture://x (pasted text, not fetched) | Run old-1` }); T.DB.raw.exec(`UPDATE companies SET hubspot_id='${hid}', identity_status='linked' WHERE id='${a.coId}'`);
  assert.equal((await sync(T, s, a.runId)).status, 200); const d = T.hs.companies.get(hid).properties.description; assert.ok(d.startsWith("HUMAN")); assert.equal((d.match(/LightYield research/g) || []).length, 1); assert.ok(!d.includes("Crop: Old")); T.restore();
});
t("tasks: association verified; lost response → uncertain and reconciled by marker; 4xx → failed then retry; no duplicates", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Tasks Ltd"); await sync(T, s, a.runId); const hid = T.DB.one("SELECT hubspot_id h FROM companies WHERE id=?", a.coId).h;
  const ok = await T.post(s, `/api/accounts/${a.coId}/tasks`, { request_id: uuid(), subject: "Call", owner: "O", due_on: due() }); assert.equal(ok.status, 201); assert.equal(ok.j.association_verified, true); assert.deepEqual(T.hs.assoc.get(ok.j.task.hubspot_task_id), [hid]);
  const body = { request_id: uuid(), subject: "Lost", owner: "O", due_on: due() }; const lost = await T.post(s, `/api/accounts/${a.coId}/tasks`, body, { "x-fault": "hubspot-lost-response" }); assert.equal(lost.status, 502); assert.equal(lost.j.op_state, "uncertain");
  assert.equal((await T.post(s, `/api/accounts/${a.coId}/tasks`, body)).status, 201); assert.equal([...T.hs.tasks.values()].filter((x) => x.properties.hs_task_subject === "Lost").length, 1);
  const b4 = { request_id: uuid(), subject: "Four", owner: "O", due_on: due() }; assert.equal((await T.post(s, `/api/accounts/${a.coId}/tasks`, b4, { "x-fault": "hubspot-4xx" })).j.op_state, "failed"); assert.equal((await T.post(s, `/api/accounts/${a.coId}/tasks`, b4)).status, 201);
  assert.equal([...T.hs.tasks.values()].filter((x) => x.properties.hs_task_subject === "Four").length, 1); T.restore();
});
t("tasks require a synced company; sessions/CSRF/origin guards still apply to every mutation route", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Unsynced Ltd"); assert.equal((await T.post(s, `/api/accounts/${a.coId}/tasks`, { request_id: uuid(), subject: "x", owner: "o", due_on: due() })).status, 409);
  assert.equal((await T.request(null, "POST", `/api/runs/${a.runId}/sync`, {})).status, 401); assert.equal((await T.request(s, "POST", `/api/runs/${a.runId}/sync`, {}, { "x-csrf-token": "wrong" })).status, 403); T.restore();
});
await done();
