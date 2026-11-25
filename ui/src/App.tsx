/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { api, setCsrf } from "./api";
import Research from "./Research";
import Account from "./Account";
import { Followups, Activity } from "./Followups";
import { Card, Pill, ghost, primary, DEMO } from "./ui";
import { DemoBanner, DemoGuide, ResetDemo } from "./demoSlots";

type Route = { name: "accounts" | "followups" | "activity" } | { name: "research"; run?: string } | { name: "account"; id: string };
const parse = (): Route => { const h = location.hash.replace(/^#\/?/, ""); const [a, b] = h.split("/"); if (a === "account" && b) return { name: "account", id: b }; if (a === "research" && b) return { name: "research", run: b }; return (["accounts", "followups", "activity"].includes(a) ? { name: a } : { name: "research" }) as Route; };

function Accounts({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.accounts().then((r) => r.ok && setRows(r.data.accounts)); }, []);
  if (!rows) return <p role="status">Loading accounts…</p>;
  return <Card title="Accounts">{rows.length === 0 ? <p className="text-sm text-slate-600">No accounts yet. Start with Research.</p> :
    <ul className="divide-y" data-testid="accounts">{rows.map((a) => <li key={a.id}><button className="flex w-full flex-wrap items-center gap-2 py-2 text-left text-sm hover:bg-slate-50" onClick={() => onOpen(a.id)}><b className="min-w-0 flex-1">{a.name}</b>
      <Pill tone={a.sync_status === "synced" ? "green" : "amber"}>{a.sync_status === "synced" ? (DEMO ? "synced (simulated CRM)" : "in HubSpot") : DEMO ? "not synced" : a.sync_status}</Pill>{a.latest_fit && <Pill tone="slate">{a.latest_fit}</Pill>}<span className="text-slate-600">{a.open_tasks} open task{a.open_tasks === 1 ? "" : "s"}</span></button></li>)}</ul>}</Card>;
}

export default function App() {
  const [sess, setSess] = useState<any>(null), [route, setRoute] = useState<Route>(parse()), [expired, setExpired] = useState(false);
  const boot = useCallback(async () => { const r = await api.session(); setSess(r.data); if (r.data.authenticated) { setCsrf(r.data.csrf); setExpired(false); } }, []);
  useEffect(() => { boot(); const h = () => setRoute(parse()); const u = () => setExpired(true); addEventListener("hashchange", h); addEventListener("ly-unauth", u); return () => { removeEventListener("hashchange", h); removeEventListener("ly-unauth", u); }; }, [boot]);
  const go = (r: string) => { location.hash = "#/" + r; };
  const hosted = sess?.env === "hosted";
  const banner = DEMO ? <DemoBanner /> : <div data-testid="env-banner" className={`px-4 py-1.5 text-center text-sm font-semibold ${hosted ? "bg-orange-300 text-orange-950" : "bg-amber-300 text-amber-950"}`}>{hosted ? "HOSTED DEVELOPMENT ENVIRONMENT" : "LOCAL DEVELOPMENT"} · SYNTHETIC DATA ONLY · HubSpot DEVELOPER_TEST account · not production</div>;
  if (!sess) return <p className="p-4" role="status">Loading…</p>;
  if (!DEMO && !sess.authenticated) return (
    <div className="min-h-screen bg-slate-100">{banner}
      <main className="mx-auto max-w-md p-6"><Card title="Sign in required">
        <p className="text-sm">Access is limited to approved GitHub accounts.</p>
        {sess.auth?.fixture_idp && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900" data-testid="fixture-note">Local test mode: this uses a <b>fixture</b> identity provider, not real GitHub. Real GitHub sign-in is not yet configured.</p>}
        {!sess.auth?.configured && <p className="mt-2 text-sm text-red-800">Authentication is not configured on the server.</p>}
        <a href="/auth/login" className={`${primary} mt-3 inline-block`} data-testid="signin">Sign in with GitHub</a></Card></main></div>);
  const nav = (r: string, label: string, active: boolean) => <button className={`rounded px-3 py-1.5 text-sm font-medium ${active ? "bg-slate-900 text-white" : "hover:bg-slate-200"}`} aria-current={active ? "page" : undefined} onClick={() => go(r)}>{label}</button>;
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">{banner}
      {!DEMO && expired && <div role="alert" data-testid="expired" className="fixed inset-x-0 top-0 z-10 bg-red-700 p-3 text-center text-sm text-white">Your session has expired or was revoked. Nothing was lost on this screen. <a className="underline" href="/auth/login">Sign in again</a>, then repeat the last action.</div>}
      <header className="border-b bg-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 p-3">
        <span className="font-bold">LightYield</span><nav className="flex flex-wrap gap-1" aria-label="Main">{nav("research", "Research", route.name === "research")}{nav("accounts", "Accounts", route.name === "accounts" || route.name === "account")}{nav("followups", "Follow-ups", route.name === "followups")}{nav("activity", "Activity", route.name === "activity")}</nav>
        {DEMO ? <span className="ml-auto"><ResetDemo /></span> : <><span className="ml-auto text-xs text-slate-600" data-testid="whoami">{sess.user.login}</span>
        <button className={ghost} onClick={async () => { await api.logout(); location.href = "/"; }} data-testid="signout">Sign out</button></>}</div></header>
      <main className="mx-auto max-w-6xl p-4">
        {DEMO && route.name === "research" && <DemoGuide />}
        {route.name === "research" && <Research key={(route as any).run ?? "new"} openRun={(route as any).run} onOpenAccount={(id) => go("account/" + id)} />}
        {route.name === "accounts" && <Accounts onOpen={(id) => go("account/" + id)} />}
        {route.name === "account" && <Account id={route.id} onResearch={() => go("research")} onSyncScreen={(runId) => go("research/" + runId)} />}
        {route.name === "followups" && <Followups onOpen={(id) => go("account/" + id)} />}
        {route.name === "activity" && <Activity />}
      </main>
    </div>
  );
}
