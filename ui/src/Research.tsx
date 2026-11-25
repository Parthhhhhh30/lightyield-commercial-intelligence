import { useEffect, useState } from "react";
import { api, type Finding, type RunData, type Verify, type Candidate } from "./api";
import { FLAG_TEXT, KIND, DEMO } from "./ui";
import { DemoSource } from "./demoSlots";
import Preview from "./Preview";

const SOURCED = ["crop", "lighting", "future"];
function badge(f: Finding): { label: string; cls: string } {
  if (f.review_status === "rejected") return { label: "Rejected", cls: "bg-red-100 text-red-800 border-red-300" };
  if (f.review_status === "edited") return { label: "Edited by human", cls: "bg-violet-100 text-violet-800 border-violet-300" };
  if (f.review_status === "approved") {
    if ((f.kind === "crop" || f.kind === "lighting" || f.kind === "future") && f.value !== "Unknown") return { label: "Approved · quote found", cls: "bg-green-100 text-green-800 border-green-300" };
    if (SOURCED.includes(f.kind)) return { label: "Unknown (kept)", cls: "bg-slate-200 text-slate-800 border-slate-400" };
    return { label: DEMO ? "Approved (suggestion)" : "Approved (AI suggestion)", cls: "bg-sky-100 text-sky-800 border-sky-300" };
  }
  return { label: "Needs review", cls: "bg-amber-100 text-amber-900 border-amber-300" };
}

