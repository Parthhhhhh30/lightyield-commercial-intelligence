// FOURTH REVIEW, finding C: ONE deterministic evidence-selection policy for the account's current commercial facts, applied identically to the account summary,
// the CRM payload, staleness/revision tracking, verification and derived questions. Policy (docs/EVIDENCE_POLICY.md):
//  * candidates = approved/edited findings of ANY run of the account; "Unknown" never supersedes a known value (absence of evidence)
//  * winner per kind = candidate from the NEWEST run (ties: latest review). A differently-valued OLDER-run candidate reviewed BEFORE the winner is "superseded" (history);
//    reviewed AFTER the winner is an UNRESOLVED CONFLICT: exposed, sync refused, never reported as current.
import assert from "node:assert";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("C2 account evidence-selection policy");
const crop = (T, name) => { T.AI.extract = ({ name: n }) => ({ business_name: n, crop_value: name, crop_quote: `grows ${name}`, lighting_status: "Unknown", lighting_quote: "", future_plans: "Unknown", future_quote: "", unknown_information: [], discovery_questions: [] }); };
const src = (n, c) => `${n} grows ${c} in glasshouses near Ely. The company website does not state whether supplementary LED lighting is installed.`;
async function twoRuns(T, s) { crop(T, "tomatoes"); const A = await T.research(s, "ZZ Policy Ltd"); crop(T, "peppers"); const B = await T.research(s, "ZZ Policy Ltd", { source: src("ZZ Policy Ltd", "peppers") }); return { A, B }; }
const acct = async (T, s, id) => (await T.get(s, `/api/accounts/${id}`)).j;
const hsDesc = (T, id) => [...T.hs.companies.values()].find((c) => (c.properties.description || "").includes(`[LY-CO:${id}]`))?.properties.description || "";
const cropLine = (d) => (d.match(/^Crop: (.*?)( \(human-edited\))?$/m) || [])[1];
const editOld = async (T, s, run, value) => { const f = (await T.get(s, `/api/runs/${run.runId}`)).j.findings.find((x) => x.kind === "crop"); const r = await T.post(s, `/api/findings/${f.id}/review`, { action: "edit", value, note: "later human edit of the OLDER run's finding" }); assert.equal(r.status, 200, JSON.stringify(r.j)); return f; };

