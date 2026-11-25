// PUBLIC STATIC DEMO build (npm run build:demo -> dist-demo/). Separate from the operational build (vite.config.ts -> dist/), which is unchanged.
// Isolation is enforced here, not only by UI wording:
//  1. ui/src/api.ts (the HTTP client) is replaced by ui/src/demo/api.ts (browser-local state), so the bundle has no route to any server.
//     ui/src/demoSlots.tsx (empty in the operational build) is replaced by ui/src/demo/DemoChrome.tsx.
//  2. The build FAILS if any emitted file mentions an operational route or provider host.
//  3. A restrictive Content Security Policy (connect-src 'none') stops the page making any network request after load.
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const realApi = fileURLToPath(new URL("./ui/src/api.ts", import.meta.url));
const demoApi = fileURLToPath(new URL("./ui/src/demo/api.ts", import.meta.url));
const SWAP = new Map([[realApi, demoApi], [fileURLToPath(new URL("./ui/src/demoSlots.tsx", import.meta.url)), fileURLToPath(new URL("./ui/src/demo/DemoChrome.tsx", import.meta.url))]]);
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const FORBIDDEN = [/["'`]\/api\//, /["'`]\/auth\//, /hubspot\.com/i, /hubapi/i, /tavily/i, /workers\.dev/i, /api\.cloudflare\.com/i, /x-csrf-token/i];

const swapApi: Plugin = {
  name: "lightyield-demo-api", enforce: "pre",
  async resolveId(source, importer, options) {
    if (!importer || [...SWAP.values()].includes(importer)) return null;
    const r = await this.resolve(source, importer, { ...options, skipSelf: true });
    return (r && SWAP.get(r.id)) ?? null;
  },
};
const demoHtml: Plugin = {
  name: "lightyield-demo-html",
  transformIndexHtml: (html) => html
    .replace("<title>LightYield Research Review</title>", `<meta http-equiv="Content-Security-Policy" content="${CSP}" /><meta name="robots" content="noindex" /><link rel="icon" href="data:," /><title>LightYield · interactive demo (fictional data)</title>`),
};
const guard: Plugin = {
  name: "lightyield-demo-guard", apply: "build", enforce: "post",
  generateBundle(_o, bundle) {
    for (const [name, f] of Object.entries(bundle)) {
      const text = f.type === "chunk" ? f.code : typeof f.source === "string" ? f.source : new TextDecoder().decode(f.source);
      for (const re of FORBIDDEN) if (re.test(text)) this.error(`demo isolation: ${name} contains ${re}`);
    }
  },
};
export default defineConfig({
  root: "ui", mode: "demo", publicDir: "demo-public",
  plugins: [swapApi, demoHtml, react(), tailwindcss(), guard],
  build: { outDir: "../dist-demo", emptyOutDir: true, modulePreload: { polyfill: false } },
});
