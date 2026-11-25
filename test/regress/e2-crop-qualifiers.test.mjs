// FINAL REMEDIATION E: crop claims need FULL support tied to the right subject. Unsupported/ambiguous → Unknown (review required). Both false
// positives (unsupported accepted) and false negatives (ordinary supported statements rejected) are tested. Deterministic text rules only.
import assert from "node:assert";
import { pathToFileURL } from "node:url";
import { ROOT } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { buildFindings } = await import(pathToFileURL(`${ROOT}/src/logic.js`).href + "?e=" + Math.random());
const { t, done } = suite("E2 crop subject + qualifier support");
const ai = (crop, quote) => ({ business_name: "Acme Glass", crop_value: crop, crop_quote: quote, lighting_status: "Unknown", lighting_quote: "", future_plans: "Unknown", future_quote: "", unknown_information: [], discovery_questions: [] });
const crop = (c, quote, source, name = "Acme Glass") => buildFindings(ai(c, quote), source, name).findings.find((f) => f.kind === "crop");
const accepted = (f) => f.value !== "Unknown" && !f.flags.some((x) => !["quote_recovered_from_source", "semantic_check_passed"].includes(x));


// FOURTH REVIEW, finding E: subject matching must not depend on capitalisation, and every material qualifier of the claimed value must be supported.
t("CODEX E (lowercase names): a differently named company written in lowercase is never attributed to the target ('acme foods' ≠ 'Acme Glass')", () => {
  for (const [q, src] of [["acme foods grows peppers", "acme foods grows peppers in kent."], ["The acme foods company grows peppers", "The acme foods company grows peppers in kent."], ["acme glass grows tomatoes and rival ltd grows peppers", "acme glass grows tomatoes and rival ltd grows peppers near ely."], ["Acme Glass grows tomatoes and rival ltd grows peppers", "Acme Glass grows tomatoes and rival ltd grows peppers."]]) {
    const f = crop(q.includes("peppers") ? "peppers" : "tomatoes", q, src); assert.equal(f.value, "Unknown", `${q} → ${JSON.stringify(f)}`); }
});
t("lowercase / uppercase / location-prefixed statements about the TARGET are accepted (no false negative from capitalisation)", () => {
  for (const [q, src] of [["acme glass grows tomatoes", "acme glass grows tomatoes."], ["ACME GLASS grows tomatoes", "ACME GLASS GROWS TOMATOES."], ["In Ely, Acme Glass grows tomatoes", "In Ely, Acme Glass grows tomatoes."], ["acme glass ltd grows tomatoes", "acme glass ltd grows tomatoes."]]) assert.equal(crop("tomatoes", q, src).value, "tomatoes", q);
});
t("CODEX E (qualifier): a source supporting 'tomatoes' is NOT evidence for 'organic tomatoes' (every material word of the claim must be supported)", () => {
  for (const [v, q, src] of [["organic tomatoes", "Acme Glass grows tomatoes", "Acme Glass grows tomatoes in glasshouses."], ["cherry tomatoes", "Acme Glass grows tomatoes", "Acme Glass grows tomatoes. Rival Ltd grows cherry tomatoes."], ["organic tomatoes", "Acme Glass grows tomatoes", "Acme Glass grows tomatoes. Its organic tomatoes are not mentioned"], ["organic tomatoes and peppers", "Acme Glass grows tomatoes and peppers", "Acme Glass grows tomatoes and peppers."]]) { const f = crop(v, q, src); assert.equal(f.value, "Unknown", `${v} / ${q} → ${JSON.stringify(f)}`); }
});
t("a claim whose every word is supported is accepted; a LESS specific claim than the source is accepted; checker-recovered quotes must support the qualifier too", () => {
  assert.equal(crop("organic tomatoes", "Acme Glass grows organic tomatoes", "Acme Glass grows organic tomatoes.").value, "organic tomatoes");
  assert.equal(crop("tomatoes", "Acme Glass grows organic tomatoes", "Acme Glass grows organic tomatoes.").value, "tomatoes");
  assert.equal(crop("organic tomatoes", "", "Acme Glass grows organic tomatoes in Kent.").value, "organic tomatoes"); assert.equal(crop("organic tomatoes", "", "Acme Glass grows tomatoes in Kent.").value, "Unknown");
});
await done();
