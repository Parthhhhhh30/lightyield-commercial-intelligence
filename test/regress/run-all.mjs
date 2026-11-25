// Runs every credential-free regression suite (test/regress/*.test.mjs) in its own process and fails if ANY suite fails or if none were found.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const dir = new URL("./", import.meta.url).pathname, files = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
if (!files.length) { console.error("no regression suites found"); process.exit(1); }
let bad = 0;
for (const f of files) { const r = spawnSync(process.execPath, [dir + f], { encoding: "utf8", env: process.env }); const last = (r.stdout.trim().split("\n").filter((l) => /passed/.test(l)).pop() || "(no summary line)"); console.log(r.status === 0 ? "PASS" : "FAIL", f, "-", last); if (r.status !== 0) { bad++; console.log(r.stdout.split("\n").filter((l) => l.startsWith("FAIL")).join("\n"), r.stderr.slice(0, 400)); } }
console.log(bad ? `${bad} suite(s) FAILED` : `all ${files.length} regression suites passed`); process.exit(bad ? 1 : 0);
