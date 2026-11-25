import { defineConfig } from "@playwright/test";
// MOCKED-API browser tests (no backend, no network, no credentials): they exercise the built UI's recovery behaviour only.
export default defineConfig({ testDir: "test/ui-offline", timeout: 60000, workers: 1, reporter: "list", use: { baseURL: "http://localhost:8799" }, webServer: { command: "node test/ui-offline/server.mjs", url: "http://localhost:8799", reuseExistingServer: true } });
