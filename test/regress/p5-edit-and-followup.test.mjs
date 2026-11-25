// Phase 5 founder-workflow regressions, run against the REAL Worker code (in-process; in-memory D1, FAKE HubSpot, FAKE AI - fixture, not live).
import assert from "node:assert";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("Phase 5: correcting findings and following up");
const SRC = "ZZ-V2 Fenland Salads Ltd grows cucumbers in four hectares of glasshouse near Ely, Cambridgeshire. In 2024 the company installed supplementary LED lighting in its newest bay to extend the winter season.";
const mk = async () => { const app = await makeApp(); const s = await app.login(); app.AI.extract = () => ({ business_name: "ZZ-V2 Fenland Salads Ltd", crop_value: "cucumbers", crop_quote: "grows cucumbers", lighting_status: "Yes", lighting_quote: "installed supplementary LED lighting in its newest bay", future_plans: "Unknown", future_quote: "", unknown_information: ["hours"], discovery_questions: ["q?"] });
  const r = await app.post(s, "/api/research", { businessName: "ZZ-V2 Fenland Salads Ltd", sourceId: "fixture://usability-A", sourceText: SRC, force: true }); return { app, s, r, f: (k) => r.j.findings.find((x) => x.kind === k) }; };

t("correcting cucumbers→tomatoes WITHOUT a basis is refused with a clear reason; WITH a basis it persists across reload, the AI original is preserved and the edit is never shown as source-verified", async () => {
  const { app, s, r, f } = await mk(); try {
    const bad = await app.post(s, `/api/findings/${f("crop").id}/review`, { action: "edit", value: "tomatoes" }); assert.equal(bad.status, 409); assert.match(bad.j.error, /basis is required/);
    const ok = await app.post(s, `/api/findings/${f("crop").id}/review`, { action: "edit", value: "tomatoes", note: "Grower told us by phone" }); assert.equal(ok.status, 200); assert.equal(ok.j.review_status, "edited"); assert.equal(ok.j.final_value, "tomatoes"); assert.equal(ok.j.ai_value, "cucumbers");
    const re = (await app.get(s, `/api/runs/${r.j.run.id}`)).j.findings.find((x) => x.kind === "crop"); assert.equal(re.final_value, "tomatoes"); assert.equal(re.note, "Grower told us by phone"); assert.equal(re.ai_value, "cucumbers");
    for (const k of ["lighting", "future"]) assert.equal((await app.post(s, `/api/findings/${f(k).id}/review`, { action: "approve" })).status, 200);
    assert.equal((await app.post(s, `/api/runs/${r.j.run.id}/sync`)).status, 200);
    const acc = (await app.get(s, `/api/accounts/${r.j.company.id}`)).j; assert.equal(acc.summary.crop.value, "tomatoes"); assert.equal(acc.summary.crop.state, "Human-edited"); assert.equal(acc.summary.crop.quote_verified, false, "a human correction must not carry the old quote as verification"); assert.equal(acc.summary.crop.quote, ""); assert.equal(acc.summary.crop.original_ai_value, "cucumbers"); assert.equal(acc.summary.crop.basis, "Grower told us by phone");
    assert.match([...app.hs.companies.values()][0].properties.description, /tomatoes \(human-edited\)/); } finally { app.restore(); } });
t("an UNEDITED approved finding still carries its verified quote (the fix does not hide real evidence)", async () => {
  const { app, s, r, f } = await mk(); try { await app.post(s, `/api/findings/${f("crop").id}/review`, { action: "approve" }); const acc = (await app.get(s, `/api/accounts/${r.j.company.id}`)).j; assert.equal(acc.summary.crop.quote_verified, true); assert.equal(acc.summary.crop.state, "Verified public"); } finally { app.restore(); } });
t("follow-up journey: research alone creates NO HubSpot record; a task before sync is refused; after sync it is created, associated with the right company, completed; the account exposes latest_run_id for the 'go sync' link", async () => {
  const { app, s, r, f } = await mk(); try {
    assert.equal(app.hs.companies.size, 0, "researching must not write to HubSpot"); const acc0 = (await app.get(s, `/api/accounts/${r.j.company.id}`)).j; assert.equal(acc0.latest_run_id, r.j.run.id); assert.ok(!acc0.company.hubspot_id);
    const pre = await app.post(s, `/api/accounts/${r.j.company.id}/tasks`, { request_id: "00000000-0000-4000-8000-0000000000a1", subject: "Call", owner: "Founder", due_on: "2099-01-01" }); assert.ok(pre.status >= 400 && pre.status < 500, `task before sync must be refused, got ${pre.status}`); assert.equal(app.hs.tasks.size, 0);
    for (const k of ["crop", "lighting", "future"]) await app.post(s, `/api/findings/${f(k).id}/review`, { action: "approve" }); await app.post(s, `/api/runs/${r.j.run.id}/sync`);
    const mkT = await app.post(s, `/api/accounts/${r.j.company.id}/tasks`, { request_id: "00000000-0000-4000-8000-0000000000a2", subject: "Ask about other bays", owner: "Founder", due_on: "2099-01-01" }); assert.ok([200, 201].includes(mkT.status), JSON.stringify(mkT.j).slice(0, 200)); assert.equal(app.hs.tasks.size, 1);
    const hsCo = [...app.hs.companies.keys()][0], assoc = [...app.hs.assoc.values()].flat(); assert.ok(JSON.stringify([...app.hs.assoc.entries()]).includes(String(hsCo)), "task is associated with the synced company");
    const acc = (await app.get(s, `/api/accounts/${r.j.company.id}`)).j; assert.equal(acc.tasks.length, 1); assert.equal(acc.tasks[0].op_state, "created");
    const done = await app.post(s, `/api/tasks/${acc.tasks[0].id}/complete`, { request_id: "00000000-0000-4000-8000-0000000000a3", outcome: "Spoke to grower" }); assert.equal(done.status, 200, JSON.stringify(done.j)); } finally { app.restore(); } });
await done();
