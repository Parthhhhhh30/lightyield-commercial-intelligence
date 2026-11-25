// Operation ownership for per-company operations (sync, identity resolution). The lock is (lease_owner, lease_until): every state change made
// by an operation is conditional on `lease_owner = <its token>`, so a stale or expired operation cannot modify, complete or release
// another operation's work. Leases are renewed before each external write; an operation that lost its lease must stop.
export const LEASE_MS = 5 * 60e3;
export class LeaseLost extends Error { constructor() { super("lease lost"); this.leaseLost = true; } }
// Take the lease if it is free, expired, or (legacy rows from before this column) not an in-flight 'syncing' row.
export async function acquire(env, companyId) {
  const token = crypto.randomUUID(), t = Date.now();
  const r = await env.DB.prepare("UPDATE companies SET lease_owner=?, lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until < ? OR (lease_owner IS NULL AND COALESCE(sync_status,'') != 'syncing'))").bind(token, t + LEASE_MS, companyId, t).run();
  return r.meta.changes ? token : null;
}
export async function renew(env, companyId, token) {
  const r = await env.DB.prepare("UPDATE companies SET lease_until=? WHERE id=? AND lease_owner=?").bind(Date.now() + LEASE_MS, companyId, token).run();
  return r.meta.changes > 0;
}
export async function release(env, companyId, token) { // no-op if the lease is no longer ours
  await env.DB.prepare("UPDATE companies SET lease_owner=NULL, lease_until=NULL WHERE id=? AND lease_owner=?").bind(companyId, token).run();
}
