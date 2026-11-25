// L1: the HubSpot account/portal policy must be evaluated BEFORE any cached success can be returned, on reads as well as writes.
import assert from "node:assert";
import { pathToFileURL } from "node:url";
import { randomUUID as uuid } from "node:crypto";
import { makeApp, ROOT } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { assertTestAccount } = await import(pathToFileURL(`${ROOT}/src/hubspot.js`).href);
const { t, done } = suite("L1 portal policy");
const fake = (info) => ({ accountInfo: async () => info });
const TEST = { accountType: "DEVELOPER_TEST", portalId: 42 };

t("REPRODUCES CODEX L1: a cached success cannot validate a CHANGED portal pin", async () => {
  const tok = "tok-" + uuid();
  assert.equal((await assertTestAccount({ HUBSPOT_TEST_TOKEN: tok, HUBSPOT_PORTAL_ID: "42" }, fake(TEST))).ok, true);
  const changed = await assertTestAccount({ HUBSPOT_TEST_TOKEN: tok, HUBSPOT_PORTAL_ID: "43" }, fake(TEST)); assert.equal(changed.ok, false, "pin changed to a different portal: cache must not return success");
});
t("a cached success cannot validate a MISSING pin in hosted mode", async () => {
  const tok = "tok-" + uuid(); assert.equal((await assertTestAccount({ HUBSPOT_TEST_TOKEN: tok }, fake(TEST))).ok, true, "local mode without pin is allowed and cached");
  assert.equal((await assertTestAccount({ HUBSPOT_TEST_TOKEN: tok, HOSTED: "1" }, fake(TEST))).ok, false, "hosted without a pin must fail even with a warm cache");
  assert.equal((await assertTestAccount({ HUBSPOT_TEST_TOKEN: tok, HOSTED: "1", HUBSPOT_PORTAL_ID: "42" }, fake(TEST))).ok, true);
});
t("cache reuse still works for an unchanged policy (no needless HubSpot calls) and never validates a non-test account", async () => {
  const tok = "tok-" + uuid(); let calls = 0; const hs = { accountInfo: async () => { calls++; return TEST; } }; const env = { HUBSPOT_TEST_TOKEN: tok, HUBSPOT_PORTAL_ID: "42" };
  await assertTestAccount(env, hs); await assertTestAccount(env, hs); assert.equal(calls, 1, "second call served from cache");
  assert.equal((await assertTestAccount({ HUBSPOT_TEST_TOKEN: "tok-" + uuid(), HUBSPOT_PORTAL_ID: "42" }, fake({ accountType: "STANDARD", portalId: 42 }))).ok, false);
});
t("read paths also enforce the policy: account page, task list, HubSpot link and verification make NO CRM content call when the account is not a test account", async () => {
  const T = await makeApp({ portalId: 111 }), s = await T.login(1001); const a = await T.research(s, "ZZ Policy Ltd");
  assert.equal((await T.post(s, `/api/runs/${a.runId}/sync`, {})).status, 200); const tk = await T.post(s, `/api/accounts/${a.coId}/tasks`, { request_id: uuid(), subject: "Call", owner: "O", due_on: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) }); assert.equal(tk.status, 201);
  T.hs.accountType = "STANDARD"; T.env.HUBSPOT_TEST_TOKEN = "tok-" + uuid(); T.hs.calls.length = 0; // policy now violated (fresh token so no cache)
  const acct = await T.get(s, `/api/accounts/${a.coId}`); assert.equal(acct.status, 200);
  const ver = await T.get(s, `/api/runs/${a.runId}/verify`);
  const content = T.hs.calls.filter((c) => /tasks\/batch\/read|\/crm\/v3\/objects\/(companies|tasks)\/\d+|\/crm\/v4\//.test(c));
  assert.deepEqual(content, [], `CRM content must not be read under a violated policy: ${content}`); assert.equal(ver.j.verified, false); assert.match(String(ver.j.reason), /test|policy|portal/i); assert.equal(acct.j.hubspot_url, null);
  T.restore();
});
await done();
