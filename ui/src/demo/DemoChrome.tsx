// PUBLIC DEMO ONLY: disclosure banner, first-visit guide and reset. Rendered by App.tsx only when DEMO is true.
import { useState } from "react";
import { resetDemo } from "./api";
import { ghost, primary } from "../ui";

export const DISCLOSURE = "Interactive demo · Fictional company data · Research and CRM integrations are simulated · Changes stay in your browser";
export const DemoBanner = () => <div data-testid="env-banner" role="note" className="bg-sky-200 px-4 py-1.5 text-center text-sm font-semibold text-sky-950">{DISCLOSURE}</div>;

const SEEN = "lightyield-demo-guide-dismissed";
export function DemoGuide() {
  const [open, setOpen] = useState(() => localStorage.getItem(SEEN) !== "1");
  if (!open) return <button className="mb-3 text-sm underline" data-testid="guide-show" onClick={() => setOpen(true)}>How to use this demo</button>;
  return (
    <section aria-labelledby="guide-h" data-testid="guide" className="mb-4 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-slate-900">
      <h2 id="guide-h" className="text-base font-semibold">Try the workflow on a fictional grower</h2>
      <p className="mt-1">Fernbrook Glasshouses is invented. Its web page and the extraction were written for this demo; LightYield’s own evidence checks run on them in your browser. The real application researches live websites and syncs to HubSpot. Here those steps are simulated.</p>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5">
        <li><b>Research:</b> approve, reject or correct each finding. A correction needs a stated basis.</li>
        <li>Sync the approved findings to the simulated CRM, then open the account.</li>
        <li><b>Account:</b> compare public evidence with what the grower says, record a discovery call and make the fit decision yourself.</li>
        <li>Create a follow-up, then complete it with an outcome.</li>
      </ol>
      <p className="mt-2 text-slate-700">Your changes are saved in this browser only. Reset the demo at any time to start again.</p>
      <button className={`${ghost} mt-2`} data-testid="guide-hide" onClick={() => { localStorage.setItem(SEEN, "1"); setOpen(false); }}>Hide guide</button>
    </section>);
}
export function ResetDemo() {
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <button className={ghost} data-testid="reset" onClick={() => setConfirm(true)}>Reset demo</button>;
  return <span className="flex items-center gap-2 text-sm"><span>Discard your changes?</span>
    <button className={primary} data-testid="reset-confirm" onClick={() => { resetDemo(); localStorage.removeItem(SEEN); location.hash = "#/research"; location.reload(); }}>Reset</button>
    <button className={ghost} onClick={() => setConfirm(false)}>Cancel</button></span>;
}
// Replaces the research inputs: the demo has one fictional source and cannot research anything else.
export function DemoSource({ run, company }: { run?: { source_id: string; source_text: string }; company?: { name: string; domain: string | null } }) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-4" data-testid="demo-source">
      <h2 className="text-sm font-semibold">Fictional source page</h2>
      {run ? <>
        <p className="text-sm"><b>{company?.name}</b> · {company?.domain} <span className="text-xs text-slate-600">(reserved example domain)</span></p>
        <p className="text-xs text-slate-600">{run.source_id} · written for this demo, not fetched from the web</p>
        <blockquote className="border-l-4 border-slate-300 pl-3 text-sm text-slate-800" data-testid="demo-source-text">{run.source_text}</blockquote>
      </> : <p role="status" className="text-sm">Loading the sample…</p>}
      <p className="text-xs text-slate-600">The extraction on the right was written in advance for this scenario. The quotation checks, downgrades and flags are produced by LightYield’s own rules, running in your browser. Researching another company needs live web search and an AI model, so it is not available in this demo.</p>
    </div>);
}
