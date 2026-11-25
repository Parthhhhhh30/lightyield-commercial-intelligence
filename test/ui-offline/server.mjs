// Static server for the BUILT UI (dist/) used by the mocked-API browser tests. Serves files only; no API.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
const dist = (process.env.LY_DIST || new URL("../../dist/", import.meta.url).pathname).replace(/\/?$/, "/"), types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
createServer((req, res) => { const p = new URL(req.url, "http://x").pathname; let f = join(dist, p === "/" ? "index.html" : p); if (!f.startsWith(dist) || !existsSync(f)) f = join(dist, "index.html"); res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f)); }).listen(Number(process.env.LY_PORT || 8799), () => console.log(`ui-offline server on :${process.env.LY_PORT || 8799}`));
