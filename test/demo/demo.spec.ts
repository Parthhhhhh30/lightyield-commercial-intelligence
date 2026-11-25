// PUBLIC DEMO acceptance: the complete visitor journey against the STATIC demo build (local dist-demo/ or the hosted URL). No backend exists.
// Every interaction must change browser-local state; every request must stay on the demo origin; nothing may reach an API route or a provider.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const DISCLOSURE = "Interactive demo · Fictional company data · Research and CRM integrations are simulated · Changes stay in your browser";
const OPERATIONAL_WORDING = /Workers AI|Neurons|Tavily|DEVELOPER_TEST|stored in D1|HubSpot company|Sign in with GitHub|HOSTED DEVELOPMENT|LOCAL DEVELOPMENT|Average run time/;

type Watch = { requests: string[]; errors: string[] };
function watch(page: Page): Watch {
  const w: Watch = { requests: [], errors: [] };
  page.on("request", (r) => w.requests.push(`${r.method()} ${r.url()}`));
  page.on("console", (m) => { if (m.type() === "error") w.errors.push(m.text()); });
  page.on("pageerror", (e) => w.errors.push(String(e)));
  return w;
}
function assertIsolated(w: Watch, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const foreign = w.requests.filter((r) => new URL(r.split(" ")[1]).origin !== origin && !r.split(" ")[1].startsWith("data:"));
  const operational = w.requests.filter((r) => /^\S+ https?:\/\/[^/]+\/(api|auth)(\/|$)/.test(r));
  const nonGet = w.requests.filter((r) => !r.startsWith("GET "));
  expect(foreign, "requests to another origin").toEqual([]);
  expect(operational, "requests to operational API routes").toEqual([]);
  expect(nonGet, "non-GET requests (a static demo only loads files)").toEqual([]);
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "horizontal overflow").toBeLessThanOrEqual(1);
const noOperationalWording = async (page: Page) => expect(await page.locator("body").innerText()).not.toMatch(OPERATIONAL_WORDING);
const card = (page: Page, kind: string, n = 0) => page.getByTestId(`finding-${kind}`).nth(n);

