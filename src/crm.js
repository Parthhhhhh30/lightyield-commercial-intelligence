// Company identity resolution + idempotent, recoverable HubSpot sync.
// HubSpot offers no idempotency keys on create and its Search API is eventually consistent, so we combine:
//  (1) persisted stored HubSpot ID (trusted first), (2) a stable per-company marker embedded in the record and found via a
//  paged LIST scan (reads storage, not the search index), (3) a write-ahead `create_sent_at` flag so a crash/lost response
//  between create and saving the ID is reconciled before any second create, (4) an atomic D1 lease against concurrent calls.
import { HubspotError, assertTestAccount } from "./hubspot.js";
import { eventStmt } from "./audit.js";
import { renew, LeaseLost } from "./lease.js";
import { buildDescription, mergeDescription, extractBlock, markerCo } from "./logic.js";

const WAIT_MS = 60000;
export async function scan(hs, maxPages = 20) {
  const all = []; let after;
  for (let i = 0; i < maxPages; i++) {
    const p = await hs.list("companies", ["name", "domain", "description"], after);
    all.push(...(p.results || [])); after = p.paging?.next?.after;
    if (!after) return { all, complete: true };
  }
  return { all, complete: false };
}
const lc = (s) => String(s || "").trim().toLowerCase();
const cand = (r) => ({ id: r.id, name: r.properties?.name || "", domain: r.properties?.domain || "" });

// Pure decision over a complete scan. Never auto-adopts on name alone.
export function decideIdentity(all, co) {
  const byMarker = all.filter((r) => (r.properties?.description || "").includes(markerCo(co.id)));
  if (byMarker.length === 1) return { action: "adopt", id: byMarker[0].id, why: "marker" };
  if (byMarker.length > 1) return { action: "ambiguous", candidates: byMarker.map(cand), why: "multiple records carry this company's marker" };
  const byDomain = co.domain ? all.filter((r) => lc(r.properties?.domain) === co.domain) : [];
  if (byDomain.length === 1 && lc(byDomain[0].properties?.name) === lc(co.name)) return { action: "adopt", id: byDomain[0].id, why: "domain+name" };
  if (byDomain.length) return { action: "ambiguous", candidates: byDomain.map(cand), why: "domain matches a record with a different name or several records" };
  const byName = all.filter((r) => lc(r.properties?.name) === lc(co.name));
  if (byName.length) return { action: "ambiguous", candidates: byName.map(cand), why: "same name exists in HubSpot but identity cannot be confirmed (no matching domain/marker)" };
  return { action: "create" };
}

const nowIso = () => new Date().toISOString();
// Final/transition write of a sync operation: conditional on lease ownership, releases the lease, and commits the audit event in the SAME
// transaction (event only if the update changed a row). Throws LeaseLost if the lease is no longer ours: nothing is overwritten.
async function finish(env, co, token, status, error, extra = {}, ev = null) {
  const stmts = [env.DB.prepare("UPDATE companies SET sync_status=?, sync_error=?, hubspot_id=COALESCE(?, hubspot_id), synced_run_id=COALESCE(?, synced_run_id), synced_run_rev=COALESCE(?, synced_run_rev), synced_evidence_rev=COALESCE(?, synced_evidence_rev), last_uncertain_at=COALESCE(?, last_uncertain_at), identity_status=COALESCE(?, identity_status), candidates=?, lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=? AND lease_owner=?")
    .bind(status, error, extra.hubspot_id ?? null, extra.synced_run_id ?? null, extra.synced_run_rev ?? null, extra.synced_evidence_rev ?? null, extra.uncertain ? Date.now() : null, extra.identity ?? null, extra.candidates ? JSON.stringify(extra.candidates) : null, nowIso(), co.id, token)];
  if (ev) stmts.push(eventStmt(env, ev.entity, co.id, ev.action, ev.detail, ev.actor, { onlyIfChanged: true }));
  const res = await env.DB.batch(stmts); if (!res[0].meta.changes) throw new LeaseLost();
}
const own = async (env, co, token, sets, ...binds) => { // intermediate owner-conditional update (lease stays held)
  const r = await env.DB.prepare(`UPDATE companies SET ${sets}, updated_at=? WHERE id=? AND lease_owner=?`).bind(...binds, nowIso(), co.id, token).run(); if (!r.meta.changes) throw new LeaseLost();
};
export const leaseLostResponse = { status: 409, body: { error: "Another operation took over this company's sync (this operation's lease was lost). Nothing was overwritten; retry.", lease_lost: true } };

