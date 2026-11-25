// Presentation of a company row to clients (shared by index.js and accounts.js).
// sync_stale: HubSpot holds an OLDER revision than the currently approved evidence of the run that was synced. An unknown revision (legacy row)
// counts as stale: the system never claims "up to date" without proof. Interrupted syncs (expired lease) are reported as errors, not "syncing".
// Account-level revision semantics: `evidence_rev` counts every finding review in ANY run of the account. A sync records the account revision read BEFORE its
// evidence snapshot (`synced_evidence_rev`). HubSpot is reported CURRENT only if (1) that revision equals the present one, and (2) the run that was synced
// is still the account's current run (the latest run with approved/edited findings). Unknown revision (legacy row) = stale: never "current" without proof.
export const COMPANY_COLS = "c.id,c.name,c.domain,c.hubspot_id,c.sync_status,c.sync_error,c.synced_run_id,c.synced_run_rev,c.evidence_rev,c.synced_evidence_rev,c.identity_status,c.candidates,c.updated_at,c.lease_until";
export function presentCompany(co) {
  if (!co) return co;
  const interrupted = co.sync_status === "syncing" && co.lease_until && co.lease_until < Date.now();
  const stale = co.sync_status === "synced" && !!co.synced_run_id && (co.synced_evidence_rev == null || co.synced_evidence_rev !== co.evidence_rev);
  const { lease_until, lease_owner, ...rest } = co;
  return { ...rest, sync_status: interrupted ? "error" : co.sync_status, sync_error: interrupted ? "The previous sync was interrupted before finishing; retry (safe: duplicate-protected)." : co.sync_error, sync_stale: stale };
}