test("complete visitor journey: review, sync, qualify, follow up, persist, reset", async ({ page, baseURL }) => {
  const w = watch(page);
  await page.goto("/");
  // 1. opens without signing in; persistent disclosure and first-time guide
  await expect(page.getByTestId("env-banner")).toHaveText(DISCLOSURE);
  await expect(page.getByTestId("guide")).toBeVisible();
  await expect(page.getByText("Sign in", { exact: false })).toHaveCount(0);
  // 2-3. sample research, fictional source, crop / lighting / plans / explicit unknowns
  await expect(page.getByTestId("demo-source-text")).toContainText("Fernbrook Glasshouses is a family-run grower");
  await expect(page.getByTestId("demo-source")).toContainText("fernbrook-glasshouses.example");
  await expect(card(page, "crop").getByTestId("value")).toHaveText("Tomatoes");
  await expect(card(page, "crop")).toContainText("✓ Quotation found verbatim in the source");
  await expect(card(page, "lighting").getByTestId("value")).toHaveText("Unknown");
  await expect(card(page, "lighting").getByTestId("downgrade")).toHaveText("The sample extraction claimed “Yes” — downgraded to Unknown because the evidence check failed.");
  await expect(card(page, "future").getByTestId("downgrade")).toContainText("claimed “Planned” — downgraded to Unknown");
  await expect(page.getByTestId("finding-unknown_item").filter({ hasText: "Current supplementary lighting: not established by the source" })).toHaveCount(1);
  await expect(page.getByTestId("finding-unknown_item").filter({ hasText: "Future lighting installation plans: not established by the source" })).toHaveCount(1);
  await expect(page.getByTestId("sync")).toBeDisabled(); // three sourced findings still need review
  await noOverflow(page); await noOperationalWording(page);

  // 4. correction basis is enforced
  await card(page, "crop").getByRole("button", { name: "Edit" }).click();
  await card(page, "crop").getByLabel("Edited value").fill("Truss and cherry tomatoes");
  await card(page, "crop").getByRole("button", { name: "Save and approve edit" }).click();
  await expect(card(page, "crop").getByTestId("edit-error")).toContainText("Enter the basis for this correction first");
  await expect(card(page, "crop").getByTestId("status")).toHaveText("Needs review");
  await card(page, "crop").getByLabel("Basis for edit").fill("The About page names both truss and cherry tomatoes");
  await card(page, "crop").getByRole("button", { name: "Save and approve edit" }).click();
  await expect(card(page, "crop").getByTestId("status")).toHaveText("Edited by human");
  await expect(card(page, "crop").getByTestId("edit-provenance")).toContainText("not source-verified");
  await expect(card(page, "crop").getByTestId("edit-provenance")).toContainText("The About page names both truss and cherry tomatoes");
  // approve (keep explicit unknowns) and reject
  await card(page, "lighting").getByRole("button", { name: "Keep Unknown" }).click();
  await expect(card(page, "lighting").getByTestId("status")).toHaveText("Unknown (kept)");
  await card(page, "future").getByRole("button", { name: "Keep Unknown" }).click();
  await expect(card(page, "future").getByTestId("status")).toHaveText("Unknown (kept)");
  const winter = page.getByTestId("finding-question").filter({ hasText: "extending the winter season" });
  await winter.getByRole("button", { name: "Reject" }).click();
  await expect(winter.getByTestId("status")).toHaveText("Rejected");
  const decider = page.getByTestId("finding-question").filter({ hasText: "Who makes or influences decisions on lighting investment" });
  await decider.getByRole("button", { name: "Approve" }).click();
  await expect(decider.getByTestId("status")).toHaveText("Approved (suggestion)");

  // 7a. simulated CRM sync and read-back
  await expect(page.getByTestId("sync-note")).toContainText("Nothing is sent to HubSpot");
  await page.getByTestId("sync").click();
  await expect(page.getByTestId("sync-status")).toContainText("Synced to the simulated CRM record");
  await expect(page.getByTestId("verify")).toContainText("✓ Read back from the simulated CRM record in this browser");
  await noOperationalWording(page);

  // 5. account qualification, provenance kept separate
  await page.getByRole("button", { name: "Open account workspace →" }).click();
  await expect(page.getByTestId("acct-name")).toHaveText("Fernbrook Glasshouses");
  await expect(page.getByTestId("hs-link")).toHaveCount(0);
  await expect(page.getByTestId("qual-status")).toContainText("Discovery required");
  await expect(page.getByTestId("qual-operation")).toContainText("Truss and cherry tomatoes");
  await expect(page.getByTestId("qual-operation")).toContainText("Public source");
  await expect(page.getByTestId("qual-current_led")).toContainText("Not established");
  await expect(page.getByTestId("prov-current").getByTestId("pub-value")).toHaveText("Unknown");
  await expect(page.getByTestId("questions")).toContainText("Who makes or influences decisions on lighting investment");
  await expect(page.getByTestId("questions")).not.toContainText("extending the winter season");
  await expect(page.getByTestId("no-ai-suggest")).toBeVisible();
  await noOverflow(page); await noOperationalWording(page);

  // 6. discovery conversation and a human-led fit decision (reason required)
  const form = page.getByTestId("conv-form");
  await form.getByLabel("What the grower actually reported").fill("Head grower says there is no supplementary lighting today. The board will decide on LED for Glasshouse 2 next spring.");
  await form.getByLabel("Current LED use").selectOption("No");
  await form.getByLabel("Future LED plans").selectOption("Planned");
  await form.getByLabel("Commercial need or concern").fill("Wants a longer winter season without higher heating costs");
  await form.getByLabel("Product-fit decision").selectOption("Future fit");
  await expect(page.getByTestId("save-conv")).toBeDisabled();
  await form.getByLabel(/Reason for the decision/).fill("Firm plan for Glasshouse 2 with a spring decision date");
  await page.getByTestId("save-conv").click();
  await expect(page.getByTestId("conv-msg")).toContainText("Saved");
  await expect(page.getByTestId("latest-fit")).toContainText("Future fit");
  await expect(page.getByTestId("qual-status")).toContainText("Potential future fit");
  await expect(page.getByTestId("qual-current_led")).toContainText("Customer-reported");
  await expect(page.getByTestId("prov-current").getByTestId("grower-value")).toHaveText("No");
  await expect(page.getByTestId("prov-current").getByTestId("pub-value")).toHaveText("Unknown"); // public evidence is not overwritten
  await expect(page.getByTestId("history")).toContainText("The board will decide on LED for Glasshouse 2");

  // 8. follow-up: create, see it in Follow-ups, complete with an outcome
  const tf = page.getByTestId("task-form");
  await tf.getByLabel("Action").fill("Send interlighting case study before board meeting");
  await tf.getByLabel("Owner").fill("Demo SDR");
  await page.getByTestId("create-task").click();
  const task = page.getByTestId("task").filter({ hasText: "Send interlighting case study" });
  await expect(task).toContainText("saved to simulated CRM · NOT_STARTED");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Follow-ups" }).click();
  await expect(page.getByTestId("fu-item")).toHaveCount(1);
  await expect(page.getByTestId("fu-item")).toContainText("Fernbrook Glasshouses");
  await page.getByTestId("fu-item").getByRole("button", { name: "Open account" }).click();
  await page.getByLabel("Outcome for Send interlighting case study before board meeting").fill("Sent; head grower will share it with the board");
  await page.getByTestId("task").getByRole("button", { name: "Complete" }).click();
  await expect(page.getByTestId("task")).toHaveCount(0);
  await page.getByText("Completed (1)").click();
  await expect(page.getByTestId("done-task")).toContainText("Sent; head grower will share it with the board");

  // 9. reload keeps state
  await page.reload();
  await expect(page.getByTestId("latest-fit")).toContainText("Future fit");
  await expect(page.getByText("Completed (1)")).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Research" }).click();
  await expect(card(page, "crop").getByTestId("status")).toHaveText("Edited by human");
  await expect(page.getByTestId("sync-status")).toContainText("Synced to the simulated CRM record");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Activity" }).click();
  await expect(page.getByTestId("activity")).toContainText("Follow-ups completed");
  await noOverflow(page); await noOperationalWording(page);

  // 10. reset to the original scenario
  await page.getByTestId("reset").click();
  await page.getByTestId("reset-confirm").click();
  await expect(card(page, "crop").getByTestId("status")).toHaveText("Needs review");
  await expect(card(page, "crop").getByTestId("value")).toHaveText("Tomatoes");
  await expect(page.getByTestId("guide")).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Follow-ups" }).click();
  await expect(page.getByTestId("fu-empty")).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Accounts" }).click();
  await expect(page.getByTestId("accounts")).toContainText("not synced");

  assertIsolated(w, baseURL!);
  expect(w.errors, "browser console errors").toEqual([]);
});

