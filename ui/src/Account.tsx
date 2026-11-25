/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { api, newId } from "./api";
import { Card, Err, Pill, inputCls, primary, ghost, btn, DEMO } from "./ui";

const today = () => new Date().toISOString().slice(0, 10);
const tone = (v: string): "green" | "slate" | "amber" => (v === "Unknown" ? "slate" : "green");

function Provenance({ label, p }: { label: string; p: any }) {
  return (
    <div className="rounded border border-slate-300 p-3" data-testid={`prov-${label.split(" ")[0].toLowerCase()}`}>
      <h3 className="text-sm font-semibold">{label}</h3>
      <dl className="mt-2 space-y-2 text-sm">
        <div><dt className="text-xs uppercase tracking-wide text-slate-600">Public source (human-approved)</dt><dd><b data-testid="pub-value">{p.public.value}</b> <Pill tone={p.public.state === "Verified public" ? "green" : "slate"}>{p.public.state === "Verified public" ? "Approved · quote found" : p.public.state}</Pill>{p.public.quote && <q className="mt-1 block text-xs text-slate-600">{p.public.quote}</q>}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-slate-600">Grower-reported</dt><dd><b data-testid="grower-value">{p.grower.value}</b> {p.grower.on && <span className="text-xs text-slate-600">({p.grower.channel}, {p.grower.on})</span>}</dd></div>
        <div className="border-t pt-2"><dt className="text-xs uppercase tracking-wide text-slate-600">Working view</dt><dd><Pill tone={tone(p.working.value)}>{p.working.value} · {p.working.provenance}</Pill></dd></div>
      </dl>
      {p.conflict && <p className="mt-2 rounded bg-amber-100 p-2 text-xs text-amber-900" role="note">Public information and the grower disagree. Both are kept; confirm which is current.</p>}
    </div>
  );
}