t("REPRODUCES CODEX C (exact counterexample): newer run approves peppers, older retained finding later edited to cucumbers → summary, HubSpot payload and sync state must AGREE or expose the conflict", async () => {
  const T = await makeApp(), s = await T.login(1001); const { A, B } = await twoRuns(T, s); assert.equal((await T.post(s, `/api/runs/${B.runId}/sync`, {})).status, 200); assert.equal(cropLine(hsDesc(T, B.coId)), "peppers");
  await editOld(T, s, A, "cucumbers"); const r = await T.post(s, `/api/runs/${B.runId}/sync`, {}); const a = await acct(T, s, B.coId); const hs = cropLine(hsDesc(T, B.coId));
  const consistent = a.summary.crop.value === hs; const exposed = a.company.sync_stale === true && (a.summary.crop.unresolved || []).length >= 1 && r.status === 409;
  assert.ok(consistent || exposed, `summary says "${a.summary.crop.value}", HubSpot says "${hs}", sync answered ${r.status}, stale=${a.company.sync_stale}: silently inconsistent`);
  T.restore();
});
t("policy: the newest run's approved value wins; a later edit of an OLDER run's finding is an UNRESOLVED CONFLICT (exposed on the account, sync refused with details, HubSpot untouched, never 'current')", async () => {
  const T = await makeApp(), s = await T.login(1001); const { A, B } = await twoRuns(T, s); await T.post(s, `/api/runs/${B.runId}/sync`, {}); const old = await editOld(T, s, A, "cucumbers");
  const a = await acct(T, s, B.coId); assert.equal(a.summary.crop.value, "peppers", "the winner stays the newest run's value"); assert.equal(a.summary.crop.unresolved.length, 1); assert.equal(a.summary.crop.unresolved[0].value, "cucumbers"); assert.equal(a.summary.crop.unresolved[0].finding_id, old.id);
  assert.equal(a.company.sync_stale, true); assert.ok(a.company.evidence_conflicts.length >= 1); const r = await T.post(s, `/api/runs/${B.runId}/sync`, {}); assert.equal(r.status, 409); assert.equal(r.j.evidence_conflict, true); assert.equal(r.j.conflicts[0].kind, "crop"); assert.equal(cropLine(hsDesc(T, B.coId)), "peppers", "HubSpot unchanged");
  const v = await T.get(s, `/api/runs/${B.runId}/verify`); assert.equal(v.j.verified, false); assert.ok(v.j.evidence_conflicts.length >= 1); T.restore();
});
t("resolution: rejecting the contradicting older finding (or re-approving the newer one later) clears the conflict; then summary == payload == verification, and the account is current", async () => {
  const T = await makeApp(), s = await T.login(1001); const { A, B } = await twoRuns(T, s); await T.post(s, `/api/runs/${B.runId}/sync`, {}); const old = await editOld(T, s, A, "cucumbers");
  assert.equal((await T.post(s, `/api/findings/${old.id}/review`, { action: "reject", note: "superseded by the newer run" })).status, 200); assert.equal((await T.post(s, `/api/runs/${B.runId}/sync`, {})).status, 200);
  const a = await acct(T, s, B.coId); assert.equal(a.company.sync_stale, false); assert.equal(a.summary.crop.value, cropLine(hsDesc(T, B.coId))); assert.equal(a.summary.crop.value, "peppers"); const v = await T.get(s, `/api/runs/${B.runId}/verify`); assert.equal(v.j.verified, true, JSON.stringify(v.j)); T.restore();
});
t("an OLDER run's differing value reviewed BEFORE the winner is merely superseded (history, no conflict); summary lists it separately", async () => {
  const T = await makeApp(), s = await T.login(1001); const { B } = await twoRuns(T, s); const a = await acct(T, s, B.coId); assert.equal(a.summary.crop.value, "peppers"); assert.equal((a.summary.crop.unresolved || []).length, 0); assert.ok(a.summary.crop.superseded.some((x) => x.value === "tomatoes"));
  assert.equal(a.public_evidence.filter((e) => e.kind === "crop").length, 2, "historical evidence stays separately inspectable"); T.restore();
});
t("syncing from ANY run of the account pushes the SAME account selection (no regression of HubSpot to older evidence)", async () => {
  const T = await makeApp(), s = await T.login(1001); const { A, B } = await twoRuns(T, s); assert.equal((await T.post(s, `/api/runs/${A.runId}/sync`, {})).status, 200); assert.equal(cropLine(hsDesc(T, A.coId)), "peppers"); assert.equal((await acct(T, s, A.coId)).company.sync_stale, false);
  assert.equal((await T.post(s, `/api/runs/${B.runId}/sync`, {})).status, 200); assert.equal(cropLine(hsDesc(T, A.coId)), "peppers"); T.restore();
});
t("an approved 'Unknown' in a newer run does not erase a known approved value from an older run (absence of evidence is not contradiction)", async () => {
  const T = await makeApp(), s = await T.login(1001); crop(T, "tomatoes"); const A = await T.research(s, "ZZ Unknown Ltd"); crop(T, "Unknown"); const B = await T.research(s, "ZZ Unknown Ltd", { source: "ZZ Unknown Ltd is a glasshouse business near Ely. Nothing is stated about its crop." });
  const a = await acct(T, s, A.coId); assert.equal(a.summary.crop.value, "tomatoes"); await T.post(s, `/api/runs/${B.runId}/sync`, {}); assert.equal(cropLine(hsDesc(T, A.coId)), "tomatoes"); T.restore();
});
t("INVARIANT over operation sequences: whenever there is no unresolved conflict, summary crop/lighting/future == the values in the CRM payload == what verify checks", async () => {
  const T = await makeApp(), s = await T.login(1001); const { A, B } = await twoRuns(T, s); const steps = [async () => editOld(T, s, A, "cucumbers"), async () => { const f = (await T.get(s, `/api/runs/${B.runId}`)).j.findings.find((x) => x.kind === "crop"); await T.post(s, `/api/findings/${f.id}/review`, { action: "edit", value: "chillies", note: "newer edit" }); }, async () => { const f = (await T.get(s, `/api/runs/${A.runId}`)).j.findings.find((x) => x.kind === "crop"); await T.post(s, `/api/findings/${f.id}/review`, { action: "reject", note: "x" }); }];
  for (const step of steps) { await step(); const a = await acct(T, s, B.coId); const r = await T.post(s, `/api/runs/${B.runId}/sync`, {}); if ((a.summary.crop.unresolved || []).length) { assert.equal(r.status, 409); continue; } assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(cropLine(hsDesc(T, B.coId)), (await acct(T, s, B.coId)).summary.crop.value); const v = await T.get(s, `/api/runs/${B.runId}/verify`); assert.equal(v.j.verified, true, JSON.stringify(v.j)); }
  T.restore();
});
t("derived discovery questions follow the same selection: an identical approved question from two runs yields ONE open question; both source findings stay inspectable", async () => {
  const T = await makeApp(), s = await T.login(1001); const base = T.AI.extract; T.AI.extract = (a) => ({ ...base(a), discovery_questions: ["Which bays would LED cover?"] }); const A = await T.research(s, "ZZ Q Ltd"), B = await T.research(s, "ZZ Q Ltd", { source: src("ZZ Q Ltd", "tomatoes") + " Second look." });
  for (const R of [A, B]) for (const f of (await T.get(s, `/api/runs/${R.runId}`)).j.findings.filter((x) => x.kind === "question")) assert.equal((await T.post(s, `/api/findings/${f.id}/review`, { action: "approve" })).status, 200);
  const a = await acct(T, s, A.coId); assert.equal(a.questions.filter((q) => q.text === "Which bays would LED cover?").length, 1, JSON.stringify(a.questions)); assert.equal(T.DB.one("SELECT count(*) c FROM findings WHERE kind='question' AND review_status='approved' AND final_value='Which bays would LED cover?'").c, 2, "both source findings retained"); T.restore();
});
await done();