test("follow-ups require a synced account; sync requires every sourced finding reviewed", async ({ page }) => {
  await page.goto("/#/account/demo-fernbrook");
  await expect(page.getByTestId("needs-sync")).toContainText("sync this company first");
  await expect(page.getByTestId("task-form")).toHaveCount(0);
  await page.getByTestId("go-sync").click();
  await card(page, "crop").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("sync")).toBeDisabled();
  await expect(page.getByTestId("sync-panel")).toContainText("2 pending");
});

test("separate browser contexts do not share state", async ({ browser, baseURL }) => {
  const a: BrowserContext = await browser.newContext({ baseURL }), b: BrowserContext = await browser.newContext({ baseURL });
  const pa = await a.newPage(); await pa.goto("/");
  await card(pa, "crop").getByRole("button", { name: "Approve" }).click();
  await expect(card(pa, "crop").getByTestId("status")).toHaveText("Approved · quote found");
  const pb = await b.newPage(); await pb.goto("/");
  await expect(card(pb, "crop").getByTestId("status")).toHaveText("Needs review");
  await pa.reload(); await expect(card(pa, "crop").getByTestId("status")).toHaveText("Approved · quote found");
  await a.close(); await b.close();
});

test("the page cannot reach any API: CSP blocks fetch, and API paths serve no JSON", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("env-banner")).toBeVisible();
  const outcome = await page.evaluate(async () => { const r: string[] = []; for (const u of ["/api/research", "/api/session", "https://api.hubapi.com/crm/v3/objects/companies", "https://api.tavily.com/search"]) { try { await fetch(u, { method: "POST", body: "{}" }); r.push("reached " + u); } catch { r.push("blocked"); } } return r; });
  expect(outcome).toEqual(["blocked", "blocked", "blocked", "blocked"]);
  for (const [m, p] of [["GET", "/api/session"], ["POST", "/api/research"], ["POST", "/api/runs/demo-run-1/sync"], ["GET", "/auth/login"]] as const) {
    const r = m === "GET" ? await request.get(p, { maxRedirects: 0 }) : await request.post(p, { data: {}, maxRedirects: 0 });
    expect(r.headers()["content-type"] ?? "", `${m} ${p}`).not.toContain("json");
    expect(await r.text(), `${m} ${p}`).not.toMatch(/"(authenticated|run|findings|hubspot_id)"\s*:/);
    expect(r.headers()["set-cookie"], `${m} ${p} sets no cookie`).toBeUndefined();
  }
});
