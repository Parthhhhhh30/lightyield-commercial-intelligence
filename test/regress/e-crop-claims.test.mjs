// FINAL REMEDIATION E: crop claims need FULL support tied to the right subject. Unsupported/ambiguous → Unknown (review required). Both false
// positives (unsupported accepted) and false negatives (ordinary supported statements rejected) are tested. Deterministic text rules only.
import assert from "node:assert";
import { pathToFileURL } from "node:url";
import { ROOT } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { buildFindings } = await import(pathToFileURL(`${ROOT}/src/logic.js`).href + "?e=" + Math.random());
const { t, done } = suite("E crop claim support");
const ai = (crop, quote) => ({ business_name: "Acme Glass", crop_value: crop, crop_quote: quote, lighting_status: "Unknown", lighting_quote: "", future_plans: "Unknown", future_quote: "", unknown_information: [], discovery_questions: [] });
const crop = (c, quote, source, name = "Acme Glass") => buildFindings(ai(c, quote), source, name).findings.find((f) => f.kind === "crop");
const accepted = (f) => f.value !== "Unknown" && !f.flags.some((x) => !["quote_recovered_from_source", "semantic_check_passed"].includes(x));

// ---- false positives (must NOT be proposed as a definite crop)
t("CODEX E1: 'tomatoes and bananas' from a source that mentions only tomatoes is not accepted", () => { const f = crop("tomatoes and bananas", "Acme Glass grows tomatoes", "Acme Glass grows tomatoes in glasshouses near Ely."); assert.equal(f.value, "Unknown", JSON.stringify(f)); assert.ok(f.flags.length); });
t("compound value where the quote supports only one item is not accepted (even if the source mentions both elsewhere)", () => { const f = crop("tomatoes and peppers", "Acme Glass grows tomatoes", "Acme Glass grows tomatoes in glasshouses. Rival Ltd grows peppers."); assert.equal(f.value, "Unknown", JSON.stringify(f)); });
t("CODEX E2: a crop attributed to a DIFFERENT company in a compound sentence is not accepted for the target", () => { const src = "Acme Glass grows tomatoes and Rival Ltd grows peppers near Ely."; for (const q of ["Acme Glass grows tomatoes and Rival Ltd grows peppers", "Rival Ltd grows peppers"]) { const f = crop("peppers", q, src); assert.equal(f.value, "Unknown", `${q} → ${JSON.stringify(f)}`); } });
t("similar-but-different company name ('Acme Foods' vs 'Acme Glass') is not accepted", () => { const f = crop("peppers", "Acme Foods grows peppers", "Acme Foods grows peppers in Kent."); assert.equal(f.value, "Unknown", JSON.stringify(f)); });
t("passive attribution to another company is not accepted ('sells tomatoes grown by Rival Ltd')", () => { const f = crop("tomatoes", "Acme Glass sells tomatoes grown by Rival Ltd", "Acme Glass sells tomatoes grown by Rival Ltd."); assert.equal(f.value, "Unknown", JSON.stringify(f)); });
t("coordination with an inherited subject from ANOTHER company is not accepted", () => { const f = crop("peppers", "Rival Ltd grows bananas and also harvests peppers", "Rival Ltd grows bananas and also harvests peppers."); assert.equal(f.value, "Unknown", JSON.stringify(f)); });
t("crop only for the target's customers/competitors/neighbours is not accepted", () => { for (const s of ["Acme Glass supplies supermarkets. Its neighbour grows tomatoes.", "Competitors grow tomatoes but Acme Glass focuses on distribution."]) { const f = crop("tomatoes", s.split(". ")[0], s); assert.equal(f.value, "Unknown", s + " → " + JSON.stringify(f)); } });
t("negation, historical, future and unrelated-quote cases stay Unknown", () => {
  for (const [q, s] of [["Acme Glass does not grow tomatoes", "Acme Glass does not grow tomatoes."], ["Acme Glass used to grow tomatoes", "Acme Glass used to grow tomatoes."], ["Acme Glass plans to grow tomatoes next year", "Acme Glass plans to grow tomatoes next year."], ["The weather was mild near Ely", "Acme Glass grows tomatoes. The weather was mild near Ely."]]) assert.equal(crop("tomatoes", q, s).value, "Unknown", q); });
// ---- false negatives (ordinary supported statements must be accepted)
t("CODEX E3: 'Acme Glass grows tomatoes for supermarkets.' is accepted (customers in the OBJECT are not the subject)", () => { const f = crop("tomatoes", "Acme Glass grows tomatoes for supermarkets", "Acme Glass grows tomatoes for supermarkets."); assert.equal(f.value, "tomatoes", JSON.stringify(f)); assert.ok(accepted(f)); });
t("ordinary supported variants are accepted: pronoun/the company subject, compound crops both supported, passive by the target, own-name coordination", () => {
  assert.equal(crop("tomatoes", "The company grows tomatoes", "Acme Glass is a family business. The company grows tomatoes.").value, "tomatoes");
  assert.equal(crop("tomatoes and peppers", "Acme Glass grows tomatoes and peppers", "Acme Glass grows tomatoes and peppers in Norfolk.").value, "tomatoes and peppers");
  assert.equal(crop("tomatoes", "tomatoes grown by Acme Glass", "Tomatoes grown by Acme Glass are sold locally.").value, "tomatoes");
  assert.equal(crop("tomatoes", "Acme Glass grows tomatoes", "Rival Ltd grows peppers and Acme Glass grows tomatoes.").value, "tomatoes", "the target's own statement in a multi-company sentence");
  assert.equal(crop("tomatoes", "Acme Glass grows tomatoes and harvests them weekly", "Acme Glass grows tomatoes and harvests them weekly.").value, "tomatoes");
  assert.equal(crop("cucumbers", "", "Acme Glass grows cucumbers in Kent.").value, "cucumbers", "checker-recovered quote");
});
await done();
