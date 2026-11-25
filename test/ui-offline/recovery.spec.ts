// M5 + weak-test repair: network failures must never leave the UI permanently disabled, retries must complete, and idempotency identifiers must be preserved.
// MOCKED API (page.route) against the built UI: these are UI recovery tests, NOT live integration tests.
import { test, expect, type Page, type Route } from "@playwright/test";
const J = (o: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(o) });
const finding = (id: string, kind: string, value: string, extra = {}) => ({ id, kind, ai_value: value, value, quote: kind === "question" ? "" : "The company grows tomatoes.", quote_verified: kind !== "question", flags: [], review_status: "approved", final_value: value, note: null, ...extra });
const runData = (over: any = {}, co: any = {}) => ({ run: { id: "run1", source_id: "fixture://x", source_text: "Acme grows tomatoes.", source_kind: "pasted_text", model: "m", ai_status: "ok", ai_error: null, neurons: 1, duration_ms: 100, run_flags: [], created_at: "2026-01-01", ...over }, company: { id: "co1", name: "Acme Glass", domain: null, hubspot_id: null, sync_status: "not_synced", sync_error: null, synced_run_id: null, identity_status: "unresolved", candidates: null, sync_stale: false, ...co }, findings: [finding("f1", "lighting", "Unknown"), finding("f2", "future", "Unknown"), finding("f3", "crop", "tomatoes")] });
const account = (over: any = {}, co: any = {}, tasks: any[] = []) => ({ company: { id: "co1", name: "Acme Glass", domain: null, hubspot_id: "900", sync_status: "synced", sync_error: null, sync_stale: false, identity_status: "linked", candidates: [], ...co }, hubspot_url: null, crm_blocked: null, summary: { current: { public: { value: "Unknown", state: "Unknown (kept)" }, grower: { value: "Unknown" }, working: { value: "Unknown", provenance: "Unknown" }, conflict: false }, future: { public: { value: "Unknown", state: "Unknown (kept)" }, grower: { value: "Unknown" }, working: { value: "Unknown", provenance: "Unknown" }, conflict: false }, crop: { value: "tomatoes", state: "Verified public" }, hypothesis: "Insufficient evidence.", gaps: [], latest_fit: null }, public_evidence: [], questions: [], conversations: [], notes: [], tasks, runs: [], latest_run_id: "run1", ...over });
const task = (over: any = {}) => ({ id: "t1", company_id: "co1", company_name: "Acme Glass", subject: "Call grower", owner: "Owner", due_on: "2099-01-01", op_state: "created", last_error: null, hubspot_task_id: "77", hubspot_status: "NOT_STARTED", hubspot_read: true, completed_at: null, outcome: null, overdue: false, request_id: "rq", ...over });

async function base(page: Page, opts: { timeoutMs?: number } = {}) {
  if (opts.timeoutMs) await page.addInitScript((ms) => { (window as any).__LY_TIMEOUT_MS = ms; }, opts.timeoutMs);
  await page.route("**/api/session", (r) => r.fulfill(J({ authenticated: true, user: { login: "tester", id: 1 }, csrf: "csrf-token", env: "local" })));
  await page.route("**/api/config", (r) => r.fulfill(J({ local: true, model: "granite-test", hubspot_configured: true, limits: {} })));
  await page.route("**/api/runs", (r) => r.fulfill(J({ runs: [] })));
}
async function fillResearch(page: Page) { await page.getByTestId("name").fill("Acme Glass"); await page.getByTestId("source-id").fill("fixture://x"); await page.getByTestId("text").fill("Acme Glass grows tomatoes in glasshouses near Ely, Norfolk."); }
const body = (r: Route) => JSON.parse(r.request().postData() || "{}");

