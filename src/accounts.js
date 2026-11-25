// Account workspace, human-entered conversations/qualification, discovery questions, HubSpot tasks, follow-ups, metrics.
import { hubspot, HubspotError, assertTestAccount } from "./hubspot.js";
import { presentCompany, COMPANY_COLS } from "./company.js";
import { validateConversation, validateTask, summariseAccount, selectEvidence, normText, normName, SOURCED } from "./logic.js";

import { eventStmt, withEvent } from "./audit.js";
const now = () => new Date().toISOString();
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
// CRM reads obey the same account policy as writes: ONE gate result per request; nothing is read from HubSpot when it fails.
async function crmGate(env) { if (!env.HUBSPOT_TEST_TOKEN) return { ok: false, reason: "HubSpot not configured" }; return assertTestAccount(env, hubspot(env.HUBSPOT_TEST_TOKEN)); }
const hubspotLink = (gate, hid) => (gate.ok && hid ? `https://${gate.uiDomain}/contacts/${gate.portalId}/record/0-2/${hid}` : null);

export async function listAccounts(env) {
  const rows = await all(env, `SELECT c.id, c.name, c.domain, c.hubspot_id, c.sync_status, c.updated_at,
    (SELECT fit FROM conversations v WHERE v.company_id=c.id ORDER BY occurred_on DESC, created_at DESC LIMIT 1) AS latest_fit,
    (SELECT count(*) FROM tasks t WHERE t.company_id=c.id AND t.completed_at IS NULL AND t.op_state='created') AS open_tasks,
    (SELECT count(*) FROM research_runs r WHERE r.company_id=c.id) AS runs FROM companies c ORDER BY c.updated_at DESC LIMIT 100`);
  return { accounts: rows };
}

