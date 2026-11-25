// FINAL REMEDIATION E: crop claims need FULL support tied to the right subject. Unsupported/ambiguous → Unknown (review required). Both false
// positives (unsupported accepted) and false negatives (ordinary supported statements rejected) are tested. Deterministic text rules only.
import assert from "node:assert";
import { pathToFileURL } from "node:url";
import { ROOT } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { buildFindings } = await import(pathToFileURL(`${ROOT}/src/logic.js`).href + "?e=" + Math.random());
const { t, done } = suite("E4 crop modifiers belong to the asserted phrase");
const ai = (crop, quote) => ({ business_name: "Acme Glass", crop_value: crop, crop_quote: quote, lighting_status: "Unknown", lighting_quote: "", future_plans: "Unknown", future_quote: "", unknown_information: [], discovery_questions: [] });
const crop = (c, quote, source, name = "Acme Glass") => buildFindings(ai(c, quote), source, name).findings.find((f) => f.kind === "crop");
const accepted = (f) => f.value !== "Unknown" && !f.flags.some((x) => !["quote_recovered_from_source", "semantic_check_passed"].includes(x));


// SIXTH REVIEW, finding E: a modifier supports a crop only when it belongs to THAT crop's phrase (adjacent to its head noun), not merely when it appears somewhere in the clause.
t("CODEX E: 'tomatoes and organic peppers' does NOT support 'organic tomatoes'; 'GM tomatoes in a pesticide-free greenhouse' does NOT support 'GM-free tomatoes'", () => {
  for (const [v, q, src] of [["organic tomatoes", "Acme Glass grows tomatoes and organic peppers", "Acme Glass grows tomatoes and organic peppers."], ["GM-free tomatoes", "Acme Glass grows GM tomatoes in a pesticide-free greenhouse", "Acme Glass grows GM tomatoes in a pesticide-free greenhouse."], ["organic tomatoes", "Acme Glass grows organic peppers and tomatoes", "Acme Glass grows organic peppers and tomatoes."], ["organic peppers", "Acme Glass grows tomatoes, organic cucumbers and peppers", "Acme Glass grows tomatoes, organic cucumbers and peppers."], ["cherry tomatoes", "Acme Glass grows cherry peppers and tomatoes", "Acme Glass grows cherry peppers and tomatoes."]]) { const f = crop(v, q, src); assert.equal(f.value, "Unknown", `${v} / ${src} -> ${JSON.stringify(f)}`); }
});
t("POSITIVE controls: modifiers that DO belong to the crop phrase are accepted, in clauses that also mention other crops/qualifiers", () => {
  const ok = (v, q, src) => assert.equal(crop(v, q, src).value, v, `${v} / ${src}`);
  ok("organic tomatoes", "Acme Glass grows organic tomatoes and peppers", "Acme Glass grows organic tomatoes and peppers."); ok("organic peppers", "Acme Glass grows tomatoes and organic peppers", "Acme Glass grows tomatoes and organic peppers.");
  ok("GM tomatoes", "Acme Glass grows GM tomatoes in a pesticide-free greenhouse", "Acme Glass grows GM tomatoes in a pesticide-free greenhouse."); ok("GM-free tomatoes", "Acme Glass grows GM-free tomatoes", "Acme Glass grows GM-free tomatoes in Kent.");
  ok("tomatoes", "Acme Glass grows tomatoes and organic peppers", "Acme Glass grows tomatoes and organic peppers."); ok("peppers", "Acme Glass grows tomatoes and organic peppers", "Acme Glass grows tomatoes and organic peppers.");
  ok("cherry tomatoes", "Acme Glass grows cherry tomatoes and peppers", "Acme Glass grows cherry tomatoes and peppers.");
});
await done();
