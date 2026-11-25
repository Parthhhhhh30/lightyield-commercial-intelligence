// FIXTURE test mode (NOT real GitHub): fixture IdP :9099 + a Worker on :8788 with a disposable LOCAL D1 (scripts/lib/dev-guard.mjs refuses anything remote before any login).
import { run } from "./lib/dev-run.mjs"; run({ mode: "test" });