// ---- discovery questions derived from approved findings: created once, then kept consistent with their source finding ----
export function reconcileQuestionStmts(env, findingId) { // per finding (used inside the review transaction AND on every account load)
  const t = now();
  const applicable = "(SELECT review_status FROM findings WHERE id=?) IN ('approved','edited')";
  return [
    // 1. a rejected / not-yet-reviewed source finding withdraws its (not yet asked) question
    env.DB.prepare("UPDATE questions SET status='dropped', updated_at=? WHERE finding_id=? AND status IN ('open','proposed') AND (SELECT review_status FROM findings WHERE id=?) IN ('rejected','needs_review')").bind(t, findingId, findingId),
    // 2. a question dropped BY THE SYSTEM (duplicate collapse) comes back when its finding is applicable again; one the USER dropped (event status_dropped) never does
    env.DB.prepare(`UPDATE questions SET status='open', updated_at=? WHERE finding_id=? AND status='dropped' AND ${applicable} AND NOT EXISTS (SELECT 1 FROM events e WHERE e.entity='question' AND e.entity_id=questions.id AND e.action='status_dropped')`).bind(t, findingId, findingId),
    // 3. keep the text of open/proposed questions equal to their (edited) source finding
    env.DB.prepare(`UPDATE questions SET text=(SELECT final_value FROM findings WHERE id=?), updated_at=? WHERE finding_id=? AND status IN ('open','proposed') AND ${applicable} AND text != COALESCE((SELECT final_value FROM findings WHERE id=?), text)`).bind(findingId, t, findingId, findingId, findingId),
  ];
}
async function syncQuestions(env, companyId) {
  // Derived questions follow the account evidence-selection policy (union of approved questions across runs). ONE canonical normaliser (normText) is used for matching and de-duplication.
  const rows = await all(env, "SELECT f.*, r.created_at AS run_at, r.rowid AS run_ord FROM findings f JOIN research_runs r ON r.id=f.run_id WHERE r.company_id=? AND f.kind='question' ORDER BY r.rowid, f.rowid", companyId);
  const sel = selectEvidence(rows.map((f) => ({ ...f, flags: [] }))), fin = new Map(rows.map((f) => [f.id, f]));
  let qs = await all(env, "SELECT id, text, origin, status, finding_id, created_at FROM questions WHERE company_id=?", companyId);
  // 1. DETACH: an asked / user-dropped question whose source finding now says something else is HISTORY. finding_id is UNIQUE, so the link is released (recorded as an event) and the
  //    current approved question can materialise; the history row keeps its text, status and timestamps.
  for (const q of qs) { const f = q.finding_id && fin.get(q.finding_id); if (f && ["asked", "dropped"].includes(q.status) && ["approved", "edited"].includes(f.review_status) && normText(f.final_value) !== normText(q.text)) {
    await env.DB.batch([env.DB.prepare("UPDATE questions SET finding_id=NULL, updated_at=? WHERE id=? AND finding_id=?").bind(now(), q.id, q.finding_id), env.DB.prepare("INSERT INTO events (id, entity, entity_id, action, detail, at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), "question", q.id, "detached_from_finding", JSON.stringify({ finding_id: q.finding_id, kept_text: q.text, status: q.status, current_finding_value: f.final_value }).slice(0, 500), now())]); q.finding_id = null; } }
  // 2. MATERIALISE the current approved questions that have no active equivalent
  const activeKey = () => new Set(qs.filter((q) => ["open", "proposed", "asked"].includes(q.status)).map((q) => normText(q.text))), linked = () => new Set(qs.map((q) => q.finding_id).filter(Boolean));
  for (const f of sel.questions) { if (linked().has(f.id) || activeKey().has(normText(f.final_value))) continue; const id = crypto.randomUUID(); await env.DB.prepare("INSERT INTO questions (id,company_id,text,origin,status,finding_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id, companyId, f.final_value, "ai_suggestion", "open", f.id, now(), now()).run(); qs.push({ id, text: f.final_value, origin: "ai_suggestion", status: "open", finding_id: f.id, created_at: now() }); }
  // 3. RECONCILE linked rows with their findings (drop on rejection, revive system-dropped, refresh text)
  const links = (await all(env, "SELECT finding_id FROM questions WHERE company_id=? AND finding_id IS NOT NULL", companyId));
  if (links.length) await env.DB.batch(links.flatMap((q) => reconcileQuestionStmts(env, q.finding_id)));
  // 4. DE-DUPLICATE active questions by normText: keep asked > human > oldest; the rest are dropped (rows + finding links kept as history)
  qs = await all(env, "SELECT id, text, origin, status, created_at FROM questions WHERE company_id=? AND status IN ('open','proposed','asked')", companyId); const groups = new Map();
  for (const q of qs) { const k = normText(q.text); (groups.get(k) ?? groups.set(k, []).get(k)).push(q); }
  const rank = (q) => [q.status === "asked" ? 0 : 1, q.origin === "human" ? 0 : 1, q.created_at, q.id]; const drops = [];
  for (const g of groups.values()) if (g.length > 1) { g.sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; }); for (const q of g.slice(1)) if (q.status !== "asked") drops.push(env.DB.prepare("UPDATE questions SET status='dropped', updated_at=? WHERE id=?").bind(now(), q.id)); }
  if (drops.length) await env.DB.batch(drops);
}

async function liveTasks(env, rows, gate) {
  const ids = rows.map((t) => t.hubspot_task_id).filter(Boolean);
  const live = {};
  if (ids.length && gate?.ok) {
    try { for (const x of (await hubspot(env.HUBSPOT_TEST_TOKEN).batchTasks(ids)).results || []) live[x.id] = x.properties; } catch { /* shown as unavailable */ }
  }
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((t) => {
    const p = live[t.hubspot_task_id];
    const status = p ? p.hs_task_status : t.completed_at ? "COMPLETED" : null;
    return { id: t.id, company_id: t.company_id, company_name: t.company_name, subject: t.subject, owner: t.owner_label, due_on: t.due_at.slice(0, 10), op_state: t.op_state, completion_pending: t.completion_request_id && !t.completed_at ? { request_id: t.completion_request_id, outcome: t.completion_outcome, state: t.completion_state } : null, last_error: t.last_error, hubspot_task_id: t.hubspot_task_id, hubspot_status: status, hubspot_read: !!p, crm_blocked: gate?.ok ? null : (gate?.reason || "CRM access not verified"), completed_at: t.completed_at, outcome: t.completion_outcome, completion_state: t.completion_state, overdue: !t.completed_at && t.op_state === "created" && t.due_at.slice(0, 10) < today, request_id: t.request_id };
  });
}

export async function getAccount(env, id) {
  const row = await one(env, `SELECT ${COMPANY_COLS} FROM companies c WHERE c.id=?`, id);
  if (!row) return null;
  const gate = await crmGate(env);
  await syncQuestions(env, id);
  const findings = (await all(env, "SELECT f.*, r.source_id, r.created_at AS run_at, r.rowid AS run_ord FROM findings f JOIN research_runs r ON r.id=f.run_id WHERE r.company_id=? ORDER BY f.rowid", id)).map((f) => ({ ...f, flags: parse(f.flags, []) }));
  const conversations = await all(env, "SELECT * FROM conversations WHERE company_id=? ORDER BY occurred_on DESC, created_at DESC", id);
  const notes = await all(env, "SELECT id, text, created_at FROM notes WHERE company_id=? ORDER BY created_at DESC", id);
  const questions = await all(env, "SELECT id, text, origin, status FROM questions WHERE company_id=? ORDER BY created_at", id);
  const taskRows = await all(env, "SELECT t.*, ? AS company_name FROM tasks t WHERE company_id=? ORDER BY due_at", row.name, id);
  const tasks = await liveTasks(env, taskRows, gate);
  const runs = await all(env, "SELECT id, source_id, created_at, ai_status, duration_ms FROM research_runs WHERE company_id=? ORDER BY created_at DESC", id);
  const openTasks = tasks.filter((t) => !t.completed_at && t.op_state === "created").length;
  const summary = summariseAccount({ findings, conversations, openTasks });
  const publicEvidence = findings.filter((f) => SOURCED.includes(f.kind) && ["approved", "edited"].includes(f.review_status));
  const pc = presentCompany(row); // unresolved evidence conflicts (policy) can never be "current"
  const company = { ...pc, candidates: parse(row.candidates, []), evidence_conflicts: summary.conflicts, sync_stale: pc.sync_stale || (pc.sync_status === "synced" && summary.conflicts.length > 0) };
  return { company, hubspot_url: hubspotLink(gate, row.hubspot_id), crm_blocked: gate.ok ? null : gate.reason, summary, public_evidence: publicEvidence.map((f) => ({ id: f.id, kind: f.kind, value: f.final_value, status: f.review_status, quote: f.quote, quote_verified: !!f.quote_verified, source_id: f.source_id, note: f.note })), questions, conversations, notes, tasks, runs, latest_run_id: runs[0]?.id || null };
}

// ---- idempotency: a request_id is bound to ONE account and ONE payload. Same key + same account + same content = duplicate success;
// anything else is a conflict (never another account's record, never a silently ignored change). ----
const keyConflict = (existing, companyId, same, what) => !existing ? null
  : existing.company_id !== companyId ? { status: 409, body: { error: `This request_id was already used for a different account; use a new one`, idempotency_conflict: true } }
  : !same(existing) ? { status: 409, body: { error: `This request_id was already used with different ${what}; use a new one for a new entry`, idempotency_conflict: true } } : null;
const sameConv = (c) => (r) => r.occurred_on === c.occurred_on && r.channel === c.channel && r.grower_reported === c.grower_reported && r.current_led === c.current_led && r.future_led === c.future_led && (r.need_or_concern || "") === (c.need_or_concern || "") && r.fit === c.fit && (r.fit_reason || "") === (c.fit_reason || "");

export async function addConversation(env, companyId, body, actor) {
  const co = await one(env, "SELECT id FROM companies WHERE id=?", companyId); if (!co) return { status: 404, body: { error: "not found" } };
  const v = validateConversation(body); if (!v.ok) return { status: 400, body: { error: v.errors.join("; "), errors: v.errors } };
  const c = v.value, same = sameConv(c);
  const check = async () => { const ex = await one(env, "SELECT * FROM conversations WHERE request_id=?", c.request_id); const k = keyConflict(ex, companyId, same, "content"); return k || (ex ? { status: 200, body: { conversation: ex, duplicate: true, warnings: v.warnings } } : null); };
  const pre = await check(); if (pre) return pre;
  const id = crypto.randomUUID();
  try {
    await withEvent(env, [
      env.DB.prepare("INSERT INTO conversations (id,request_id,company_id,occurred_on,channel,grower_reported,current_led,future_led,need_or_concern,fit,fit_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, c.request_id, companyId, c.occurred_on, c.channel, c.grower_reported, c.current_led, c.future_led, c.need_or_concern, c.fit, c.fit_reason || null, now()),
      env.DB.prepare("UPDATE companies SET updated_at=? WHERE id=?").bind(now(), companyId),
    ], ["conversation", id, "recorded", { fit: c.fit, current: c.current_led, future: c.future_led }], actor);
  } catch (e) { const again = await check(); if (again) return again; throw e; } // lost a race on the unique key: judge the winner by the same rules
  return { status: 201, body: { conversation: await one(env, "SELECT * FROM conversations WHERE id=?", id), warnings: v.warnings } };
}

export async function addNote(env, companyId, body, actor) {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 2000 || !/^[0-9a-f-]{16,64}$/i.test(String(body?.request_id || ""))) return { status: 400, body: { error: "note text (max 2000) and request_id required" } };
  const co = await one(env, "SELECT id FROM companies WHERE id=?", companyId); if (!co) return { status: 404, body: { error: "not found" } };
  const same = (r) => r.text === text;
  const check = async () => { const ex = await one(env, "SELECT id, company_id, text, created_at FROM notes WHERE request_id=?", body.request_id); const k = keyConflict(ex, companyId, same, "text"); return k || (ex ? { status: 200, body: { note: ex, duplicate: true } } : null); };
  const pre = await check(); if (pre) return pre;
  const id = crypto.randomUUID(), t = now();
  try { await withEvent(env, [env.DB.prepare("INSERT INTO notes (id,request_id,company_id,text,created_at) VALUES (?,?,?,?,?)").bind(id, body.request_id, companyId, text, t)], ["note", id, "added", { company: companyId }], actor); }
  catch (e) { const again = await check(); if (again) return again; throw e; }
  return { status: 201, body: { note: { id, text, created_at: t } } };
}

export async function addQuestion(env, companyId, body, actor) {
  const text = typeof body?.text === "string" ? body.text.trim() : ""; if (!text || text.length > 300) return { status: 400, body: { error: "question text required (max 300)" } };
  const co = await one(env, "SELECT id FROM companies WHERE id=?", companyId); if (!co) return { status: 404, body: { error: "not found" } };
  const id = crypto.randomUUID();
  await withEvent(env, [env.DB.prepare("INSERT INTO questions (id,company_id,text,origin,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id, companyId, text, "human", "open", now(), now())], ["question", id, "added", { company: companyId }], actor);
  return { status: 201, body: { id } };
}
export async function setQuestion(env, id, body, actor) {
  if (!["open", "asked", "dropped"].includes(body?.status)) return { status: 400, body: { error: "status must be open, asked or dropped" } };
  const res = await withEvent(env, [env.DB.prepare("UPDATE questions SET status=?, updated_at=? WHERE id=?").bind(body.status, now(), id)], ["question", id, "status_" + body.status, {}], actor, { onlyIfChanged: true });
  return res[0].meta.changes ? { status: 200, body: { ok: true } } : { status: 404, body: { error: "not found" } };
}
const SUGGEST_SCHEMA = { type: "object", properties: { questions: { type: "array", items: { type: "string" } } }, required: ["questions"] };
export async function suggestQuestions(env, companyId, model, actor) {
  const a = await getAccount(env, companyId); if (!a) return { status: 404, body: { error: "not found" } };
  const s = a.summary;
  const facts = [`Crop (human-approved public evidence): ${s.crop.value}`, `Current supplementary lighting: ${s.current.working.value} (${s.current.working.provenance})`, `Future lighting plans: ${s.future.working.value} (${s.future.working.provenance})`];
  const prompt = `You help a salesperson prepare discovery questions for a UK greenhouse grower. Use ONLY these facts and gaps; do not invent facts about the grower.\nFacts:\n${facts.join("\n")}\nGaps:\n${s.gaps.join("\n") || "none"}\nReturn 3 short, open, non-leading questions as JSON {"questions": [...]}.`;
  let out; try { out = await env.AI.run(model, { messages: [{ role: "user", content: prompt }], response_format: { type: "json_schema", json_schema: SUGGEST_SCHEMA }, max_tokens: 400 }); } catch { return { status: 502, body: { error: "AI call failed; add questions manually" } }; }
  let p = out?.response ?? out?.choices?.[0]?.message?.content; try { if (typeof p === "string") p = JSON.parse(p); } catch { return { status: 502, body: { error: "AI output invalid; add questions manually" } }; }
  const have = new Set(a.questions.map((q) => q.text.toLowerCase()));
  const qs = (Array.isArray(p?.questions) ? p.questions : []).filter((q) => typeof q === "string" && q.trim().length > 5 && q.length <= 300 && !have.has(q.trim().toLowerCase())).slice(0, 3);
  await env.DB.batch([...qs.map((q) => env.DB.prepare("INSERT INTO questions (id,company_id,text,origin,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), companyId, q.trim(), "ai_suggestion", "proposed", now(), now())), eventStmt(env, "question", companyId, "suggested", { count: qs.length }, actor)]);
  return { status: 200, body: { added: qs.length, neurons: out?.usage?.neurons ?? null } };
}
export async function acceptQuestion(env, id, actor) {
  const res = await withEvent(env, [env.DB.prepare("UPDATE questions SET status='open', updated_at=? WHERE id=? AND status='proposed'").bind(now(), id)], ["question", id, "accepted", {}], actor, { onlyIfChanged: true });
  return res[0].meta.changes ? { status: 200, body: { ok: true } } : { status: 409, body: { error: "not a proposed question" } };
}

// ---------------- HubSpot tasks ----------------
const WAIT_MS = 60000, taskMarker = (id) => `[LY-TASK:${id}]`;
class TaskLeaseLost extends Error { constructor() { super("task operation lease lost"); this.leaseLost = true; } }
const taskLeaseMs = (env) => Number(env.TASK_LEASE_MS) || 120000; // test-only override; production uses the default
// `renew` runs before EVERY provider page: a long paginated scan keeps its lease only while it is still the owner; a lost lease aborts the scan.
async function findTaskByMarker(hs, id, renew, maxPages = 20) {
  let after; const hits = [];
  for (let i = 0; i < maxPages; i++) {
    await renew();
    const p = await hs.list("tasks", ["hs_task_body", "hs_task_subject"], after);
    for (const r of p.results || []) if ((r.properties?.hs_task_body || "").includes(taskMarker(id))) hits.push(r.id);
    after = p.paging?.next?.after; if (!after) return { hits, complete: true };
  }
  return { hits, complete: false };
}
// Every state write of the creating operation is conditional on its lease token. A transition out of 'creating' also releases the lease.
async function setOwned(env, id, token, patch) {
  if (patch.op_state && patch.op_state !== "creating") patch = { ...patch, lease_until: null, lease_owner: null };
  const keys = Object.keys(patch); const r = await env.DB.prepare(`UPDATE tasks SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=? AND lease_owner=? AND op_state!='created'`).bind(...keys.map((k) => patch[k]), id, token).run();
  if (!r.meta.changes) throw new TaskLeaseLost();
}
const leaseLostBody = (rid) => ({ error: "Another request took over this follow-up creation (this request's lease expired). Nothing was overwritten; retry with the same request_id to see the result.", lease_lost: true, request_id: rid });
export async function createTask(env, companyId, body, fault, actor) {
  // A RETRY of an existing operation (same request_id) is validated for shape only: the due date may have become "past" since the first attempt, and that must not
  // block recovery or force the client to change the payload under the same operation id (it would be an idempotency conflict).
  const existing = typeof body?.request_id === "string" ? await one(env, "SELECT id FROM tasks WHERE request_id=?", body.request_id) : null;
  const v = validateTask(body, existing ? "0000-00-00" : undefined); if (!v.ok) return { status: 400, body: { error: v.errors.join("; "), errors: v.errors } };
  const co = await one(env, "SELECT * FROM companies WHERE id=?", companyId); if (!co) return { status: 404, body: { error: "not found" } };
  if (!co.hubspot_id || co.sync_status !== "synced") return { status: 409, body: { error: "Sync the company to HubSpot (and resolve its identity) before creating a follow-up." } };
  if (!env.HUBSPOT_TEST_TOKEN) return { status: 503, body: { error: "HubSpot test token not configured" } };
  const gate = await crmGate(env); if (!gate.ok) return { status: 403, body: { error: gate.reason } };
  const t = v.value; let row = await one(env, "SELECT * FROM tasks WHERE request_id=?", t.request_id);
  const taskConflict = (r) => (r.company_id !== companyId ? { status: 409, body: { error: "This request_id was already used for a different account; use a new one", idempotency_conflict: true } } : r.subject !== t.subject || r.owner_label !== t.owner || String(r.due_at).slice(0, 10) !== t.due_on ? { status: 409, body: { error: "This request_id was already used with different content; use a new one for a new follow-up", idempotency_conflict: true } } : null);
  if (row) { const c = taskConflict(row); if (c) return c; }
  if (!row) {
    const id = crypto.randomUUID();
    try { await env.DB.prepare("INSERT INTO tasks (id,request_id,company_id,op_state,subject,owner_label,due_at,conversation_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, t.request_id, companyId, "creating", t.subject, t.owner, t.due_on + "T09:00:00Z", body.conversation_id || null, now()).run(); } catch { /* concurrent insert */ }
    row = await one(env, "SELECT * FROM tasks WHERE request_id=?", t.request_id);
    const c2 = taskConflict(row); if (c2) return c2; // a concurrent request with the same key but another account/payload won the insert
  }
  if (row.op_state === "created") return { status: 200, body: { task: (await liveTasks(env, [{ ...row, company_name: co.name }], gate))[0], duplicate: true } };
  // Explicit operation OWNER: only the holder of `token` may write this task's state; expiry hands ownership to a later request.
  const token = crypto.randomUUID(), ms = taskLeaseMs(env);
  const lease = await env.DB.prepare("UPDATE tasks SET lease_owner=?, lease_until=?, op_state='creating' WHERE id=? AND op_state!='created' AND (lease_until IS NULL OR lease_until<?)").bind(token, Date.now() + ms, row.id, Date.now()).run();
  if (!lease.meta.changes) { const cur = await one(env, "SELECT * FROM tasks WHERE id=?", row.id); return cur.op_state === "created" ? { status: 200, body: { task: (await liveTasks(env, [{ ...cur, company_name: co.name }], gate))[0], duplicate: true } } : { status: 409, body: { error: "this follow-up is already being created", in_progress: true } }; }
  const renew = async () => { const r = await env.DB.prepare("UPDATE tasks SET lease_until=? WHERE id=? AND lease_owner=? AND op_state!='created'").bind(Date.now() + ms, row.id, token).run(); if (!r.meta.changes) throw new TaskLeaseLost(); };
  const fresh = await one(env, "SELECT * FROM tasks WHERE id=?", row.id);
  const hs = hubspot(env.HUBSPOT_TEST_TOKEN);
  try {
    let tid = fresh.hubspot_task_id;
    if (!tid) {
      const found = await findTaskByMarker(hs, row.id, renew);
      if (found.hits.length > 1) { await setOwned(env, row.id, token, { op_state: "failed", last_error: "multiple HubSpot tasks carry this marker" }); return { status: 409, body: { error: "ambiguous: multiple HubSpot tasks carry this follow-up's marker; resolve in HubSpot (nothing was created)" } }; }
      if (found.hits.length === 1) tid = found.hits[0];
      else if (!found.complete) throw new Error("task scan incomplete: cannot rule out an earlier create; reconcile in HubSpot");
      else if (fresh.create_sent_at && Date.now() - fresh.create_sent_at < WAIT_MS) { await setOwned(env, row.id, token, { op_state: "uncertain" }); return { status: 409, body: { error: "a previous create may have succeeded; retry shortly", retry_after_s: Math.ceil((WAIT_MS - (Date.now() - fresh.create_sent_at)) / 1000) } }; }
    }
    if (!tid) {
      if (fault === "hubspot-4xx") throw new HubspotError("client", 400, "simulated HubSpot 400 (fault injection)");
      await renew(); // ownership must be CURRENT immediately before the only irreversible step
      await setOwned(env, row.id, token, { create_sent_at: Date.now(), op_state: "creating" });
      if (fault === "hubspot-5xx") throw new HubspotError("server", 503, "simulated HubSpot 503 (fault injection)");
      let c;
      try { c = await hs.createTask({ hs_timestamp: fresh.due_at, hs_task_subject: fresh.subject, hs_task_status: "NOT_STARTED", hs_task_body: `Owner: ${fresh.owner_label}\n${taskMarker(row.id)}` }, co.hubspot_id); }
      catch (e) { if (e instanceof HubspotError && e.kind === "client") await setOwned(env, row.id, token, { create_sent_at: null, op_state: "creating" }); throw e; }
      if (fault === "hubspot-lost-response") throw new HubspotError("network", 0, "simulated lost response after create (fault injection)");
      tid = c.id;
    }
    await setOwned(env, row.id, token, { hubspot_task_id: tid, create_sent_at: null, op_state: "creating" });
    // verify: association to the RIGHT company, and the content we wrote
    let assoc = await hs.taskCompanies(tid);
    if (!assoc.includes(String(co.hubspot_id))) { // one repair attempt via default association
      await renew();
      await fetch(`https://api.hubapi.com/crm/v4/objects/tasks/${tid}/associations/default/companies/${co.hubspot_id}`, { method: "PUT", headers: { authorization: `Bearer ${env.HUBSPOT_TEST_TOKEN}` } });
      assoc = await hs.taskCompanies(tid);
    }
    const back = await hs.getTask(tid);
    if (!assoc.includes(String(co.hubspot_id)) || back.properties?.hs_task_subject !== fresh.subject) { await setOwned(env, row.id, token, { op_state: "failed", last_error: "task exists in HubSpot but is not associated with the right company or content mismatched; not shown as success" }); return { status: 502, body: { error: "Task created in HubSpot but could not be verified as associated with the right company; not shown as success", op_state: "failed", request_id: t.request_id } }; }
    const fin = await env.DB.batch([env.DB.prepare("UPDATE tasks SET op_state='created', last_error=NULL, lease_until=NULL, lease_owner=NULL WHERE id=? AND lease_owner=? AND op_state!='created'").bind(row.id, token), eventStmt(env, "task", row.id, "created", { hubspot_task_id: tid, company: companyId }, actor, { onlyIfChanged: true })]);
    if (!fin[0].meta.changes) throw new TaskLeaseLost();
    return { status: 201, body: { task: (await liveTasks(env, [{ ...(await one(env, "SELECT * FROM tasks WHERE id=?", row.id)), company_name: co.name }], gate))[0], association_verified: true } };
  } catch (e) {
    if (e instanceof TaskLeaseLost) return { status: 409, body: leaseLostBody(t.request_id) }; // never touch state we no longer own
    try {
      const sent = (await one(env, "SELECT create_sent_at, hubspot_task_id FROM tasks WHERE id=?", row.id)) || {};
      const uncertain = !sent.hubspot_task_id && !!sent.create_sent_at && (!(e instanceof HubspotError) || ["network", "server"].includes(e.kind));
      await setOwned(env, row.id, token, { op_state: uncertain ? "uncertain" : "failed", last_error: String(e.message).slice(0, 300) });
      return { status: 502, body: { error: e.message, op_state: uncertain ? "uncertain" : "failed", recoverable: true, request_id: t.request_id } };
    } catch (e2) { if (e2 instanceof TaskLeaseLost) return { status: 409, body: leaseLostBody(t.request_id) }; throw e2; }
  }
}


// Completion is an idempotent, OUTCOME-AWARE operation. The (request_id, outcome) intent is recorded first (first writer wins); HubSpot receives a
// marker `[LY-DONE:<request_id>] Outcome: <outcome>` so a retry after a lost response recognises its own earlier write. A different outcome for a
// task whose completion may already have been applied is a conflict (409), never a silently different record in D1 vs HubSpot.
export async function completeTask(env, taskId, body, fault, actor) {
  const outcome = typeof body?.outcome === "string" ? body.outcome.trim() : "";
  let rid = String(body?.request_id || "");
  if (!outcome || outcome.length > 500) return { status: 400, body: { error: "completion outcome required (max 500)" } };
  if (!/^[0-9a-f-]{16,64}$/i.test(rid)) return { status: 400, body: { error: "request_id required" } };
  const row = await one(env, "SELECT t.*, c.name AS company_name FROM tasks t JOIN companies c ON c.id=t.company_id WHERE t.id=?", taskId);
  if (!row) return { status: 404, body: { error: "not found" } };
  if (row.op_state !== "created") return { status: 409, body: { error: "task is not saved in HubSpot yet; retry creation first" } };
  const gate = await crmGate(env); if (!gate.ok) return { status: 403, body: { error: gate.reason } };
  const conflict = (why) => ({ status: 409, body: { error: why, idempotency_conflict: true } });
  if (row.completed_at) return row.completion_outcome === outcome ? { status: 200, body: { task: (await liveTasks(env, [row], gate))[0], duplicate: true } } : conflict("This task was already completed with a different outcome; the recorded outcome is unchanged.");
  const pending = "A completion with a different outcome was already started and may have been applied in HubSpot. Resume the pending completion (same outcome), or check the task in HubSpot first.";
  // One completion INTENT per task (first writer wins). Re-submitting the SAME outcome (e.g. after a reload, with a new request id) RECONCILES that intent
  // under its stored request id; a different outcome is a conflict. A new contradictory operation can never be started silently.
  if (row.completion_request_id) { if (row.completion_outcome !== outcome) return conflict(pending); rid = row.completion_request_id; }
  else {
    const r = await env.DB.prepare("UPDATE tasks SET completion_request_id=?, completion_outcome=?, completion_state='pending' WHERE id=? AND completion_request_id IS NULL").bind(rid, outcome, taskId).run();
    if (!r.meta.changes) { const again = await one(env, "SELECT * FROM tasks WHERE id=?", taskId); if (again.completion_outcome !== outcome) return conflict(pending); rid = again.completion_request_id; }
  }
  const hs = hubspot(env.HUBSPOT_TEST_TOKEN), marker = `[LY-DONE:${rid}]`;
  try {
    const cur = await hs.getTask(row.hubspot_task_id), body0 = cur.properties?.hs_task_body || "";
    if (!body0.includes(marker)) {
      if (cur.properties?.hs_task_status === "COMPLETED") { // finished in HubSpot by someone else: do not pretend we recorded their outcome
        await env.DB.prepare("UPDATE tasks SET completion_request_id=NULL, completion_outcome=NULL, completion_state=NULL WHERE id=? AND completion_request_id=? AND completed_at IS NULL").bind(taskId, rid).run();
        return { status: 409, body: { error: "This task is already COMPLETED in HubSpot by another actor; its outcome was not recorded by LightYield. Reconcile in HubSpot.", hubspot_completed_externally: true } };
      }
      if (fault === "hubspot-4xx") throw new HubspotError("client", 400, "simulated HubSpot 400 (fault injection)");
      await hs.patchTask(row.hubspot_task_id, { hs_task_status: "COMPLETED", hs_task_body: `${body0}\n${marker} Outcome: ${outcome}` });
    }
    const back = await hs.getTask(row.hubspot_task_id), bb = back.properties?.hs_task_body || "";
    if (back.properties?.hs_task_status !== "COMPLETED" || !bb.includes(`${marker} Outcome: ${outcome}`)) return { status: 502, body: { error: "HubSpot did not record the completion as intended; retry with the same request_id and outcome", recoverable: true } };
    await withEvent(env, [env.DB.prepare("UPDATE tasks SET completed_at=?, completion_state='done' WHERE id=? AND completion_request_id=? AND completed_at IS NULL").bind(now(), taskId, rid)], ["task", taskId, "completed", { request_id: rid }], actor, { onlyIfChanged: true });
    const fin = await one(env, "SELECT t.*, c.name AS company_name FROM tasks t JOIN companies c ON c.id=t.company_id WHERE t.id=?", taskId);
    return { status: 200, body: { task: (await liveTasks(env, [fin], gate))[0] } };
  } catch (e) {
    if (e instanceof HubspotError && e.kind === "client") await env.DB.prepare("UPDATE tasks SET completion_request_id=NULL, completion_outcome=NULL, completion_state=NULL WHERE id=? AND completion_request_id=? AND completed_at IS NULL").bind(taskId, rid).run(); // definitely not applied: the intent may be changed
    return { status: 502, body: { error: e.message, recoverable: true } };
  }
}

// Authenticated resume/reconcile of the stored completion intent (used after a reload when the client lost its request id). It never invents a new
// outcome: it re-runs completion with the recorded (request_id, outcome), which first checks HubSpot for the marker before any write.
export async function resumeCompletion(env, taskId, fault, actor) {
  const row = await one(env, "SELECT * FROM tasks WHERE id=?", taskId);
  if (!row) return { status: 404, body: { error: "not found" } };
  if (!row.completion_request_id) return { status: 409, body: { error: "no completion is pending for this task" } };
  return completeTask(env, taskId, { request_id: row.completion_request_id, outcome: row.completion_outcome }, fault, actor);
}

export async function followups(env) {
  const rows = await all(env, "SELECT t.*, c.name AS company_name FROM tasks t JOIN companies c ON c.id=t.company_id WHERE t.completed_at IS NULL ORDER BY t.due_at LIMIT 100");
  return { followups: await liveTasks(env, rows, await crmGate(env)) };
}

export async function metrics(env) {
  const g = async (sql) => (await one(env, sql)) || {};
  const runs = await g("SELECT count(*) n, sum(ai_status='failed') ai_failed, round(avg(duration_ms)) avg_ms, round(avg(neurons),2) avg_neurons FROM research_runs");
  const f = await g("SELECT sum(review_status='approved') approved, sum(review_status='edited') edited, sum(review_status='rejected') rejected, sum(review_status='needs_review') pending, sum(kind IN ('crop','lighting','future') AND ai_value!=value) downgraded_by_checks, sum(kind IN ('crop','lighting','future') AND review_status='edited') corrected FROM findings");
  const cv = await all(env, "SELECT fit, count(*) n FROM conversations GROUP BY fit");
  const t = await g("SELECT count(*) created, sum(completed_at IS NOT NULL) completed, sum(completed_at IS NULL AND op_state='created') open FROM tasks");
  const today = now().slice(0, 10);
  const od = await g(`SELECT count(*) n FROM tasks WHERE completed_at IS NULL AND op_state='created' AND substr(due_at,1,10) < '${today}'`);
  const co = await g("SELECT count(*) n, sum(sync_status='synced') synced FROM companies");
  return { note: "Measured from this system's own records. No conversion or revenue claims.", research: runs, findings: f, conversations: { total: cv.reduce((a, x) => a + x.n, 0), by_fit: Object.fromEntries(cv.map((x) => [x.fit, x.n])) }, tasks: { ...t, overdue: od.n }, accounts: co };
}
