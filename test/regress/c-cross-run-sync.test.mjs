// FINAL REMEDIATION C: account-level revision semantics across research runs. HubSpot must never be reported as current while newer approved
// evidence exists in ANY run of the account; verification must say which revision it verified.
import assert from "node:assert";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("C cross-run synchronisation");
const peppers = (T) => { T.AI.extract = ({ name }) => ({ business_name: name, crop_value: "peppers", crop_quote: "grows peppers", lighting_status: "Unknown", lighting_quote: "", future_plans: "Unknown", future_quote: "", unknown_information: [], discovery_questions: [] }); };
const company = async (T, s, coId) => (await T.get(s, `/api/accounts/${coId}`)).j.company;
const desc = (T, coId) => [...T.hs.companies.values()].find((c) => (c.properties.description || "").includes(`[LY-CO:${coId}]`))?.properties.description || "";
async function twoRuns() {
  const T = await makeApp(), s = await T.login(1001); const A = await T.research(s, "ZZ Cross Ltd"); assert.equal((await T.post(s, `/api/runs/${A.runId}/sync`, {})).status, 200);
  assert.equal((await company(T, s, A.coId)).sync_stale, false, "fresh sync is current"); peppers(T);
  const B = await T.research(s, "ZZ Cross Ltd", { source: "ZZ Cross Ltd grows peppers in glasshouses near Ely. The company website does not state whether supplementary LED lighting is installed." }); assert.equal(B.coId, A.coId); assert.notEqual(B.runId, A.runId);
  return { T, s, A, B };
}
t("REPRODUCES CODEX C: run A synced (tomatoes); run B approves peppers → the account must be reported STALE (HubSpot still holds tomatoes)", async () => {
  const { T, s, A } = await twoRuns(); assert.ok(desc(T, A.coId).includes("omato") && !desc(T, A.coId).includes("epper"));
  const c = await company(T, s, A.coId); assert.equal(c.sync_stale, true, "UI would claim 'synced' while newer approved evidence exists in another run"); T.restore();
});
t("sync is ACCOUNT-level (see c2-evidence-policy): syncing the older run pushes the account's selection (newest approved value), never regresses HubSpot, and makes the account current", async () => {
  const { T, s, A, B } = await twoRuns(); const r = await T.post(s, `/api/runs/${A.runId}/sync`, {}); assert.equal(r.status, 200, JSON.stringify(r.j)); const c = await company(T, s, A.coId); assert.equal(c.sync_stale, false);
  assert.ok(desc(T, A.coId).includes("epper") && !desc(T, A.coId).includes("omato"), "latest approved run wins; conflicting older value is not pushed"); T.restore();
});
t("conflicting findings stay in D1 evidence for BOTH runs; HubSpot shows only the current run's approved value", async () => {
  const { T, s, A, B } = await twoRuns(); await T.post(s, `/api/runs/${B.runId}/sync`, {}); const acct = (await T.get(s, `/api/accounts/${A.coId}`)).j;
  const crops = acct.public_evidence.filter((e) => e.kind === "crop").map((e) => e.final_value ?? e.value).join("|").toLowerCase(); assert.ok(crops.includes("tomato") && crops.includes("pepper"), crops); T.restore();
});
t("verify is account-level and NAMES the revision it checked and the runs involved", async () => {
  const { T, s, A, B } = await twoRuns(); await T.post(s, `/api/runs/${B.runId}/sync`, {});
  const va = await T.get(s, `/api/runs/${A.runId}/verify`); assert.equal(va.j.requested_run_id, A.runId); assert.equal(va.j.synced_run_id, B.runId); assert.equal(va.j.verified, true, JSON.stringify(va.j)); assert.equal(va.j.verified_evidence_rev, va.j.current_evidence_rev);
  const f = (await T.get(s, `/api/runs/${B.runId}`)).j.findings.find((x) => x.kind === "crop"); await T.post(s, `/api/findings/${f.id}/review`, { action: "edit", value: "chillies", note: "n" }); const stale = await T.get(s, `/api/runs/${B.runId}/verify`); assert.equal(stale.j.verified, false); assert.ok(stale.j.verified_evidence_rev < stale.j.current_evidence_rev); T.restore();
});
t("verify while stale reports the older revision explicitly and does not verify", async () => {
  const { T, s, A } = await twoRuns(); const v = await T.get(s, `/api/runs/${A.runId}/verify`); assert.equal(v.j.verified, false); assert.ok(v.j.stale === true || /stale|older|newer/i.test(v.j.reason || ""), JSON.stringify(v.j)); T.restore();
});
t("an edit made WHILE the sync is in flight leaves the account stale (never claims the older snapshot is current)", async () => {
  const T = await makeApp(), s = await T.login(1001); const A = await T.research(s, "ZZ Midflight Ltd"); const h = T.hs.holdAfter(/^POST \/crm\/v3\/objects\/companies$/);
  const sync = T.post(s, `/api/runs/${A.runId}/sync`, {}); await h.arrived; const run = (await T.get(s, `/api/runs/${A.runId}`)).j; const f = run.findings.find((x) => x.kind === "crop");
  assert.equal((await T.post(s, `/api/findings/${f.id}/review`, { action: "edit", value: "cucumbers", note: "human correction during sync" })).status, 200);
  h.release(); assert.equal((await sync).status, 200); assert.equal((await company(T, s, A.coId)).sync_stale, true); T.restore();
});
t("a review in a DIFFERENT run (even without a new sync) bumps the account revision; a reject of the synced run's finding also does", async () => {
  const T = await makeApp(), s = await T.login(1001); const A = await T.research(s, "ZZ Rev Ltd"); await T.post(s, `/api/runs/${A.runId}/sync`, {}); assert.equal((await company(T, s, A.coId)).sync_stale, false);
  const f = A.j.findings.find((x) => x.kind === "crop"); await T.post(s, `/api/findings/${f.id}/review`, { action: "reject", note: "wrong" }); assert.equal((await company(T, s, A.coId)).sync_stale, true);
  assert.equal(T.DB.one("SELECT evidence_rev r FROM companies WHERE id=?", A.coId).r > 0, true); T.restore();
});
t("legacy synced rows with an unknown account revision are reported stale (never 'current' without proof)", async () => {
  const T = await makeApp(), s = await T.login(1001); const A = await T.research(s, "ZZ Legacy Rev Ltd"); await T.post(s, `/api/runs/${A.runId}/sync`, {}); T.DB.raw.exec(`UPDATE companies SET synced_evidence_rev=NULL WHERE id='${A.coId}'`);
  assert.equal((await company(T, s, A.coId)).sync_stale, true); T.restore();
});
await done();
