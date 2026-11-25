// OFFLINE (no AI, no network): how does the deterministic crop validator treat the labelled evaluation texts?
// For every case with a labelled crop, feed the validator the LABELLED crop as if the model had claimed it (with and without a quotation).
// Safety: a claim for a crop that is NOT the labelled crop must never be supported. Coverage: report how many true crops are still supported.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { buildFindings } from "../../src/logic.js";
const { live, hostile } = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
const ai = (crop, quote, name) => ({ business_name: name, crop_value: crop, crop_quote: quote, lighting_status: "Unknown", lighting_quote: "", future_plans: "Unknown", future_quote: "", unknown_information: [], discovery_questions: [] });
const sentences = (t) => t.split(/(?<=[.!?])\s+/);
let withCrop = 0, supportedNoQuote = 0, supportedQuote = 0; const missed = [];
for (const c of live.filter((x) => x.label.crop)) {
  withCrop++; const crop = c.label.crop;
  const f1 = buildFindings(ai(crop, "", c.name), c.text, c.name).findings.find((f) => f.kind === "crop");
  const q = sentences(c.text).find((s) => s.toLowerCase().includes(crop.toLowerCase().slice(0, 5))) || "";
  const f2 = buildFindings(ai(crop, q, c.name), c.text, c.name).findings.find((f) => f.kind === "crop");
  if (f1.value !== "Unknown") supportedNoQuote++; else missed.push(`${c.id}(no-quote:${f1.flags.join("|")})`);
  if (f2.value !== "Unknown") supportedQuote++; else missed.push(`${c.id}(quote:${f2.flags.join("|")})`);
  // safety: a WRONG crop is never supported by these texts
  const wrong = buildFindings(ai("bananas", "", c.name), c.text, c.name).findings.find((f) => f.kind === "crop"); assert.equal(wrong.value, "Unknown", `${c.id}: unsupported crop 'bananas' must stay Unknown`);
}
for (const h of hostile.filter((x) => x.field === "crop")) { const f = buildFindings(h.scripted, h.text, "X").findings.find((x) => x.kind === "crop"); assert.equal(f.value, "Unknown", `${h.id} must stay blocked`); }
console.log(`labelled crop cases: ${withCrop}; supported with model quote: ${supportedQuote}; supported via checker-recovered quote: ${supportedNoQuote}`);
if (missed.length) console.log("not supported (conservative):", missed.join("; "));
assert.ok(supportedQuote / withCrop >= 0.9, `over-blocking: only ${supportedQuote}/${withCrop} true crops supported`); assert.ok(supportedNoQuote / withCrop >= 0.9);
console.log("crop-offline: PASS");
