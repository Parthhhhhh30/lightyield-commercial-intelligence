// FINAL REMEDIATION A (HIGH): follow-up creation must be fenced by an explicit operation owner. A request whose lease expired (long/stalled provider
// pagination) must not create, complete or clear anything once another request owns the task. Faults here are INJECTED into the fake provider.
import assert from "node:assert";
import { randomUUID as uuid } from "node:crypto";
import { makeApp, sleep } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("A task ownership fencing");
const due = () => new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
async function world({ others = 5, pageSize = 2 } = {}) {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Fence Ltd"); assert.equal((await T.post(s, `/api/runs/${a.runId}/sync`, {})).status, 200);
  for (let i = 0; i < others; i++) T.hs.tasks.set("9" + i, { id: "9" + i, properties: { hs_task_subject: "unrelated " + i, hs_task_body: "", hs_task_status: "NOT_STARTED" } }); T.hs.seq += 100; T.hs.pageSize = pageSize;
  const body = { request_id: uuid(), subject: "Call grower", owner: "Owner", due_on: due() }; return { T, s, a, body, path: `/api/accounts/${a.coId}/tasks` };
}
const hsTasks = (T) => [...T.hs.tasks.values()].filter((x) => x.properties.hs_task_subject === "Call grower");
const row = (T, rid) => T.DB.one("SELECT * FROM tasks WHERE request_id=?", rid);
const expireLease = (T, rid) => T.DB.raw.exec(`UPDATE tasks SET lease_until=1 WHERE request_id='${rid}'`);

