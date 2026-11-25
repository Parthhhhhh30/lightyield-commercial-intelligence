// FINAL REMEDIATION E: crop claims need FULL support tied to the right subject. Unsupported/ambiguous → Unknown (review required). Both false
// positives (unsupported accepted) and false negatives (ordinary supported statements rejected) are tested. Deterministic text rules only.
import assert from "node:assert";
import { pathToFileURL } from "node:url";
import { ROOT } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { buildFindings } = await import(pathToFileURL(`${ROOT}/src/logic.js`).href + "?e=" + Math.random());
const { t, done } = suite("E3 crop identity + meaning-changing modifiers");
const ai = (crop, quote) => ({ business_name: "Acme Glass", crop_value: crop, crop_quote: quote, lighting_status: "Unknown", lighting_quote: "", future_plans: "Unknown", future_quote: "", unknown_information: [], discovery_questions: [] });
const crop = (c, quote, source, name = "Acme Glass") => buildFindings(ai(c, quote), source, name).findings.find((f) => f.kind === "crop");
const accepted = (f) => f.value !== "Unknown" && !f.flags.some((x) => !["quote_recovered_from_source", "semantic_check_passed"].includes(x));


// FIFTH REVIEW, finding E.
t("CODEX E (identity): a DIFFERENT specific company that shares a word with the target and a generic noun ('acme farm', 'the acme nursery') is not the target", () => {
  for (const [q, src] of [["acme farm grows peppers", "acme farm grows peppers."], ["Acme Farm Ltd grows peppers", "Acme Farm Ltd grows peppers."], ["the acme nursery grows peppers", "The acme nursery grows peppers in Kent."], ["Acme Glass Farm grows peppers", "Acme Glass Farm grows peppers."], ["Acme Glass grows tomatoes and acme farm grows peppers", "Acme Glass grows tomatoes and acme farm grows peppers."]]) { const f = crop("peppers", q, src); assert.equal(f.value, "Unknown", `${q} → ${JSON.stringify(f)}`); }
});
t("CODEX E (modifier): 'non-organic tomatoes' is NOT supported by 'organic tomatoes' (and vice versa); short meaning-changing words are not dropped", () => {
  for (const [v, q, src] of [["non-organic tomatoes", "Acme Glass grows organic tomatoes", "Acme Glass grows organic tomatoes."], ["organic tomatoes", "Acme Glass grows non-organic tomatoes", "Acme Glass grows non-organic tomatoes."], ["non organic tomatoes", "Acme Glass grows organic tomatoes", "Acme Glass grows organic tomatoes."], ["low-carbon tomatoes", "Acme Glass grows tomatoes", "Acme Glass grows tomatoes."], ["GM tomatoes", "Acme Glass grows tomatoes", "Acme Glass grows tomatoes."], ["no-spray tomatoes", "Acme Glass grows tomatoes", "Acme Glass grows tomatoes."]]) { const f = crop(v, q, src); assert.equal(f.value, "Unknown", `${v} / ${src} → ${JSON.stringify(f)}`); }
});
t("POSITIVE controls: the validator is not simply rejecting everything", () => {
  const ok = (v, q, src) => assert.equal(crop(v, q, src).value, v, `${v} / ${src}`);
  ok("non-organic tomatoes", "Acme Glass grows non-organic tomatoes", "Acme Glass grows non-organic tomatoes."); ok("tomatoes", "Acme Glass grows non-organic tomatoes", "Acme Glass grows non-organic tomatoes.");
  ok("tomatoes", "The farm grows tomatoes", "Acme Glass is a family business. The farm grows tomatoes."); ok("peppers", "Acme Glass Ltd grows peppers", "Acme Glass Ltd grows peppers."); ok("peppers", "the Acme Glass company grows peppers", "The Acme Glass company grows peppers.");
  ok("low-carbon tomatoes", "Acme Glass grows low-carbon tomatoes", "Acme Glass grows low-carbon tomatoes."); ok("tomatoes", "Acme Glass grows tomatoes", "Acme Glass grows tomatoes and acme farm grows peppers.");
  ok("organic tomatoes", "", "Acme Glass grows organic tomatoes in Kent.");
});
await done();
