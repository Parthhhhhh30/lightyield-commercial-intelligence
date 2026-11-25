// Local development with REAL GitHub sign-in (credentials from the gitignored .dev.vars). No fixture IdP. Disposable LOCAL D1 only (scripts/lib/dev-guard.mjs).
import { readFileSync, existsSync } from "node:fs";
import { run } from "./lib/dev-run.mjs";
const vars = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "";
if (/^IDP_BASE=/m.test(vars)) { console.error("REFUSING TO START: .dev.vars contains IDP_BASE (fixture IdP). Remove it for real GitHub sign-in, or use `npm run dev:test` for fixture tests."); process.exit(1); }
for (const k of ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "ALLOWED_GITHUB_IDS", "HUBSPOT_TEST_TOKEN"]) if (!new RegExp(`^${k}=.+`, "m").test(vars)) { console.error(`.dev.vars is missing ${k}`); process.exit(1); }
run({ mode: "local" });
