// Name -> public sources. Everything fetched here is UNTRUSTED CONTENT: it becomes text for the evidence pipeline (where quotes are verified deterministically),
// never instructions and never a tool call. No credentials ever enter fetched text; Companies House key stays server-side.
// All network access goes through an injectable `fetchFn` so tests run on fixtures; production uses the global fetch.

export const FETCH_LIMITS = { maxPages: 4, maxBytesPerPage: 200_000, pageTimeoutMs: 8000, totalTimeoutMs: 25000, maxRedirects: 3, maxPassageChars: 1400, maxTotalChars: 5600 };
const UA = "LightYieldResearchBot/0.1 (synthetic prototype; contact via site owner request)";
const PAGE_HINT = /(about|who-we-are|our-story|growers?|products?|produce|sustainab|energy|lighting|news|farm|nursery|glasshouse|greenhouse|facilit|operations?)/i;

export class SourceError extends Error { constructor(code, message) { super(message); this.code = code; } }

// ---- URL policy -------------------------------------------------------------------------------------------------------------------------------------
const PRIVATE_V4 = /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.0\.0\.|198\.1[89]\.|22[4-9]\.|2[3-5]\d\.)/;
export function checkUrl(raw) {
  let u; try { u = new URL(String(raw)); } catch { throw new SourceError("bad_url", "not a valid URL"); }
  if (u.protocol !== "https:") throw new SourceError("not_https", "only https:// sources are fetched");
  if (u.username || u.password) throw new SourceError("credentials_in_url", "URLs with embedded credentials are refused");
  if (u.port && u.port !== "443") throw new SourceError("bad_port", "only the default https port is allowed");
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || /^\[/.test(u.host) || /^\d+$/.test(h.split(".").pop())) throw new SourceError("ip_literal", "IP-address hosts are refused");
  if (!h.includes(".") || h === "localhost" || /\.(local|localhost|internal|intranet|lan|home|corp|localdomain|test|invalid|example)$/.test(h)) throw new SourceError("internal_host", "internal or non-public host names are refused");
  if (PRIVATE_V4.test(h)) throw new SourceError("private_ip", "private address refused");
  if (h.length > 253) throw new SourceError("bad_url", "host too long");
  u.hash = ""; return u;
}

// ---- bounded fetch ----------------------------------------------------------------------------------------------------------------------------------
// Manual redirects (each hop re-validated), timeout, byte cap while streaming, text/html or text/plain only.
export async function boundedGet(rawUrl, { fetchFn = fetch, limits = FETCH_LIMITS, accept = "text/html,text/plain;q=0.9", signal } = {}) {
  let url = checkUrl(rawUrl).href;
  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), limits.pageTimeoutMs); const onAbort = () => ctl.abort(); signal?.addEventListener("abort", onAbort);
    try {
      const r = await fetchFn(url, { method: "GET", redirect: "manual", headers: { "user-agent": UA, accept }, signal: ctl.signal });
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const loc = r.headers.get("location"); if (!loc) throw new SourceError("bad_redirect", "redirect without location");
        if (hop === limits.maxRedirects) throw new SourceError("too_many_redirects", `more than ${limits.maxRedirects} redirects`);
        url = checkUrl(new URL(loc, url).href).href; continue; // each hop passes the same policy as the first request
      }
      if (r.status === 404 || r.status === 410) throw new SourceError("not_found", `HTTP ${r.status}`);
      if (r.status === 429 || r.status === 403 || r.status === 401) throw new SourceError("refused", `site refused automated access (HTTP ${r.status})`);
      if (r.status < 200 || r.status >= 300) throw new SourceError("http_error", `HTTP ${r.status}`);
      const ct = (r.headers.get("content-type") || "").toLowerCase(); if (!/^(text\/html|text\/plain|application\/xhtml\+xml)/.test(ct)) throw new SourceError("bad_content_type", `unsupported content type: ${ct.split(";")[0] || "none"}`);
      const len = Number(r.headers.get("content-length")); if (Number.isFinite(len) && len > limits.maxBytesPerPage * 4) throw new SourceError("too_large", "declared size exceeds the limit");
      let bytes = 0; const chunks = []; const rd = r.body?.getReader?.();
      if (rd) { for (;;) { const { done, value } = await rd.read(); if (done) break; bytes += value.byteLength; chunks.push(value); if (bytes >= limits.maxBytesPerPage) { rd.cancel().catch(() => {}); break; } } }
      else { const b = new Uint8Array(await r.arrayBuffer()); chunks.push(b.subarray(0, limits.maxBytesPerPage)); bytes = chunks[0].byteLength; }
      const buf = new Uint8Array(Math.min(bytes, limits.maxBytesPerPage)); let o = 0; for (const c of chunks) { const take = c.subarray(0, buf.length - o); buf.set(take, o); o += take.byteLength; if (o >= buf.length) break; }
      return { url, status: r.status, contentType: ct.split(";")[0], html: new TextDecoder("utf-8", { fatal: false }).decode(buf), truncated: bytes >= limits.maxBytesPerPage };
    } catch (e) { if (e instanceof SourceError) throw e; if (e?.name === "AbortError") throw new SourceError("timeout", "request timed out"); throw new SourceError("network", "network error"); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
  }
  throw new SourceError("too_many_redirects", "redirect limit");
}

