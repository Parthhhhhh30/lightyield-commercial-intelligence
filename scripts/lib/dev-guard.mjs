// Mechanical isolation for every local dev/test Worker. Incident 2026-11-24: `npm run dev:test` started a Worker whose top-level D1 binding has `remote = true`
// (Phase 0's live database), so three failed FIXTURE logins wrote 3 oauth_states + 3 sessions rows into it. Comments and CLAUDE.md did not prevent that; this does:
//   1. the Worker only ever starts from a GENERATED config in which no D1 binding is remote;
//   2. wrangler's own startup binding table is parsed and verified BEFORE any migration, fixture-IdP start or request: DB must be `local`; the only remote binding allowed is AI;
//   3. anything unparseable is refused (fail closed); `--remote`, `--env <hosted>` and `--persist-to` pointing elsewhere are refused.
import { spawn } from "node:child_process";
import { writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import net from "node:net";

export class GuardError extends Error {}
const HOSTED_ENVS = new Set(["synthetic", "v2"]);

// Remove `remote = true` ONLY from D1 sections; everything else (AI, assets, vars) is preserved byte for byte.
export function localOnlyConfig(toml) {
  const out = []; let inD1 = false;
  for (const line of String(toml).split("\n")) { const sec = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/); if (sec) inD1 = /(^|\.)d1_databases$/.test(sec[1].trim()); if (inD1 && /^\s*remote\s*=\s*true\s*(#.*)?$/.test(line)) continue; out.push(line); }
  return out.join("\n");
}
// Violations in a config: any D1 binding marked remote.
export function remoteD1Violations(toml) {
  const v = []; let inD1 = false, sec = ""; for (const line of String(toml).split("\n")) { const m = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/); if (m) { sec = m[1].trim(); inD1 = /(^|\.)d1_databases$/.test(sec); } if (inD1 && /^\s*remote\s*=\s*true\s*(#.*)?$/.test(line)) v.push(`[[${sec}]] has remote = true`); }
  return v;
}
export function checkArgs(args) {
  for (const a of args) { if (a === "--remote" || a.startsWith("--remote=")) throw new GuardError("--remote is refused: dev/test Workers never use remote databases"); if (a === "--persist-to" || a.startsWith("--persist-to=")) throw new GuardError("--persist-to is refused (state must stay in the default local directory)"); }
  const i = args.indexOf("--env") >= 0 ? args.indexOf("--env") : args.findIndex((a) => a.startsWith("--env=")); if (i >= 0) { const e = args[i] === "--env" ? args[i + 1] : args[i].slice(6); if (HOSTED_ENVS.has(e) || !e) throw new GuardError(`--env ${e} is a hosted environment: dev/test Workers must not target it`); }
}
// Parse wrangler's startup table:  "env.DB (lightyield-phase0)   D1 Database   local"
const ROW = /^\s*env\.([A-Za-z0-9_]+)(?:\s+\S.*?)?\s{2,}([A-Za-z0-9][A-Za-z0-9 ]*?)\s{2,}(local|remote|not supported)\s*$/;
const clean = (o) => String(o).replace(/\x1b\[[0-9;]*m/g, "");
export function parseBindingTable(output) { const rows = []; for (const line of clean(output).split("\n")) { const m = line.match(ROW); if (m) rows.push({ name: m[1], kind: m[2].trim(), mode: m[3] }); } return rows; }
// COMPLETION BOUNDARY (no sleeps): the table starts at wrangler's "access to the following bindings" header and is complete only when a later NON-EMPTY line that is not a binding row
// (or wrangler's "Ready on") has been seen, i.e. the table was followed by something else. Partial lines (no trailing newline yet) never count as rows or as a terminator.
export function tableStatus(output) {
  const text = clean(output), lines = text.split("\n"), endsWithNewline = text.endsWith("\n"); const complete = endsWithNewline ? lines : lines.slice(0, -1);
  const h = complete.findIndex((l) => /access to the following bindings/i.test(l)); if (h < 0) return { started: false, complete: false, rows: [] };
  const rows = []; let seenRow = false;
  for (const l of complete.slice(h + 1)) { if (/^\s*Binding\s+Resource\s+Mode\s*$/.test(l) || !l.trim()) continue; const m = l.match(ROW); if (m) { rows.push({ name: m[1], kind: m[2].trim(), mode: m[3] }); seenRow = true; continue; } if (seenRow) return { started: true, complete: true, rows }; }
  return { started: true, complete: false, rows };
}
// Allowlist derived from the repository's own top-level config: exactly these bindings, exactly these modes. Anything else (extra, missing, other kind, other mode) is refused.
export const EXPECTED = { DB: { kind: "D1 Database", mode: "local" }, AI: { kind: "AI", mode: "remote" }, ASSETS: { kind: "Assets", mode: "local" } };
export function verifyBindings(output, { expected = EXPECTED, requireComplete = true } = {}) {
  const st = tableStatus(output); if (!st.started) throw new GuardError("effective bindings could not be read (no binding table): refusing to continue");
  if (requireComplete && !st.complete) throw new GuardError("binding table incomplete: refusing to continue");
  const rows = st.rows, byName = new Map(); for (const r of rows) { if (byName.has(r.name)) throw new GuardError(`duplicate binding ${r.name}`); byName.set(r.name, r); }
  for (const [name, want] of Object.entries(expected)) { const r = byName.get(name); if (!r) throw new GuardError(`expected binding ${name} is missing: refusing`); if (r.kind !== want.kind) throw new GuardError(`binding ${name} is ${r.kind}, expected ${want.kind}`); if (r.mode !== want.mode) throw new GuardError(`binding ${name} is ${r.mode}, expected ${want.mode}${name === "DB" && r.mode === "remote" ? " (a dev/test Worker must use a disposable LOCAL database)" : ""}`); }
  for (const r of rows) if (!(r.name in expected)) { if (/^Environment Variable$/i.test(r.kind) && r.mode === "local") continue; throw new GuardError(`unexpected binding ${r.name} (${r.kind}, ${r.mode}): refusing`); }
  return rows;
}
// Top-level (dev) config must declare no binding kinds beyond the allowlist.
const FORBIDDEN_SECTIONS = /^(kv_namespaces|r2_buckets|queues(\.[a-z]+)?|durable_objects(\.[a-z]+)?|services|hyperdrive|vectorize|browser|analytics_engine_datasets|workflows|dispatch_namespaces|mtls_certificates|send_email|pipelines|unsafe(\..*)?)$/;
export function unexpectedConfigBindings(toml) { const bad = []; for (const line of String(toml).split("\n")) { const m = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/); if (m && !m[1].trim().startsWith("env.") && FORBIDDEN_SECTIONS.test(m[1].trim())) bad.push(m[1].trim()); } return bad; }

// A dev Worker must own its port: if something already listens there (e.g. a previous preview with different settings), tests or the browser would silently talk to THAT process (seen on 2026-11-24).
export async function assertPortFree(port) { await new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", (e) => reject(new GuardError(`port ${port} is already in use (${e.code}); stop the other process first - refusing to start`))); s.once("listening", () => s.close(resolve)); s.listen(port, "127.0.0.1"); }); }
// Start wrangler dev from a generated local-only config; resolve only after the effective bindings were verified. Nothing else (migrations, IdP, requests) happens before that.
export async function startGuardedWorker({ baseToml, port, vars = {}, spawnFn = spawn, wranglerArgs = [], readyTimeoutMs = 120000, cwd = process.cwd() }) {
  checkArgs(wranglerArgs); await assertPortFree(port);
  const cfg = join(cwd, `wrangler.dev-local-${randomBytes(4).toString("hex")}.toml`); // beside wrangler.toml so relative paths (assets, main) still resolve; git-ignored
  writeFileSync(cfg, localOnlyConfig(baseToml)); { const g = readFileSync(cfg, "utf8"); const v = [...remoteD1Violations(g), ...unexpectedConfigBindings(g).map((x) => `unexpected binding section [${x}]`)]; if (v.length) { rmSync(cfg, { force: true }); throw new GuardError("generated config refused before spawn: " + v.join("; ")); } }
  const args = ["wrangler", "dev", "-c", cfg, "--port", String(port), ...wranglerArgs, ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])];
  const child = spawnFn("npx", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }); let buf = "";
  const cleanup = () => { try { child.kill("SIGTERM"); } catch {} try { rmSync(cfg, { force: true }); } catch {} };
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new GuardError("worker did not report its bindings in time")); }, readyTimeoutMs);
    const onData = (d) => { buf += d.toString(); const st = tableStatus(buf); if (!st.complete) { if (/Ready on/.test(buf) && !st.started) { clearTimeout(timer); cleanup(); reject(new GuardError("worker reported ready without a binding table: refusing")); } return; } // wait for the table's completion boundary
      clearTimeout(timer); child.stdout?.off("data", onData); child.stderr?.off("data", onData);
      try { resolve({ child, bindings: verifyBindings(buf), configPath: cfg, stop: cleanup }); } catch (e) { cleanup(); reject(e); } };
    child.stdout?.on("data", onData); child.stderr?.on("data", onData); child.on("error", (e) => { clearTimeout(timer); cleanup(); reject(e); }); child.on("exit", () => { clearTimeout(timer); cleanup(); reject(new GuardError("worker exited before a complete binding table was read: refusing")); });
  });
}
