// Minimal HubSpot client. Token is passed in from a Worker secret; never logged.
export class HubspotError extends Error {
  constructor(kind, status, msg) { super(msg); this.kind = kind; this.status = status; } // kind: client|server|network|rate
}
export function hubspot(token, fetchImpl = fetch) {
  const call = async (method, path, body) => {
    let r;
    try {
      r = await fetchImpl("https://api.hubapi.com" + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    } catch (e) { throw new HubspotError("network", 0, "network error or timeout calling HubSpot"); }
    const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
    if (r.status === 429) throw new HubspotError("rate", 429, "HubSpot rate limit");
    if (r.status >= 500) throw new HubspotError("server", r.status, `HubSpot server error ${r.status}`);
    if (r.status >= 400) throw new HubspotError("client", r.status, `HubSpot rejected request (${r.status}): ${String(j.message || "").slice(0, 160)}`);
    return j;
  };
  return {
    accountInfo: async () => call("GET", "/account-info/v3/details"),
    accountType: async () => (await call("GET", "/account-info/v3/details")).accountType,
    search: async (name) => (await call("POST", "/crm/v3/objects/companies/search", { filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: name }] }], properties: ["name", "description", "domain"], limit: 5 })).results || [],
    create: async (properties) => call("POST", "/crm/v3/objects/companies", { properties }),
    patch: async (id, properties) => call("PATCH", `/crm/v3/objects/companies/${encodeURIComponent(id)}`, { properties }),
    list: async (type, props, after) => call("GET", `/crm/v3/objects/${type}?limit=100&properties=${props.join(",")}${after ? "&after=" + encodeURIComponent(after) : ""}`),
    createTask: async (properties, companyId) => call("POST", "/crm/v3/objects/tasks", { properties, associations: [{ to: { id: companyId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 192 }] }] }),
    getTask: async (id) => call("GET", `/crm/v3/objects/tasks/${encodeURIComponent(id)}?properties=hs_task_subject,hs_task_status,hs_timestamp,hs_task_body`),
    patchTask: async (id, properties) => call("PATCH", `/crm/v3/objects/tasks/${encodeURIComponent(id)}`, { properties }),
    batchTasks: async (ids) => call("POST", "/crm/v3/objects/tasks/batch/read", { properties: ["hs_task_subject", "hs_task_status", "hs_timestamp", "hs_task_body"], inputs: ids.map((id) => ({ id })) }),
    taskCompanies: async (id) => (await call("GET", `/crm/v4/objects/tasks/${encodeURIComponent(id)}/associations/companies`)).results?.map((r) => String(r.toObjectId)) || [],
    get: async (id) => call("GET", `/crm/v3/objects/companies/${encodeURIComponent(id)}?properties=name,description,domain`),
  };
}

// Every CRM read AND write path must pass this gate: the token must belong to a developer TEST account and, when HUBSPOT_PORTAL_ID is
// configured, to exactly that portal; in HOSTED mode a missing pin fails closed. POLICY IS EVALUATED ON EVERY CALL: the cache stores only the
// observed account IDENTITY (never a "success"), so a changed/missing pin or a changed account can never be validated by a stale entry.
const identityCache = new Map();
const refuse = (reason) => ({ ok: false, reason });
export async function assertTestAccount(env, hs) {
  const pin = env.HUBSPOT_PORTAL_ID ? String(env.HUBSPOT_PORTAL_ID) : null;
  if (!env.HUBSPOT_TEST_TOKEN) return refuse("HubSpot test token not configured");
  if (env.HOSTED === "1" && !pin) return refuse("Hosted mode requires HUBSPOT_PORTAL_ID to pin the HubSpot test account; CRM access refused");
  let id = identityCache.get(env.HUBSPOT_TEST_TOKEN);
  if (!id || Date.now() - id.t > 300000) {
    try { const info = await hs.accountInfo(); id = { t: Date.now(), portalId: String(info.portalId), accountType: String(info.accountType), uiDomain: info.uiDomain || "app.hubspot.com" }; }
    catch { identityCache.delete(env.HUBSPOT_TEST_TOKEN); return refuse("Could not verify the HubSpot account; CRM access refused"); }
    identityCache.set(env.HUBSPOT_TEST_TOKEN, id);
  }
  if (!/TEST/.test(id.accountType)) return refuse("HubSpot account is not a developer test account; CRM access refused");
  if (pin && id.portalId !== pin) return refuse("HubSpot account is not the pinned test portal; CRM access refused");
  return { ok: true, portalId: id.portalId, uiDomain: id.uiDomain };
}