test("research: aborted request shows an honest network error, re-enables Run, keeps input; the retry completes", async ({ page }) => {
  await base(page); let n = 0; await page.route("**/api/research", (r) => (++n === 1 ? r.abort("failed") : r.fulfill(J(runData()))));
  await page.goto("/"); await fillResearch(page); const run = page.getByTestId("run");
  await run.click(); await expect(page.getByTestId("error")).toContainText("Network error"); await expect(run).toBeEnabled(); await expect(run).toHaveText("Run research");
  await expect(page.getByTestId("text")).toHaveValue(/grows tomatoes/); await expect(page.getByTestId("name")).toHaveValue("Acme Glass");
  await run.click(); await expect(page.getByTestId("finding-lighting")).toBeVisible(); expect(n).toBe(2);
});
test("research: AI failure → Retry research is ACTUALLY performed (force re-run) and recovers (replaces the old button-only check)", async ({ page }) => {
  await base(page); const bodies: any[] = []; let n = 0;
  await page.route("**/api/research", (r) => { bodies.push(body(r)); return ++n === 1 ? r.fulfill(J({ ...runData({ ai_status: "failed", ai_error: "AI call failed: simulated" }), findings: [], error: "AI call failed: simulated" }, 502)) : r.fulfill(J(runData())); });
  await page.goto("/"); await fillResearch(page); await page.getByTestId("run").click();
  await expect(page.getByTestId("error")).toContainText("AI call failed"); await page.getByRole("button", { name: "Retry research" }).click();
  await expect(page.getByTestId("finding-lighting")).toBeVisible(); await expect(page.getByTestId("error")).toHaveCount(0);
  expect(bodies).toHaveLength(2); expect(bodies[0].force).toBeFalsy(); expect(bodies[1].force).toBe(true); expect(bodies[1].sourceText).toBe(bodies[0].sourceText); // same input, forced new run
});
test("research: a hung request times out with an accurate message and the UI recovers", async ({ page }) => {
  await base(page, { timeoutMs: 700 }); await page.route("**/api/research", () => new Promise(() => {})); // never answers
  await page.goto("/"); await fillResearch(page); const run = page.getByTestId("run"); await run.click(); await expect(page.getByRole("status")).toContainText("Calling Cloudflare Workers AI");
  await expect(page.getByTestId("error")).toContainText("timed out", { timeout: 5000 }); await expect(run).toBeEnabled();
});
test("sync: aborted request → error, Sync enabled again, retry succeeds and shows the synced state", async ({ page }) => {
  await base(page); await page.route("**/api/research", (r) => r.fulfill(J(runData()))); let n = 0, synced = false;
  await page.route("**/api/runs/run1/sync", (r) => { if (++n === 1) return r.abort("failed"); synced = true; return r.fulfill(J(runData({}, { sync_status: "synced", hubspot_id: "900", synced_run_id: "run1" }))); });
  await page.route("**/api/runs/run1", (r) => r.fulfill(J(synced ? runData({}, { sync_status: "synced", hubspot_id: "900", synced_run_id: "run1" }) : runData())));
  await page.route("**/api/runs/run1/verify", (r) => r.fulfill(J({ verified: true, hubspot_id: "900", hubspot_name: "Acme Glass", d1_approved_findings: 3 })));
  await page.goto("/"); await fillResearch(page); await page.getByTestId("run").click(); const sync = page.getByTestId("sync");
  await sync.click(); await expect(page.getByTestId("error")).toContainText("Network error"); await expect(sync).toBeEnabled(); await expect(page.getByTestId("sync-status")).not.toContainText("Synced");
  await sync.click(); await expect(page.getByTestId("sync-status")).toContainText("Synced (HubSpot company 900)"); expect(n).toBe(2);
});
test("stale evidence is displayed as OUT OF DATE (never 'Synced') with a 'Sync changes' action", async ({ page }) => {
  await base(page); await page.route("**/api/runs", (r) => r.fulfill(J({ runs: [{ id: "run1", name: "Acme Glass", created_at: "2026-01-01", ai_status: "ok", sync_status: "synced" }] })));
  await page.route("**/api/runs/run1", (r) => r.fulfill(J(runData({}, { sync_status: "synced", hubspot_id: "900", synced_run_id: "run1", sync_stale: true }))));
  await page.goto("/"); await page.getByRole("button", { name: /Acme Glass/ }).click();
  await expect(page.getByTestId("sync-status")).toContainText("OUT OF DATE"); await expect(page.getByTestId("sync-status")).not.toContainText("Synced (HubSpot"); await expect(page.getByTestId("sync")).toHaveText("Sync changes to HubSpot");
});
test("conversation: offline failure keeps the form, shows an error, and the retry reuses the SAME request_id", async ({ page }) => {
  await base(page); await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account()))); const bodies: any[] = []; let n = 0;
  await page.route("**/api/accounts/co1/conversations", (r) => { bodies.push(body(r)); return ++n === 1 ? r.abort("internetdisconnected") : r.fulfill(J({ conversation: { id: "c1" }, warnings: [] }, 201)); });
  await page.goto("/#/account/co1"); const form = page.getByTestId("conv-form");
  await form.getByLabel("What the grower actually reported").fill("Synthetic: unlit today."); await form.getByLabel("Current LED use").selectOption("No");
  const save = page.getByTestId("save-conv"); await save.click(); await expect(page.getByTestId("error")).toContainText("Network error"); await expect(save).toBeEnabled();
  await expect(form.getByLabel("What the grower actually reported")).toHaveValue("Synthetic: unlit today."); await expect(form.getByLabel("Current LED use")).toHaveValue("No");
  await save.click(); await expect(page.getByTestId("conv-msg")).toContainText("Saved"); expect(bodies).toHaveLength(2); expect(bodies[1].request_id).toBe(bodies[0].request_id); expect(bodies[1].grower_reported).toBe(bodies[0].grower_reported);
});
test("follow-up creation: a timed-out request is retried with the SAME request_id", async ({ page }) => {
  await base(page, { timeoutMs: 700 }); await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account())));
  const bodies: any[] = []; let n = 0; await page.route("**/api/accounts/co1/tasks", (r) => { bodies.push(body(r)); return ++n === 1 ? new Promise(() => {}) : r.fulfill(J({ task: task() }, 201)); });
  await page.goto("/#/account/co1"); const tf = page.getByTestId("task-form"); await tf.getByLabel("Action").fill("Call grower"); await tf.getByLabel("Owner").fill("Owner");
  const create = page.getByTestId("create-task"); await create.click(); await expect(page.getByTestId("error")).toContainText("timed out", { timeout: 5000 }); await expect(create).toBeEnabled();
  await create.click(); await expect.poll(() => bodies.length).toBe(2); expect(bodies[1].request_id).toBe(bodies[0].request_id); expect(bodies[1].subject).toBe("Call grower");
});
test("task completion: retry with the same outcome reuses the request_id; changing the outcome starts a new operation", async ({ page }) => {
  await base(page); await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account({}, {}, [task()])))); const bodies: any[] = []; let n = 0;
  await page.route("**/api/tasks/t1/complete", (r) => { bodies.push(body(r)); return ++n <= 2 ? r.abort("failed") : r.fulfill(J({ task: task({ completed_at: "2026-01-02", outcome: "Spoke to owner" }) })); });
  await page.goto("/#/account/co1"); const outcome = page.getByLabel(/Outcome for/), btn = page.getByRole("button", { name: "Complete" });
  await outcome.fill("Left voicemail"); await btn.click(); await expect(page.getByTestId("error")).toContainText("Network error"); await expect(btn).toBeEnabled();
  await btn.click(); await expect.poll(() => bodies.length).toBe(2); expect(bodies[1].request_id).toBe(bodies[0].request_id); expect(bodies[1].outcome).toBe("Left voicemail");
  await outcome.fill("Spoke to owner"); await btn.click(); await expect.poll(() => bodies.length).toBe(3); expect(bodies[2].outcome).toBe("Spoke to owner"); expect(bodies[2].request_id).not.toBe(bodies[0].request_id);
});
test("account page: stale CRM state is shown prominently", async ({ page }) => {
  await base(page); await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account({}, { sync_stale: true })))); await page.goto("/#/account/co1");
  await expect(page.getByTestId("stale")).toContainText("older version");
});

