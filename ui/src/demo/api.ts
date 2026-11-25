/* eslint-disable @typescript-eslint/no-explicit-any */
// PUBLIC DEMO ONLY: browser-local replacement for ui/src/api.ts. vite.demo.config.ts swaps it in at build time, so the demo bundle contains no HTTP client and
// no route to the operational API. It satisfies the same contract (same function names, same { ok, status, data } results) and keeps all state in this
// browser's localStorage. Business rules are LightYield's own (src/logic.js, src/company.js), run here instead of in the Worker.
// Not reproduced: live research, AI calls, HubSpot, identity resolution, multi-user storage. Those entry points return an explicit "not available" error.
import type { Res } from "../api";
import { applyReview, syncEligibility, selectEvidence, summariseAccount, validateConversation, validateTask, buildAccountDescription, buildFindings, parseAi, presentCompany, SOURCED } from "./rules";
import { DEMO_COMPANY, DEMO_EXTRACTION, DEMO_SOURCE_ID, DEMO_SOURCE_TEXT } from "./fixture";

const KEY = "lightyield-demo-v1";
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
export const newId = () => crypto.randomUUID();
export const setCsrf = (_t: string) => { /* no session in the demo */ };
type S = { v: 1; company: any; runs: any[]; findings: any[]; conversations: any[]; notes: any[]; questions: any[]; tasks: any[]; crm: { description: string; synced_at: string } | null };

function seed(): S {
  const t = now(), runId = "demo-run-1";
  const ai = parseAi({ response: JSON.stringify(DEMO_EXTRACTION) });
  if (!ai.ok) throw new Error("demo extraction failed validation");
  const { findings, runFlags } = buildFindings(ai.value, DEMO_SOURCE_TEXT, DEMO_COMPANY.name); // the real deterministic checks
  return {
    v: 1,
    company: { ...DEMO_COMPANY, hubspot_id: null, sync_status: "not_synced", sync_error: null, synced_run_id: null, synced_run_rev: null, evidence_rev: 0, synced_evidence_rev: null, identity_status: "confirmed", candidates: null, updated_at: t, lease_until: null },
    runs: [{ id: runId, company_id: DEMO_COMPANY.id, source_id: DEMO_SOURCE_ID, source_text: DEMO_SOURCE_TEXT, source_kind: "demo_fixture", model: "none", ai_status: "ok", ai_error: null, neurons: null, duration_ms: null, run_flags: runFlags, created_at: t }],
    findings: findings.map((f: any, i: number) => ({ id: `demo-f${i + 1}`, run_id: runId, ...f, review_status: "needs_review", final_value: null, note: null, reviewed_at: null })),
    conversations: [], notes: [], questions: [], tasks: [], crm: null,
  };
}
const read = (): S => { try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (s?.v === 1 && s.company && Array.isArray(s.findings)) return s; } catch { /* corrupt: reseed */ } const s = seed(); write(s); return s; };
const write = (s: S) => localStorage.setItem(KEY, JSON.stringify(s));
export const resetDemo = () => { localStorage.removeItem(KEY); write(seed()); };

