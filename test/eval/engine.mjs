// Evaluation engine (testable without any network): runs the labelled cases through `call` and scores them. See score.mjs for the rules.
import { classifyLive, classifyHostile, verdict } from "./score.mjs";
export async function runEvaluation({ live, hostile, call, expected, log = console.log, maxModelFailures = 0 }) {
const ok = (label, v) => (Array.isArray(label) ? label : [label]).includes(v);
const sysVal = (r, kind) => r.findings?.find((f) => f.kind === kind)?.value ?? "Unknown";
const rawVal = (r, k) => r.ai?.[k] ?? null;
const held = { n: 0, unsafe: 0, correct: 0, missed: 0 };
const rows = []; let neurons = 0, formatFail = 0, calls = 0, invalidCount = 0, hostileProcessed = 0;
const M = { n: 0, raw: { cur: { wrong: 0, unsupported: 0 }, fut: { wrong: 0, unsupported: 0 }, crop: { wrong: 0 } }, sys: { cur: { correct: 0, missed: 0, unsafe: 0 }, fut: { correct: 0, missed: 0, unsafe: 0 }, crop: { correct: 0, missed: 0, unsafe: 0 } }, blocked: 0, flagged: 0 };
for (const c of live) {
  let r; for (let i = 0; i < 2; i++) { r = await call({ businessName: c.name, sourceText: c.text }); if (r?.ai || i) break; }
  calls++; neurons += r?.neurons || 0; M.n++;
  const cl = classifyLive(r);
  if (cl.status === "invalid") { invalidCount++; rows.push({ id: c.id, cat: c.category, note: "INVALID RESULT: " + cl.reason }); log("INVALID", c.id, cl.reason); continue; }
  if (cl.status === "model_failure") { formatFail++; rows.push({ id: c.id, cat: c.category, note: "MODEL FORMAT FAILURE: " + cl.reason }); log("MODELFAIL", c.id, cl.reason); continue; }
  const exp = c.label, cur = sysVal(r, "lighting"), fut = sysVal(r, "future"), crop = sysVal(r, "crop");
  const rc = rawVal(r, "lighting_status"), rf = rawVal(r, "future_plans"), rcr = rawVal(r, "crop_value");
  const bump = (field, raw, sys, label, rawKey) => {
    if (rawKey && raw !== "Unknown" && !ok(label, raw)) { M.raw[field].wrong++; if (!ok(label, "Unknown") === false) M.raw[field].unsupported++; }
    if (ok(label, sys)) M.sys[field].correct++; else if (sys === "Unknown") M.sys[field].missed++; else M.sys[field].unsafe++;
    if (rawKey && raw !== "Unknown" && !ok(label, raw) && sys === "Unknown") M.blocked++;
  };
  bump("cur", rc, cur, exp.current, true); bump("fut", rf, fut, exp.future, true);
  const cropLabel = exp.crop ? [exp.crop] : ["Unknown"]; const cropSys = crop.toLowerCase(); const cropOk = exp.crop ? cropSys === exp.crop.toLowerCase() || cropSys.replace(/s$/, "") === exp.crop.toLowerCase().replace(/s$/, "") : cropSys === "unknown";
  if (cropOk) M.sys.crop.correct++; else if (cropSys === "unknown") M.sys.crop.missed++; else M.sys.crop.unsafe++;
  if (rcr && rcr !== "Unknown" && (!exp.crop || !rcr.toLowerCase().startsWith(exp.crop.toLowerCase().slice(0, 5)))) M.raw.crop.wrong++;
  const flagged = r.findings.some((f) => ["lighting", "future", "crop"].includes(f.kind) && f.flags.some((x) => !["quote_recovered_from_source", "semantic_check_passed"].includes(x))); if (flagged) M.flagged++;
  rows.push({ id: c.id, cat: c.category, exp: `${[].concat(exp.current).join("/")} | ${exp.future} | ${exp.crop ?? "-"}`, raw: `${rc} | ${rf} | ${rcr}`, sys: `${cur} | ${fut} | ${crop}`, flags: [...new Set(r.findings.filter((f) => ["lighting", "future", "crop"].includes(f.kind)).flatMap((f) => f.flags))].join(","), unsafe: (!ok(exp.current, cur) && cur !== "Unknown") || (!ok(exp.future, fut) && fut !== "Unknown") || (!cropOk && cropSys !== "unknown") });
  if (c.held) { held.n++; if (rows.at(-1).unsafe) held.unsafe++; else if (ok(exp.current, cur) && ok(exp.future, fut) && cropOk) held.correct++; else held.missed++; }
  log(rows.at(-1).unsafe ? "UNSAFE" : "ok    ", c.id, "|", rows.at(-1).sys, "|", rows.at(-1).flags);
}
const H = []; let hostilePromoted = 0, hostileSem = 0;
for (const h of hostile) {
  const r = await call({ businessName: "X", sourceText: h.text, scripted: h.scripted }); neurons += r?.neurons || 0; hostileProcessed++;
  const ch = classifyHostile(r, h.field);
  if (ch.status === "invalid") { invalidCount++; H.push({ id: h.id, cat: h.category, note: h.note, value: "INVALID", flags: ch.reason, verifier: "", promoted: false }); log("INVALID", h.id, ch.reason); continue; }
  const f = ch.finding, promoted = f.value !== "Unknown"; // every scripted claim is unsupported by construction: ANY definite value is an unsafe promotion
  const semantic = f?.flags.find((x) => x.startsWith("semantic_")); if (semantic && semantic !== "semantic_check_passed") hostileSem++;
  if (promoted) hostilePromoted++;
  H.push({ id: h.id, cat: h.category, note: h.note, value: f?.value, flags: f?.flags.join(","), verifier: JSON.stringify(r.verifier), promoted });
  log(promoted ? "PROMOTED" : "blocked ", h.id, "|", f?.value, "|", f?.flags.join(","));
}
  const unsafe = M.sys.cur.unsafe + M.sys.fut.unsafe + M.sys.crop.unsafe;
  const v = verdict({ expectedLive: expected.live, expectedHostile: expected.hostile, liveProcessed: M.n, hostileProcessed, invalidCount, modelFailures: formatFail, maxModelFailures, unsafe, hostilePromoted });
  return { M, rows, H, held, neurons, formatFail, calls, hostilePromoted, hostileSem, invalidCount, hostileProcessed, unsafe, v };
}