// ---------------- FINAL REMEDIATION F + D (UI): response validation, retry identifiers, pending completion after reload ----------------
const noteForm = (page: Page) => page.locator("form", { has: page.getByLabel("Internal observation") });
test("F: HTTP 200 with a TRUNCATED/non-JSON body is NOT a successful save: error shown, form kept, retry reuses the request_id", async ({ page }) => {
  await base(page); await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account()))); const bodies: any[] = []; let n = 0;
  await page.route("**/api/accounts/co1/conversations", (r) => { bodies.push(body(r)); return ++n === 1 ? r.fulfill({ status: 200, contentType: "application/json", body: '{"conversation":{"id":"c1","grower_rep' }) : r.fulfill(J({ conversation: { id: "c1" }, warnings: [] }, 201)); });
  await page.goto("/#/account/co1"); const form = page.getByTestId("conv-form"); await form.getByLabel("What the grower actually reported").fill("Synthetic: unlit today."); const save = page.getByTestId("save-conv");
  await save.click(); await expect(page.getByTestId("error")).toContainText("could not be read"); await expect(page.getByTestId("conv-msg")).toHaveCount(0); await expect(save).toBeEnabled(); await expect(form.getByLabel("What the grower actually reported")).toHaveValue("Synthetic: unlit today.");
  await save.click(); await expect(page.getByTestId("conv-msg")).toContainText("Saved"); expect(bodies[1].request_id).toBe(bodies[0].request_id);
});
test("F: HTTP 200 with a valid JSON body that LACKS the required fields is not a success (conversation, task, research)", async ({ page }) => {
  await base(page); await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account()))); await page.route("**/api/accounts/co1/conversations", (r) => r.fulfill(J({}, 201))); await page.route("**/api/accounts/co1/tasks", (r) => r.fulfill(J({ ok: true }, 201)));
  await page.goto("/#/account/co1"); await page.getByTestId("conv-form").getByLabel("What the grower actually reported").fill("x"); await page.getByTestId("save-conv").click(); await expect(page.getByTestId("error")).toContainText("incomplete answer"); await expect(page.getByTestId("conv-msg")).toHaveCount(0);
  const tf = page.getByTestId("task-form"); await tf.getByLabel("Action").fill("Call"); await tf.getByLabel("Owner").fill("O"); await page.getByTestId("create-task").click(); await expect(page.getByTestId("error")).toContainText("incomplete answer");
});
test("F: research 200 with malformed JSON shows an error and re-enables Run (never shows findings)", async ({ page }) => {
  await base(page); let n = 0; await page.route("**/api/research", (r) => (++n === 1 ? r.fulfill({ status: 200, contentType: "application/json", body: "<html>proxy error</html>" }) : r.fulfill(J(runData()))));
  await page.goto("/"); await fillResearch(page); const run = page.getByTestId("run"); await run.click(); await expect(page.getByTestId("error")).toContainText("could not be read"); await expect(page.getByTestId("finding-lighting")).toHaveCount(0); await expect(run).toBeEnabled();
  await run.click(); await expect(page.getByTestId("finding-lighting")).toBeVisible();
});
test("F: an INTERRUPTED body read (connection dies mid-response) is reported, nothing is shown as saved, retry reuses the request_id", async ({ page }) => {
  await base(page); await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account()))); const bodies: any[] = [];
  await page.addInitScript(() => { const real = window.fetch.bind(window); let n = 0; window.fetch = (input: any, init?: any) => { const u = typeof input === "string" ? input : input.url; if (u.includes("/notes") && ++n === 1) { (window as any).__noteBodies = [init?.body]; return Promise.resolve(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"note":{"id":')); c.error(new TypeError("interrupted")); } }), { status: 201, headers: { "content-type": "application/json" } })); } return real(input, init); }; });
  await page.route("**/api/accounts/co1/notes", (r) => { bodies.push(body(r)); return r.fulfill(J({ note: { id: "n1", text: "obs", created_at: "2026-01-01" } }, 201)); });
  await page.goto("/#/account/co1"); const nf = noteForm(page); await nf.getByLabel("Internal observation").fill("obs"); await nf.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("error")).toContainText(/interrupted|could not be read/); await expect(nf.getByLabel("Internal observation")).toHaveValue("obs");
  const first = JSON.parse(await page.evaluate(() => (window as any).__noteBodies[0])); await nf.getByRole("button", { name: "Add" }).click(); await expect.poll(() => bodies.length).toBe(1); expect(bodies[0].request_id).toBe(first.request_id); expect(bodies[0].text).toBe("obs");
});
test("F: note retry keeps the SAME request_id while the text is unchanged; a changed text is a new operation", async ({ page }) => {
  await base(page); await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account()))); const bodies: any[] = []; let n = 0;
  await page.route("**/api/accounts/co1/notes", (r) => { bodies.push(body(r)); return ++n <= 2 ? r.abort("failed") : r.fulfill(J({ note: { id: "n1", text: "x", created_at: "2026-01-01" } }, 201)); });
  await page.goto("/#/account/co1"); const nf = noteForm(page), add = nf.getByRole("button", { name: "Add" }); await nf.getByLabel("Internal observation").fill("first text"); await add.click(); await expect(page.getByTestId("error")).toContainText("Network error");
  await add.click(); await expect.poll(() => bodies.length).toBe(2); expect(bodies[1].request_id).toBe(bodies[0].request_id);
  await nf.getByLabel("Internal observation").fill("second text"); await add.click(); await expect.poll(() => bodies.length).toBe(3); expect(bodies[2].request_id).not.toBe(bodies[0].request_id); expect(bodies[2].text).toBe("second text");
});
test("F: retry of a failed follow-up whose due date is now PAST sends the IDENTICAL payload under the same request_id (no payload change under one operation id)", async ({ page }) => {
  await base(page); const t = task({ op_state: "failed", last_error: "HubSpot rejected", hubspot_task_id: null, due_on: "2020-01-15", request_id: "aaaaaaaa-1111-2222-3333-444444444444", subject: "Old call", owner: "Own" }); let n = 0; const bodies: any[] = [];
  await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account({}, {}, n > 0 ? [task({ subject: "Old call", due_on: "2020-01-15" })] : [t]))));
  await page.route("**/api/accounts/co1/tasks", (r) => { bodies.push(body(r)); n++; return r.fulfill(J({ task: task({ subject: "Old call", due_on: "2020-01-15" }) }, 201)); });
  await page.goto("/#/account/co1"); await page.getByRole("button", { name: "Retry saving" }).click(); await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toEqual({ request_id: "aaaaaaaa-1111-2222-3333-444444444444", subject: "Old call", owner: "Own", due_on: "2020-01-15" });
});
test("D: lost completion response → page RELOAD → the pending intent is shown, Resume reconciles via the stored intent (no new operation)", async ({ page }) => {
  await base(page); let pending = false, done = false; const completes: any[] = [], resumes: any[] = [];
  await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account({}, {}, [done ? task({ completed_at: "2026-01-02", outcome: "Spoke to owner" }) : pending ? task({ completion_pending: { request_id: "bbbbbbbb-1111-2222-3333-444444444444", outcome: "Spoke to owner", state: "pending" } }) : task()]))));
  await page.route("**/api/tasks/t1/complete", (r) => { completes.push(body(r)); pending = true; return r.abort("failed"); }); // the provider applied it; the response is lost
  await page.route("**/api/tasks/t1/resume-completion", (r) => { resumes.push(body(r)); done = true; return r.fulfill(J({ task: task({ completed_at: "2026-01-02", outcome: "Spoke to owner" }) })); });
  await page.goto("/#/account/co1"); await page.getByLabel(/Outcome for/).fill("Spoke to owner"); await page.getByRole("button", { name: "Complete" }).click(); await expect(page.getByTestId("error")).toContainText("Network error");
  await page.reload(); await expect(page.getByTestId("completion-pending")).toContainText("Spoke to owner"); await expect(page.getByLabel(/Outcome for/)).toHaveCount(0); // no way to start a contradictory completion from the UI
  await page.getByTestId("resume-completion").click(); await expect(page.getByTestId("done-task")).toContainText("Spoke to owner"); expect(completes).toHaveLength(1); expect(resumes).toHaveLength(1);
});

test("C (UI): an unresolved evidence conflict is shown prominently and the company is not presented as current", async ({ page }) => {
  await base(page); await page.route("**/api/accounts/co1", (r) => r.fulfill(J(account({}, { sync_stale: true, evidence_conflicts: [{ kind: "crop", winner: { value: "peppers" }, other: { value: "cucumbers" } }] }))));
  await page.goto("/#/account/co1"); await expect(page.getByTestId("evidence-conflict")).toContainText("peppers"); await expect(page.getByTestId("evidence-conflict")).toContainText("cucumbers"); await expect(page.getByTestId("stale")).toBeVisible();
});
