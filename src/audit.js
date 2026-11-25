// Audit events with an authenticated actor. `eventStmt` returns a prepared statement so the event can be committed in the SAME D1 batch
// (one transaction) as the mutation it describes; with onlyIfChanged the event is written only if the preceding statement changed a row.
export const actorOf = (session) => ({ id: session?.github_id ?? null, login: session?.login ?? null });
const COLS = "INSERT INTO events (id, entity, entity_id, action, detail, at, actor_github_id, actor_login)";
export function eventStmt(env, entity, entityId, action, detail, actor = {}, { onlyIfChanged = false } = {}) {
  const v = [crypto.randomUUID(), entity, String(entityId), action, detail ? JSON.stringify(detail).slice(0, 800) : null, new Date().toISOString(), actor?.id ?? null, actor?.login ?? null];
  return onlyIfChanged ? env.DB.prepare(`${COLS} SELECT ?,?,?,?,?,?,?,? WHERE changes() > 0`).bind(...v) : env.DB.prepare(`${COLS} VALUES (?,?,?,?,?,?,?,?)`).bind(...v);
}
// Run mutation statements and their audit event atomically. Returns the batch results (results[0].meta.changes = rows changed by the first statement).
export const withEvent = (env, stmts, ev, actor, opts) => env.DB.batch([...stmts, eventStmt(env, ...ev, actor, opts)]);
