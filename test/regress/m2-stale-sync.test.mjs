// M2: synchronisation must be revision-aware; the UI/API must never claim the latest evidence is synced when HubSpot holds an older revision.
import assert from "node:assert";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("M2 stale synchronisation");
const block = (T, coId) => [...T.hs.companies.values()].find((c) => (c.properties.description || "").includes(`[LY-CO:${coId}]`))?.properties.description || "";
async function withQuestion(T, s, name) { const r = await T.research(s, name); const q = r.j.findings.find((f) => f.kind === "question"); assert.equal((await T.post(s, `/api/findings/${q.id}/review`, { action: "approve" })).status, 200); return { ...r, q }; }
const stale = async (T, s, a) => (await T.get(s, `/api/accounts/${a.coId}`)).j.company.sync_stale;

t("REPRODUCES CODEX M2: editing or rejecting synced evidence makes the account visibly STALE until a re-sync succeeds", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await withQuestion(T, s, "ZZ Stale Evidence Ltd");
  assert.equal((await T.post(s, `/api/runs/${a.runId}/sync`, {})).status, 200); assert.ok(block(T, a.coId).includes(a.q.value)); assert.equal(await stale(T, s, a), false, "freshly synced is not stale");
  assert.equal((await T.post(s, `/api/findings/${a.q.id}/review`, { action: "reject" })).status, 200);
  assert.equal(await stale(T, s, a), true, "HubSpot still holds the rejected question: must be flagged stale"); assert.ok(block(T, a.coId).includes(a.q.value), "HubSpot indeed still has the old content");
  const run = await T.get(s, `/api/runs/${a.runId}`); assert.equal(run.j.company.sync_stale, true, "the research screen must also see staleness");
  assert.equal((await T.post(s, `/api/runs/${a.runId}/sync`, {})).status, 200); assert.equal(await stale(T, s, a), false); assert.ok(!block(T, a.coId).includes(a.q.value), "re-sync removed the rejected content"); T.restore();
});
t("editing a synced sourced finding (with basis) also marks it stale", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await T.research(s, "ZZ Edit Stale Ltd"); assert.equal((await T.post(s, `/api/runs/${a.runId}/sync`, {})).status, 200);
  const crop = a.j.findings.find((f) => f.kind === "crop"); assert.equal((await T.post(s, `/api/findings/${crop.id}/review`, { action: "edit", value: "peppers", note: "Synthetic: corrected" })).status, 200);
  assert.equal(await stale(T, s, a), true); T.restore();
});
t("findings are snapshotted AFTER the operation lock is acquired (an edit made while waiting for the lock is included)", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await withQuestion(T, s, "ZZ Snapshot Ltd");
  const gate = (() => { let release; const p = new Promise((r) => (release = r)); let reached; const arrived = new Promise((r) => (reached = r)); return { p, release, arrived, reached }; })();
  const inner = T.env.DB; let armed = true; // pause the lease-claim statement (the moment the lock is taken)
  T.env.DB = { ...inner, prepare: (sql) => { const st = inner.prepare(sql); if (armed && /UPDATE companies SET .*lease/.test(sql) && /WHERE id=\? AND/.test(sql)) { const run = st.run; st.run = async () => { armed = false; gate.reached(); await gate.p; return run(); }; } return st; }, batch: inner.batch, exec: inner.exec };
  const A = T.post(s, `/api/runs/${a.runId}/sync`, {}); await gate.arrived;
  assert.equal((await T.post(s, `/api/findings/${a.q.id}/review`, { action: "reject" })).status, 200); gate.release(); assert.equal((await A).status, 200);
  assert.ok(!block(T, a.coId).includes(a.q.value), "HubSpot must reflect the edit made before the lock was acquired"); assert.equal(await stale(T, s, a), false); T.restore();
});
t("an edit made DURING the sync is not claimed as synced: the result is flagged stale", async () => {
  const T = await makeApp(), s = await T.login(1001); const a = await withQuestion(T, s, "ZZ During Ltd");
  const h = T.hs.hold(/^GET \/account-info\/v3\/details$/); const A = T.post(s, `/api/runs/${a.runId}/sync`, {}); await h.arrived;
  assert.equal((await T.post(s, `/api/findings/${a.q.id}/review`, { action: "reject" })).status, 200); h.release(); assert.equal((await A).status, 200);
  assert.equal(await stale(T, s, a), true, "the synced snapshot predates the rejection"); T.restore();
});
t("derived discovery questions follow their source findings (reject drops, edit rewrites, asked is preserved)", async () => {
  const T = await makeApp(), s = await T.login(1001); const base = T.AI.extract; T.AI.extract = (a) => ({ ...base(a), discovery_questions: ["Which bays are lit?", "What is the canopy area?", "Who decides on lighting?"] }); // three distinct questions
  const r = await T.research(s, "ZZ Questions Ltd", { approve: false });
  const [q1, q2, q3] = r.j.findings.filter((f) => f.kind === "question"); for (const q of [q1, q2, q3]) assert.equal((await T.post(s, `/api/findings/${q.id}/review`, { action: "approve" })).status, 200);
  let acct = (await T.get(s, `/api/accounts/${r.j.company.id}`)).j; assert.equal(acct.questions.filter((x) => x.status === "open").length, 3);
  const asked = acct.questions.find((x) => x.text === q3.value); assert.equal((await T.post(s, `/api/questions/${asked.id}`, { status: "asked" })).status, 200);
  assert.equal((await T.post(s, `/api/findings/${q1.id}/review`, { action: "reject" })).status, 200); assert.equal((await T.post(s, `/api/findings/${q2.id}/review`, { action: "edit", value: "Reworded question?", note: "" })).status, 200); assert.equal((await T.post(s, `/api/findings/${q3.id}/review`, { action: "reject" })).status, 200);
  acct = (await T.get(s, `/api/accounts/${r.j.company.id}`)).j; const by = (txt) => acct.questions.find((x) => x.text === txt);
  assert.ok(!acct.questions.some((x) => x.text === q1.value && x.status === "open"), "rejected source finding must not leave an OPEN question");
  assert.ok(by("Reworded question?") && by("Reworded question?").status === "open", "edited source finding rewrites the open question"); assert.ok(!acct.questions.some((x) => x.text === q2.value && x.status === "open"));
  assert.equal(by(q3.value)?.status, "asked", "a question already asked keeps its history"); T.restore();
});
await done();
