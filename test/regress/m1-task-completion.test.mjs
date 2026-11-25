// M1: task completion must be idempotent and outcome-aware; HubSpot and D1 must never disagree about the outcome.
import assert from "node:assert";
import { randomUUID as uuid } from "node:crypto";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("M1 task completion idempotency");
const due = () => new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
async function setup(T, s, name) { const a = await T.research(s, name); assert.equal((await T.post(s, `/api/runs/${a.runId}/sync`, {})).status, 200); const tk = await T.post(s, `/api/accounts/${a.coId}/tasks`, { request_id: uuid(), subject: "Call grower", owner: "Owner", due_on: due() }); assert.equal(tk.status, 201, JSON.stringify(tk.j)); return { a, task: tk.j.task }; }
const hsBody = (T, task) => T.hs.tasks.get(task.hubspot_task_id).properties.hs_task_body || "";
const d1Row = (T, task) => T.DB.one("SELECT * FROM tasks WHERE id=?", task.id);

t("REPRODUCES CODEX M1: lost response then a retry with a CHANGED outcome must be rejected, never recorded differently in D1 and HubSpot", async () => {
  const T = await makeApp(), s = await T.login(1001); const { task } = await setup(T, s, "ZZ Complete Ltd");
  T.hs.loseOnce(/^PATCH \/crm\/v3\/objects\/tasks\/\d+$/);
  const first = await T.post(s, `/api/tasks/${task.id}/complete`, { request_id: uuid(), outcome: "Outcome A" }); assert.equal(first.status, 502, "lost response surfaces as a recoverable error");
  assert.match(hsBody(T, task), /Outcome A/, "HubSpot did apply the first completion");
  const retry = await T.post(s, `/api/tasks/${task.id}/complete`, { request_id: uuid(), outcome: "Outcome B" });
  assert.equal(retry.status, 409, `a conflicting outcome must be rejected (got ${retry.status})`);
  const row = d1Row(T, task); assert.ok(!row.completion_outcome || row.completion_outcome === "Outcome A", "D1 must never hold B while HubSpot holds A"); assert.ok(!/Outcome B/.test(hsBody(T, task))); T.restore();
});
t("retry with the SAME request and outcome after a lost response converges: HubSpot and D1 agree", async () => {
  const T = await makeApp(), s = await T.login(1001); const { task } = await setup(T, s, "ZZ Converge Ltd"); const rid = uuid();
  T.hs.loseOnce(/^PATCH \/crm\/v3\/objects\/tasks\/\d+$/); assert.equal((await T.post(s, `/api/tasks/${task.id}/complete`, { request_id: rid, outcome: "Same outcome" })).status, 502);
  const ok = await T.post(s, `/api/tasks/${task.id}/complete`, { request_id: rid, outcome: "Same outcome" }); assert.equal(ok.status, 200, JSON.stringify(ok.j));
  const row = d1Row(T, task); assert.equal(row.completion_outcome, "Same outcome"); assert.ok(row.completed_at); assert.equal(T.hs.tasks.get(task.hubspot_task_id).properties.hs_task_status, "COMPLETED"); assert.equal((hsBody(T, task).match(/Outcome: Same outcome/g) || []).length, 1, "outcome recorded exactly once"); T.restore();
});
t("an already-completed task: same outcome = idempotent success; different outcome = conflict", async () => {
  const T = await makeApp(), s = await T.login(1001); const { task } = await setup(T, s, "ZZ Done Ltd");
  assert.equal((await T.post(s, `/api/tasks/${task.id}/complete`, { request_id: uuid(), outcome: "Left voicemail" })).status, 200);
  const same = await T.post(s, `/api/tasks/${task.id}/complete`, { request_id: uuid(), outcome: "Left voicemail" }); assert.equal(same.status, 200); assert.equal(same.j.duplicate, true);
  assert.equal((await T.post(s, `/api/tasks/${task.id}/complete`, { request_id: uuid(), outcome: "Spoke to owner" })).status, 409); assert.equal(d1Row(T, task).completion_outcome, "Left voicemail"); T.restore();
});
t("concurrent completions with different outcomes: exactly one wins, the other is rejected, both stores agree", async () => {
  const T = await makeApp(), s = await T.login(1001); const { task } = await setup(T, s, "ZZ Concurrent Ltd");
  const rs = await Promise.all([T.post(s, `/api/tasks/${task.id}/complete`, { request_id: uuid(), outcome: "Outcome X" }), T.post(s, `/api/tasks/${task.id}/complete`, { request_id: uuid(), outcome: "Outcome Y" })]);
  const codes = rs.map((r) => r.status).sort(); assert.deepEqual(codes, [200, 409], `statuses ${codes}`);
  const winner = d1Row(T, task).completion_outcome; assert.ok(["Outcome X", "Outcome Y"].includes(winner)); assert.match(hsBody(T, task), new RegExp(`Outcome: ${winner}`)); const loser = winner === "Outcome X" ? "Outcome Y" : "Outcome X"; assert.ok(!hsBody(T, task).includes(loser)); T.restore();
});
t("completion requires an outcome; a failed completion is not recorded as done", async () => {
  const T = await makeApp(), s = await T.login(1001); const { task } = await setup(T, s, "ZZ Fail Ltd");
  assert.equal((await T.post(s, `/api/tasks/${task.id}/complete`, { request_id: uuid(), outcome: "" })).status, 400);
  T.hs.failOnce(/^PATCH \/crm\/v3\/objects\/tasks\/\d+$/, 503); const f = await T.post(s, `/api/tasks/${task.id}/complete`, { request_id: uuid(), outcome: "x outcome" }); assert.equal(f.status, 502); assert.equal(d1Row(T, task).completed_at, null); T.restore();
});
await done();
