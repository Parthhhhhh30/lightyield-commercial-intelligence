/* eslint-disable @typescript-eslint/no-explicit-any */
export type Finding = { id: string; kind: "crop" | "lighting" | "future" | "unknown_item" | "question"; ai_value: string; value: string; quote: string; quote_verified: boolean; flags: string[]; review_status: "needs_review" | "approved" | "edited" | "rejected"; final_value: string | null; note: string | null };
export type Company = { id: string; name: string; domain: string | null; hubspot_id: string | null; sync_status: string; sync_stale?: boolean; evidence_rev?: number; evidence_conflicts?: { kind: string; winner: { value: string }; other: { value: string } }[]; sync_error: string | null; synced_run_id: string | null; identity_status: string; candidates: string | null };
export type Run = { id: string; source_id: string; source_text: string; source_kind: string; model: string; ai_status: string; ai_error: string | null; neurons: number | null; duration_ms: number | null; run_flags: string[]; created_at: string };
export type RunData = { run: Run; company: Company; findings: Finding[]; reused?: boolean; error?: string };
export type Verify = { verified: boolean; reason?: string; hubspot_id?: string; hubspot_name?: string; d1_approved_findings?: number };
export type Candidate = { id: string; name: string; domain: string };

let csrf = "";
export const setCsrf = (t: string) => { csrf = t; };
export const newId = () => crypto.randomUUID();
export type Res<T = any> = { ok: boolean; status: number; data: T & { error?: string; network?: boolean; malformed?: boolean } };
// The client NEVER rejects. SUCCESS = HTTP 2xx AND a parseable JSON body AND the endpoint's required fields are present. A network failure, abort, timeout,
// truncated/interrupted/non-JSON/incomplete body all become { ok:false, ... data:{ error, network|malformed } } so no caller can show a false "saved".
// Mutations carry client-generated request ids, so retrying after any of these is safe (idempotent).
type Check = (d: any) => string | null;
const isObj = (d: any) => !!d && typeof d === "object" && !Array.isArray(d);
const has = (...paths: string[]): Check => (d) => { if (!isObj(d)) return "not an object"; for (const p of paths) { const v = p.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), d); if (v === undefined || v === null) return `missing ${p}`; } return null; };
const arr = (k: string): Check => (d) => (isObj(d) && Array.isArray(d[k]) ? null : `missing ${k}[]`);
const okTrue: Check = (d) => (isObj(d) && d.ok === true ? null : "missing ok");
const runData: Check = (d) => has("run.id", "company.id")(d) ?? (Array.isArray(d.findings) ? null : "missing findings[]");
const timeoutMs = (method: string) => (window as any).__LY_TIMEOUT_MS ?? (method === "GET" ? 30000 : 120000);
const NET = "Network error: the server could not be reached. Nothing was confirmed; your input is kept and retrying is safe.";
const TIMEOUT = "The request timed out. It may or may not have been applied; retrying is safe because it reuses the same request id.";
const unreadable = (status: number, why: string) => `The server's response could not be read (HTTP ${status}: ${why}). The action may or may not have been applied; reload to check, or retry (safe: same request id).`;
async function call<T = any>(method: string, path: string, body?: unknown, check?: Check): Promise<Res<T>> {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs(method));
  const fail = (status: number, error: string, extra: object = {}) => ({ ok: false, status, data: { error, ...extra } as any });
  try {
    let r: Response;
    try { r = await fetch(path, { method, signal: ctl.signal, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), "x-csrf-token": csrf }, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch { return fail(0, ctl.signal.aborted ? TIMEOUT : NET, { network: true }); }
    let text: string;
    try { text = await r.text(); } catch { return fail(r.status, ctl.signal.aborted ? TIMEOUT : unreadable(r.status, "the connection was interrupted while reading"), { network: true, malformed: r.ok }); }
    let data: any, parsed = true; try { data = JSON.parse(text); } catch { parsed = false; }
    if (r.status === 401 && path !== "/api/session") window.dispatchEvent(new Event("ly-unauth"));
    if (!parsed) return fail(r.status, r.ok ? unreadable(r.status, "not valid JSON; the body may be truncated") : `Unexpected response (${r.status})`, { malformed: true });
    if (!r.ok) return { ok: false, status: r.status, data: isObj(data) ? data : { error: `Unexpected response (${r.status})` } };
    const why = check ? check(data) : null;
    if (why) return fail(r.status, unreadable(r.status, "incomplete answer: " + why), { malformed: true });
    return { ok: true, status: r.status, data };
  } finally { clearTimeout(timer); }
}
export const api = {
  session: () => call("GET", "/api/session", undefined, (d) => (isObj(d) && typeof d.authenticated === "boolean" ? null : "missing authenticated")),
  logout: () => fetch("/auth/logout", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf } }).catch(() => null),
  config: () => call("GET", "/api/config", undefined, has()),
  runs: () => call("GET", "/api/runs", undefined, arr("runs")),
  run: (id: string) => call<RunData>("GET", `/api/runs/${id}`, undefined, runData),
  research: (b: { businessName: string; sourceId: string; sourceText: string; domain?: string; force?: boolean }) => call<RunData>("POST", "/api/research", b, runData),
  discover: (b: { businessName: string; website?: string; location?: string }) => call<any>("POST", "/api/discover", b, has("candidates", "ambiguity", "registry")),
  researchWeb: (b: { businessName: string; website: string; confirmed_identity: boolean; candidate_company_number?: string; use_search?: boolean; force?: boolean }) => call<any>("POST", "/api/research/web", b, runData),
  previewWeb: (b: { businessName: string; website: string; confirmed_identity: boolean }) => call<any>("POST", "/api/research/preview", b, has("findings", "web_sources")),
  review: (id: string, b: { action: string; value?: string; note?: string }) => call<Finding>("POST", `/api/findings/${id}/review`, b, has("id", "review_status")),
  sync: (id: string) => call<any>("POST", `/api/runs/${id}/sync`, {}, runData),
  verify: (id: string) => call<Verify>("GET", `/api/runs/${id}/verify`, undefined, (d) => (isObj(d) && typeof d.verified === "boolean" ? null : "missing verified")),
  resolve: (companyId: string, b: { action: string; hubspot_id?: string }) => call("POST", `/api/companies/${companyId}/resolve`, b, okTrue),
  accounts: () => call("GET", "/api/accounts", undefined, arr("accounts")),
  account: (id: string) => call("GET", `/api/accounts/${id}`, undefined, (d) => has("company.id", "summary")(d) ?? arr("tasks")(d) ?? arr("conversations")(d) ?? arr("questions")(d) ?? arr("notes")(d)),
  conversation: (id: string, b: unknown) => call("POST", `/api/accounts/${id}/conversations`, b, has("conversation.id")),
  note: (id: string, b: unknown) => call("POST", `/api/accounts/${id}/notes`, b, has("note.id")),
  addQuestion: (id: string, text: string) => call("POST", `/api/accounts/${id}/questions`, { text }, has("id")),
  suggest: (id: string) => call("POST", `/api/accounts/${id}/suggest-questions`, {}, (d) => (isObj(d) && typeof d.added === "number" ? null : "missing added")),
  setQuestion: (id: string, status: string) => call("POST", `/api/questions/${id}`, { status }, okTrue),
  acceptQuestion: (id: string) => call("POST", `/api/questions/${id}/accept`, {}, okTrue),
  createTask: (id: string, b: unknown) => call("POST", `/api/accounts/${id}/tasks`, b, has("task.id")),
  completeTask: (id: string, outcome: string, request_id: string) => call("POST", `/api/tasks/${id}/complete`, { outcome, request_id }, has("task.id")),
  resumeCompletion: (id: string) => call("POST", `/api/tasks/${id}/resume-completion`, {}, has("task.id")),
  followups: () => call("GET", "/api/followups", undefined, arr("followups")),
  metrics: () => call("GET", "/api/metrics", undefined, has()),
};
