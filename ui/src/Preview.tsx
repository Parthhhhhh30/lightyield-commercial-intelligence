import { FLAG_TEXT, KIND } from "./ui";
// READ-ONLY result of a real-company research PREVIEW: nothing here is saved, approved or sent to a CRM. Quotation checks are deterministic (existence in the retrieved text only); the reader judges relevance.
type PF = { kind: string; ai_value: string; value: string; quote: string; quote_verified: boolean; flags: string[] };
export default function Preview({ pv }: { pv: any }) {
  const f: PF[] = pv.findings ?? [], sourced = ["crop", "lighting", "future"];
  const urlFor = (q: string) => (pv.web_sources?.pages ?? []).find((p: any) => (pv.source_text ?? "").split("[Retrieved page ").find((b: string) => b.startsWith(p.url))?.includes(q))?.url;
  return (
    <div className="space-y-3" data-testid="preview">
      <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900" role="note"><b>PREVIEW — NOTHING IS SAVED.</b> This is real public information about <b>{pv.business_name}</b> ({pv.website}). It was not stored in the database or sent to HubSpot; closing this page discards it. Model: Workers AI · {pv.neurons?.toFixed?.(1) ?? "?"} neurons · {((pv.ms ?? 0) / 1000).toFixed(1)} s.</div>
      <section className="rounded-lg border border-slate-300 bg-white p-4"><h3 className="text-sm font-semibold">Sources retrieved (URL and retrieval date)</h3>
        <ul className="mt-1 list-disc pl-5 text-sm" data-testid="pv-sources">{(pv.web_sources?.pages ?? []).map((p: any) => <li key={p.url}><a className="underline" href={p.url} target="_blank" rel="noreferrer noopener">{p.url}</a> <span className="text-xs text-slate-600">retrieved {String(p.retrieved_at).slice(0, 10)}</span></li>)}</ul></section>
      {f.filter((x) => sourced.includes(x.kind)).map((x) => (
        <section key={x.kind} className="rounded-lg border border-slate-300 bg-white p-4" data-testid={`pv-${x.kind}`}>
          <h3 className="text-sm font-semibold text-slate-700">{KIND[x.kind]}</h3>
          <p className="mt-1 text-lg font-medium" data-testid="pv-value">{x.value}</p>
          {x.ai_value !== x.value && <p className="text-xs text-red-800">The AI claimed “{x.ai_value}” — downgraded to {x.value} because the evidence check did not hold.</p>}
          {x.quote ? <blockquote className="mt-2 border-l-4 border-slate-300 pl-3 text-sm text-slate-700">“{x.quote}”<div className="mt-1 text-xs">{x.quote_verified ? "✓ found verbatim in the retrieved text" : "✗ NOT found in the retrieved text"}{urlFor(x.quote) ? <> · from {urlFor(x.quote)}</> : null}</div></blockquote> : <p className="mt-2 text-sm italic text-slate-600">No supporting quotation: nothing is asserted.</p>}
          {(pv.checks ?? []).filter((c: any) => c.kind === x.kind).map((c: any) => <p key={c.kind} className="mt-1 text-xs text-slate-600" data-testid="pv-check">Independent AI check of “{c.claim}”: {c.verdict ?? "no verdict"}</p>)}
          {x.flags.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-amber-800">{x.flags.map((g) => <li key={g}>⚠ {FLAG_TEXT[g] ?? g}</li>)}</ul>}
        </section>))}
      <section className="rounded-lg border border-slate-300 bg-white p-4"><h3 className="text-sm font-semibold">Not established (unknowns)</h3><ul className="mt-1 list-disc pl-5 text-sm" data-testid="pv-unknowns">{f.filter((x) => x.kind === "unknown_item").map((x) => <li key={x.value}>{x.value}</li>)}</ul></section>
      <section className="rounded-lg border border-slate-300 bg-white p-4"><h3 className="text-sm font-semibold">Suggested discovery questions</h3><ul className="mt-1 list-disc pl-5 text-sm" data-testid="pv-questions">{f.filter((x) => x.kind === "question").map((x) => <li key={x.value}>{x.value}</li>)}</ul></section>
      <details className="rounded-lg border border-slate-300 bg-white p-4 text-sm"><summary className="cursor-pointer">Retrieved text used by the AI (untrusted public text)</summary><pre className="mt-2 whitespace-pre-wrap text-xs">{pv.source_text}</pre></details>
    </div>);
}