// ---- text extraction (untrusted -> inert plain text) ------------------------------------------------------------------------------------------------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", euro: "€", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };
export function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template|svg|iframe|object|embed|head)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<[^>]+\b(hidden|aria-hidden\s*=\s*["']?true|style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0))[^>]*>[\s\S]*?<\/[a-z0-9]+\s*>/gi, " "); // best-effort: hidden prompt-injection text
  s = s.replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)\s*>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => { if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 31 && n < 0x10ffff ? String.fromCodePoint(n) : " "; } return ENT[e.toLowerCase()] ?? " "; });
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‏‪-‮⁠-⁤﻿]/g, ""); // control + zero-width + bidi
  s = s.replace(/<\/?\s*source\s*>/gi, " ").replace(/[ \t\f\v]+/g, " ").replace(/ *\n[ \n]*/g, "\n").trim(); // a page can never close the model's <source> delimiter
  return s;
}
export function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl), out = new Map();
  for (const m of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>/gi)) { try { const u = new URL(m[1], base); if (u.protocol === "https:" && u.hostname === base.hostname && PAGE_HINT.test(u.pathname) && !/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?)$/i.test(u.pathname)) { u.hash = ""; u.search = ""; out.set(u.href, u.pathname.length); } } catch { /* ignore */ } }
  return [...out.entries()].sort((a, b) => a[1] - b[1]).map(([h]) => h);
}
// Choose a bounded passage by RELEVANCE, not page order: lighting sentences first, then crop/production, then scale/site, then the page opening; a chosen sentence that starts with a pronoun or
// demonstrative ("It", "These", "This") brings its preceding sentence for the subject context. Output keeps page order. (A relevant LED sentence late on a long page used to be cut by the character cap.)
const R_LIGHT = /\b(led|leds|lighting|lights?|lamps?|hps|illuminat\w+|sunlight|photoperiod|supplement\w*)\b/i, R_CROP = /\b(grow\w*|produc\w+|harvest\w*|crops?|tomato\w*|cucumber\w*|pepper\w*|strawberr\w*|aubergine\w*|raspberr\w*|berr\w+|salad\w*|lettuce|herbs?|varieties|specialis\w*)\b/i, R_SCALE = /\b(hectares?|acres?|glasshouses?|greenhouses?|bays?|sites?|nursery|nurseries|install\w*|expan\w*|energy|sustainab\w*)\b/i, R_PRON = /^(?:it|they|these|those|this|that|the (?:system|installation|lamps?|lights?|glasshouses?|greenhouses?|site|farm))\b/i;
export function selectPassage(text, max = FETCH_LIMITS.maxPassageChars) {
  const sents = text.replace(/\n+/g, " \n").split(/(?<=[.!?])\s+|\n/).map((x) => x.trim()).filter((x) => x.length >= 20);
  const score = (x, i) => (R_LIGHT.test(x) ? 3 : 0) + (R_CROP.test(x) ? 2 : 0) + (R_SCALE.test(x) ? 1 : 0) + (i < 2 ? 1 : 0);
  const ranked = sents.map((x, i) => ({ x, i, sc: score(x, i) })).filter((r) => r.sc > 0).sort((a, b) => b.sc - a.sc || a.i - b.i);
  const keep = new Set(); let n = 0; const add = (i) => { if (keep.has(i) || i < 0 || i >= sents.length) return true; if (n + sents[i].length + 1 > max) return false; keep.add(i); n += sents[i].length + 1; return true; };
  for (const r of ranked) { if (n >= max) break; if (R_PRON.test(r.x) && r.i > 0 && !keep.has(r.i - 1)) { if (n + sents[r.i - 1].length + r.x.length + 2 > max) continue; add(r.i - 1); } if (!add(r.i)) continue; }
  return [...keep].sort((a, b) => a - b).map((i) => sents[i]).join(" ");
}

