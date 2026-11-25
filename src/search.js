// Name -> candidate websites + bounded page text via Tavily (https://docs.tavily.com/documentation/api-reference/endpoint/search).
// Free plan = 1,000 credits/month, no card (official docs, read 2026-11-24); basic search = 1 credit. What the free plan does at zero credits is NOT STATED in the docs,
// so this module fails CLOSED: 429/432/433/434 are reported as quota/rate states, never retried, never replaced by invented results, and the app keeps its own daily/monthly search budgets.
// Search results and page text are UNTRUSTED DATA. The API key is server-side only and never appears in any response or log.
import { checkUrl, htmlToText, selectPassage, FETCH_LIMITS } from "./sources.js";

const ENDPOINT = "https://api.tavily.com/search";
const DIRECTORY_TOKENS = ["linkedin", "facebook", "twitter", "instagram", "youtube", "wikipedia", "companieshouse", "company-information", "endole", "opencorporates", "dnb", "zoominfo", "yell", "trustpilot", "glassdoor", "indeed", "crunchbase", "pinterest", "tiktok", "reddit", "bloomberg", "checkatrade", "gov", "companycheck", "duedil", "creditsafe", "kompass", "tavily"];
const STOP = new Set(["ltd", "limited", "plc", "llp", "the", "and", "of", "co", "company", "uk", "zz", "v2", "synthetic", "test"]);
export const nameTokens = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 1 && !STOP.has(t));
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };
export const isDirectory = (host) => host.split(".").some((p) => DIRECTORY_TOKENS.includes(p));

export async function tavilySearch(body, { apiKey, fetchFn = fetch }) {
  if (!apiKey) return { status: "not_configured", results: [] };
  let r; try { r = await fetchFn(ENDPOINT, { method: "POST", redirect: "manual", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ search_depth: "basic", topic: "general", include_answer: false, include_images: false, include_usage: true, ...body }), signal: AbortSignal.timeout(12000) }); }
  catch (e) { return { status: "unavailable", results: [], error: `The search provider could not be reached (${String(e?.name ?? "Error")}: ${String(e?.message ?? "").slice(0, 100)})` }; }
  if (r.status === 401) return { status: "unauthorised", results: [], error: "The search provider rejected the API key" };
  if (r.status === 429) return { status: "rate_limited", results: [], error: "Search rate limit reached; wait a minute and try again", retry_after: r.headers.get("retry-after") };
  if ([432, 433, 434].includes(r.status)) return { status: "quota", results: [], error: "Search quota exhausted for this plan. No fallback results are invented; use the website field or wait for the monthly reset." };
  if (!r.ok) return { status: "unavailable", results: [], error: `The search provider returned HTTP ${r.status}` };
  let j; try { j = await r.json(); } catch { return { status: "unavailable", results: [], error: "The search provider returned an unreadable response" }; }
  if (!Array.isArray(j?.results)) return { status: "unavailable", results: [], error: "The search provider returned an unexpected response" };
  return { status: "ok", results: j.results.filter((x) => x && typeof x.url === "string").slice(0, 20), credits: j?.usage?.credits ?? null };
}

// Rank hosts by evidence that they are THIS business. Deterministic; never selects for the user: it only reports support and whether the choice is ambiguous.
export function rankCandidates(name, location, results) {
  const toks = nameTokens(name), compact = toks.join(""), loc = String(location || "").toLowerCase().trim(), byHost = new Map();
  for (const x of results) {
    let u; try { u = checkUrl(x.url); } catch { continue; } const host = hostOf(u.href); if (!host || isDirectory(host)) continue;
    const title = String(x.title ?? ""), snip = String(x.content ?? "").slice(0, 600), tl = title.toLowerCase(), sl = snip.toLowerCase();
    const allIn = (s) => toks.length > 0 && toks.every((t) => s.includes(t));
    const sup = { host_match: compact.length >= 4 && host.replace(/[^a-z0-9]/g, "").includes(compact), name_in_title: allIn(tl), name_in_snippet: allIn(sl), location_match: !!loc && (tl.includes(loc) || sl.includes(loc)) };
    const pts = (sup.host_match ? 2 : 0) + (sup.name_in_title ? 1 : 0) + (sup.name_in_snippet ? 1 : 0) + (sup.location_match ? 1 : 0), prev = byHost.get(host);
    if (!prev || pts > prev.support_score || (pts === prev.support_score && (x.score ?? 0) > prev.score)) byHost.set(host, { source: "search", host, website: `https://${host}/`, title: title.slice(0, 160), snippet: snip.slice(0, 280), score: x.score ?? null, support: sup, support_score: pts, example_url: u.href });
  }
  const cands = [...byHost.values()].sort((a, b) => b.support_score - a.support_score || (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);
  const supported = cands.filter((c) => c.support.host_match || c.support.name_in_title || c.support.name_in_snippet);
  if (!supported.length) return { candidates: cands, ambiguous: true, suggested: null, reason: cands.length ? "no_candidate_names_the_business" : "no_results" };
  const [a, b] = supported; // suggest only a clear, well-supported leader (>=3 points and >=2 ahead of any other supported candidate)
  if (a.support_score >= 3 && (!b || a.support_score - b.support_score >= 2)) return { candidates: cands, ambiguous: false, suggested: a.host, reason: "single_supported_leader" };
  return { candidates: cands, ambiguous: true, suggested: null, reason: supported.length > 1 ? "several_plausible_sites" : "weak_support" };
}

// Bounded page text for ONE confirmed host, retrieved by the provider (our Worker does not fetch these pages), then sanitised exactly like directly fetched pages.
export async function siteEvidence(host, name, { apiKey, fetchFn = fetch, limits = FETCH_LIMITS, now = () => new Date() }) {
  const q = `${nameTokens(name).join(" ")} greenhouse glasshouse growing crops lighting LED`;
  const s = await tavilySearch({ query: q.slice(0, 300), include_domains: [host], include_raw_content: "text", max_results: limits.maxPages }, { apiKey, fetchFn });
  if (s.status !== "ok") return { status: s.status, error: s.error, pages: [], text: "" };
  const pages = [], seen = new Set();
  for (const x of s.results) {
    let u; try { u = checkUrl(x.url); } catch { continue; } if (hostOf(u.href) !== host || seen.has(u.href)) continue; seen.add(u.href);
    const raw = String(x.raw_content ?? x.content ?? "").slice(0, 120000), passage = selectPassage(htmlToText(raw)); if (passage.length >= 40) pages.push({ url: u.href, retrieved_at: now().toISOString(), passage });
    if (pages.length >= limits.maxPages) break;
  }
  if (!pages.length) return { status: "no_source", error: "The search provider returned no readable pages for this website", pages: [], text: "" };
  let used = 0; const kept = []; for (const p of pages) { const room = limits.maxTotalChars - used - 200; if (room < 80) break; kept.push({ ...p, passage: p.passage.slice(0, room) }); used += Math.min(p.passage.length, room) + 200; }
  return { status: "ok", pages: kept.map(({ url, retrieved_at }) => ({ url, retrieved_at })), text: kept.map((p) => `[Retrieved page ${p.url} on ${p.retrieved_at.slice(0, 10)}]\n${p.passage}`).join("\n\n"), credits: s.credits };
}
