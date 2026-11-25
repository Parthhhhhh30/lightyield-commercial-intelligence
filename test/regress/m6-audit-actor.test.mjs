// M6: material mutations carry an authenticated actor and are recorded transactionally with the change itself.
import assert from "node:assert";
import { randomUUID as uuid } from "node:crypto";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("M6 audit actor + transactional events");
const today = () => new Date().toISOString().slice(0, 10), due = () => new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
const ev = (T, entity, action) => T.DB.q("SELECT entity, action, actor_github_id, actor_login FROM events WHERE entity=? AND action=?", entity, action);
const failEvents = (T) => { const inner = T.env.DB; T.env.DB = { ...inner, prepare: (sql) => { const st = inner.prepare(sql); if (/INSERT INTO events/.test(sql)) st.run = async () => { throw new Error("simulated event-insert failure"); }; return st; }, batch: inner.batch, exec: inner.exec }; return () => { T.env.DB = inner; }; };

t("REPRODUCES CODEX M6: two authorised actors each get their own attribution on every material mutation", async () => {
  const T = await makeApp(), a1 = await T.login(1001, "alice"), a2 = await T.login(1002, "bob");
  const r = await T.research(a1, "ZZ Audit Ltd", { approve: false }); assert.equal(ev(T, "run", "created")[0].actor_github_id, 1001, "research run attributed to its creator");
  const [f1, f2, f3] = r.j.findings.filter((f) => ["crop", "lighting", "future"].includes(f.kind)); const q = r.j.findings.filter((f) => f.kind === "question");
  await T.post(a2, `/api/findings/${f1.id}/review`, { action: "approve" }); await T.post(a1, `/api/findings/${f2.id}/review`, { action: "approve" }); await T.post(a2, `/api/findings/${f3.id}/review`, { action: "edit", value: "Planned", note: "Synthetic basis" }); await T.post(a1, `/api/findings/${q[0].id}/review`, { action: "reject" });
  const reviews = T.DB.q("SELECT action, actor_github_id a FROM events WHERE entity='finding' ORDER BY at, rowid"); assert.deepEqual(reviews.map((x) => [x.action, x.a]), [["approve", 1002], ["approve", 1001], ["edit", 1002], ["reject", 1001]]);
  await T.post(a2, `/api/accounts/${r.coId}/notes`, { request_id: uuid(), text: "bob's note" }); assert.equal(ev(T, "note", "added")[0]?.actor_github_id, 1002);
  const qa = await T.post(a1, `/api/accounts/${r.coId}/questions`, { text: "Which bays?" }); assert.equal(ev(T, "question", "added")[0]?.actor_github_id, 1001); await T.post(a2, `/api/questions/${qa.j.id}`, { status: "asked" }); assert.equal(ev(T, "question", "status_asked")[0]?.actor_login, "bob");
  await T.post(a1, `/api/accounts/${r.coId}/conversations`, { request_id: uuid(), occurred_on: today(), channel: "Phone", grower_reported: "x", current_led: "No", future_led: "Unknown", need_or_concern: "", fit: "Unknown", fit_reason: "" }); assert.equal(ev(T, "conversation", "recorded")[0]?.actor_github_id, 1001);
  for (const k of ["approve", "edit"]) assert.ok(T.DB.q("SELECT 1 FROM events WHERE entity='finding' AND action=? AND actor_login IS NOT NULL", k).length > 0);
  T.restore();
});
t("sync, identity resolution, task create/complete are attributed to the acting user", async () => {
  const T = await makeApp(), a1 = await T.login(1001, "alice"), a2 = await T.login(1002, "bob"); const r = await T.research(a1, "ZZ Audit Sync Ltd");
  assert.equal((await T.post(a2, `/api/runs/${r.runId}/sync`, {})).status, 200); assert.equal(ev(T, "company", "synced")[0]?.actor_github_id, 1002);
  const tk = await T.post(a1, `/api/accounts/${r.coId}/tasks`, { request_id: uuid(), subject: "Call", owner: "O", due_on: due() }); assert.equal(ev(T, "task", "created")[0]?.actor_github_id, 1001);
  assert.equal((await T.post(a2, `/api/tasks/${tk.j.task.id}/complete`, { request_id: uuid(), outcome: "Spoke" })).status, 200); assert.equal(ev(T, "task", "completed")[0]?.actor_github_id, 1002);
  const b = await T.research(a1, "ZZ Audit Resolve Ltd"); T.hs.addCompany({ name: "ZZ Audit Resolve Ltd" }); await T.post(a1, `/api/runs/${b.runId}/sync`, {}); await T.post(a2, `/api/companies/${b.coId}/resolve`, { action: "create" }); assert.equal(ev(T, "company", "identity_create_confirmed")[0]?.actor_github_id, 1002); T.restore();
});
t("event-insert failure rolls the mutation back: no record without its audit event (notes, questions, conversations, reviews, research)", async () => {
  const T = await makeApp(), a1 = await T.login(1001, "alice"); const r = await T.research(a1, "ZZ Audit Atomic Ltd", { approve: false }); const f = r.j.findings.find((x) => x.kind === "crop");
  const restore = failEvents(T);
  const n = await T.post(a1, `/api/accounts/${r.coId}/notes`, { request_id: uuid(), text: "should not persist" }); assert.ok(n.status >= 500, `note must fail (got ${n.status})`); assert.equal(T.DB.one("SELECT count(*) c FROM notes").c, 0);
  const q = await T.post(a1, `/api/accounts/${r.coId}/questions`, { text: "nope?" }); assert.ok(q.status >= 500); assert.equal(T.DB.one("SELECT count(*) c FROM questions WHERE text='nope?'").c, 0);
  const c = await T.post(a1, `/api/accounts/${r.coId}/conversations`, { request_id: uuid(), occurred_on: today(), channel: "Phone", grower_reported: "x", current_led: "No", future_led: "Unknown", need_or_concern: "", fit: "Unknown", fit_reason: "" }); assert.ok(c.status >= 500); assert.equal(T.DB.one("SELECT count(*) c FROM conversations").c, 0);
  const rv = await T.post(a1, `/api/findings/${f.id}/review`, { action: "approve" }); assert.ok(rv.status >= 500); assert.equal(T.DB.one("SELECT review_status s FROM findings WHERE id=?", f.id).s, "needs_review");
  const rs = await T.post(a1, "/api/research", { businessName: "ZZ Audit Atomic Two", sourceId: "s", sourceText: "ZZ Audit Atomic Two grows tomatoes in glasshouses near Ely.", force: true }); assert.ok(rs.status >= 500); assert.equal(T.DB.one("SELECT count(*) c FROM research_runs WHERE source_id='s'").c, 0, "no research run without its event");
  restore(); assert.equal((await T.post(a1, `/api/accounts/${r.coId}/notes`, { request_id: uuid(), text: "now ok" })).status, 201); T.restore();
});
t("event-insert failure during task creation is recoverable: retry converges to one HubSpot task with its event", async () => {
  const T = await makeApp(), a1 = await T.login(1001, "alice"); const r = await T.research(a1, "ZZ Audit Task Ltd"); await T.post(a1, `/api/runs/${r.runId}/sync`, {}); const body = { request_id: uuid(), subject: "Call", owner: "O", due_on: due() };
  const restore = failEvents(T); const f = await T.post(a1, `/api/accounts/${r.coId}/tasks`, body); assert.ok(f.status >= 500, `got ${f.status}`); restore();
  const ok = await T.post(a1, `/api/accounts/${r.coId}/tasks`, body); assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.j)); assert.equal(T.hs.tasks.size, 1, "exactly one HubSpot task"); assert.equal(ev(T, "task", "created").length, 1); T.restore();
});
await done();