t("REPRODUCES CODEX A: lease expires while the paginated scan's last page is delayed; a second request creates; the first must NOT create a second task", async () => {
  const { T, s, body, path } = await world(); const h = T.hs.holdAfter(/GET \/crm\/v3\/objects\/tasks\?.*after=4/);
  const A = T.post(s, path, body); await h.arrived; // A's scan has been answered with "no marker" but A has not seen the response yet
  expireLease(T, body.request_id); // A's lease lapses (the provider is slow)
  const B = await T.post(s, path, body); assert.equal(B.status, 201, JSON.stringify(B.j)); assert.equal(hsTasks(T).length, 1);
  h.release(); const a = await A;
  assert.equal(hsTasks(T).length, 1, `a stale operation created a second HubSpot task (A answered ${a.status})`); assert.ok([200, 409].includes(a.status), "A must stop cleanly, not fail with a server error: " + a.status);
  T.restore();
});
t("a stale operation cannot clear or overwrite the replacement owner's state", async () => {
  const { T, s, body, path } = await world(); const h = T.hs.holdAfter(/GET \/crm\/v3\/objects\/tasks\?.*after=4/); const A = T.post(s, path, body); await h.arrived; expireLease(T, body.request_id);
  const B = await T.post(s, path, body); const hid = row(T, body.request_id).hubspot_task_id; assert.ok(hid && row(T, body.request_id).op_state === "created");
  h.release(); const a = await A; const r = row(T, body.request_id); assert.equal(r.op_state, "created", "A must not downgrade 'created'"); assert.equal(r.hubspot_task_id, hid, "A must not replace B's HubSpot id"); assert.equal(r.last_error, null);
  if (a.status === 409) assert.equal(a.j.lease_lost, true, "a stale operation reports lease loss"); else assert.equal(a.j.task.hubspot_task_id, hid, "or it reports the replacement owner's task, never its own");
  assert.equal(T.hs.count(/^POST \/crm\/v3\/objects\/tasks$/), 1); T.restore();
});
t("stale operation: lease lost BEFORE the write-ahead marker means A reports 'lease lost' (409) and never calls the provider create", async () => {
  const { T, s, body, path } = await world(); const h = T.hs.holdAfter(/GET \/crm\/v3\/objects\/tasks\?.*after=4/); const A = T.post(s, path, body); await h.arrived;
  expireLease(T, body.request_id); T.DB.raw.exec(`UPDATE tasks SET lease_until=${Date.now() + 60000}, lease_owner='some-other-owner' WHERE request_id='${body.request_id}'`); // another operation holds a valid lease
  h.release(); const a = await A; assert.equal(a.status, 409); assert.equal(a.j.lease_lost, true, JSON.stringify(a.j)); assert.equal(T.hs.count(/^POST \/crm\/v3\/objects\/tasks$/), 0, "no provider create by the stale operation");
  const r = row(T, body.request_id); assert.equal(r.lease_owner, "some-other-owner", "A must not release the new owner's lease"); assert.equal(r.op_state, "creating"); T.restore();
});
t("the lease is renewed while a long paginated scan makes progress (no spurious loss), and a concurrent request is told it is in progress", async () => {
  const { T, s, body, path } = await world({ others: 9, pageSize: 2 }); T.env.TASK_LEASE_MS = 400; T.hs.latency = 150; // 5 pages x 150 ms > 400 ms: only renewal can keep the lease
  const A = T.post(s, path, body); await sleep(500); const B = await T.post(s, path, body); assert.equal(B.status, 409, "B must see the operation as in progress while A legitimately holds it (A's scan outlived one lease period)");
  const a = await A; assert.equal(a.status, 201, JSON.stringify(a.j)); assert.equal(hsTasks(T).length, 1); T.restore();
});
t("lost response after the provider create: 'uncertain' + reconciliation by marker on retry; never a second create", async () => {
  const { T, s, body, path } = await world(); T.hs.loseOnce(/^POST \/crm\/v3\/objects\/tasks$/); const f = await T.post(s, path, body); assert.equal(f.status, 502); assert.equal(f.j.op_state, "uncertain"); assert.equal(hsTasks(T).length, 1);
  const r = await T.post(s, path, body); assert.equal(r.status, 201, JSON.stringify(r.j)); assert.equal(hsTasks(T).length, 1, "reconciled by marker"); assert.equal(row(T, body.request_id).op_state, "created"); T.restore();
});
t("concurrent identical requests: exactly one provider create, both callers get a coherent answer", async () => {
  const { T, s, body, path } = await world({ others: 0 }); const rs = await Promise.all([T.post(s, path, body), T.post(s, path, body), T.post(s, path, body)]);
  assert.equal(hsTasks(T).length, 1); assert.ok(rs.some((r) => r.status === 201), JSON.stringify(rs.map((r) => r.status))); assert.ok(rs.every((r) => [200, 201, 409].includes(r.status))); T.restore();
});
t("two provider tasks already carrying the marker (ambiguity) are reported, not resolved by creating a third", async () => {
  const { T, s, body, path } = await world({ others: 0 }); const first = await T.post(s, path, body); assert.equal(first.status, 201); const id = row(T, body.request_id).id;
  T.hs.tasks.set("777", { id: "777", properties: { hs_task_subject: "Call grower", hs_task_body: `[LY-TASK:${id}]`, hs_task_status: "NOT_STARTED" } });
  T.DB.raw.exec(`UPDATE tasks SET op_state='uncertain', hubspot_task_id=NULL, lease_until=NULL, lease_owner=NULL WHERE id='${id}'`); const r = await T.post(s, path, body);
  assert.equal(r.status, 409); assert.match(r.j.error, /ambiguous/i); assert.equal(T.hs.count(/^POST \/crm\/v3\/objects\/tasks$/), 1, "no third task"); T.restore();
});
t("an incomplete scan (pagination limit reached) is reported and does not create; it never claims exactly-once", async () => {
  const { T, s, body, path } = await world({ others: 45, pageSize: 2 }); const r = await T.post(s, path, body); assert.equal(r.status, 502); assert.match(String(r.j.error), /scan incomplete|reconcil/i); assert.equal(hsTasks(T).length, 0); assert.notEqual(row(T, body.request_id).op_state, "created"); T.restore();
});
t("F (server): a RETRY of an existing operation whose due date has since passed is accepted unchanged; a NEW operation with a past date is still rejected", async () => {
  const { T, s, body, path } = await world({ others: 0 }); const past = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  T.DB.raw.exec(`INSERT INTO tasks (id,request_id,company_id,op_state,subject,owner_label,due_at,created_at,last_error) VALUES ('t-old','${body.request_id}','${T.DB.one("SELECT id FROM companies LIMIT 1").id}','failed','Call grower','Owner','${past}T09:00:00Z','x','HubSpot rejected')`);
  const r = await T.post(s, path, { ...body, due_on: past }); assert.equal(r.status, 201, JSON.stringify(r.j)); assert.equal(hsTasks(T).length, 1);
  assert.equal((await T.post(s, path, { ...body, request_id: uuid(), due_on: past })).status, 400, "a new operation may not be created in the past"); T.restore();
});
await done();
