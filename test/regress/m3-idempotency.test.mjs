// M3: idempotency keys are bound to account + operation + payload. A key used for account A must never produce A's record for account B.
import assert from "node:assert";
import { randomUUID as uuid } from "node:crypto";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("M3 idempotency attribution");
const today = () => new Date().toISOString().slice(0, 10), due = () => new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
const conv = (k, text = "Synthetic: unlit today.") => ({ request_id: k, occurred_on: today(), channel: "Phone", grower_reported: text, current_led: "No", future_led: "Unknown", need_or_concern: "", fit: "Unknown", fit_reason: "" });
const n = (T, table, col, v) => T.DB.one(`SELECT count(*) c FROM ${table} WHERE ${col}=?`, v).c;

t("REPRODUCES CODEX M3: a conversation key reused for ANOTHER account is rejected and never reported as a duplicate success", async () => {
  const T = await makeApp(), s = await T.login(1001); const A = await T.research(s, "ZZ Acct A", { approve: false }), B = await T.research(s, "ZZ Acct B", { approve: false }); const k = uuid();
  assert.equal((await T.post(s, `/api/accounts/${A.coId}/conversations`, conv(k, "A's private statement"))).status, 201);
  const b = await T.post(s, `/api/accounts/${A.coId === B.coId ? "x" : B.coId}/conversations`, conv(k, "B's statement"));
  assert.equal(b.status, 409, `cross-account key reuse must be rejected (got ${b.status}); B received: ${JSON.stringify(b.j.conversation?.grower_reported)}`);
  assert.equal(n(T, "conversations", "company_id", B.coId), 0, "B must not have been given A's conversation"); T.restore();
});
t("conversation: identical retry = duplicate success; changed payload under the same key = conflict, original untouched", async () => {
  const T = await makeApp(), s = await T.login(1001); const A = await T.research(s, "ZZ Conv Ltd", { approve: false }); const k = uuid();
  assert.equal((await T.post(s, `/api/accounts/${A.coId}/conversations`, conv(k))).status, 201); const dup = await T.post(s, `/api/accounts/${A.coId}/conversations`, conv(k)); assert.equal(dup.status, 200); assert.equal(dup.j.duplicate, true);
  const changed = await T.post(s, `/api/accounts/${A.coId}/conversations`, conv(k, "A DIFFERENT statement")); assert.equal(changed.status, 409, "same key, different payload must not be silently treated as a duplicate");
  assert.equal(T.DB.one("SELECT grower_reported g FROM conversations WHERE request_id=?", k).g, "Synthetic: unlit today."); T.restore();
});
t("notes: same rules (cross-account and changed payload are conflicts)", async () => {
  const T = await makeApp(), s = await T.login(1001); const A = await T.research(s, "ZZ Note A", { approve: false }), B = await T.research(s, "ZZ Note B", { approve: false }); const k = uuid();
  assert.equal((await T.post(s, `/api/accounts/${A.coId}/notes`, { request_id: k, text: "A note" })).status, 201); assert.equal((await T.post(s, `/api/accounts/${A.coId}/notes`, { request_id: k, text: "A note" })).j.duplicate, true);
  assert.equal((await T.post(s, `/api/accounts/${B.coId}/notes`, { request_id: k, text: "A note" })).status, 409); assert.equal((await T.post(s, `/api/accounts/${A.coId}/notes`, { request_id: k, text: "changed" })).status, 409); assert.equal(n(T, "notes", "company_id", B.coId), 0); T.restore();
});
t("tasks: same key for another account or with a changed payload is a conflict; identical retry is a duplicate", async () => {
  const T = await makeApp(), s = await T.login(1001); const A = await T.research(s, "ZZ Task A"), B = await T.research(s, "ZZ Task B");
  for (const x of [A, B]) assert.equal((await T.post(s, `/api/runs/${x.runId}/sync`, {})).status, 200); const k = uuid(), body = { request_id: k, subject: "Call", owner: "Owner", due_on: due() };
  assert.equal((await T.post(s, `/api/accounts/${A.coId}/tasks`, body)).status, 201); assert.equal((await T.post(s, `/api/accounts/${A.coId}/tasks`, body)).j.duplicate, true);
  assert.equal((await T.post(s, `/api/accounts/${B.coId}/tasks`, body)).status, 409); assert.equal((await T.post(s, `/api/accounts/${A.coId}/tasks`, { ...body, subject: "Changed subject" })).status, 409, "changed payload under the same key");
  assert.equal(T.hs.tasks.size, 1, "exactly one HubSpot task"); T.restore();
});
t("simultaneous requests with the same key for DIFFERENT accounts: exactly one wins, the other is a conflict (no cross-attribution)", async () => {
  const T = await makeApp(), s = await T.login(1001); const A = await T.research(s, "ZZ Sim A", { approve: false }), B = await T.research(s, "ZZ Sim B", { approve: false }); const k = uuid();
  const rs = await Promise.all([T.post(s, `/api/accounts/${A.coId}/conversations`, conv(k, "from A")), T.post(s, `/api/accounts/${B.coId}/conversations`, conv(k, "from B"))]);
  const codes = rs.map((r) => r.status).sort(); assert.deepEqual(codes, [201, 409], `statuses ${codes}`); assert.equal(T.DB.one("SELECT count(*) c FROM conversations WHERE request_id=?", k).c, 1); T.restore();
});
t("simultaneous task creation for different accounts with one key: one HubSpot task, one conflict", async () => {
  const T = await makeApp(), s = await T.login(1001); const A = await T.research(s, "ZZ Tsim A"), B = await T.research(s, "ZZ Tsim B"); for (const x of [A, B]) await T.post(s, `/api/runs/${x.runId}/sync`, {}); const body = { request_id: uuid(), subject: "Call", owner: "Owner", due_on: due() };
  const rs = await Promise.all([T.post(s, `/api/accounts/${A.coId}/tasks`, body), T.post(s, `/api/accounts/${B.coId}/tasks`, body)]); const codes = rs.map((r) => r.status).sort(); assert.deepEqual(codes, [201, 409], `statuses ${codes}`); assert.equal(T.hs.tasks.size, 1); T.restore();
});
await done();
