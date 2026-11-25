// Live-AI evaluation worker: disposable LOCAL D1, fixture login, only Workers AI is remote; HubSpot/Tavily/registry credentials are blanked. Use with /api/eval/extract (non-persisting).
import { run } from "./lib/dev-run.mjs"; run({ mode: "eval" });
