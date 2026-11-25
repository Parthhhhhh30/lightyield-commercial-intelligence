// FINAL REMEDIATION D: completion whose response was lost, followed by a page reload (all client memory gone), must be resumable safely.
import assert from "node:assert";
import { randomUUID as uuid } from "node:crypto";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("D completion resume after reload");
const due = () => new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
async function world() { const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Resume Ltd"); await T.post(s, `/api/runs/${a.runId}/sync`, {});
  const tk = (await T.post(s, `/api/accounts/${a.coId}/tasks`, { request_id: uuid(), subject: "Call", owner: "O", due_on: due() })).j.task; return { T, s, a, tk }; }
const hsTask = (T, tk) => T.hs.tasks.get(tk.hubspot_task_id).properties;
const lostCompletion = async (W, outcome = "Synthetic: left voicemail") => { W.T.hs.loseOnce(/^PATCH \/crm\/v3\/objects\/tasks\/\d+$/); const r = await W.T.post(W.s, `/api/tasks/${W.tk.id}/complete`, { request_id: uuid(), outcome }); assert.equal(r.status, 502); assert.equal(hsTask(W.T, W.tk).hs_task_status, "COMPLETED", "provider applied the completion; only the response was lost"); return r; };

t("REPRODUCES CODEX D: after a lost completion response and a reload, the account page exposes the pending completion intent", async () => {
  const W = await world(); await lostCompletion(W); const acct = (await W.T.get(W.s, `/api/accounts/${W.a.coId}`)).j; const x = acct.tasks.find((q) => q.id === W.tk.id);
  assert.ok(x.completion_pending, "the reloaded UI has no way to know a completion is pending"); assert.equal(x.completion_pending.outcome, "Synthetic: left voicemail"); assert.match(x.completion_pending.request_id, /^[0-9a-f-]{16,64}$/i); W.T.restore();
});
t("authenticated resume: reconciles the stored intent → D1 completed, outcome matches HubSpot, no second PATCH, no new operation", async () => {
  const W = await world(); await lostCompletion(W); const patches = W.T.hs.count(/^PATCH \/crm\/v3\/objects\/tasks\/\d+$/);
  const r = await W.T.post(W.s, `/api/tasks/${W.tk.id}/resume-completion`, {}); assert.equal(r.status, 200, JSON.stringify(r.j));
  const d1 = W.T.DB.one("SELECT completed_at, completion_outcome o, completion_state st FROM tasks WHERE id=?", W.tk.id); assert.ok(d1.completed_at); assert.equal(d1.o, "Synthetic: left voicemail"); assert.equal(d1.st, "done");
  assert.ok(hsTask(W.T, W.tk).hs_task_body.includes("Outcome: Synthetic: left voicemail")); assert.equal(W.T.hs.count(/^PATCH \/crm\/v3\/objects\/tasks\/\d+$/), patches, "the recognised marker means no re-write");
  assert.equal((await W.T.post(W.s, `/api/tasks/${W.tk.id}/resume-completion`, {})).status, 200, "idempotent once done"); W.T.restore();
});
t("after the reload the user may retype the SAME outcome under a NEW request id: it reconciles the existing intent (no contradictory operation)", async () => {
  const W = await world(); await lostCompletion(W); const r = await W.T.post(W.s, `/api/tasks/${W.tk.id}/complete`, { request_id: uuid(), outcome: "Synthetic: left voicemail" }); assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.ok(W.T.DB.one("SELECT completed_at c FROM tasks WHERE id=?", W.tk.id).c); assert.equal(W.T.hs.count(/^PATCH \/crm\/v3\/objects\/tasks\/\d+$/), 1); W.T.restore();
});
t("a DIFFERENT outcome while a completion is pending is rejected (409); the pending intent and HubSpot are unchanged", async () => {
  const W = await world(); await lostCompletion(W); const r = await W.T.post(W.s, `/api/tasks/${W.tk.id}/complete`, { request_id: uuid(), outcome: "A contradictory outcome" }); assert.equal(r.status, 409);
  assert.equal(W.T.DB.one("SELECT completion_outcome o FROM tasks WHERE id=?", W.tk.id).o, "Synthetic: left voicemail"); assert.ok(!hsTask(W.T, W.tk).hs_task_body.includes("contradictory")); W.T.restore();
});
t("resume with nothing pending is a clear 409; unknown task 404; unauthenticated 401; no CSRF 403", async () => {
  const W = await world(); assert.equal((await W.T.post(W.s, `/api/tasks/${W.tk.id}/resume-completion`, {})).status, 409); assert.equal((await W.T.post(W.s, `/api/tasks/nope/resume-completion`, {})).status, 404);
  assert.equal((await W.T.request(null, "POST", `/api/tasks/${W.tk.id}/resume-completion`, {})).status, 401); assert.equal((await W.T.request(W.s, "POST", `/api/tasks/${W.tk.id}/resume-completion`, {}, { "x-csrf-token": "bad" })).status, 403); W.T.restore();
});
t("if HubSpot did NOT apply the lost completion, resume applies it exactly once", async () => {
  const W = await world(); W.T.hs.failOnce(/^PATCH \/crm\/v3\/objects\/tasks\/\d+$/, 503); const r0 = await W.T.post(W.s, `/api/tasks/${W.tk.id}/complete`, { request_id: uuid(), outcome: "Did it" }); assert.equal(r0.status, 502); assert.notEqual(hsTask(W.T, W.tk).hs_task_status, "COMPLETED");
  const r = await W.T.post(W.s, `/api/tasks/${W.tk.id}/resume-completion`, {}); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(hsTask(W.T, W.tk).hs_task_status, "COMPLETED"); assert.equal(W.T.hs.count(/^PATCH \/crm\/v3\/objects\/tasks\/\d+$/), 2); W.T.restore();
});
await done();
