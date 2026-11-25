// The evaluation harness must not report success for malformed, truncated, errored or unsafe evaluations. Runs the REAL engine with a fake `call` (no network, no AI).
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { runEvaluation } from "./engine.mjs";
import { suite } from "../regress/run.mjs";
const { live, hostile, meta } = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
const { t, done } = suite("eval engine validation");
const first = (x) => (Array.isArray(x) ? x[0] : x);
const fnd = (kind, value, flags = []) => ({ kind, value, ai_value: value, quote: "", quote_verified: false, flags });
// a "perfect model + perfect system": returns exactly the labelled values
const perfect = (liveCases) => async (b) => { if (b.scripted) { const h = hostile.find((x) => x.scripted === b.scripted || JSON.stringify(x.scripted) === JSON.stringify(b.scripted)); return { ai: b.scripted, findings: [fnd(h.field, "Unknown", ["blocked"])], neurons: 1, verifier: [] }; }
  const c = liveCases.find((x) => x.text === b.sourceText); const L = c.label; return { ai: { lighting_status: first(L.current), future_plans: L.future, crop_value: L.crop ?? "Unknown" }, findings: [fnd("lighting", first(L.current)), fnd("future", L.future), fnd("crop", L.crop ?? "Unknown")], neurons: 2.5 }; };
const run = (call, over = {}) => runEvaluation({ live, hostile, call, expected: meta, log: () => {}, ...over });

t("a perfect, complete evaluation passes (code 0) with every case counted", async () => { const r = await run(perfect(live)); assert.equal(r.v.code, 0, r.v.reasons.join("; ")); assert.equal(r.M.n, 38); assert.equal(r.hostileProcessed, 15); assert.equal(r.invalidCount, 0); });
t("CODEX: an errored harness (every call returns an HTTP-style error) is INVALID, not 'blocked'/'format failure' success", async () => {
  const r = await run(async () => ({ error: "unauthenticated" })); assert.equal(r.v.code, 3); assert.equal(r.invalidCount, 53, "all 38 live + 15 hostile results are invalid"); assert.equal(r.formatFail, 0, "harness errors are not model format failures");
});
t("CODEX: hostile results WITHOUT findings are invalid (previously silently counted as blocked)", async () => {
  const base = perfect(live); const r = await run(async (b) => (b.scripted ? { neurons: 1 } : base(b))); assert.equal(r.v.code, 3); assert.equal(r.invalidCount, 15); assert.match(r.v.reasons.join(" "), /INVALID/);
});
t("a malformed live result (model output present but findings missing/incomplete) is invalid", async () => {
  const base = perfect(live); let n = 0; const r = await run(async (b) => { const x = await base(b); if (!b.scripted && ++n === 5) return { ...x, findings: x.findings.slice(0, 1) }; return x; }); assert.equal(r.v.code, 3); assert.equal(r.invalidCount, 1);
});
t("a truncated dataset (fewer cases than recorded) cannot pass", async () => { const r = await run(perfect(live), { live: live.slice(0, 10) }); assert.equal(r.v.code, 3); assert.match(r.v.reasons.join(" "), /count mismatch/); });
t("model format failures are counted, reported and FAIL the run unless explicitly allowed", async () => {
  const base = perfect(live); const call = async (b) => (!b.scripted && b.sourceText === live[2].text ? { error: "AI output failed validation: lighting_status" } : base(b)); // persistent for ONE case (the engine retries once, so a transient failure would recover)
  const r = await run(call); assert.equal(r.v.code, 2); assert.equal(r.formatFail, 1); const ok = await run(call, { maxModelFailures: 1 }); assert.equal(ok.v.code, 0);
  let transient = 0; const flaky = async (b) => (!b.scripted && b.sourceText === live[3].text && ++transient === 1 ? { error: "AI call failed: x" } : base(b)); assert.equal((await run(flaky)).v.code, 0, "a single transient failure recovers on the retry");
});
t("ANY definite value on an unsupported hostile claim is an unsafe promotion (previously only the crop 'gold' counted)", async () => {
  const base = perfect(live); const r = await run(async (b) => { const x = await base(b); if (b.scripted && x.findings[0].kind === "crop") return { ...x, findings: [fnd("crop", "cucumbers")] }; return x; }); assert.equal(r.v.code, 1); assert.ok(r.hostilePromoted >= 1);
});
t("an unsafe live promotion fails with code 1 even when everything else is valid", async () => {
  const base = perfect(live); const r = await run(async (b) => { const x = await base(b); if (!b.scripted && b.sourceText === live[0].text) return { ...x, findings: [fnd("lighting", "No"), x.findings[1], x.findings[2]] }; return x; }); assert.equal(r.v.code, 1); assert.ok(r.unsafe >= 1);
});
await done();
