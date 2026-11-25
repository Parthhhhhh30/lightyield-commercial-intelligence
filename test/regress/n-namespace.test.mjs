// Synthetic v2 shares the HubSpot DEVELOPER_TEST portal with v1 ONLY if record namespaces are strictly separated: names must carry RECORD_PREFIX and identity resolution
// must not see (adopt, link or be confused by) records outside the prefix.
import assert from "node:assert";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("N record namespace isolation");
const PFX = "ZZ-V2 ";
t("names outside the namespace are refused (400); names inside work", async () => {
  const T = await makeApp({ env: { RECORD_PREFIX: PFX } }), s = await T.login(1001); const bad = await T.post(s, "/api/research", { businessName: "Plain Name Ltd", sourceId: "s", sourceText: "Plain Name Ltd grows tomatoes in Norfolk glasshouses.", force: true }); assert.equal(bad.status, 400); assert.match(bad.j.error, /namespace/);
  const ok = await T.research(s, PFX + "Acme"); assert.equal(ok.status, 200); T.restore();
});
t("a v1-style HubSpot record with the SAME domain or a lookalike name is invisible to a v2 sync: v2 creates its own record and never adopts/modifies the other", async () => {
  const T = await makeApp({ env: { RECORD_PREFIX: PFX } }), s = await T.login(1001); const foreign = T.hs.addCompany({ name: "Acme", domain: "acme.synthetic.example", description: "V1 RECORD - must stay untouched" });
  const a = await T.research(s, PFX + "Acme", { domain: "acme.synthetic.example" }); const r = await T.post(s, `/api/runs/${a.runId}/sync`, {}); assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(T.hs.companies.get(foreign).properties.description, "V1 RECORD - must stay untouched"); assert.notEqual(T.DB.one("SELECT hubspot_id h FROM companies WHERE id=?", a.coId).h, foreign); assert.equal(T.hs.companies.size, 2); T.restore();
});
t("without RECORD_PREFIX behaviour is unchanged (v1 / local): same-domain different-name records still surface as an identity decision", async () => {
  const T = await makeApp(), s = await T.login(1001); T.hs.addCompany({ name: "ZZ Holdings Ltd", domain: "hold.synthetic.example" }); const a = await T.research(s, "ZZ Trading Name", { domain: "hold.synthetic.example" }); const r = await T.post(s, `/api/runs/${a.runId}/sync`, {}); assert.equal(r.status, 409); assert.equal(r.j.needs_identity, true); T.restore();
});
await done();
