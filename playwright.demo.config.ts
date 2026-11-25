import { defineConfig, devices } from "@playwright/test";
// PUBLIC DEMO acceptance (static build, no backend). Local: serves dist-demo/ (run `npm run build:demo` first).
// Hosted: DEMO_URL=https://<project>.pages.dev npm run test:demo  (no local server; exercises the deployed site in fresh, unauthenticated contexts).
const hosted = process.env.DEMO_URL;
export default defineConfig({
  testDir: "test/demo", timeout: 60000, workers: 1, reporter: "list",
  use: { baseURL: hosted ?? "http://localhost:8798" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: hosted ? undefined : { command: "LY_DIST=dist-demo LY_PORT=8798 node test/ui-offline/server.mjs", url: "http://localhost:8798", reuseExistingServer: false },
});