export default function Account({ id, onResearch, onSyncScreen }: { id: string; onResearch: () => void; onSyncScreen: (runId: string) => void }) {
  const [a, setA] = useState<any>(null), [err, setErr] = useState<string | null>(null), [loading, setLoading] = useState(true);
  const load = useCallback(async () => { const r = await api.account(id); setLoading(false); if (r.ok) setA(r.data); else setErr(r.data.error ?? "Could not load account"); }, [id]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  // conversation form (request id persists across retries so a double-click/refresh-retry cannot duplicate)
  const blank = () => ({ request_id: newId(), occurred_on: today(), channel: "Phone", grower_reported: "", current_led: "Unknown", future_led: "Unknown", need_or_concern: "", fit: "Unknown", fit_reason: "" });
  const [cv, setCv] = useState(blank()), [cvBusy, setCvBusy] = useState(false), [cvMsg, setCvMsg] = useState<string | null>(null);
  const saveConv = async () => {
    setErr(null); setCvMsg(null); setCvBusy(true); let r: any;
    try { r = await api.conversation(id, cv); } finally { setCvBusy(false); }
    if (!r.ok) { setErr(r.data.error ?? "Could not save conversation"); return; }
    setCvMsg(`Saved${r.data.duplicate ? " (already recorded; no duplicate created)" : ""}.${r.data.warnings?.length ? " Check: " + r.data.warnings.join(" ") : ""}`); setCv(blank()); load();
  };
  // task form
  const blankTask = () => ({ request_id: newId(), subject: "", owner: "", due_on: today() });
  const [tk, setTk] = useState(blankTask()), [tkBusy, setTkBusy] = useState(false);
  const saveTask = async () => {
    setErr(null); setTkBusy(true); let r: any;
    try { r = await api.createTask(id, tk); } finally { setTkBusy(false); }
    if (!r.ok) { setErr(`${r.data.error ?? "Task failed"}${r.data.recoverable ? " — not saved to HubSpot; press Create follow-up again to retry safely (same request, no duplicate)." : ""}`); load(); return; }
    setTk(blankTask()); load();
  };
  const [outcome, setOutcome] = useState<Record<string, string>>({});
  // One completion attempt = one request id (kept across retries while the outcome text is unchanged), so a retry after a lost response is the SAME operation.
  const [cids, setCids] = useState<Record<string, { rid: string; outcome: string }>>({});
  const complete = async (tid: string) => {
    const text = (outcome[tid] ?? "").trim(); let e = cids[tid];
    if (!e || e.outcome !== text) { e = { rid: newId(), outcome: text }; setCids((c) => ({ ...c, [tid]: e })); }
    setErr(null); setBusy("c" + tid);
    try { const r = await api.completeTask(tid, e.outcome, e.rid); if (!r.ok) setErr(r.data.error ?? "Could not complete"); else { setCids((c) => { const n = { ...c }; delete n[tid]; return n; }); load(); } } finally { setBusy(""); }
  };
  const [q, setQ] = useState(""), [note, setNote] = useState(""), [noteRid, setNoteRid] = useState<{ rid: string; text: string } | null>(null);
  // One note attempt = one request id (kept across retries while the text is unchanged): a retry after a lost response cannot add a duplicate note.
  const noteReq = (text: string) => { let e = noteRid; if (!e || e.text !== text) { e = { rid: newId(), text }; setNoteRid(e); } return e; };
  const [busy, setBusy] = useState("");
  const run = async (key: string, fn: () => Promise<any>) => { setErr(null); setBusy(key); let r: any = { ok: false, data: { error: "Failed" } }; try { r = await fn(); } finally { setBusy(""); } if (!r.ok) setErr(r.data.error ?? "Failed"); else load(); return r; };

  if (loading) return <p role="status">Loading account…</p>;
  if (!a) return <Err msg={err ?? "Account not found"} />;
  const s = a.summary, co = a.company;
  const openTasks = a.tasks.filter((t: any) => !t.completed_at);
  const doneTasks = a.tasks.filter((t: any) => t.completed_at);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-xl font-bold" data-testid="acct-name">{co.name}</h1>
          <p className="text-sm text-slate-600">{co.domain ?? "no domain recorded"} · {DEMO ? <>CRM (simulated): <Pill tone={co.sync_status === "synced" ? "green" : "amber"}>{co.sync_status === "synced" ? "synced" : "not synced yet"}</Pill></> : <>HubSpot: {co.hubspot_id ? <a className="underline" target="_blank" rel="noreferrer" href={a.hubspot_url ?? "#"} data-testid="hs-link">record {co.hubspot_id} ↗</a> : <Pill tone="amber">not in HubSpot yet ({co.sync_status})</Pill>}</>}</p></div>
        <button className={ghost} onClick={onResearch}>{DEMO ? "Back to research" : "Research again"}</button>
      </div>
      {co.sync_stale && <div role="status" data-testid="stale" className="rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">{DEMO ? "The simulated CRM record" : "HubSpot"} holds an <b>older version</b> of this company\u2019s approved evidence. Open the research screen and press “{DEMO ? "Sync changes" : "Sync changes to HubSpot"}”.</div>}
      {(co.evidence_conflicts ?? []).length > 0 && <div role="alert" data-testid="evidence-conflict" className="rounded border border-red-400 bg-red-50 p-2 text-sm text-red-900"><b>Unresolved evidence conflict.</b> A later review of an older run disagrees with the newest run: {(co.evidence_conflicts as any[]).map((c) => `${c.kind}: “${c.winner.value}” (newest run) vs “${c.other.value}” (older run, reviewed later)`).join("; ")}. Reject or edit the older finding, or re-review the newer one. Sync is blocked until resolved.</div>}
      <Err msg={err} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What we know (sources kept separate)" id="known">
          <div className="grid gap-3 sm:grid-cols-2"><Provenance label="Current lighting" p={s.current} /><Provenance label="Planned lighting" p={s.future} /></div>
          <p className="mt-3 text-sm">Crop: <b>{s.crop.value}</b> <Pill tone={s.crop.state === "Verified public" ? "green" : "slate"}>{s.crop.state === "Verified public" ? "Approved · quote found" : s.crop.state}</Pill></p>
          <details className="mt-2 text-sm"><summary className="cursor-pointer">Public evidence behind this ({a.public_evidence.length})</summary>
            <ul className="mt-1 space-y-1">{a.public_evidence.map((e: any) => <li key={e.id}><b>{e.kind}</b>: {e.value} {e.status === "edited" && <Pill tone="violet">human-edited</Pill>}{e.quote && <q className="block text-xs text-slate-600">{e.quote} — {e.source_id}</q>}</li>)}</ul></details>
        </Card>
        {s.qualification && <Card title="LightYield qualification (derived; the decision is yours)" id="qual">
          <p className="text-sm" data-testid="qual-status"><b>Status:</b> <Pill tone={s.qualification.status === "Discovery required" ? "amber" : s.qualification.status === "No established fit" ? "slate" : "green"}>{s.qualification.status}</Pill> <span className="text-xs text-slate-600">{s.qualification.decided_by ? `your decision on ${s.qualification.decided_by.on}` : "no fit decision recorded yet"}</span></p>
          <p className="mt-1 text-xs text-slate-600">{s.qualification.caveat}</p>
          <table className="mt-2 w-full text-left text-sm" data-testid="qual-table"><thead><tr className="text-xs uppercase text-slate-600"><th className="pr-2">Dimension</th><th className="pr-2">Value</th><th>Source</th></tr></thead><tbody>
            {s.qualification.rows.map((r: any) => <tr key={r.key} className="border-t align-top" data-testid={`qual-${r.key}`}><td className="py-1 pr-2 font-medium">{r.label}</td><td className="py-1 pr-2">{r.value}{r.note && <div className="text-xs text-amber-900">{r.note}</div>}{r.ask && <div className="text-xs text-slate-600">Ask: {r.ask}</div>}</td><td className="py-1"><Pill tone={r.state === "unknown" ? "amber" : r.state === "customer" ? "violet" : "green"}>{r.source}</Pill></td></tr>)}
          </tbody></table>
        </Card>}
        <Card title="Fit and next questions" id="fit">
          <div className="rounded bg-sky-50 p-2 text-sm" data-testid="hypothesis"><b>System hypothesis (not a decision):</b> {s.hypothesis}</div>
          <p className="mt-2 text-sm" data-testid="latest-fit"><b>Recorded fit decision:</b> {s.latest_fit ? <><Pill tone={s.latest_fit.fit === "Unknown" ? "slate" : "green"}>{s.latest_fit.fit}</Pill> <span className="text-slate-600">{s.latest_fit.on} · {s.latest_fit.channel}</span>{s.latest_fit.reason && <span className="block text-slate-700">Reason: {s.latest_fit.reason}</span>}</> : <span className="text-slate-600">none yet — recorded only by a person after a conversation</span>}</p>
          {s.gaps.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-amber-900" data-testid="gaps">{s.gaps.map((g: string) => <li key={g}>{g}</li>)}</ul>}
          <p className="mt-2 text-xs text-slate-600">Other LightYield product directions are research-stage hypotheses only and are not assessed here.</p>
        </Card>
      </div>

      <Card title="Discovery questions" id="qs">
        <ul className="space-y-1 text-sm" data-testid="questions">{a.questions.length === 0 && <li className="text-slate-600">{DEMO ? "No questions yet. Approve questions in research or add your own." : "No questions yet. Approve questions in research, add your own, or ask the AI to propose some."}</li>}
          {a.questions.filter((x: any) => x.status !== "dropped").map((x: any) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 p-2"><span className="min-w-0 flex-1">{x.text}</span>
              <Pill tone={x.origin === "human" ? "slate" : "sky"}>{x.origin === "human" ? "yours" : DEMO ? "suggested" : "AI suggestion"}</Pill><Pill tone={x.status === "proposed" ? "amber" : x.status === "asked" ? "green" : "slate"}>{x.status}</Pill>
              {x.status === "proposed" && <button className={ghost} onClick={() => run("q" + x.id, () => api.acceptQuestion(x.id))}>Accept</button>}
              {x.status === "open" && <button className={ghost} onClick={() => run("q" + x.id, () => api.setQuestion(x.id, "asked"))}>Mark asked</button>}
              <button className={ghost} onClick={() => run("q" + x.id, () => api.setQuestion(x.id, "dropped"))}>Drop</button></li>))}</ul>
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (q.trim()) { const r = await run("addq", () => api.addQuestion(id, q.trim())); if (r.ok) setQ(""); } }}>
          <label className="w-full min-w-0 text-sm sm:w-auto sm:flex-1">Add your own question<input aria-label="Add your own question" className={inputCls} value={q} maxLength={300} onChange={(e) => setQ(e.target.value)} /></label>
          <button className={`${primary} self-end`} disabled={!q.trim()}>Add</button>
          {DEMO ? <p className="w-full text-xs text-slate-600" data-testid="no-ai-suggest">AI-suggested questions need a live model, so they are not part of this demo.</p> : <button type="button" className={`${ghost} self-end`} disabled={busy === "sug"} onClick={() => run("sug", () => api.suggest(id))}>{busy === "sug" ? "Asking AI…" : "Suggest questions (AI)"}</button>}
        </form>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Record a conversation (your words, not AI)" id="conv">
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); saveConv(); }} data-testid="conv-form">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Date<input type="date" max={today()} className={inputCls} value={cv.occurred_on} onChange={(e) => setCv({ ...cv, occurred_on: e.target.value })} /></label>
              <label className="text-sm">Channel<select className={inputCls} value={cv.channel} onChange={(e) => setCv({ ...cv, channel: e.target.value })}>{["Phone", "Email", "Video call", "In person", "Other"].map((c) => <option key={c}>{c}</option>)}</select></label>
            </div>
            <label className="block text-sm">What the grower actually reported<textarea className={`${inputCls} h-24`} maxLength={3000} value={cv.grower_reported} onChange={(e) => setCv({ ...cv, grower_reported: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Current LED use<select className={inputCls} value={cv.current_led} onChange={(e) => setCv({ ...cv, current_led: e.target.value })}>{["Unknown", "Yes", "No"].map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="text-sm">Future LED plans<select className={inputCls} value={cv.future_led} onChange={(e) => setCv({ ...cv, future_led: e.target.value })}>{["Unknown", "Planned", "Not planned"].map((c) => <option key={c}>{c}</option>)}</select></label>
            </div>
            <label className="block text-sm">Commercial need or concern<input className={inputCls} maxLength={2000} value={cv.need_or_concern} onChange={(e) => setCv({ ...cv, need_or_concern: e.target.value })} /></label>
            <label className="block text-sm">Product-fit decision<select className={inputCls} value={cv.fit} onChange={(e) => setCv({ ...cv, fit: e.target.value })}>{["Unknown", "Current fit", "Future fit", "No established need"].map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="block text-sm">Reason for the decision{cv.fit !== "Unknown" && <span className="text-red-800"> (required)</span>}<input className={inputCls} maxLength={2000} value={cv.fit_reason} onChange={(e) => setCv({ ...cv, fit_reason: e.target.value })} /></label>
            <button className={primary} disabled={cvBusy || !cv.grower_reported.trim() || (cv.fit !== "Unknown" && !cv.fit_reason.trim())} data-testid="save-conv">{cvBusy ? "Saving…" : "Save conversation"}</button>
            {cvMsg && <p role="status" className="text-sm text-green-800" data-testid="conv-msg">{cvMsg}</p>}
          </form>
        </Card>
        <Card title="History" id="hist">
          <ul className="space-y-2 text-sm" data-testid="history">{a.conversations.length === 0 && <li className="text-slate-600">No conversations recorded.</li>}
            {a.conversations.map((c: any) => <li key={c.id} className="rounded border border-slate-200 p-2"><div className="flex flex-wrap items-center gap-2"><b>{c.occurred_on}</b> <span className="text-slate-600">{c.channel}</span> <Pill tone="slate">now: {c.current_led}</Pill> <Pill tone="slate">plans: {c.future_led}</Pill> <Pill tone={c.fit === "Unknown" ? "slate" : "green"}>{c.fit}</Pill></div><p className="mt-1">{c.grower_reported}</p>{c.need_or_concern && <p className="text-slate-600">Concern: {c.need_or_concern}</p>}{c.fit_reason && <p className="text-slate-600">Reason: {c.fit_reason}</p>}</li>)}</ul>
          <h3 className="mt-3 text-sm font-semibold">Internal observations</h3>
          <ul className="text-sm">{a.notes.map((n: any) => <li key={n.id} className="border-b py-1">{n.text} <span className="text-xs text-slate-600">{n.created_at.slice(0, 10)}</span></li>)}</ul>
          <form className="mt-1 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (note.trim()) { const e = noteReq(note.trim()); const r = await run("note", () => api.note(id, { request_id: e.rid, text: e.text })); if (r.ok) { setNote(""); setNoteRid(null); } } }}>
            <input aria-label="Internal observation" className={`${inputCls} mt-0 flex-1`} placeholder="Internal observation" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /><button className={ghost} disabled={!note.trim()}>Add</button></form>
        </Card>
      </div>

      <Card title={DEMO ? "Next action (follow-up task)" : "Next action (HubSpot follow-up task)"} id="tasks">
        {!co.hubspot_id || co.sync_status !== "synced" ? <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900" data-testid="needs-sync" role="status">
            {DEMO ? <p><b>Follow-ups belong to the CRM record, so sync this company first.</b> It has not been synced to the simulated CRM yet. Syncing uses only the findings you approved.</p> : <p><b>Follow-ups are saved to HubSpot, so this company must be synced first.</b> Current state: {!co.hubspot_id ? "not yet synced (no HubSpot company)" : `sync status "${co.sync_status}"`}. Researching a company never creates a HubSpot record by itself; syncing does, and only with the findings you approved.</p>}
            {a.latest_run_id ? <button className={`${primary} mt-2`} data-testid="go-sync" onClick={() => onSyncScreen(a.latest_run_id)}>Go to this company's research to review and sync</button> : <p className="mt-1">No research run found for this company: run research first.</p>}
          </div> : (
          <form className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); saveTask(); }} data-testid="task-form">
            <label className="text-sm">Action<input className={inputCls} maxLength={200} value={tk.subject} onChange={(e) => setTk({ ...tk, subject: e.target.value })} /></label>
            <label className="text-sm">Owner<input className={inputCls} maxLength={80} value={tk.owner} onChange={(e) => setTk({ ...tk, owner: e.target.value })} /></label>
            <label className="text-sm">Due<input type="date" min={today()} className={inputCls} value={tk.due_on} onChange={(e) => setTk({ ...tk, due_on: e.target.value })} /></label>
            <button className={`${primary} self-end`} disabled={tkBusy || !tk.subject.trim() || !tk.owner.trim()} data-testid="create-task">{tkBusy ? "Saving…" : "Create follow-up"}</button>
          </form>)}
        {DEMO ? <p className="mt-1 text-xs text-slate-600">In this demo, follow-ups are stored in your browser and their CRM status is simulated.</p> : <p className="mt-1 text-xs text-slate-600">Optional limitation, not an error: the owner you type is saved as text in the task. Assigning a real HubSpot owner needs an extra API permission this key deliberately lacks. It does not block creating follow-ups.</p>}
        <ul className="mt-3 space-y-2" data-testid="task-list">{openTasks.length === 0 && <li className="text-sm text-slate-600">No open follow-ups.</li>}
          {openTasks.map((t: any) => <li key={t.id} className="rounded border border-slate-300 p-2 text-sm" data-testid="task">
            <div className="flex flex-wrap items-center gap-2"><b>{t.subject}</b> <span>due {t.due_on}</span> <span className="text-slate-600">owner {t.owner}</span>
              {t.overdue && <Pill tone="red">overdue</Pill>}
              {t.op_state === "created" ? <Pill tone="green">{DEMO ? "saved to simulated CRM" : "saved in HubSpot"} · {t.hubspot_status ?? "status unavailable"}</Pill> : <Pill tone="amber">not saved to HubSpot ({t.op_state})</Pill>}</div>
            {t.op_state !== "created" ? <div className="mt-1"><p className="text-red-800">{t.last_error}</p><button className={ghost} onClick={async () => { setErr(null); const r = await api.createTask(id, { request_id: t.request_id, subject: t.subject, owner: t.owner, due_on: t.due_on }); if (!r.ok) setErr(r.data.error); load(); }}>Retry saving</button></div> : (
              <>{t.completion_pending ? (
                <div className="mt-2 rounded border border-amber-400 bg-amber-50 p-2" data-testid="completion-pending" role="status">
                  <p>A completion with outcome <b>“{t.completion_pending.outcome}”</b> was started but not confirmed (the response may have been lost; HubSpot may already show it as completed). Resume to reconcile it safely — it will not create a second operation.</p>
                  <button className={btn("bg-green-700 text-white hover:bg-green-800")} disabled={busy === "r" + t.id} data-testid="resume-completion" onClick={async () => { setErr(null); setBusy("r" + t.id); try { const r = await api.resumeCompletion(t.id); if (!r.ok) setErr(r.data.error ?? "Could not resume the completion"); else load(); } finally { setBusy(""); } }}>{busy === "r" + t.id ? "Resuming…" : "Resume completion"}</button>
                </div>) : (
              <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); complete(t.id); }}>
                <input aria-label={`Outcome for ${t.subject}`} className={`${inputCls} mt-0 min-w-0 flex-1`} placeholder="Completion outcome (required)" maxLength={500} value={outcome[t.id] ?? ""} onChange={(e) => setOutcome({ ...outcome, [t.id]: e.target.value })} />
                <button className={btn("bg-green-700 text-white hover:bg-green-800")} disabled={!(outcome[t.id] ?? "").trim() || busy === "c" + t.id}>{busy === "c" + t.id ? "Completing…" : "Complete"}</button></form>)}</>
              )}
          </li>)}</ul>
        {doneTasks.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer">Completed ({doneTasks.length})</summary><ul>{doneTasks.map((t: any) => <li key={t.id} className="border-b py-1" data-testid="done-task"><b>{t.subject}</b> — {t.outcome} <span className="text-xs text-slate-600">{t.completed_at?.slice(0, 10)}</span></li>)}</ul></details>}
      </Card>
    </div>
  );
}