// Returns {status, body}. The caller holds the lease (`token`) and passes a snapshot (run/findings) taken AFTER acquiring it.
export async function syncCompany({ env, hs, co, run, findings, block: given, fault, actor, token }) {
  const block = given ?? buildDescription(run, findings); // the account-level payload (selectEvidence) is passed in by index.js
  let hid = co.hubspot_id, created = false;
  const fail = async (st, status, error, extra) => { await finish(env, co, token, status, error, extra); return st; };
  try {
    await own(env, co, token, "sync_status='syncing', sync_error=NULL");
    const gate = await assertTestAccount(env, hs);
    if (!gate.ok) return await fail({ status: 403, body: { error: gate.reason } }, "error", "Refused: " + gate.reason);

    if (!hid) {
      if (!(await renew(env, co.id, token))) throw new LeaseLost();
      const scanned = await scan(hs), complete = scanned.complete;
      const all = env.RECORD_PREFIX ? scanned.all.filter((c) => String(c.properties?.name || "").startsWith(env.RECORD_PREFIX)) : scanned.all; // other namespaces are invisible to identity resolution
      const found = decideIdentity(all, co);
      const forced = co.identity_status === "create_confirmed";
      if (found.action === "adopt") hid = found.id;
      else if (!complete) return await fail({ status: 409, body: { error: "HubSpot has too many companies to scan safely; link the record explicitly" } }, "error", "Scan incomplete; explicit link required");
      else if (found.action === "ambiguous" && !forced) {
        const body = { error: `Identity unclear: ${found.why}. Choose a candidate to link, or explicitly create a new record.`, needs_identity: true, candidates: found.candidates };
        return await fail({ status: 409, body }, "needs_identity", body.error, { identity: "ambiguous", candidates: found.candidates });
      } else if (co.create_sent_at && Date.now() - co.create_sent_at < WAIT_MS) {
        const body = { error: "A previous create may have succeeded but is not visible yet; retry shortly (duplicate guard)", retry_after_s: Math.ceil((WAIT_MS - (Date.now() - co.create_sent_at)) / 1000) };
        return await fail({ status: 409, body }, "uncertain", body.error);
      }
    }
    if (fault === "hubspot-4xx") throw new HubspotError("client", 400, "simulated HubSpot 400 (fault injection)");
    if (fault === "hubspot-429") throw new HubspotError("rate", 429, "simulated HubSpot rate limit (fault injection)");

    if (hid) {
      let cur;
      try { cur = await hs.get(hid); } catch (e) {
        if (e instanceof HubspotError && e.status === 404) return await fail({ status: 409, body: { error: "The linked HubSpot record no longer exists. Re-link or explicitly create." } }, "error", "Linked HubSpot record missing (404); no automatic re-create", { identity: "ambiguous" });
        throw e;
      }
      const props = { description: mergeDescription(cur.properties?.description, block, co.id) };
      if (co.domain && !cur.properties?.domain) props.domain = co.domain;
      if (!(await renew(env, co.id, token))) throw new LeaseLost();
      await hs.patch(hid, props);
      await own(env, co, token, "hubspot_id=?, identity_status='linked', create_sent_at=NULL", hid);
    } else {
      if (!(await renew(env, co.id, token))) throw new LeaseLost(); // lease verified immediately before the only dangerous step
      await own(env, co, token, "create_sent_at=?", Date.now()); // write-ahead: a create may now be in flight
      if (fault === "hubspot-5xx") throw new HubspotError("server", 503, "simulated HubSpot 503 (fault injection)");
      const props = { name: co.name, description: block }; if (co.domain) props.domain = co.domain;
      let c;
      try { c = await hs.create(props); } catch (e) { if (e instanceof HubspotError && e.kind === "client") await own(env, co, token, "create_sent_at=NULL"); throw e; }
      if (fault === "hubspot-lost-response") throw new HubspotError("network", 0, "simulated lost response after create (fault injection)"); // id deliberately NOT saved
      hid = c.id; created = true;
      if (fault === "crash-after-create") throw new Error("simulated process failure after create (fault injection)");
      await own(env, co, token, "hubspot_id=?, identity_status='linked', create_sent_at=NULL", hid);
    }
    const back = await hs.get(hid);
    if (extractBlock(back.properties?.description, co.id) !== block) return await fail({ status: 502, body: { error: "HubSpot read-back did not match what was written" } }, "error", "HubSpot read-back did not match", { hubspot_id: hid });
    // synced_evidence_rev = the ACCOUNT revision read before the snapshot (co is read before the findings; see index.js sync) (not the current one): an edit made during the sync leaves the company visibly stale.
    await finish(env, co, token, "synced", null, { hubspot_id: hid, synced_run_id: run.id, synced_run_rev: run.rev ?? 0, synced_evidence_rev: co.evidence_rev ?? 0, identity: "linked" }, { entity: "company", action: "synced", detail: { hubspot_id: hid, run: run.id, rev: run.rev ?? 0, evidence_rev: co.evidence_rev ?? 0, created }, actor });
    return { status: 200, body: { ok: true, hubspot_id: hid, created } };
  } catch (e) {
    if (e?.leaseLost) return leaseLostResponse;
    try {
      const row = await env.DB.prepare("SELECT create_sent_at, hubspot_id FROM companies WHERE id=?").bind(co.id).first();
      const uncertain = !row?.hubspot_id && !!row?.create_sent_at && (!(e instanceof HubspotError) || ["network", "server"].includes(e.kind));
      await finish(env, co, token, uncertain ? "uncertain" : "error", String(e.message).slice(0, 300), { uncertain }, { entity: "company", action: "sync_failed", detail: { kind: e.kind || "internal", status: e.status }, actor });
      return { status: 502, body: { error: e.message, sync_status: uncertain ? "uncertain" : "error", recoverable: true } };
    } catch (e2) { if (e2?.leaseLost) return leaseLostResponse; throw e2; }
  }
}