// ---- robots.txt (minimal, conservative) -----------------------------------------------------------------------------------------------------------
export function robotsAllows(robotsTxt, path) {
  let applies = false, rules = [];
  for (const line of String(robotsTxt).split(/\r?\n/)) { const m = line.replace(/#.*/, "").match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i); if (!m) continue; const k = m[1].toLowerCase(), v = m[2];
    if (k === "user-agent") applies = v === "*" || /lightyield/i.test(v); else if (applies && (k === "disallow" || k === "allow")) rules.push([k, v]); }
  let best = null; for (const [k, v] of rules) if (v !== "" && path.startsWith(v.replace(/\*$/, "")) && (!best || v.length >= best[1].length)) best = [k, v];
  return !best || best[0] === "allow";
}

// ---- gather a bounded source bundle for ONE confirmed website -------------------------------------------------------------------------------------------
// Returns text for the evidence pipeline with a visible provenance header per passage, plus the machine-readable provenance list.
export async function gatherWebsite(websiteUrl, { fetchFn = fetch, limits = FETCH_LIMITS, now = () => new Date() } = {}) {
  const start = checkUrl(websiteUrl), overall = new AbortController(), total = setTimeout(() => overall.abort(), limits.totalTimeoutMs), pages = [], skipped = [];
  try {
    let robots = ""; try { robots = (await boundedGet(new URL("/robots.txt", start).href, { fetchFn, limits, signal: overall.signal, accept: "text/plain" })).html; } catch (e) { if (!(e instanceof SourceError) || !["not_found", "bad_content_type", "http_error"].includes(e.code)) { if (e.code === "refused") throw new SourceError("refused", "the site refuses automated access; use a pasted source instead"); } }
    const allowed = (u) => robotsAllows(robots, new URL(u).pathname || "/");
    if (!allowed(start.href)) throw new SourceError("robots", "the site's robots.txt disallows automated access to this page");
    const queue = [start.href], tried = new Set();
    while (queue.length && pages.length < limits.maxPages) {
      const u = queue.shift(); if (tried.has(u)) continue; tried.add(u);
      if (!allowed(u)) { skipped.push({ url: u, reason: "robots.txt" }); continue; }
      let got; try { got = await boundedGet(u, { fetchFn, limits, signal: overall.signal }); } catch (e) { if (!(e instanceof SourceError)) throw e; skipped.push({ url: u, reason: e.code }); if (pages.length === 0 && u === start.href && ["refused", "internal_host", "private_ip", "ip_literal", "not_https", "timeout"].includes(e.code)) throw e; continue; }
      if (new URL(got.url).hostname !== start.hostname) { skipped.push({ url: got.url, reason: "redirected to a different host" }); continue; } // never silently adopt another site
      const text = htmlToText(got.html), passage = selectPassage(text); if (passage.length >= 40) pages.push({ url: got.url, retrieved_at: now().toISOString(), passage });
      if (pages.length === 1 && queue.length === 0 && got.url === start.href) for (const l of extractLinks(got.html, got.url).slice(0, limits.maxPages * 2)) queue.push(l);
    }
  } finally { clearTimeout(total); }
  if (!pages.length) throw new SourceError("no_source", "no readable public page could be retrieved for this website");
  let used = 0; const kept = []; for (const p of pages) { const room = limits.maxTotalChars - used - 200; if (room < 80) break; const passage = p.passage.slice(0, room); kept.push({ ...p, passage }); used += passage.length + 200; }
  const text = kept.map((p) => `[Retrieved page ${p.url} on ${p.retrieved_at.slice(0, 10)}]\n${p.passage}`).join("\n\n");
  return { text, pages: kept.map(({ url, retrieved_at }) => ({ url, retrieved_at })), skipped };
}

// ---- Companies House: candidate identities (UK registered companies) -------------------------------------------------------------------------------------
export async function companiesHouseCandidates(name, { apiKey, fetchFn = fetch, limit = 5 } = {}) {
  if (!apiKey) return { status: "not_configured", candidates: [] };
  const q = String(name).trim().slice(0, 120); if (!q) return { status: "ok", candidates: [] };
  const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(q)}&items_per_page=${limit}`;
  let r; try { r = await fetchFn(url, { headers: { authorization: "Basic " + btoa(apiKey + ":"), accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(8000) }); } catch (e) { return { status: "unavailable", candidates: [], error: `Companies House could not be reached (${String(e?.name ?? "Error")}: ${String(e?.message ?? "").slice(0, 100)})` }; }
  if (r.status === 429) return { status: "quota", candidates: [], error: "Companies House rate limit reached (600 requests per 5 minutes); try again shortly" };
  if (r.status === 401 || r.status === 403) return { status: "unauthorised", candidates: [], error: "Companies House rejected the API key" };
  if (!r.ok) return { status: "unavailable", candidates: [], error: `Companies House returned HTTP ${r.status}` };
  let j; try { j = await r.json(); } catch { return { status: "unavailable", candidates: [], error: "Companies House returned an unreadable response" }; }
  const items = Array.isArray(j?.items) ? j.items : [];
  return { status: "ok", candidates: items.slice(0, limit).map((i) => ({ source: "companies_house", company_number: String(i.company_number ?? ""), name: String(i.title ?? "").slice(0, 160), status: String(i.company_status ?? ""), address: String(i.address_snippet ?? "").slice(0, 200), incorporated: i.date_of_creation ?? null, url: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(String(i.company_number ?? ""))}` })).filter((c) => c.company_number && c.name) };
}
// Ambiguity: more than one active candidate whose normalised name matches closely, or no exact match => the user must choose; we never pick silently.
const nk = (s) => String(s).toLowerCase().replace(/\b(limited|ltd|plc|llp|the)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export function assessAmbiguity(name, candidates) {
  const exact = candidates.filter((c) => nk(c.name) === nk(name));
  if (candidates.length === 0) return { ambiguous: false, reason: "no_candidates" };
  if (exact.length === 1 && candidates.filter((c) => c.status === "active").length <= 1) return { ambiguous: false, reason: "single_exact", suggested: exact[0].company_number };
  return { ambiguous: true, reason: exact.length > 1 ? "several_exact" : "no_exact_match" };
}
