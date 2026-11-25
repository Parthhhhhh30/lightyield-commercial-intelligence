// SIXTH REVIEW, finding C: an ASKED question must survive as history while the CURRENT approved question materialises after the source finding is edited
// (finding_id is UNIQUE); and question de-duplication must use ONE canonical normalisation (case + trim + internal whitespace) everywhere.
import assert from "node:assert";
import { pathToFileURL } from "node:url";
import { makeApp, ROOT } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("C4 question history + canonical normalisation");
const logic = await import(pathToFileURL(`${ROOT}/src/logic.js`).href + "?c4=" + Math.random());
async function world() { const T = await makeApp(), s = await T.login(1001); const base = T.AI.extract; T.AI.extract = (a) => ({ ...base(a), discovery_questions: ["Which bays would LED cover?"] }); const A = await T.research(s, "ZZ History Ltd");
  const f = (await T.get(s, `/api/runs/${A.runId}`)).j.findings.find((x) => x.kind === "question"); assert.equal((await T.post(s, `/api/findings/${f.id}/review`, { action: "approve" })).status, 200); return { T, s, A, f }; }
const acct = async (W) => (await W.T.get(W.s, `/api/accounts/${W.A.coId}`)).j;
t("REPRODUCES CODEX C: approve → mark ASKED → edit the source finding to a different current question: the asked question is kept as history AND the new question appears", async () => {
  const W = await world(); let a = await acct(W); const q1 = a.questions.find((q) => q.text === "Which bays would LED cover?"); assert.equal((await W.T.post(W.s, `/api/questions/${q1.id}`, { status: "asked" })).status, 200);
  assert.equal((await W.T.post(W.s, `/api/findings/${W.f.id}/review`, { action: "edit", value: "What is your canopy area?", note: "better question" })).status, 200); a = await acct(W);
  assert.equal(a.questions.find((q) => q.id === q1.id).status, "asked", "asked history preserved"); assert.equal(a.questions.find((q) => q.id === q1.id).text, "Which bays would LED cover?", "history text unchanged");
  const cur = a.questions.filter((q) => q.text === "What is your canopy area?" && ["open", "proposed"].includes(q.status)); assert.equal(cur.length, 1, "the CURRENT approved question must materialise: " + JSON.stringify(a.questions));
  assert.ok(W.T.DB.one("SELECT count(*) c FROM events WHERE entity='question' AND entity_id=? AND action='detached_from_finding'", q1.id).c >= 1, "the detachment is recorded (association evidence)"); W.T.restore();
});
t("a question the USER dropped, whose finding is later edited to a different question, also yields the new current question (and the dropped one stays dropped)", async () => {
  const W = await world(); let a = await acct(W); const q1 = a.questions[0]; await W.T.post(W.s, `/api/questions/${q1.id}`, { status: "dropped" });
  await W.T.post(W.s, `/api/findings/${W.f.id}/review`, { action: "edit", value: "Who decides on lighting?", note: "n" }); a = await acct(W); assert.equal(a.questions.find((q) => q.id === q1.id).status, "dropped"); assert.equal(a.questions.filter((q) => q.text === "Who decides on lighting?" && q.status === "open").length, 1); W.T.restore();
});
t("canonical normalisation: ONE exported function (case, edges, INTERNAL whitespace, unicode spaces) used for question de-dup and evidence reconciliation", async () => {
  assert.equal(typeof logic.normText, "function"); const n = logic.normText; assert.equal(n("  Which   bays\twould  LED\u00a0cover? "), n("which bays would led cover?")); assert.notEqual(n("a b"), n("ab"));
  const W = await world(); await W.T.post(W.s, `/api/accounts/${W.A.coId}/questions`, { text: "which   BAYS would led   cover?" }); const a = await acct(W); const active = a.questions.filter((q) => ["open", "proposed", "asked"].includes(q.status) && logic.normText(q.text) === n("Which bays would LED cover?")); assert.equal(active.length, 1, JSON.stringify(a.questions));
  const sel = logic.selectEvidence([{ id: "1", kind: "question", review_status: "approved", final_value: "Which   bays?", run_id: "r1" }, { id: "2", kind: "question", review_status: "approved", final_value: "which bays?", run_id: "r2" }]); assert.equal(sel.questions.length, 1, "evidence union uses the same normalisation"); W.T.restore();
});
await done();