const ok = <T,>(data: T): Promise<Res<T>> => Promise.resolve({ ok: true, status: 200, data: JSON.parse(JSON.stringify(data)) });
const fail = (status: number, error: string, extra: object = {}): Promise<Res> => Promise.resolve({ ok: false, status, data: { error, ...extra } as any });
const UNSUPPORTED = "Not available in the public demo: it does not connect to live search, AI or a CRM. Use the fictional Fernbrook Glasshouses scenario instead.";
const unsupported = (..._a: unknown[]) => fail(501, UNSUPPORTED, { demo_unsupported: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- read models (same shapes the Worker returns) ----
const runMeta = (s: S) => new Map(s.runs.map((r, i) => [r.id, { at: r.created_at, ord: i + 1 }]));
const withRunMeta = (s: S) => { const m = runMeta(s); return s.findings.map((f) => ({ ...f, run_at: m.get(f.run_id)?.at, run_ord: m.get(f.run_id)?.ord, source_id: s.runs.find((r) => r.id === f.run_id)?.source_id })); };
const strip = ({ run_id: _r, reviewed_at: _t, ...f }: any) => f;
const companyView = (s: S) => { const conflicts = selectEvidence(withRunMeta(s)).conflicts; const pc = presentCompany(s.company); return { ...pc, evidence_conflicts: conflicts, sync_stale: pc.sync_stale || (pc.sync_status === "synced" && conflicts.length > 0) }; };
const runData = (s: S, id: string) => { const run = s.runs.find((r) => r.id === id); return run ? { run, company: companyView(s), findings: s.findings.filter((f) => f.run_id === id).map(strip) } : null; };
const crmDescription = (s: S) => buildAccountDescription(s.company.id, selectEvidence(withRunMeta(s)), Object.fromEntries(s.runs.map((r) => [r.id, { id: r.id, source_id: r.source_id }])));
const taskView = (s: S, t: any) => ({ ...t, company_name: s.company.name, completion_pending: null, last_error: null, hubspot_task_id: null, hubspot_status: t.completed_at ? "COMPLETED" : "NOT_STARTED", overdue: !t.completed_at && t.due_on < today() });

// Discovery questions follow the approved question findings (simplified form of the Worker's reconciliation): approved -> open question; rejected or back
// in review -> an unasked question is withdrawn; edited -> text follows; a question the visitor dropped stays dropped.
function reconcileQuestions(s: S) {
  for (const f of s.findings.filter((x) => x.kind === "question")) {
    const applied = ["approved", "edited"].includes(f.review_status), q = s.questions.find((x) => x.finding_id === f.id);
    if (!q) { if (applied) s.questions.push({ id: newId(), text: f.final_value, origin: "ai_suggestion", status: "open", finding_id: f.id, user_dropped: false, created_at: now() }); continue; }
    if (!applied && ["open", "proposed"].includes(q.status)) q.status = "dropped";
    else if (applied && q.status === "dropped" && !q.user_dropped) q.status = "open";
    if (applied && ["open", "proposed"].includes(q.status)) q.text = f.final_value;
  }
}
function account(s: S) {
  reconcileQuestions(s); write(s);
  const findings = withRunMeta(s), tasks = s.tasks.map((t) => taskView(s, t)), openTasks = tasks.filter((t) => !t.completed_at).length;
  const summary = summariseAccount({ findings, conversations: s.conversations, openTasks });
  return {
    company: companyView(s), hubspot_url: null, crm_blocked: null, summary,
    public_evidence: findings.filter((f) => SOURCED.includes(f.kind) && ["approved", "edited"].includes(f.review_status)).map((f) => ({ id: f.id, kind: f.kind, value: f.final_value, status: f.review_status, quote: f.quote, quote_verified: !!f.quote_verified, source_id: f.source_id, note: f.note })),
    questions: s.questions.map(({ id, text, origin, status }) => ({ id, text, origin, status })),
    conversations: [...s.conversations].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)),
    notes: [...s.notes].sort((a, b) => b.created_at.localeCompare(a.created_at)), tasks,
    runs: s.runs.map(({ id, source_id, created_at, ai_status }) => ({ id, source_id, created_at, ai_status })), latest_run_id: s.runs[s.runs.length - 1]?.id ?? null,
  };
}
const isCo = (id: string) => id === DEMO_COMPANY.id;
const markChanged = (s: S) => { s.company.evidence_rev += 1; s.company.updated_at = now(); };

