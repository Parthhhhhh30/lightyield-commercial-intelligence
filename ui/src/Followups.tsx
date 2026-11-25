/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { api } from "./api";
import { Card, Err, Pill, ghost, DEMO } from "./ui";

export function Followups({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null), [err, setErr] = useState<string | null>(null);
  const load = async () => { const r = await api.followups(); if (r.ok) setRows(r.data.followups); else setErr(r.data.error ?? "Could not load follow-ups"); };
  useEffect(() => { load(); }, []);
  if (!rows) return <p role="status">{err ?? "Loading follow-ups…"}</p>;
  return (
    <Card title="Open follow-ups" id="fu"><Err msg={err} />
      {rows.length === 0 ? <p className="text-sm text-slate-600" data-testid="fu-empty">Nothing open. Create follow-ups from an account.</p> : (
        <ul className="divide-y" data-testid="fu-list">{rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="fu-item">
            <b className="min-w-0 flex-1">{t.subject}</b><span className="text-slate-600">{t.company_name}</span><span>due {t.due_on}</span>{t.overdue && <Pill tone="red">overdue</Pill>}
            {t.op_state !== "created" ? <Pill tone="amber">not saved to HubSpot ({t.op_state})</Pill> : <Pill tone="green">{DEMO ? "simulated CRM · " : ""}{t.hubspot_status ?? "status unavailable"}</Pill>}
            <button className={ghost} onClick={() => onOpen(t.company_id)}>Open account</button></li>))}</ul>)}
    </Card>
  );
}

export function Activity() {
  const [m, setM] = useState<any>(null);
  useEffect(() => { api.metrics().then((r) => r.ok && setM(r.data)); }, []);
  if (!m) return <p role="status">Loading activity…</p>;
  const row = (k: string, v: any) => <div key={k} className="flex justify-between gap-4 border-b py-1 text-sm"><span>{k}</span><b>{v ?? 0}</b></div>;
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="activity">
      <Card title="Research"><p className="mb-2 text-xs text-slate-600">{m.note}</p>
        {row(DEMO ? "Research runs (sample)" : "Research runs", m.research.n)}{!DEMO && <>{row("AI failures", m.research.ai_failed)}{row("Average run time (ms)", m.research.avg_ms)}{row("Average Neurons per run", m.research.avg_neurons)}</>}
        {row("Findings approved", m.findings.approved)}{row("Findings edited by a person", m.findings.edited)}{row("Findings rejected", m.findings.rejected)}{row("Findings awaiting review", m.findings.pending)}{row("Sourced claims downgraded by checks", m.findings.downgraded_by_checks)}</Card>
      <Card title="Commercial activity">
        {row("Accounts", m.accounts.n)}{row(DEMO ? "Accounts synced (simulated CRM)" : "Accounts in HubSpot", m.accounts.synced)}{row("Conversations recorded", m.conversations.total)}
        {Object.entries(m.conversations.by_fit).map(([k, v]) => row(`Fit: ${k}`, v))}
        {row("Follow-ups created", m.tasks.created)}{row("Follow-ups completed", m.tasks.completed)}{row("Follow-ups open", m.tasks.open)}{row("Follow-ups overdue", m.tasks.overdue)}</Card>
    </div>
  );
}