function FindingCard({ f, onChange, onError }: { f: Finding; onChange: (f: Finding) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(f.final_value ?? f.value);
  const [note, setNote] = useState(""), [localErr, setLocalErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const b = badge(f);
  const sourced = f.kind === "crop" || f.kind === "lighting" || f.kind === "future";
  const act = async (action: string, extra: { value?: string; note?: string } = {}) => {
    setBusy(true);
    const r = await api.review(f.id, { action, ...extra });
    setBusy(false);
    if (r.ok) { onChange(r.data as Finding); setEditing(false); setLocalErr(null); } else { const m = r.data.error ?? "Review failed"; setLocalErr(m); onError(m); }
  };
  const shown = f.final_value ?? f.value;
  return (
    <li className="rounded-lg border border-slate-300 bg-white p-4" data-testid={`finding-${f.kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{KIND[f.kind]}</h3>
        <span className={`rounded border px-2 py-0.5 text-xs font-medium ${b.cls}`} data-testid="status">{b.label}</span>
      </div>
      <p className="mt-1 text-lg font-medium" data-testid="value">{shown}</p>
      {f.ai_value !== f.value && <p className="text-xs text-red-800" data-testid="downgrade">{DEMO ? "The sample extraction" : "AI"} claimed “{f.ai_value}” — downgraded to {f.value} because the evidence check failed.</p>}
      {sourced && f.review_status === "edited" && f.final_value !== f.value && <p className="mt-2 rounded border border-violet-300 bg-violet-50 p-2 text-sm text-violet-900" data-testid="edit-provenance">Human correction — <b>not</b> source-verified. Original AI/source finding: <b>{f.ai_value}</b>{f.quote ? <> (quote: “{f.quote}”)</> : null}. Basis you gave: {f.note ?? "—"}</p>}
      {sourced && !(f.review_status === "edited" && f.final_value !== f.value) && (
        f.quote ? (
          <blockquote className="mt-2 border-l-4 border-slate-300 pl-3 text-sm text-slate-700">“{f.quote}”
            <div className={`mt-1 text-xs ${f.quote_verified ? "text-green-800" : "text-red-800"}`}>{f.quote_verified ? "✓ Quotation found verbatim in the source (existence only — you judge whether it supports the claim)" : "✗ Quotation NOT found in the source"}</div>
          </blockquote>
        ) : <p className="mt-2 text-sm italic text-slate-600">No supporting quotation (nothing is asserted).</p>
      )}
      {!sourced && <p className="text-xs text-slate-600">{DEMO ? "Suggestion" : "AI suggestion"} — not a sourced fact.</p>}
      {f.flags.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-amber-800">{f.flags.map((x) => <li key={x}>⚠ {FLAG_TEXT[x] ?? x}</li>)}</ul>}
      {f.note && <p className="mt-1 text-xs text-slate-600">Basis noted: {f.note}</p>}
      {editing ? (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (sourced && val.trim() && val !== "Unknown" && !note.trim()) { setLocalErr("Enter the basis for this correction first (required for any value other than Unknown)."); return; } act("edit", { value: val, note }); }}>
          {f.kind === "lighting" || f.kind === "future" ? (
            <select aria-label="Edited value" className="w-full rounded border p-2" value={val} onChange={(e) => setVal(e.target.value)}>{(f.kind === "lighting" ? ["Unknown", "Yes", "No"] : ["Unknown", "Planned", "Not planned"]).map((o) => <option key={o}>{o}</option>)}</select>
          ) : <input aria-label="Edited value" className="w-full rounded border p-2" value={val} maxLength={200} onChange={(e) => setVal(e.target.value)} />}
          <label className="block text-sm font-medium">{sourced ? (val === "Unknown" ? "Basis for edit (optional for Unknown)" : "Basis for this correction (REQUIRED): where does this come from? e.g. “grower told us on the phone”, or a quote from another source") : "Note (optional)"}<input aria-label="Basis for edit" className="mt-1 w-full rounded border p-2" value={note} maxLength={300} onChange={(e) => { setNote(e.target.value); setLocalErr(null); }} aria-required={sourced && val !== "Unknown"} /></label>
          {localErr && <p role="alert" data-testid="edit-error" className="text-sm font-medium text-red-800">{localErr}</p>}
          <div className="flex gap-2"><button disabled={busy} className="rounded bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50">Save and approve edit</button><button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => act("approve")} className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50">{sourced && f.value === "Unknown" ? "Keep Unknown" : "Approve"}</button>
          <button disabled={busy} onClick={() => { setVal(f.value); setEditing(true); }} className="rounded border border-slate-400 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">Edit</button>
          <button disabled={busy} onClick={() => act("reject")} className="rounded border border-red-400 px-3 py-1.5 text-sm text-red-800 hover:bg-red-50 disabled:opacity-50">Reject</button>
        </div>
      )}
    </li>
  );
}

export default function Research({ onOpenAccount, openRun }: { onOpenAccount: (id: string) => void; openRun?: string }) {
  const [name, setName] = useState(""), [sourceId, setSourceId] = useState(""), [text, setText] = useState(""), [domain, setDomain] = useState("");
  const [data, setData] = useState<RunData | null>(null);
  const [phase, setPhase] = useState<"idle" | "analysing" | "syncing" | "verifying">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [ver, setVer] = useState<Verify | null>(null);
  const [recent, setRecent] = useState<{ id: string; name: string; created_at: string; ai_status: string; sync_status: string }[]>([]);
  const [cfg, setCfg] = useState<{ hubspot_configured: boolean; model: string; preview_only?: boolean } | null>(null), [pv, setPv] = useState<any>(null);
  const loadRecent = async () => { const r = await api.runs(); if (r.ok) setRecent(r.data.runs); };
  useEffect(() => { api.config().then((r) => r.ok && setCfg(r.data)); loadRecent(); if (openRun) open(openRun); else if (DEMO) api.runs().then((r) => { if (r.ok && r.data.runs[0]) open(r.data.runs[0].id); }); }, []); // eslint-disable-line

  // Name -> sources: discovery writes nothing; fetching pages needs an explicit identity confirmation.
  const [site, setSite] = useState(""), [loc, setLoc] = useState(""), [viaSearch, setViaSearch] = useState(false), [disc, setDisc] = useState<any>(null), [pick, setPick] = useState<string>(""), [confirm, setConfirm] = useState(false), [webBusy, setWebBusy] = useState<"" | "find" | "fetch">("");
  const find = async () => { setErr(null); setDisc(null); setConfirm(false); setPick(""); setViaSearch(false); setWebBusy("find"); try { const r = await api.discover({ businessName: name, website: site || undefined, location: loc || undefined }); if (r.ok) setDisc(r.data); else setErr(r.data.error ?? "Lookup failed"); } finally { setWebBusy(""); } };
  const fetchWeb = async () => { setErr(null); setVer(null); setPv(null); setWebBusy("fetch"); try { if (cfg?.preview_only) { const r = await api.previewWeb({ businessName: name, website: site, confirmed_identity: true }); if (r.ok) setPv(r.data); else setErr(r.data.error ?? "Retrieval failed"); return; } const r = await api.researchWeb({ businessName: name, website: site, confirmed_identity: true, candidate_company_number: pick && pick !== "none" ? pick : undefined, use_search: viaSearch ? true : undefined, force: true }); if (r.ok) { setData(r.data as RunData); setSourceId(r.data.run.source_id); setText(r.data.run.source_text); } else setErr(r.data.error ?? "Retrieval failed"); } finally { setWebBusy(""); loadRecent(); } };
  const invalid = !name.trim() || !sourceId.trim() || text.trim().length < 20;
  const submit = async (force = false) => {
    setErr(null); setVer(null); setPhase("analysing");
    try {
      const r = await api.research({ businessName: name, sourceId, sourceText: text, domain: domain || undefined, force });
      if (r.ok) setData(r.data as RunData); else { if (r.data.run) setData(r.data as RunData); setErr(r.data.error ?? "Research failed"); } // a network error keeps what is on screen
    } finally { setPhase("idle"); loadRecent(); }
  };
  const open = async (id: string) => { setErr(null); setVer(null); const r = await api.run(id); if (r.ok) { setData(r.data as RunData); setName(r.data.company.name); setSourceId(r.data.run.source_id); setText(r.data.run.source_text); setDomain(r.data.company.domain ?? ""); } else setErr(r.data.error ?? "Could not load run"); };
  const refresh = async () => { if (data) { const r = await api.run(data.run.id); if (r.ok) setData(r.data as RunData); } loadRecent(); };
  const onFinding = (f: Finding) => setData((prev) => (prev ? { ...prev, findings: prev.findings.map((x) => (x.id === f.id ? f : x)) } : prev));
  const runVerify = async () => { if (!data) return; setPhase("verifying"); try { const r = await api.verify(data.run.id); if (r.ok) setVer(r.data as Verify); else setErr(r.data.error ?? "Verification failed"); } finally { setPhase("idle"); } };
  const doSync = async () => {
    if (!data) return; setErr(null); setVer(null); setPhase("syncing");
    let ok = false;
    try { const r = await api.sync(data.run.id); ok = r.ok; if (!r.ok) setErr(r.data.error ?? "Sync failed"); } finally { setPhase("idle"); }
    await refresh();
    if (ok) runVerify();
  };
  const resolve = async (action: string, hubspot_id?: string) => {
    if (!data) return; setErr(null);
    const r = await api.resolve(data.company.id, { action, hubspot_id });
    if (!r.ok) { setErr(r.data.error ?? "Could not resolve"); return; }
    await refresh(); if (action === "link" || action === "create") doSync();
  };
  const pending = data?.findings.filter((f) => (f.kind === "crop" || f.kind === "lighting" || f.kind === "future") && f.review_status === "needs_review").length ?? 0;
  const co = data?.company;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      
      <main className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="in" className="space-y-3">
          <h1 id="in" className="text-xl font-bold">{DEMO ? "Sample research" : "Research a greenhouse business"}</h1>
          {DEMO ? <DemoSource run={data?.run} company={data?.company} /> : <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-4" data-testid="web-panel">
            <h2 className="text-sm font-semibold">Find public sources from the business name (beta)</h2>
            <p className="text-xs text-slate-600">Enter the business name (the website is optional: leave it empty and the search will propose it). Nothing is saved or sent to HubSpot by looking up. Pages are fetched only after you confirm the identity, and every finding still needs your review.</p>
            {cfg?.preview_only && <label className="block text-sm font-medium">Business name<input data-testid="name" className="mt-1 w-full rounded border p-2" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>}
            <label className="block text-sm font-medium">Business website (optional: leave empty to search by name)<input data-testid="site" className="mt-1 w-full rounded border p-2" placeholder="e.g. example-glasshouse.co.uk" value={site} maxLength={200} onChange={(e) => { setSite(e.target.value); setDisc(null); setViaSearch(false); }} /></label>
            <label className="block text-sm font-medium">Location hint (optional)<input data-testid="loc" className="mt-1 w-full rounded border p-2" placeholder="e.g. Ely, Cambridgeshire" value={loc} maxLength={80} onChange={(e) => setLoc(e.target.value)} /></label>
            <button type="button" data-testid="find" disabled={!name.trim() || webBusy !== ""} onClick={find} className="rounded border border-slate-500 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-40">{webBusy === "find" ? "Looking up…" : "1. Look up business"}</button>
            {disc && <div className="space-y-2 text-sm" data-testid="disc">
              {disc.web_search?.status === "ok" && disc.web_search.ranking && <fieldset className="space-y-1" data-testid="web-cands"><legend className="font-medium">{disc.web_search.ranking.candidates.length === 0 ? "No websites found for that name" : disc.web_search.ranking.ambiguous ? "Possible websites: none is clearly this business, choose carefully or provide the website" : "Website found (please check it is the right business)"}</legend>
                {disc.web_search.ranking.candidates.map((c: any) => <label key={c.host} className="flex items-start gap-2"><input type="radio" name="site" checked={viaSearch && site === c.host} onChange={() => { setSite(c.host); setViaSearch(true); setConfirm(false); }} /><span><b>{c.host}</b> — {c.title}<br /><span className="text-xs text-slate-600">{c.snippet}</span><br /><span className="text-xs text-slate-600">Evidence: {[c.support.host_match && "name in web address", c.support.name_in_title && "name in title", c.support.name_in_snippet && "name in text", c.support.location_match && "location matches"].filter(Boolean).join(", ") || "none"}{disc.web_search.ranking.suggested === c.host ? " · best supported" : ""}</span></span></label>)}</fieldset>}
              {disc.web_search && !["ok", "skipped_website_given"].includes(disc.web_search.status) && <p className="text-amber-900" data-testid="search-status">Website search unavailable ({disc.web_search.status}): {disc.web_search.error} You can still type the website above.</p>}
              {disc.registry.status !== "not_configured" && <p data-testid="registry-line">UK company register: <b>{disc.registry.status === "ok" ? `${disc.candidates.length} candidate(s)` : disc.registry.status === "not_configured" ? "not enabled (no registry key configured)" : disc.registry.error ?? disc.registry.status}</b>. </p>}
              {disc.candidates.length > 0 && <fieldset className="space-y-1"><legend className="font-medium">{disc.ambiguity.ambiguous ? "Several possible matches: choose the right one (nothing is chosen for you)" : "Registry match"}</legend>
                {disc.candidates.map((c: any) => <label key={c.company_number} className="flex items-start gap-2"><input type="radio" name="cand" checked={pick === c.company_number} onChange={() => setPick(c.company_number)} /><span>{c.name} · {c.company_number} · {c.status}<br /><span className="text-xs text-slate-600">{c.address}</span></span></label>)}
                <label className="flex items-start gap-2"><input type="radio" name="cand" checked={pick === "none"} onChange={() => setPick("none")} /><span>None of these / not a UK registered company</span></label></fieldset>}
              {site ? <label className="flex items-start gap-2"><input data-testid="confirm-id" type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span>I confirm <b>{site}</b> is the website of the business I mean{disc.candidates.length > 0 && !pick ? " (and I have chosen a registry match above, or None)" : ""}.</span></label> : <p className="text-amber-900">Choose a website above, or type one and look up again.</p>}
              <button type="button" data-testid="fetch" disabled={!confirm || !site || (disc.candidates.length > 0 && !pick) || webBusy !== "" || phase !== "idle"} onClick={fetchWeb} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">{webBusy === "fetch" ? "Fetching public pages and analysing…" : "2. Fetch public pages and research"}</button>
            </div>}
          </div>}
          {cfg?.preview_only && <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900" data-testid="preview-banner"><b>PREVIEW MODE.</b> Real public companies can be researched here; results are shown but never saved, and nothing can be sent to the CRM.</div>}
          {!cfg?.preview_only && !DEMO && <form className="space-y-3 rounded-lg border border-slate-300 bg-white p-4" onSubmit={(e) => { e.preventDefault(); if (!invalid) submit(); }}>
            <label className="block text-sm font-medium">Business name (synthetic)
              <input data-testid="name" className="mt-1 w-full rounded border p-2" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
            <label className="block text-sm font-medium">Business domain (optional; used to match the HubSpot record safely)
              <input data-testid="domain" className="mt-1 w-full rounded border p-2" placeholder="e.g. example-glasshouse.co.uk" value={domain} maxLength={120} onChange={(e) => setDomain(e.target.value)} /></label>
            <label className="block text-sm font-medium">Source identifier (label only — the URL is NOT fetched)
              <input data-testid="source-id" className="mt-1 w-full rounded border p-2" placeholder="e.g. https://example.test/about" value={sourceId} maxLength={200} onChange={(e) => setSourceId(e.target.value)} /></label>
            <label className="block text-sm font-medium">Public-source text (pasted)
              <textarea data-testid="text" className="mt-1 h-48 w-full rounded border p-2 font-mono text-sm" value={text} maxLength={6000} onChange={(e) => setText(e.target.value)} /></label>
            <div className="flex items-center justify-between text-xs text-slate-600"><span>{text.length}/6000 characters{text.trim().length > 0 && text.trim().length < 20 ? " · need at least 20" : ""}</span>
              {cfg && <span>Model: {cfg.model.split("/").pop()}</span>}</div>
            <button data-testid="run" disabled={invalid || phase !== "idle"} className="w-full rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-40">{phase === "analysing" ? "Analysing with Workers AI…" : "Run research"}</button>
          </form>}
          {!cfg?.preview_only && <div className="rounded-lg border border-slate-300 bg-white p-4">
            <h2 className="text-sm font-semibold">{DEMO ? "Runs saved in this browser" : "Recent runs (stored in D1)"}</h2>
            {recent.length === 0 ? <p className="text-sm text-slate-600">No runs yet.</p> : <ul className="mt-2 space-y-1 text-sm">{recent.slice(0, 8).map((r) => <li key={r.id}><button className="w-full rounded px-2 py-1 text-left hover:bg-slate-100" onClick={() => open(r.id)}>{r.name} <span className="text-xs text-slate-600">· {r.ai_status} · {r.sync_status}</span></button></li>)}</ul>}
          </div>}
        </section>

        <section aria-labelledby="out" className="space-y-3" aria-live="polite">
          <h2 id="out" className="text-xl font-bold">Findings and review</h2>
          {err && <div role="alert" data-testid="error" className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900">{err}{data?.run.ai_status === "failed" && <button className="ml-3 underline" onClick={() => submit(true)}>Retry research</button>}</div>}
          {phase === "analysing" && <div className="rounded border bg-white p-4 text-sm" role="status">Calling Cloudflare Workers AI, then checking every quotation against your source text…</div>}
          {pv && <Preview pv={pv} />}
          {!data && !pv && phase === "idle" && !err && <div className="rounded border border-dashed border-slate-400 p-8 text-center text-sm text-slate-600">Enter a synthetic business and source text, then run research. Nothing reaches HubSpot until you approve findings and press Sync.</div>}
          {data && (<>
            {data.reused && <div className="rounded border border-sky-300 bg-sky-50 p-2 text-sm">This exact source was already researched — showing the saved run (no new AI call). <button className="underline" onClick={() => submit(true)}>Re-run anyway</button></div>}
            {data.run.run_flags.map((x) => <div key={x} className="rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">⚠ {FLAG_TEXT[x] ?? x}</div>)}
            <p className="text-xs text-slate-600">Source: {data.run.source_id} ({data.run.source_kind === "pasted_text" ? "pasted text, not fetched" : data.run.source_kind === "demo_fixture" ? "fictional sample page, not fetched" : data.run.source_kind}) · run {data.run.id.slice(0, 8)}{data.run.neurons ? ` · ${data.run.neurons.toFixed(2)} Neurons` : ""}</p>
            {data.findings.length > 0 && (
              <div className="rounded-lg border-2 border-slate-400 bg-white p-4" data-testid="sync-panel">
                <h3 className="font-semibold">{DEMO ? "CRM sync (simulated in this browser)" : "HubSpot DEVELOPER_TEST and D1"}</h3>
                {DEMO && <p className="text-xs text-slate-600" data-testid="sync-note">Nothing is sent to HubSpot. Syncing writes the approved findings to a simulated CRM record stored in your browser. The real application syncs to a HubSpot developer test account.</p>}
                <p className="text-sm" data-testid="sync-status">Status: <b>{co?.sync_status === "synced" && (co.sync_stale || co.synced_run_id !== data.run.id) ? DEMO ? "OUT OF DATE — the simulated CRM record holds an older version of the evidence" : `OUT OF DATE — HubSpot company ${co.hubspot_id} holds an older version of the evidence` : co?.sync_status === "synced" ? (DEMO ? "Synced to the simulated CRM record" : `Synced (HubSpot company ${co.hubspot_id})`) : co?.sync_status === "error" ? "Error — not saved to HubSpot" : co?.sync_status === "uncertain" ? "Uncertain — HubSpot outcome unknown; retry is duplicate-safe" : phase === "syncing" ? "Syncing…" : "Not synced"}</b></p>
                {co?.sync_error && co.sync_status !== "synced" && <p className="text-sm text-red-800">{co.sync_error}</p>}
                {pending > 0 && <p className="text-sm text-amber-800">Review crop, lighting and future plans before syncing ({pending} pending).</p>}
                {co?.sync_status === "needs_identity" && (() => { let cands: Candidate[] = []; try { cands = JSON.parse(co.candidates ?? "[]"); } catch { /* ignore */ } return (
                  <div className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm" data-testid="identity">
                    <p className="font-medium">HubSpot already has a similar company. Nothing was written. Choose explicitly:</p>
                    <ul className="mt-1 space-y-1">{cands.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2"><span>{c.name} {c.domain ? `(${c.domain})` : "(no domain)"} · ID {c.id}</span><button className="rounded border border-slate-500 px-2 py-0.5" onClick={() => resolve("link", c.id)}>Link to this record</button></li>)}</ul>
                    <button className="mt-2 rounded border border-red-400 px-2 py-0.5 text-red-800" onClick={() => resolve("create")}>These are different businesses — create a new record</button>
                  </div>); })()}
                {co?.sync_status === "synced" && <button className="mt-2 text-sm underline" onClick={() => onOpenAccount(co.id)}>Open account workspace →</button>}
                <div className="mt-2 flex gap-2">
                  <button data-testid="sync" disabled={pending > 0 || phase !== "idle" || !cfg?.hubspot_configured} onClick={doSync} className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40">{co?.sync_status === "error" || co?.sync_status === "uncertain" ? "Retry sync" : co?.sync_status === "synced" && (co.sync_stale || co.synced_run_id !== data.run.id) ? (DEMO ? "Sync changes" : "Sync changes to HubSpot") : "Sync approved findings"}</button>
                  <button disabled={phase !== "idle"} onClick={runVerify} className="rounded border px-3 py-2 text-sm disabled:opacity-40">{DEMO ? "Check the CRM record" : "Verify persistence"}</button>
                </div>
                {ver && <div data-testid="verify" className={`mt-3 rounded border p-2 text-sm ${ver.verified ? "border-green-400 bg-green-50 text-green-900" : "border-red-400 bg-red-50 text-red-900"}`}>
                  {ver.verified ? DEMO ? <>✓ Read back from the simulated CRM record in this browser: it matches the {ver.d1_approved_findings} approved findings.</> : <>✓ Independently read back from HubSpot (company {ver.hubspot_id}, “{ver.hubspot_name}”): matches the {ver.d1_approved_findings} approved findings stored in D1.</> : <>✗ Not verified: {ver.reason ?? "HubSpot content differs from approved evidence"}</>}
                </div>}
              </div>)}
            <ul className="space-y-3">{data.findings.map((f) => <FindingCard key={f.id} f={f} onChange={onFinding} onError={setErr} />)}</ul>
          </>)}
        </section>
      </main>
    </div>
  );
}