export const api = {
  session: () => ok({ authenticated: true, csrf: "", env: "demo", user: { login: "Demo visitor" } }),
  logout: () => Promise.resolve(null),
  config: () => ok({ hubspot_configured: true, model: "none (sample extraction)", preview_only: false, demo: true }),
  runs: () => { const s = read(); return ok({ runs: [...s.runs].reverse().map((r) => ({ id: r.id, name: s.company.name, created_at: r.created_at, ai_status: r.ai_status, sync_status: s.company.sync_status })) }); },
  run: (id: string) => { const d = runData(read(), id); return d ? ok(d) : fail(404, "Run not found in this browser"); },
  research: unsupported, discover: unsupported, researchWeb: unsupported, previewWeb: unsupported, resolve: unsupported, suggest: unsupported, resumeCompletion: unsupported,
  review: (id: string, b: { action: string; value?: string; note?: string }) => {
    const s = read(), f = s.findings.find((x) => x.id === id);
    if (!f) return fail(404, "Finding not found");
    const r = applyReview(f, b); // the Worker's own review rules (correction basis, no approval without a verified quotation)
    if (!r.ok) return fail(400, r.error ?? "Review failed");
    Object.assign(f, r.patch, { reviewed_at: now() }); markChanged(s); reconcileQuestions(s); write(s);
    return ok(strip(f));
  },
  sync: async (runId: string) => {
    await wait(300); // long enough to show the "Syncing…" state; no timing is displayed
    const s = read(); if (!runData(s, runId)) return fail(404, "Run not found");
    const el = syncEligibility(s.findings.filter((f) => f.run_id === runId));
    if (!el.ok) return fail(409, el.reason ?? "Not eligible to sync");
    if (companyView(s).evidence_conflicts.length) return fail(409, "Unresolved evidence conflict: resolve it before syncing.");
    s.crm = { description: crmDescription(s), synced_at: now() };
    Object.assign(s.company, { hubspot_id: "simulated", sync_status: "synced", sync_error: null, synced_run_id: runId, synced_evidence_rev: s.company.evidence_rev, updated_at: now() });
    write(s); return ok(runData(s, runId));
  },
  verify: (runId: string) => {
    const s = read(), approved = s.findings.filter((f) => f.run_id === runId && ["approved", "edited"].includes(f.review_status)).length;
    if (!s.crm) return ok({ verified: false, reason: "Nothing has been synced to the simulated CRM record yet." });
    const same = s.crm.description === crmDescription(s) && s.company.synced_evidence_rev === s.company.evidence_rev;
    return ok(same ? { verified: true, hubspot_id: "simulated", hubspot_name: s.company.name, d1_approved_findings: approved } : { verified: false, reason: "The simulated CRM record holds an older version of the approved evidence. Sync again to update it." });
  },
  accounts: () => { const s = read(), last = [...s.conversations].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at))[0];
    return ok({ accounts: [{ id: s.company.id, name: s.company.name, domain: s.company.domain, hubspot_id: s.company.hubspot_id, sync_status: s.company.sync_status, updated_at: s.company.updated_at, latest_fit: last?.fit ?? null, open_tasks: s.tasks.filter((t) => !t.completed_at).length, runs: s.runs.length }] }); },
  account: (id: string) => (isCo(id) ? ok(account(read())) : fail(404, "Account not found in this browser")),
  conversation: (id: string, b: any) => {
    if (!isCo(id)) return fail(404, "Account not found");
    const s = read(), dup = s.conversations.find((c) => c.request_id === b?.request_id);
    if (dup) return ok({ conversation: dup, duplicate: true, warnings: [] });
    const v = validateConversation(b, today()); // the Worker's validation: a reason is required for any fit decision other than Unknown
    if (!v.ok) return fail(400, v.errors.join("; "));
    const c = { id: newId(), company_id: id, ...v.value, created_at: now() }; s.conversations.push(c); s.company.updated_at = now(); write(s);
    return ok({ conversation: c, duplicate: false, warnings: v.warnings });
  },
  note: (id: string, b: any) => {
    if (!isCo(id)) return fail(404, "Account not found");
    const s = read(), text = String(b?.text ?? "").trim(); if (!text || text.length > 2000) return fail(400, "note text required (max 2000)");
    const dup = s.notes.find((n) => n.request_id === b?.request_id); if (dup) return ok({ note: dup });
    const n = { id: newId(), request_id: b?.request_id, text, created_at: now() }; s.notes.push(n); write(s); return ok({ note: n });
  },
  addQuestion: (id: string, text: string) => {
    if (!isCo(id)) return fail(404, "Account not found");
    const s = read(), t = String(text ?? "").trim(); if (!t || t.length > 300) return fail(400, "question text required (max 300)");
    const q = { id: newId(), text: t, origin: "human", status: "open", finding_id: null, user_dropped: false, created_at: now() }; s.questions.push(q); write(s); return ok({ id: q.id });
  },
  setQuestion: (id: string, status: string) => {
    const s = read(), q = s.questions.find((x) => x.id === id); if (!q) return fail(404, "Question not found");
    if (!["open", "asked", "dropped"].includes(status)) return fail(400, "invalid status");
    q.status = status; if (status === "dropped") q.user_dropped = true; write(s); return ok({ ok: true });
  },
  acceptQuestion: (id: string) => { const s = read(), q = s.questions.find((x) => x.id === id); if (!q) return fail(404, "Question not found"); q.status = "open"; write(s); return ok({ ok: true }); },
  createTask: (id: string, b: any) => {
    if (!isCo(id)) return fail(404, "Account not found");
    const s = read(); if (s.company.sync_status !== "synced") return fail(409, "Sync this company to the simulated CRM before creating a follow-up.");
    const dup = s.tasks.find((t) => t.request_id === b?.request_id); if (dup) return ok({ task: taskView(s, dup), duplicate: true });
    const v = validateTask(b, today()); if (!v.ok) return fail(400, v.errors.join("; "));
    const t = { id: newId(), company_id: id, request_id: v.value.request_id, subject: v.value.subject, owner: v.value.owner, due_on: v.value.due_on, op_state: "created", completed_at: null, outcome: null, completion_request_id: null, created_at: now() };
    s.tasks.push(t); write(s); return ok({ task: taskView(s, t) });
  },
  completeTask: (id: string, outcome: string, request_id: string) => {
    const s = read(), t = s.tasks.find((x) => x.id === id); if (!t) return fail(404, "Follow-up not found");
    const o = String(outcome ?? "").trim(); if (!o || o.length > 500) return fail(400, "an outcome is required to complete a follow-up (max 500)");
    if (t.completed_at) return t.completion_request_id === request_id ? ok({ task: taskView(s, t) }) : fail(409, "This follow-up is already completed.");
    Object.assign(t, { completed_at: now(), outcome: o, completion_request_id: request_id }); write(s); return ok({ task: taskView(s, t) });
  },
  followups: () => { const s = read(); return ok({ followups: s.tasks.filter((t) => !t.completed_at).sort((a, b) => a.due_on.localeCompare(b.due_on)).map((t) => taskView(s, t)) }); },
  metrics: () => {
    const s = read(), f = s.findings, by = (st: string) => f.filter((x) => x.review_status === st).length, byFit: Record<string, number> = {};
    for (const c of s.conversations) byFit[c.fit] = (byFit[c.fit] ?? 0) + 1;
    const done = s.tasks.filter((t) => t.completed_at).length;
    return ok({ note: "Counted from the fictional data in this browser. No conversion or revenue figures.", research: { n: s.runs.length, ai_failed: 0 },
      findings: { approved: by("approved"), edited: by("edited"), rejected: by("rejected"), pending: by("needs_review"), downgraded_by_checks: f.filter((x) => SOURCED.includes(x.kind) && x.ai_value !== x.value).length },
      conversations: { total: s.conversations.length, by_fit: byFit }, tasks: { created: s.tasks.length, completed: done, open: s.tasks.length - done, overdue: s.tasks.filter((t) => taskView(s, t).overdue).length },
      accounts: { n: 1, synced: s.company.sync_status === "synced" ? 1 : 0 } });
  },
};
