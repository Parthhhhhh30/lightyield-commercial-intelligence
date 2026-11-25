// Shared launcher for dev:test (fixture IdP), dev:eval (fixture IdP + only AI remote, no CRM/search credentials) and dev:local (real GitHub).
// ORDER IS THE SAFETY PROPERTY: (1) generate local-only config, (2) start wrangler, (3) parse + verify its effective bindings, and ONLY THEN (4) migrate the local DB, (5) start the fixture IdP. Any failure stops everything.
import { readFileSync } from "node:fs";
import { spawn, execSync, spawnSync } from "node:child_process";
import { startGuardedWorker, GuardError } from "./dev-guard.mjs";

export async function run({ mode, port = mode === "local" ? 8787 : 8788 }) {
  const fixture = mode !== "local"; const v = { LOCAL_DEV: "1" };
  if (fixture) Object.assign(v, { GITHUB_CLIENT_ID: "fixture-client", GITHUB_CLIENT_SECRET: "fixture-secret-local-only", ALLOWED_GITHUB_IDS: "1001", IDP_BASE: "http://localhost:9099", LIMIT_RESEARCH_HOUR: "100000", LIMIT_RESEARCH_DAY: "100000", LIMIT_SUGGEST_HOUR: "100000", LIMIT_SUGGEST_DAY: "100000" });
  if (mode === "preview") Object.assign(v, { HUBSPOT_TEST_TOKEN: "none", COMPANIES_HOUSE_API_KEY: "none", PREVIEW_ONLY: "1", LIMIT_SEARCH_HOUR: "100000" }); // CRM unreachable; the search key from .dev.vars is KEPT; persistence routes closed by PREVIEW_ONLY
  if (mode === "eval") Object.assign(v, { HUBSPOT_TEST_TOKEN: "none", TAVILY_API_KEY: "none", COMPANIES_HOUSE_API_KEY: "none" }); // the evaluation needs Workers AI only
  if (mode === "local") { const vars = readFileSync(".dev.vars", "utf8"); if (/^IDP_BASE=/m.test(vars)) throw new GuardError(".dev.vars contains IDP_BASE (fixture IdP): refusing real-GitHub dev"); }
  execSync("npx vite build", { stdio: "inherit" });
  let w; try { w = await startGuardedWorker({ baseToml: readFileSync("wrangler.toml", "utf8"), port, vars: mode === "local" ? {} : v, wranglerArgs: ["--inspector-port", String(port + 1000)] }); }
  catch (e) { console.error("REFUSED BEFORE ANY LOGIN, MIGRATION OR REQUEST: " + e.message); process.exit(1); }
  console.log("effective bindings verified:", w.bindings.map((r) => `${r.name}=${r.mode}`).join(" "));
  const m = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "lightyield-phase0", "--local", "-c", w.configPath], { stdio: "inherit" }); if (m.status !== 0) { w.stop(); console.error("local migration failed"); process.exit(1); }
  const kids = [w.child]; if (fixture) kids.push(spawn("node", ["scripts/fixture-idp.mjs"], { stdio: "inherit" }));
  const stop = () => { kids.forEach((k) => { try { k.kill("SIGTERM"); } catch {} }); w.stop(); }; process.on("SIGINT", () => { stop(); process.exit(0); }); process.on("SIGTERM", () => { stop(); process.exit(0); }); process.on("exit", stop);
  w.child.stdout?.pipe(process.stdout); w.child.stderr?.pipe(process.stderr);
  console.log(`READY ${mode} on http://localhost:${port} (local D1; ${mode === "eval" ? "AI remote only" : "see bindings above"})`);
}
