// FIFTH REVIEW, finding C: derived questions must be de-duplicated AFTER edits too (not only at insertion), consistently with the evidence-selection policy, without destroying
// asked/answered/dropped history or source links.
import assert from "node:assert";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("C3 derived-question de-duplication");
const src = (n, c) => `${n} grows ${c} in glasshouses near Ely. The company website does not state whether supplementary LED lighting is installed.`;
async function world(qa, qb) {
  const T = await makeApp(), s = await T.login(1001); const base = T.AI.extract; let n = 0; T.AI.extract = (a) => ({ ...base(a), discovery_questions: [[qa, qb][n++ % 2]] });
  const A = await T.research(s, "ZZ Dedupe Ltd"), B = await T.research(s, "ZZ Dedupe Ltd", { source: src("ZZ Dedupe Ltd", "tomatoes") + " Second look." }); const qf = {};
  for (const [k, R] of [["A", A], ["B", B]]) { const f = (await T.get(s, `/api/runs/${R.runId}`)).j.findings.find((x) => x.kind === "question"); qf[k] = f; assert.equal((await T.post(s, `/api/findings/${f.id}/review`, { action: "approve" })).status, 200); }
  return { T, s, A, B, qf };
}
const acct = async (W) => (await W.T.get(W.s, `/api/accounts/${W.A.coId}`)).j;
const active = (a) => a.questions.filter((q) => ["open", "proposed", "asked"].includes(q.status));
const payloadQs = (W) => { const d = [...W.T.hs.companies.values()].find((c) => (c.properties.description || "").includes(`[LY-CO:${W.A.coId}]`))?.properties.description || ""; return (d.split("Discovery questions (AI-suggested, approved):\n")[1] || "").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)); };
const edit = (W, f, value) => W.T.post(W.s, `/api/findings/${f.id}/review`, { action: "edit", value, note: "edit" });

t("REPRODUCES CODEX C: two approved questions from different runs become IDENTICAL after an edit → exactly ONE active question remains; both source findings and the dropped row are retained", async () => {
  const W = await world("Which bays would LED cover?", "What is your energy tariff?"); assert.equal(active(await acct(W)).length, 2);
  assert.equal((await edit(W, W.qf.B, "Which bays would LED cover?")).status, 200); const a = await acct(W);
  assert.equal(active(a).filter((q) => q.text === "Which bays would LED cover?").length, 1, JSON.stringify(a.questions)); assert.equal(W.T.DB.one("SELECT count(*) c FROM questions WHERE company_id=? AND finding_id IS NOT NULL", W.A.coId).c, 2, "source associations retained"); assert.equal(W.T.DB.one("SELECT count(*) c FROM findings WHERE kind='question' AND review_status IN ('approved','edited')").c, 2, "both findings still approved/edited");
  W.T.restore();
});
t("an ASKED question is never dropped or reset: the duplicate open one is dropped instead", async () => {
  const W = await world("Which bays would LED cover?", "What is your energy tariff?"); let a = await acct(W); const qA = a.questions.find((q) => q.text === "Which bays would LED cover?"); assert.equal((await W.T.post(W.s, `/api/questions/${qA.id}`, { status: "asked" })).status, 200);
  await edit(W, W.qf.B, "Which bays would LED cover?"); a = await acct(W); const same = a.questions.filter((q) => q.text === "Which bays would LED cover?"); assert.equal(same.filter((q) => q.status === "asked").length, 1); assert.equal(same.filter((q) => ["open", "proposed"].includes(q.status)).length, 0); W.T.restore();
});
t("reject / edit / re-approve across runs: duplicates collapse and separate again; a rejected finding's question stays dropped (rejection is terminal)", async () => {
  const W = await world("Which bays would LED cover?", "What is your energy tariff?"); await acct(W);
  await edit(W, W.qf.B, "Which bays would LED cover?"); let a = await acct(W); assert.equal(active(a).length, 1);
  assert.equal((await W.T.post(W.s, `/api/findings/${W.qf.B.id}/review`, { action: "approve" })).status, 200); a = await acct(W); assert.equal(active(a).length, 2, "re-approving B restores its ORIGINAL text; the system-dropped row comes back: " + JSON.stringify(a.questions));
  await edit(W, W.qf.B, "which BAYS would led cover?  "); a = await acct(W); assert.equal(active(a).filter((q) => /bays/i.test(q.text)).length, 1, "normalised (case/space) duplicates collapse");
  assert.equal((await W.T.post(W.s, `/api/findings/${W.qf.B.id}/review`, { action: "reject", note: "no" })).status, 200); a = await acct(W); assert.equal(active(a).length, 1); assert.equal(active(a)[0].text, "Which bays would LED cover?"); W.T.restore();
});
t("SUPERSEDING: an older run's question that duplicates a newer run's stays ONE active question; editing the survivor away re-activates the other", async () => {
  const W = await world("Which bays would LED cover?", "What is your energy tariff?"); await edit(W, W.qf.A, "What is your energy tariff?"); let a = await acct(W); assert.equal(active(a).length, 1, JSON.stringify(a.questions));
  await edit(W, W.qf.B, "Who decides on lighting?"); a = await acct(W); assert.deepEqual(active(a).map((q) => q.text).sort(), ["What is your energy tariff?", "Who decides on lighting?"]); W.T.restore();
});
t("a question the USER dropped stays dropped through edit / re-approve cycles (human decision wins over system revival)", async () => {
  const W = await world("Which bays would LED cover?", "What is your energy tariff?"); let a = await acct(W); const qB = a.questions.find((q) => q.text === "What is your energy tariff?"); assert.equal((await W.T.post(W.s, `/api/questions/${qB.id}`, { status: "dropped" })).status, 200);
  await edit(W, W.qf.B, "Something else?"); await W.T.post(W.s, `/api/findings/${W.qf.B.id}/review`, { action: "approve" }); a = await acct(W); assert.equal(a.questions.find((q) => q.id === qB.id).status, "dropped"); W.T.restore();
});
t("CONSISTENCY: the CRM payload's question list equals the account's active derived questions (same policy, same dedupe) after edits and a sync", async () => {
  const W = await world("Which bays would LED cover?", "What is your energy tariff?"); await edit(W, W.qf.B, "Which bays would LED cover?"); const a = await acct(W); assert.equal((await W.T.post(W.s, `/api/runs/${W.B.runId}/sync`, {})).status, 200);
  assert.deepEqual(payloadQs(W).sort(), active(a).map((q) => q.text).sort()); assert.equal(payloadQs(W).length, 1); W.T.restore();
});
t("human-origin question with the same text wins over a derived duplicate", async () => {
  const W = await world("Which bays would LED cover?", "What is your energy tariff?"); assert.equal((await W.T.post(W.s, `/api/accounts/${W.A.coId}/questions`, { text: "What is your energy tariff?" })).status, 201); const a = await acct(W);
  const same = a.questions.filter((q) => q.text === "What is your energy tariff?" && q.status === "open"); assert.equal(same.length, 1); assert.equal(same[0].origin, "human"); W.T.restore();
});
await done();
