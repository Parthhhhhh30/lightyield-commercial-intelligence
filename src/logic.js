// Pure, dependency-free business rules. Everything the AI says is untrusted until checked here.
import { quoteInSource } from "./evidence.js";

export const LIMITS = { name: 120, sourceId: 200, sourceText: 6000, value: 200, note: 300 };
const INFO_FLAGS = ["ai_may_have_missed_cue", "quote_recovered_from_source", "ai_quote_replaced", "semantic_check_passed"];
export const SOURCED = ["crop", "lighting", "future"];
export const LIGHTING = ["Yes", "No", "Unknown"];
export const normName = (s) => String(s).replace(/\s+/g, " ").trim();
export const nameKey = (s) => normName(s).toLowerCase();

const LIGHT_TERMS = /\b(led|leds|lighting|lights?|lamps?|hps|grow[- ]?lights?|illumination|photoperiod)\b/i;
const OBJ = "(?:supplementary|supplemental|artificial|assimilation|grow|led|leds|hps|lamps?|lighting|lights?)";
const UNCERTAIN = /\b(does not state|doesn't state|not stated|unclear|unknown|not specified|no information|does not (?:say|mention|specify|confirm)|not (?:mentioned|confirmed|clear)|whether|unsure)\b/i;
const PLANISH = /\b(to be (?:installed|fitted|added|retrofitted)|can|plans?|planning|planned|will|going to|intends?|intending|scheduled|about to|next (?:year|season|winter|spring|autumn)|upgrad(?:e|ing) (?:to|its|their)|considering|consider|might|may|would|could|exploring|interested in|if)\b/i;
const WEAK_PLAN = /\b(considering|consider|might|may|would|could|exploring|interested in|if|hopes?|thinking about|possibly)\b/i;
const NO_PLAN = /\b(no plans? to|does not plan|doesn't plan|do not plan|not planning|no intention|no current plans?|has no plans?)\b/i;
const FIRM_PLAN = /\b(plans? to|planning to|planned|will (?:install|add|upgrade|retrofit|fit|introduce|use)|intends? to|scheduled|going to (?:install|add|upgrade)|about to (?:install|add)|is upgrading|are upgrading|upgrad(?:e|ing) to)\b/i;
const EXCLUDE_NEG = /\bno (?:shortage|lack|complaints?|issues?|problems?|doubt|question|surprise)\b|\bnot only\b|\bnot (?:just|merely)\b/i;
const NEG_LIGHT = new RegExp("\\b(?:no|without|not (?:supplemented|augmented|boosted|assisted|powered|topped up)|(?:isn't|aren't|wasn't|weren't) (?:supplemented|augmented|boosted|assisted|lit|powered)|not (?:lit|lighted|illuminated)(?: by| with)?|unlit|never (?:used|installed|had)|lacks?|not (?:use|using|have|has|installed|equipped|fitted|operate|operating|run|running)|(?:does|do|did) not (?:use|have|operate|run|install)|(?:doesn't|don't|didn't) (?:use|have|operate|run|install)|has no|have no|no (?:current )?use of|not currently (?:lit|lighting|using))\\b[^.;]{0,50}\\b" + OBJ + "\\b|\\b(?:natural (?:light|daylight|sunlight) only|relies (?:solely|only|entirely|exclusively) on (?:natural|daylight|sunlight)|only natural (?:light|daylight))\\b", "i");
const AFFIRM_A = new RegExp("\\b(?:use[sd]?|using|install(?:ed|s)?|operat(?:e|es|ed|ing)|runs?|running|equipped with|fitted with|has|have|deploy(?:s|ed)?|employ(?:s|ed)?|with|under|retrofitted with)\\b[^.;]{0,60}\\b" + OBJ + "\\b|\\b(?:supplementary|supplemental|artificial|led|hps|grow)\\b[^.;]{0,40}\\b(?:is|are|was|were) (?:installed|in use|used|operated|fitted|running)\\b|\\b(?:lit|lighted|illuminated)\\s+(?:by|with)\\b[^.;]{0,40}\\b" + OBJ + "\\b|\\b(?:supplementary|supplemental|artificial|led|leds|hps|grow)\\b(?:\\s+(?!to\\b|be\\b|will\\b|would\\b|could\\b|may\\b|if\\b|not\\b|never\\b|no\\b)\\w+){0,3}?\\s+(?:installed|fitted|retrofitted|in use|operating)\\b", "i");
// Additional PRESENT-state constructions seen on real company pages (2026-11-24): present perfect ("has recently been installed"), participial ("sunlight, supplemented by LED lights"),
// LED as grammatical subject of an effect verb ("LED lights simulate sunlight", "LED grow light system enables us to ..."), "to power LED lights". Negation, plans, removal, other parties and dates are still decided by classify().
const GAP = "(?:\\s+(?!to\\b|be\\b|will\\b|would\\b|could\\b|may\\b|might\\b|can\\b|if\\b|not\\b|never\\b|no\\b)[\\w-]+){0,9}?";
const AFFIRM_B = new RegExp("\\b(?:led|leds|hps|lighting|lights?|lamps?)\\b[^.;]{0,50}\\b(?:has|have)\\s+(?:\\w+\\s+)?been\\s+(?:installed|fitted|retrofitted|commissioned)\\b"
  + "|\\b(?:supplemented|supplementing|augmented|topped up|boosted|assisted)\\s+(?:by|with)\\b[^.;]{0,40}\\b" + OBJ + "\\b"
  + "|\\b(?:led|leds|hps)\\b" + GAP + "\\s+(?:simulates?|provides?|supplements?|extends?|illuminates?|powers?|boosts?|delivers?|enables?|makes?|allows?|gives?|supports?)\\b"
  + "|\\b(?:power|powers|powering)\\s+(?:the\\s+|our\\s+)?[^.;]{0,15}\\b(?:led|leds|hps)\\b", "i");
const AFFIRM = { test: (x) => AFFIRM_A.test(x) || AFFIRM_B.test(x) };
// Other parties: a clause about neighbours/competitors/suppliers/customers is NOT evidence about the target business.
const OTHER_PARTY = /\b(?:competitors?|competing|rivals?|neighbou?rs?|neighbou?ring|neighbou?rhood|nearby|adjacent|surrounding|other (?:growers?|farms?|nurser(?:y|ies)|businesses|producers?)|customers?|suppliers?|installers?|contractors?|manufacturers?|vendors?|consultants?)\b/i;
// Lighting that no longer operates (removed/decommissioned/switched off/replaced): never an affirmative CURRENT statement.
const REMOVED = /\b(?:removed|removal|removing|taken out|ripped out|stripped out|dismantled|decommission\w*|switched off|turned off|shut down|mothballed|scrapped|retired|discontinued|abandoned|no longer|ceased|stopped using|replaced (?:by|with)|phased out)\b/i;
// Past installation with a past year/ago/formerly and NO present-state cue: history, not current operation. A stated present cue (uses, lit by, is lit, in use, currently, to extend ...) keeps it affirmative.
const PAST_INSTALL = /\b(?:installed|fitted|retrofitted|commissioned|put in|was|were|had been|supplemented|illuminated|lit|powered|provided|simulated|extended|boosted|delivered|enabled)\b/i;
const PAST_MARK = /\b(?:(?:in|since|during|from|back in|around|circa|by)\s+(?:19|20)\d{2}|(?:19|20)\d{2}\b|\d+\s+years?\s+ago|years ago|formerly|previously|originally|once|historically|in the past|last (?:year|decade))\b/i;
const PRESENT_MARK = /\b(?:(?:is|are) (?:lit|installed|in use|operat\w+|running|used|fitted)|since\s+(?:19|20)\d{2}|(?:has|have)\s+(?:\w+\s+)?been|(?:lit|lighted|illuminated) (?:by|with)|uses?|using|operates?|operating|runs?|running|currently|now|today|at present|presently|in use)\b/i; // NB: a PURPOSE ("to extend the winter season") says why it was installed, not that it operates now
const INJECTION = /(ignore|disregard|forget)\b.{0,50}\b(instruction|prompt|previous|above|rules)|system prompt|you are now|new instructions|set (the )?(lighting|status)|respond with|output (the )?json|as an ai\b/i;

const sentences = (t) => String(t).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
export const clauses = (s) => String(s).split(/;|,?\s+(?:but|however|although|though|while|whereas|and)\s+|\s+[-\u2013\u2014]\s+/i).map((x) => x.trim()).filter(Boolean);
export const isInjection = (s) => INJECTION.test(s);
export function detectInjection(source) { return sentences(source).filter(isInjection); }
// Source with instruction-like sentences removed: values/quotes must be supported by THIS text, not by injected instructions.
export const cleanSource = (source) => sentences(source).filter((x) => !isInjection(x)).join(" ");
export const overlapsInjection = (quote, source) => { const q = String(quote).replace(/\s+/g, " ").trim().toLowerCase(); return !!q && detectInjection(source).some((i) => { const n = i.replace(/\s+/g, " ").trim().toLowerCase(); return n.includes(q) || q.includes(n); }); };
// Polarity of a clause about CURRENT supplementary lighting: affirmative | negative | uncertain | null (not evidence)
export function classify(clause) {
  if (!LIGHT_TERMS.test(clause) && !NEG_LIGHT.test(clause)) return null;
  if (OTHER_PARTY.test(clause)) return null; // about someone else
  if (EXCLUDE_NEG.test(clause) && !AFFIRM.test(clause.replace(EXCLUDE_NEG, ""))) return null;
  if (UNCERTAIN.test(clause)) return "uncertain";
  if (PLANISH.test(clause)) return null; // plans/hypotheticals are not statements about current use
  if (NEG_LIGHT.test(clause)) return AFFIRM.test(clause.replace(NEG_LIGHT, "")) ? null : "negative";
  if (AFFIRM.test(clause)) {
    if (REMOVED.test(clause)) return "uncertain";                                                     // installed, then removed / switched off: not current use
    if (PAST_INSTALL.test(clause) && PAST_MARK.test(clause) && !PRESENT_MARK.test(clause)) return "uncertain"; // historical installation alone
    return "affirmative";
  }
  return null;
}
// Polarity about FUTURE lighting plans: planned | not_planned | weak | null
export function classifyPlan(clause) {
  if (!LIGHT_TERMS.test(clause)) return null;
  if (NO_PLAN.test(clause)) return "not_planned";
  if (WEAK_PLAN.test(clause) && !/\b(?:plans? to|planning to|will (?:install|add)|intends? to|scheduled)\b/i.test(clause)) return "weak";
  if (FIRM_PLAN.test(clause)) return "planned";
  return null;
}
const classes = (text, fn) => sentences(text).filter((x) => !isInjection(x)).flatMap(clauses).map((c) => ({ c: fn(c), s: c })).filter((x) => x.c);
export const lightingCues = (source) => classes(source, classify);
export const planCues = (source) => classes(source, classifyPlan);
export const quoteClasses = (quote, fn) => new Set(clauses(quote).map(fn).filter(Boolean));

// ---- AI output validation (strict; never trusts shape) ----
const str = (v, max) => typeof v === "string" && v.length <= max;
export const PLANS = ["Planned", "Not planned", "Unknown"];
export function validateAiOutput(o) {
  const errors = [];
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, errors: ["not an object"] };
  if (!str(o.business_name, 200)) errors.push("business_name");
  if (!str(o.crop_value, 200)) errors.push("crop_value");
  if (!str(o.crop_quote, 1000)) errors.push("crop_quote");
  if (!LIGHTING.includes(o.lighting_status)) errors.push("lighting_status");
  if (!str(o.lighting_quote, 1000)) errors.push("lighting_quote");
  if (o.future_plans !== undefined && !PLANS.includes(o.future_plans)) errors.push("future_plans");
  if (o.future_quote !== undefined && !str(o.future_quote, 1000)) errors.push("future_quote");
  for (const k of ["unknown_information", "discovery_questions"]) {
    if (!Array.isArray(o[k]) || o[k].length > 12 || !o[k].every((x) => str(x, 300))) errors.push(k);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}
export function parseAi(out) {
  let p = out?.response ?? out?.choices?.[0]?.message?.content;
  if (typeof p === "string") { try { p = JSON.parse(p); } catch { return { ok: false, errors: ["invalid JSON"] }; } }
  const v = validateAiOutput(p);
  return v.ok ? { ok: true, value: { future_plans: "Unknown", future_quote: "", ...p } } : v;
}

// ---- Turn validated AI output into reviewable findings ----
// A claim is only PROPOSED (never verified) when every deterministic check passes; a second semantic model pass must also agree
// (see needsSemanticCheck/applySemantic). Anything else is downgraded to Unknown and flagged. Humans approve everything.
const recover = (cues, want, flags) => { const c = cues.find((x) => x.c === want); if (c) { flags.push("quote_recovered_from_source"); return c.s; } return ""; };
function assess({ status, quote: q0, unknownValue, source, cues, polarity, posValue, negValue, posClass, negClass, plan }) {
  const flags = []; let quote = (q0 || "").trim();
  if (!quote && status !== unknownValue) quote = recover(cues, status === posValue ? posClass : negClass, flags);
  if (!quote && status === unknownValue) quote = recover(cues, "uncertain", flags);
  const quoteOk = quote ? quoteInSource(quote, source) : false;
  const hasPos = cues.some((c) => c.c === posClass), hasNeg = cues.some((c) => c.c === negClass);
  if (hasPos && hasNeg) flags.push("contradictory_source");
  if (quote && !quoteOk) flags.push("quote_not_in_source");
  if (status !== unknownValue) {
    if (!quote) flags.push("claim_without_quote");
    else if (quoteOk) {
      if (isInjection(quote) || overlapsInjection(quote, source)) flags.push("quote_is_injection_text");
      else {
        const qc = quoteClasses(quote, polarity);
        const want = status === posValue ? posClass : negClass, other = status === posValue ? negClass : posClass;
        if (!qc.has(want) || qc.has(other)) flags.push(qc.size === 0 ? "quote_not_about_claim" : "quote_contradicts_claim");
      }
    }
  } else if (hasPos && !hasNeg) flags.push("ai_may_have_missed_cue");
  const unsupportedClaim = status !== unknownValue && flags.some((f) => !INFO_FLAGS.includes(f));
  const downgrade = unsupportedClaim || flags.includes("contradictory_source");
  return { value: downgrade ? unknownValue : status, quote, quoteOk: !!quote && quoteOk, flags, claim: status !== unknownValue && !downgrade ? status : null };
}
// Removal evidence anywhere in the source about lighting (same sentence, or the NEXT sentence starting with a pronoun/definite reference to it) blocks an affirmative CURRENT claim.
function removalEvidence(source) {
  const sn = sentences(source).filter((x) => !isInjection(x));
  return sn.some((x, i) => REMOVED.test(x) && !OTHER_PARTY.test(x) && (LIGHT_TERMS.test(x) || (i > 0 && LIGHT_TERMS.test(sn[i - 1]) && /^(?:it|they|these|those|the (?:lamps?|lights?|fixtures?|lighting|system|installation|equipment|leds?))\b/i.test(x))));
}
export function assessLighting(ai, source) {
  let r = assessLighting0(ai, source);
  // The quote may be a TRIMMED part of a longer source sentence ("installed LED lighting in its newest bay" from "In 2015 we installed ..."): judge the whole sentence(s) containing it too.
  if (ai.lighting_status === "Yes" && r.value === "Yes" && r.quote) {
    const q = r.quote.replace(/\s+/g, " ").trim().toLowerCase(), cls = sentences(source).filter((x) => x.replace(/\s+/g, " ").toLowerCase().includes(q)).flatMap(clauses).map(classify);
    if (cls.includes("uncertain") && !cls.includes("affirmative")) r = { ...r, value: "Unknown", flags: [...r.flags, "lighting_historical_in_source"], claim: null };
  }
  if (ai.lighting_status === "Yes" && r.value === "Yes" && removalEvidence(source)) return { ...r, value: "Unknown", flags: [...r.flags, "lighting_removal_in_source"], claim: null };
  return r;
}
function assessLighting0(ai, source) {
  return assess({ status: ai.lighting_status, quote: ai.lighting_quote, unknownValue: "Unknown", source, cues: lightingCues(source), polarity: classify, posValue: "Yes", negValue: "No", posClass: "affirmative", negClass: "negative" });
}
export function assessFuture(ai, source) {
  return assess({ status: ai.future_plans, quote: ai.future_quote, unknownValue: "Unknown", source, cues: planCues(source).filter((c) => c.c !== "weak"), polarity: classifyPlan, posValue: "Planned", negValue: "Not planned", posClass: "planned", negClass: "not_planned" });
}
export const CLAIM_TEXT = {
  lighting: { Yes: "The business CURRENTLY uses supplementary lighting in its glasshouses.", No: "The business CURRENTLY has NO supplementary lighting." },
  future: { Planned: "The business has a FIRM plan to install or upgrade supplementary lighting.", "Not planned": "The business has stated it has NO plan to install supplementary lighting." },
};
export const needsSemanticCheck = (f) => (f.kind === "lighting" || f.kind === "future") && f.value !== "Unknown" && !f.flags.some((x) => !INFO_FLAGS.includes(x));
export function applySemantic(f, verdict) { // verdict: {verdict:'supported'|'not_supported'|'contradicted'} or null (verifier unavailable => fail closed)
  const ok = verdict && verdict.verdict === "supported";
  if (ok) return { ...f, flags: [...f.flags, "semantic_check_passed"] };
  return { ...f, value: "Unknown", flags: [...f.flags, verdict ? "semantic_check_failed" : "semantic_check_unavailable"] };
}

// ---- Crop evidence (M4). A crop claim is supported only by an AFFIRMATIVE, CURRENT clause about the TARGET company that contains a growing
// statement and names the crop; negation, history, plans, other subjects (competitors, neighbours, customers) and contradictions all downgrade to
// Unknown. Heuristic and deliberately conservative: it does not prove semantic truth, and human review stays mandatory.
const CROP_GROW = /\b(grow(?:s|ing|n)?|grew|growers? of|focus(?:es|ed|ing)? (?:totally |solely |entirely |mainly |primarily |exclusively )?on|produc(?:e|es|ed|ing|tion)|cultivat\w*|harvest\w*|raise[sd]?|raising|specialis\w*|specializ\w*|farm(?:s|ed|ing)|(?<=\b(?:we|they|to) )farm)\b/i;
const CROP_NEG = /\b(no|not|never|without|neither|nor|none|n't|cease[sd]?|stopped|discontinued|abandoned|ruled out)\b/i;
const CROP_HIST = /\b(used to|formerly|previously|once|in the past|no longer|former|historic\w*|until (?:\d{4}|recently|last)|before \d{4}|stopped|ceased|discontinued|gave up|grew\b)/i;
const CROP_FUTURE = /\b(plan(?:s|ned|ning)? to|will (?:start|begin|grow|produce|plant)|intend\w*|considering|consider|trial\w*|hope[sd]? to|from next|next (?:year|season|spring|winter)|aims? to|about to|might|may|could|would)\b/i;
const CROP_OTHER = /\b(neighbouring|neighboring|nearby|adjacent|surrounding|competing|rival|local|regional|national|competitors?|neighbou?rs?|rivals?|other (?:growers|farms|businesses|producers|nurseries)|the (?:industry|sector|market|region|uk)|customers?|suppliers?|buyers?|retailers?|supermarkets?|wholesalers?)\b/i;
const GENERIC_SUBJ = /\b(we|our|it|its|they|their|the (?:company|business|firm|grower|growers|farm|nursery|site|glasshouses?|greenhouses?|operation|enterprise)|this (?:company|business|farm|site))\b/i;
const NAME_STOP = new Set(["ltd", "limited", "plc", "llp", "growers", "grower", "produce", "farms", "farm", "nursery", "nurseries", "glass", "glasshouse", "glasshouses", "greenhouse", "greenhouses", "salads", "fresh", "group", "holdings", "the", "and", "company", "packers", "horticulture", "eval", "business"]);
const stemW = (w) => { w = w.toLowerCase(); return w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("oes") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w; };
// "non-organic" / "non organic" is ONE token ("nonorganic"): the prefix reverses the meaning and must neither be dropped nor let "organic" match it
const wordsOf = (t) => (String(t).replace(/\bnon[-\s]+(?=[A-Za-z])/gi, "non").match(/[A-Za-z]+/g) || []);
const CROP_STOP = new Set(["with", "under", "glass", "mixed", "various", "salad", "the", "and", "for", "from", "in", "at", "of", "to", "a", "an", "on", "by"]);
// every word of a claimed crop is material (qualifiers like "organic", "non", "low", "GM"); only filler is ignored
const cropTokens = (v) => wordsOf(v).filter((w) => w.length >= 2 && !CROP_STOP.has(w.toLowerCase())).map(stemW);
const nameTokens = (n) => (String(n).toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length >= 3 && !NAME_STOP.has(t));
const GROW_SRC = "grow(?:s|ing|n)?|grew|growers? of|focus(?:es|ed|ing)? (?:totally |solely |entirely |mainly |primarily |exclusively )?on|produc(?:e|es|ed|ing|tion)|cultivat\\w*|harvest\\w*|raise[sd]?|raising|specialis\\w*|specializ\\w*|farm(?:s|ed|ing)|(?<=\\b(?:we|they|to) )farm";
// Clause splitting: hard separators plus a coordination ("and"/",") that introduces ANOTHER growing predicate ("Acme grows X and Rival grows Y"),
// so each predicate is judged with its own subject.
const SPLIT_RE = new RegExp(`;|\\s[-–—]\\s|,?\\s+(?:but(?!\\s+also\\b)|however|although|though|while|whereas)\\s+|,?\\s+(?:and|,)\\s+(?=[^,;.]{0,70}?\\b(?:${GROW_SRC})\\b)`, "i");
const cropClauses = (t) => String(t).split(SPLIT_RE).map((x) => x && x.trim()).filter(Boolean);
const FILLER = /\b(?:also|now|currently|mainly|primarily|mostly|then|still|and|but|today|here|there)\b/gi;
const PASSIVE = /\b(?:grown|produced|raised|cultivated|harvested|farmed)\s+(?:\w+\s+){0,3}?by\s+([^,;.]+)/i;
const CAP_OK = new Set(["the", "a", "an", "in", "at", "since", "today", "currently", "now", "also", "our", "we", "it", "they", "this", "its", "their", "however", "founded", "family", "based"]);
// The subject of a predicate is the text before its growing verb, or (passive "grown by X") the agent after "by". Returns null when there is no
// explicit subject in this clause (inherits from the previous predicate of the same sentence).
function clauseSubject(clause) {
  const pm = PASSIVE.exec(clause); if (pm) return pm[1];
  const m = CROP_GROW.exec(clause); const subj = (m ? clause.slice(0, m.index) : clause).replace(FILLER, " ").replace(/\s+/g, " ").trim();
  return subj || null;
}
// Is `subj` the target company? INDEPENDENT OF CAPITALISATION: the subject (the text right before the growing verb, after the last comma so "In Ely, Acme Glass" works)
// is reduced to lowercase content words. Customers/competitors/neighbours as the SUBJECT disqualify (as OBJECT, "for supermarkets", they do not). Every remaining word must
// belong to the target's own name or be a generic company noun ("the company", "Acme Glass Ltd"), and at least one distinctive name word must be present - so "acme foods"
// (any case) is not "Acme Glass". Bare generic subjects (we/it/the company) are accepted (limitation: ambiguous in a multi-company passage; human review is the control).
const FN_WORDS = new Set(["the", "a", "an", "our", "we", "it", "its", "they", "their", "this", "that", "these", "those", "us", "and"]), BENIGN_ADJ = new Set(["family", "run", "owned", "based", "independent", "established", "specialist", "leading", "large", "largest", "big", "biggest", "enormous", "huge", "modern", "main", "entire", "whole", "extensive", "new", "combined", "complex", "state-of-the-art"]), GENERIC_NOUNS = new Set(["company", "business", "firm", "grower", "growers", "farm", "nursery", "site", "operation", "enterprise", "glasshouse", "glasshouses", "greenhouse", "greenhouses"]), CORP_SUFFIX = new Set(["ltd", "limited", "plc", "llp", "company", "business", "firm"]);
// auxiliaries/negations/tense words between the subject noun phrase and the growing verb are not part of the subject ("Acme Glass does not grow ...")
const AUX = new Set(["does", "do", "did", "not", "never", "no", "longer", "has", "have", "had", "is", "are", "was", "were", "will", "would", "can", "could", "may", "might", "shall", "should", "cannot", "plan", "plans", "planned", "planning", "intend", "intends", "intended", "to", "still", "also", "now", "currently", "recently", "previously", "formerly", "once", "just", "only", "mainly", "primarily", "estimated", "believed", "thought", "understood", "reported", "said", "been", "being", "be"]); // present-tense hedges about current output; "expected"/"planned" stay out (they describe the future)
function subjectIsTarget(subj, name) {
  if (subj == null) return null;
  subj = subj.replace(/^.*\b(?:enable[sd]?|allow(?:s|ed)?|help(?:s|ed)?|let(?:s)?|permit(?:s|ted)?|make(?:s)? it possible for)\s+/i, "").replace(/\s+to$/i, ""); // "... enables us to grow X": the subject of growing is "us"
  if (CROP_OTHER.test(subj)) return false;
  const seg = subj.split(",").pop().replace(/['\u2019]s\b/gi, ""), words = (seg.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !FN_WORDS.has(w) && !AUX.has(w));
  if (!words.length) return true;                                            // bare pronoun / article
  const nameWords = new Set(String(name).toLowerCase().match(/[a-z0-9]+/g) || []), toks = nameTokens(name);
  if (words.every((w) => GENERIC_NOUNS.has(w) || CORP_SUFFIX.has(w))) return true;                  // "the company"
  if (words.some((w) => GENERIC_NOUNS.has(w)) && words.every((w) => GENERIC_NOUNS.has(w) || CORP_SUFFIX.has(w) || BENIGN_ADJ.has(w))) return true; // "these enormous glasshouses" (descriptors are benign; neighbouring/rival/other were already excluded by CROP_OTHER)
  const distinctive = toks.length ? toks.some((x) => words.includes(x)) : [...nameWords].every((w) => words.includes(w));
  return distinctive && words.every((w) => nameWords.has(w) || CORP_SUFFIX.has(w) || BENIGN_ADJ.has(w)); // "Family-run <Name>", "Independent Acme Glass"
}
function negatedNear(clause, toks) { // a negation shortly BEFORE the crop word, not across a coordinating "and"/comma
  const re = /[A-Za-z]+/g; let m; while ((m = re.exec(clause))) if (toks.includes(stemW(m[0]))) { let win = clause.slice(Math.max(0, m.index - 45), m.index).replace(/\b(?:not|never)\s+(?:only|just|merely|simply)\b/gi, " "); const cut = Math.max(win.lastIndexOf(" and "), win.lastIndexOf(",")); if (cut >= 0) win = win.slice(cut + 1); if (CROP_NEG.test(win)) return true; }
  return false;
}
// The claim "organic tomatoes" is supported only where "organic" sits immediately before "tomato(es)" (modifiers precede the head noun, which is the LAST claim token); a qualifier that merely appears
// elsewhere in the clause ("tomatoes and organic peppers", "GM tomatoes in a pesticide-free greenhouse") supports nothing. Filler words are ignored on both sides.
function phraseIn(stems, toks) {
  if (!toks.length) return false; const head = toks[toks.length - 1], mods = toks.slice(0, -1);
  for (let j = 0; j < stems.length; j++) if (stems[j] === head && j >= mods.length && mods.every((m, k) => stems[j - mods.length + k] === m)) return true;
  return false;
}
function analyseCrop(text, toks, name) {
  const res = { mentions: false, support: false, targetNegOrHist: false, reasons: [] }; let contradicted = false, prev = true;
  for (const cl of cropClauses(text)) {
    const hasPredicate = CROP_GROW.test(cl) || PASSIVE.test(cl); // a clause WITHOUT a growing predicate ("... and deliver many different") says nothing about who grows: it must not reset the subject
    const subj = hasPredicate ? subjectIsTarget(clauseSubject(cl), name) : null, subjOk = subj === null ? prev : subj; if (hasPredicate) prev = subjOk; // keep the subject across "also harvests ..." predicates
    if (!phraseIn(wordsOf(cl).filter((w) => !CROP_STOP.has(w.toLowerCase())).map(stemW), toks)) continue; res.mentions = true; // the whole claimed PHRASE (head crop + its modifiers, adjacent and in order) must occur in the clause
    const neg = negatedNear(cl, toks), hist = CROP_HIST.test(cl), fut = CROP_FUTURE.test(cl), grow = CROP_GROW.test(cl);
    if (subjOk && (neg || hist)) contradicted = true;
    const why = []; if (neg) why.push("crop_negated"); if (hist) why.push("crop_historical"); if (fut) why.push("crop_not_current"); if (!subjOk) why.push("crop_other_subject"); if (!grow) why.push("crop_no_growing_statement");
    if (!why.length) res.support = true; else if (!res.reasons.length) res.reasons = why;
  }
  res.targetNegOrHist = contradicted; if (contradicted) res.support = false; // a clause in the same text contradicts the support
  return res;
}
// A claimed crop value may list several crops ("tomatoes and peppers"): EVERY item must be supported by the quote, none may be contradicted.
const cropItems = (v) => String(v).split(/\s*(?:,|&|\/|;|\band\b|\bplus\b)\s*/i).map((x) => x.trim()).filter(Boolean);
export function assessCrop(ai, source, enteredName) {
  const cv = ai.crop_value.trim() || "Unknown"; let quote = ai.crop_quote.trim(); let flags = [];
  if (cv === "Unknown") return { value: "Unknown", quote, quoteOk: quote ? quoteInSource(quote, source) : false, flags };
  const items = cropItems(cv).map((x) => cropTokens(x)), clean = wordsOf(cleanSource(source));
  const allToks = items.flat();
  if (!items.length || items.some((tk) => !tk.length) || items.some((tk) => !tk.every((x) => clean.some((w) => stemW(w) === x)))) flags.push("value_not_in_source"); // each item must appear outside injected text
  const supports = (text) => items.every((tk) => tk.length && analyseCrop(text, tk, enteredName).support);
  if (!quote || !quoteInSource(quote, source)) { // the checker (not the AI) proposes a sentence, and it must itself support EVERY claimed item. An AI quote that is NOT in the source (merged/paraphrased) is replaced only by such a sentence.
    const aiQuote = quote, cand = sentences(source).filter((x) => !isInjection(x)).find((x) => items.length && supports(x));
    if (cand) { quote = cand; flags.push("quote_recovered_from_source"); if (aiQuote) flags.push("ai_quote_replaced"); } else if (!aiQuote) flags.push("claim_without_quote");
  }
  let quoteOk = quote ? quoteInSource(quote, source) : false;
  if (quote && !quoteOk) flags.push("quote_not_in_source");
  if (quote && (isInjection(quote) || overlapsInjection(quote, source))) flags.push("quote_is_injection_text");
  if (quote && quoteOk && allToks.length && !flags.includes("quote_is_injection_text")) {
    for (const tk of items) { if (!tk.length) continue; const qa = analyseCrop(quote, tk, enteredName); if (!qa.mentions) flags.push("crop_quote_lacks_value"); else if (!qa.support) flags.push(...(qa.reasons.length ? qa.reasons : ["crop_contradicted_in_source"])); }
  }
  // The AI chose a quotation that EXISTS but does not itself support the crop (no growing statement / other subject / lacks the value): let the checker look for another exact sentence that supports EVERY claimed item.
  // Only these "soft" reasons qualify (the quote must at least MENTION the crop; an unrelated quote is never rescued, see e-crop-claims); negation, history, future, contradiction and injection never do, and the replacement passes the same strict analysis.
  const SOFT = ["crop_other_subject", "crop_no_growing_statement"], hard = flags.filter((f) => !INFO_FLAGS.includes(f) && !SOFT.includes(f));
  if (quoteOk && !hard.length && flags.some((f) => SOFT.includes(f)) && items.length && !flags.includes("value_not_in_source")) {
    const cand = sentences(source).filter((x) => !isInjection(x) && x !== quote).find((x) => supports(x));
    if (cand) { quote = cand; quoteOk = quoteInSource(cand, source); flags = flags.filter((f) => !SOFT.includes(f)); flags.push("quote_recovered_from_source", "ai_quote_replaced"); }
  }
  if (allToks.length && !flags.some((f) => !INFO_FLAGS.includes(f))) { // contradiction elsewhere in the source about the target company
    outer: for (const sn of sentences(source).filter((x) => !isInjection(x))) for (const tk of items) { const a = analyseCrop(sn, tk, enteredName); if (a.targetNegOrHist) { flags.push("crop_contradicted_in_source"); break outer; } }
  }
  return { value: flags.some((f) => !INFO_FLAGS.includes(f)) ? "Unknown" : cv, quote, quoteOk, flags: [...new Set(flags)] };
}

// A discovery question must not ASSERT or PRESUPPOSE a fact the validated findings do not establish. The model's questions are screened against the final values; our own gap questions are written neutrally.
const PRES_LIGHT = /\b(?:upgrad\w*|expand\w*|replac\w*|retrofit\w*|existing|current(?:ly)? (?:installed|used|operating|lit)|(?:your|the|its|their) (?:current |existing |present )?(?:led|leds|hps|lighting system|lighting installation|installed (?:led|lighting|lights)|lights|lamps|fixtures)|(?:impact|effect|benefit|performance|cost|savings?) (?:of|from) (?:the )?(?:led|hps|lighting|your lighting)|(?:use|using) of (?:led|hps)|how (?:does|do|did) (?:the|your) (?:use|lighting|led|hps)|installed in your|installation (?:of|in) your|since (?:installing|you installed))\b/i;
const PRES_PLAN = /\b(?:your (?:planned|upcoming|proposed)|the (?:planned|upcoming|proposed) (?:installation|expansion|upgrade|project)|once (?:it is|installed|built)|when you (?:install|expand))\b/i;
export function presupposesUnsupported(q, v) {
  if (v.lighting !== "Yes" && PRES_LIGHT.test(q)) return true;                  // asks about an installation/system that is not established (Unknown or No)
  if (v.future !== "Planned" && PRES_PLAN.test(q)) return true;                 // asks about a plan that is not established
  if (v.crop === "Unknown" && /\b(?:your|the) (?:tomato|cucumber|pepper|strawberr|lettuce|salad|herb|berry)\w*\b/i.test(q)) return true;
  return false;
}
// Semantic near-duplicates: same content words (>= 0.5 Jaccard on stemmed, stop-word-free tokens).
const QSTOP = new Set(["the", "a", "an", "do", "does", "you", "your", "are", "is", "any", "to", "of", "in", "and", "or", "if", "so", "what", "which", "how", "when", "will", "have", "has", "there", "for", "on", "at", "it", "that", "with", "be", "can", "would", "into", "over", "much", "who", "this"]);
const SYN = (w) => (/^(decid|decision|influenc)/.test(w) ? "decision" : /^(invest|fund|budget|spend)/.test(w) ? "investment" : /^(plan|intend|propos)/.test(w) ? "plan" : /^(instal|fit|retrofit)/.test(w) ? "install" : w);
const qTok = (q) => new Set((String(q).toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !QSTOP.has(w)).map((w) => SYN(stemW(w))));
// near-duplicate = at least 3 shared content tokens AND >= 75% of the SHORTER question's tokens are shared (a short paraphrase of a longer question collapses; unrelated questions do not)
export function similarQuestion(a, b) { const x = qTok(a), y = qTok(b); let n = 0; for (const t of x) if (y.has(t)) n++; return n >= 3 && n / Math.min(x.size, y.size) >= 0.75; }
// Qualification gaps implied by the validated values. These are statements of what is NOT established and questions to ask; they assert nothing about the business.
export function deriveGaps({ lighting, future, crop }) {
  const g = [];
  if (crop === "Unknown") g.push({ unknown: "Crops grown: not established by the source", question: "Which crops do you grow, and in how much glasshouse area?" });
  if (lighting === "Unknown") g.push({ unknown: "Current supplementary lighting: not established by the source", question: "Do you use supplementary lighting in any glasshouse today, and if so which technology (LED, HPS) and over how much of the area?" });
  else if (lighting === "Yes") g.push({ unknown: "Installed lighting coverage and capacity: not established by the source", question: "Which areas or bays are lit, with what technology and installed capacity?" });
  else if (lighting === "No") g.push({ unknown: "Reasons for no current supplementary lighting: not stated", question: "Have you ever trialled or costed supplementary lighting, and what held you back?" });
  if (future === "Unknown") g.push({ unknown: "Future lighting installation plans: not established by the source", question: "Are you planning any lighting installation or upgrade in the next two years, and when would that decision be made?" });
  else if (future === "Planned") g.push({ unknown: "Timing and scale of the planned installation: not stated", question: "When is the planned installation due to happen, how large is it, and what stage is the project at?" });
  g.push({ unknown: "Who decides on lighting investment: not stated", question: "Who makes or influences decisions on lighting investment (owner, technical manager, head grower, board)?" });
  return g;
}
export function buildFindings(ai, source, enteredName) {
  const runFlags = [];
  const inj = detectInjection(source);
  if (inj.length) runFlags.push("possible_prompt_injection_in_source");
  const out = [];
  const L = assessLighting(ai, source);
  out.push({ kind: "lighting", ai_value: ai.lighting_status, value: L.value, quote: L.quote, quote_verified: L.quoteOk, flags: L.flags });
  const F = assessFuture(ai, source);
  out.push({ kind: "future", ai_value: ai.future_plans, value: F.value, quote: F.quote, quote_verified: F.quoteOk, flags: F.flags });

  const C = assessCrop(ai, source, enteredName);
  out.push({ kind: "crop", ai_value: ai.crop_value.trim() || "Unknown", value: C.value, quote: C.quote, quote_verified: C.quoteOk, flags: C.flags });

  const nm = ai.business_name.trim();
  if (nm && nameKey(nm) !== nameKey(enteredName) && !norm(source).includes(norm(enteredName))) runFlags.push("entered_name_not_in_source");
  const final = Object.fromEntries(out.map((f) => [f.kind, f.value])), seenU = new Set(), seenQ = new Set(), nkey = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const pushU = (u) => { const k = nkey(u); if (!k || seenU.has(k)) return; seenU.add(k); out.push({ kind: "unknown_item", ai_value: u, value: u, quote: "", quote_verified: false, flags: [] }); };
  const qOut = [], pushQ = (q, isAi = false) => { const k = nkey(q); if (!k || seenQ.has(k) || seenQ.size >= 8) return; if (isAi && presupposesUnsupported(q, final)) return; if (qOut.some((x) => similarQuestion(x, q))) return; seenQ.add(k); qOut.push(q); out.push({ kind: "question", ai_value: q, value: q, quote: "", quote_verified: false, flags: [] }); };
  const claimsUnknown = (u) => /\b(unknown|not (?:stated|known|specified|mentioned|established|clear|confirmed)|unclear|whether|no information|does not (?:state|say|mention|specify)|lack of)\b/i.test(u);
  const staleUnknown = (u) => claimsUnknown(u) && ((final.lighting !== "Unknown" && /\b(light\w*|led|leds|hps|lamps?)\b/i.test(u)) || (final.future !== "Unknown" && /\b(plans?|future|expan\w*|upgrad\w*)\b/i.test(u)) || (final.crop !== "Unknown" && /\b(crops?|grow\w*|produc\w*|variet\w*)\b/i.test(u))); // an unknown the validated findings already settle
  const askedKnown = (q) => (final.lighting !== "Unknown" && /^(?:do|does|are|is|have|has)\b.*\b(?:use|using|have|installed)\b.*\b(?:led|leds|lighting|lights|supplementary)\b/i.test(q)) || (final.crop !== "Unknown" && /^(?:which|what) (?:crops?|varieties)\b/i.test(q)); // asks for a fact that is already established
  for (const q of ai.discovery_questions) if (!askedKnown(q)) pushQ(q, true);                        // the model's own questions first (existing order and semantics preserved)
  const gaps = deriveGaps(final); for (const g of gaps) pushU(g.unknown);        // unknowns come from the VALIDATED values, so the list cannot be empty when material fields are Unknown
  for (const u of ai.unknown_information) if (!staleUnknown(u)) pushU(u);
  for (const g of gaps) pushQ(g.question);                                       // qualification questions for the gaps, after the model's
  return { findings: out, runFlags };
}
const norm = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();

// ---- Human review rules (enforced server-side) ----
const BLOCKING = (f) => f.flags.filter((x) => !INFO_FLAGS.includes(x));
export function applyReview(f, { action, value, note }) {
  const sourced = SOURCED.includes(f.kind);
  if (f.review_status === "rejected" && action !== "reject") return { ok: false, error: "finding already rejected" };
  if (action === "reject") return { ok: true, patch: { review_status: "rejected", final_value: null } };
  if (action === "approve") {
    if (sourced && f.value !== "Unknown") {
      if (!f.quote_verified || BLOCKING(f).length) return { ok: false, error: "cannot approve a claim without a verified, consistent quotation — edit it (with a note) or reject it" };
    }
    return { ok: true, patch: { review_status: "approved", final_value: f.value } };
  }
  if (action === "edit") {
    const v = typeof value === "string" ? value.trim() : "";
    if (!v || v.length > LIMITS.value) return { ok: false, error: "edited value required (max 200 chars)" };
    if (f.kind === "lighting" && !LIGHTING.includes(v)) return { ok: false, error: "lighting must be Yes, No or Unknown" };
    if (f.kind === "future" && !PLANS.includes(v)) return { ok: false, error: "future plans must be Planned, Not planned or Unknown" };
    const n = typeof note === "string" ? note.trim() : "";
    if (n.length > LIMITS.note) return { ok: false, error: "note too long" };
    if (sourced && v !== "Unknown" && !n) return { ok: false, error: "a note stating the basis is required when asserting a non-Unknown value" };
    return { ok: true, patch: { review_status: "edited", final_value: v, note: n || null } };
  }
  return { ok: false, error: "unknown action" };
}
export function syncEligibility(findings) {
  const pending = findings.filter((f) => SOURCED.includes(f.kind) && f.review_status === "needs_review");
  if (pending.length) return { ok: false, reason: `Review crop, lighting and future plans first (${pending.map((p) => p.kind).join(", ")} pending)` };
  if (!findings.some((f) => f.review_status === "approved" || f.review_status === "edited")) return { ok: false, reason: "Nothing approved" };
  return { ok: true };
}
export const START = "[LightYield research - human-approved]";
export const markerCo = (coId) => `[LY-CO:${coId}]`; // stable per-company identity marker embedded in the HubSpot record
export function normaliseDomain(input) {
  if (input == null || String(input).trim() === "") return { ok: true, domain: null };
  let d = String(input).trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^www\./, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d) || d === "localhost" || !/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d)) return { ok: false, error: "Enter a valid business domain such as example-glasshouse.co.uk (no IP addresses)" };
  return { ok: true, domain: d };
}
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function extractBlock(desc, coId) { // innermost block: the LAST start marker before our company marker
  const m = new RegExp(esc(START) + "(?:(?!" + esc(START) + ")[\\s\\S])*?" + esc(markerCo(coId))).exec(desc || "");
  return m ? m[0] : null;
}
// Phase 1 wrote a block without an end marker; remove such legacy blocks so they are replaced, not duplicated.
const LEGACY = new RegExp(esc(START) + "(?:(?!" + esc(START) + "|\\[LY-CO:)[\\s\\S])*?\\nSource: [^\\n]*\\| Run [\\w-]+[ \\t]*(?:\\n|$)(?!\\[LY-CO:)", "g");
// Preserve any human-written text already on the HubSpot record; only our delimited block is replaced/added.
export function mergeDescription(existing, block, coId) {
  const ex = (existing || "").replace(LEGACY, "");
  const cur = extractBlock(ex, coId);
  if (cur) return ex.replace(cur, () => block);
  return ex.trim() ? `${ex.trim()}\n\n${block}` : block;
}
export function buildDescription(run, findings) {
  const ok = findings.filter((f) => f.review_status === "approved" || f.review_status === "edited");
  const get = (k) => ok.find((f) => f.kind === k);
  const list = (k) => ok.filter((f) => f.kind === k).map((f) => `- ${f.final_value}`).join("\n");
  const lines = [START];
  const c = get("crop"), l = get("lighting"), fu = get("future");
  if (c) lines.push(`Crop: ${c.final_value}${c.review_status === "edited" ? " (human-edited)" : ""}`);
  if (l) lines.push(`Supplementary lighting: ${l.final_value}${l.review_status === "edited" ? " (human-edited)" : ""}`);
  if (fu) lines.push(`Planned supplementary lighting: ${fu.final_value}${fu.review_status === "edited" ? " (human-edited)" : ""}`);
  if (ok.some((f) => f.kind === "unknown_item")) lines.push("Unknowns:\n" + list("unknown_item"));
  if (ok.some((f) => f.kind === "question")) lines.push("Discovery questions (AI-suggested, approved):\n" + list("question"));
  lines.push(`Source: ${run.source_id} (pasted text, not fetched) | Run ${run.id}`);
  lines.push(markerCo(run.company_id));
  return lines.join("\n");
}

// ---- Commercial workflow rules (all conversation/qualification content is human-entered; nothing here invents outcomes) ----
export const CHANNELS = ["Phone", "Email", "Video call", "In person", "Other"];
export const FITS = ["Current fit", "Future fit", "No established need", "Unknown"];
export function validateConversation(b, today = new Date().toISOString().slice(0, 10)) {
  const e = [], w = [];
  const req = (k, max) => { const v = typeof b?.[k] === "string" ? b[k].trim() : ""; if (!v) e.push(`${k} is required`); else if (v.length > max) e.push(`${k} too long (max ${max})`); return v; };
  if (!/^[0-9a-f-]{16,64}$/i.test(String(b?.request_id || ""))) e.push("request_id required");
  const occurred_on = String(b?.occurred_on || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurred_on) || Number.isNaN(Date.parse(occurred_on))) e.push("date must be YYYY-MM-DD"); else if (occurred_on > today) e.push("a conversation cannot be dated in the future");
  if (!CHANNELS.includes(b?.channel)) e.push("channel invalid");
  const grower_reported = req("grower_reported", 3000);
  if (!LIGHTING.includes(b?.current_led)) e.push("current LED use must be Yes, No or Unknown");
  if (!PLANS.includes(b?.future_led)) e.push("future LED plans must be Planned, Not planned or Unknown");
  const need = typeof b?.need_or_concern === "string" ? b.need_or_concern.trim() : ""; if (need.length > 2000) e.push("need/concern too long");
  if (!FITS.includes(b?.fit)) e.push("fit decision invalid");
  const reason = typeof b?.fit_reason === "string" ? b.fit_reason.trim() : "";
  if (b?.fit && b.fit !== "Unknown" && !reason) e.push("a reason is required for any fit decision other than Unknown");
  if (reason.length > 2000) e.push("reason too long");
  if (b?.fit === "Current fit" && b?.current_led === "No") w.push("Fit is 'Current fit' but current LED use is 'No' - check the reason.");
  if (b?.fit === "Future fit" && b?.future_led !== "Planned") w.push("Fit is 'Future fit' but future LED plans are not 'Planned' - check the reason.");
  if (b?.fit === "No established need" && (b?.current_led === "Yes" || b?.future_led === "Planned")) w.push("'No established need' conflicts with reported lighting use/plans - check the reason.");
  return { ok: e.length === 0, errors: e, warnings: w, value: { request_id: b?.request_id, occurred_on, channel: b?.channel, grower_reported, current_led: b?.current_led, future_led: b?.future_led, need_or_concern: need, fit: b?.fit, fit_reason: reason } };
}
export function validateTask(b, today = new Date().toISOString().slice(0, 10)) {
  const e = [];
  const s = (k, max) => { const v = typeof b?.[k] === "string" ? b[k].trim() : ""; if (!v) e.push(`${k} is required`); else if (v.length > max) e.push(`${k} too long (max ${max})`); return v; };
  if (!/^[0-9a-f-]{16,64}$/i.test(String(b?.request_id || ""))) e.push("request_id required");
  const subject = s("subject", 200), owner = s("owner", 80);
  const due = String(b?.due_on || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due))) e.push("due date must be YYYY-MM-DD"); else if (due < today) e.push("due date cannot be in the past");
  return { ok: e.length === 0, errors: e, value: { request_id: b?.request_id, subject, owner, due_on: due } };
}
// Provenance-preserving account view: public evidence, grower-reported and AI suggestions are NEVER merged into one fact.

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// ACCOUNT EVIDENCE-SELECTION POLICY (docs/EVIDENCE_POLICY.md). ONE deterministic rule set used by the account summary, the CRM payload, staleness/verification
// and derived questions. Input: findings of ALL runs of the account, each carrying run_id, run_at (run created_at) and run_ord (run rowid).
//  * candidates: approved/edited findings. A human-approved "Unknown" never supersedes a known value (absence of evidence is not a contradiction).
//  * winner per sourced kind: the candidate from the NEWEST run (newer source reading supersedes older); inside a run, the latest review.
//  * an older-run candidate with a DIFFERENT value reviewed BEFORE the winner is SUPERSEDED (history). Reviewed AFTER the winner it is an UNRESOLVED CONFLICT:
//    a later human decision contradicts the winner and the system cannot tell which was meant, so it is exposed, sync is refused and the account is never "current".
//  * resolve a conflict by rejecting/editing the older finding or re-reviewing the winner afterwards.
//  * lists (unknown items, questions): union of approved items across runs, de-duplicated by normalised text (they are not mutually exclusive facts).
// ONE canonical text normaliser (case, edges, ALL internal whitespace incl. unicode spaces): used for evidence values, question de-duplication and reconciliation
export const normText = (v) => String(v ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const vnorm = normText;
const vKnown = (v) => vnorm(v) !== "" && vnorm(v) !== "unknown";
const APPLIED = ["approved", "edited"];
const runKey = (f) => `${f.run_at ?? ""}|${String(f.run_ord ?? 0).padStart(12, "0")}|${f.run_id ?? ""}`;
export function selectEvidence(findings) {
  const app = findings.filter((f) => APPLIED.includes(f.review_status)), out = { conflicts: [] };
  const brief = (f) => ({ finding_id: f.id, value: f.final_value, run_id: f.run_id, reviewed_at: f.reviewed_at ?? null, status: f.review_status });
  for (const kind of SOURCED) {
    const known = app.filter((f) => f.kind === kind && vKnown(f.final_value)).sort((a, b) => runKey(b).localeCompare(runKey(a)) || String(b.reviewed_at ?? "").localeCompare(String(a.reviewed_at ?? "")));
    const winner = known[0] || app.filter((f) => f.kind === kind).sort((a, b) => String(b.reviewed_at ?? "").localeCompare(String(a.reviewed_at ?? "")))[0] || null; // approved "Unknown" kept only when nothing known exists
    const k = { winner, superseded: [], unresolved: [] };
    if (winner && vKnown(winner.final_value)) for (const o of known.slice(1)) {
      if (runKey(o) === runKey(winner) || vnorm(o.final_value) === vnorm(winner.final_value)) continue;
      (String(o.reviewed_at ?? "") > String(winner.reviewed_at ?? "") ? k.unresolved : k.superseded).push(brief(o));
    }
    for (const u of k.unresolved) out.conflicts.push({ kind, winner: brief(winner), other: u });
    out[kind] = k;
  }
  const union = (kind) => { const seen = new Set(), items = []; for (const f of app.filter((x) => x.kind === kind).sort((a, b) => runKey(a).localeCompare(runKey(b)))) { const key = vnorm(f.final_value); if (!key || seen.has(key)) continue; seen.add(key); items.push(f); } return items; };
  out.unknown_items = union("unknown_item"); out.questions = union("question");
  return out;
}
// CRM payload from the SAME selection. `runs` = { [run_id]: { id, source_id } }; one Source line per distinct contributing run (oldest first).
export function buildAccountDescription(companyId, sel, runs) {
  const lines = [START], tag = (f) => (f.review_status === "edited" ? " (human-edited)" : "");
  const c = sel.crop.winner, l = sel.lighting.winner, fu = sel.future.winner, used = [];
  if (c) { lines.push(`Crop: ${c.final_value}${tag(c)}`); used.push(c); }
  if (l) { lines.push(`Supplementary lighting: ${l.final_value}${tag(l)}`); used.push(l); }
  if (fu) { lines.push(`Planned supplementary lighting: ${fu.final_value}${tag(fu)}`); used.push(fu); }
  if (sel.unknown_items.length) { lines.push("Unknowns:\n" + sel.unknown_items.map((f) => `- ${f.final_value}`).join("\n")); used.push(...sel.unknown_items); }
  if (sel.questions.length) { lines.push("Discovery questions (AI-suggested, approved):\n" + sel.questions.map((f) => `- ${f.final_value}`).join("\n")); used.push(...sel.questions); }
  const order = [...new Set(used.sort((a, b) => runKey(a).localeCompare(runKey(b))).map((f) => f.run_id))];
  for (const id of order) lines.push(`Source: ${runs[id]?.source_id ?? "unknown"} (pasted text, not fetched) | Run ${id}`);
  lines.push(markerCo(companyId));
  return lines.join("\n");
}

// LightYield qualification view: DERIVED, read-only, from the existing evidence, conversations and the founder's own fit decision. No score, no new storage. Each dimension says WHERE its value comes from
// (public human-approved evidence / customer-reported / unknown); anything not captured stays Unknown with the question to ask. LED use alone never establishes demand.
const FIT_LABEL = { "Current fit": "Potential current fit", "Future fit": "Potential future fit", "No established need": "No established fit", Unknown: "Discovery required" };
export const QUAL_ASK = { scale: "Which areas or bays are lit, with what technology and installed capacity, and how large is the whole operation?", pain: "What is costing you most in the glasshouse today (energy, yield, winter season length, labour)?", timing: "When would any lighting decision or installation happen, and what triggers it?", decider: "Who makes or influences decisions on lighting investment (owner, technical manager, head grower, board)?" };
export function buildQualification({ crop, cw, fw, current, future, conversations, decided, openTasks }) {
  const row = (key, label, state, value, source, ask = null, note = null) => ({ key, label, state, value, source, ask, note });
  const evid = (x, w, label, key) => w.value === "Unknown" ? row(key, label, "unknown", "Unknown", "Not established", null) : row(key, label, w.provenance === "Grower-reported" ? "customer" : "public", w.value, w.provenance === "Grower-reported" ? "Customer-reported" : `Public source, ${String(w.provenance).toLowerCase()}`, null, x.conflict ? "Public evidence and the customer disagree: confirm which is current." : null);
  const lastNeed = [...conversations].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)).find((c) => (c.need_or_concern || "").trim());
  const status = FIT_LABEL[decided?.fit ?? "Unknown"] ?? "Discovery required";
  const rows = [
    crop.value !== "Unknown" ? row("operation", "Commercial growing operation", "public", crop.value, `Public source, ${String(crop.state).toLowerCase()}`) : row("operation", "Commercial growing operation", "unknown", "Unknown", "Not established", "Which crops do you grow, and in how much glasshouse area?"),
    evid(current, cw, "Current supplementary LED lighting", "current_led"),
    evid(future, fw, "Future lighting installation or upgrade plans", "future_plans"),
    row("scale", "Installation coverage and scale", "unknown", "Not captured as structured data", "Record what the customer says in the conversation", QUAL_ASK.scale),
    lastNeed ? row("pain", "Commercial or operational pain", "customer", lastNeed.need_or_concern.trim().slice(0, 240), "Customer-reported", null) : row("pain", "Commercial or operational pain", "unknown", "Unknown", "Not established", QUAL_ASK.pain),
    row("timing", "Relevant timing", "unknown", fw.value === "Planned" ? "A plan exists; its timing is not recorded" : "Not captured as structured data", "Record what the customer says in the conversation", QUAL_ASK.timing),
    row("decider", "Decision-making responsibility", "unknown", "Not captured as structured data", "Record what the customer says in the conversation", QUAL_ASK.decider),
    openTasks ? row("next", "Appropriate next commercial action", "founder", "A follow-up task is open (see Next action)", "Your follow-up") : row("next", "Appropriate next commercial action", "unknown", status === "No established fit" ? "No action until something changes; optionally a dated re-check" : status === "Discovery required" ? "Run a discovery conversation using the questions above" : "Create a follow-up with a dated, specific action", "Suggestion only"),
  ];
  return { status, decided_by: decided && decided.fit !== "Unknown" ? { on: decided.occurred_on, reason: decided.fit_reason } : null, caveat: "LED use alone does not establish commercial demand. This view only organises what is evidenced; the fit decision is yours.", rows };
}
export function summariseAccount({ findings, conversations, openTasks }) {
  const sel = selectEvidence(findings);
  const pub = (kind) => { const k = sel[kind], f = k.winner; if (!f) return { value: "Unknown", state: "Not yet researched", unresolved: [], superseded: [] };
    return { value: f.final_value, state: f.review_status === "edited" ? "Human-edited" : f.final_value === "Unknown" ? "Unknown (kept)" : "Verified public", ...(f.review_status === "edited" && f.final_value !== f.value ? { quote: "", quote_verified: false, original_ai_value: f.ai_value, basis: f.note ?? null } : { quote: f.quote, quote_verified: !!f.quote_verified }), source_run_id: f.run_id, unresolved: k.unresolved, superseded: k.superseded }; };
  const grower = (field) => { const c = [...conversations].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)).find((x) => x[field] !== "Unknown"); return c ? { value: c[field], on: c.occurred_on, channel: c.channel } : { value: "Unknown" }; };
  const current = { public: pub("lighting"), grower: grower("current_led") }, future = { public: pub("future"), grower: grower("future_led") };
  for (const x of [current, future]) x.conflict = x.public.value !== "Unknown" && x.grower.value !== "Unknown" && x.public.value !== x.grower.value;
  const working = (x) => x.grower.value !== "Unknown" ? { value: x.grower.value, provenance: "Grower-reported" } : x.public.value !== "Unknown" ? { value: x.public.value, provenance: x.public.state } : { value: "Unknown", provenance: "Unknown" };
  const cw = working(current), fw = working(future);
  let hypothesis;
  if (cw.value === "Yes") hypothesis = "Existing lighting user: a possible optimisation or upgrade conversation. Confirm what is installed and what decisions are coming.";
  else if (cw.value === "No" && fw.value === "Planned") hypothesis = "Possible future fit: an installation decision may be approaching. Ask about timing, capacity and constraints.";
  else if (cw.value === "No") hypothesis = "No established need yet. Ask what would change that (crop, energy cost, expansion).";
  else hypothesis = "Insufficient evidence to hypothesise fit. Close the unknowns below first.";
  const gaps = [];
  if (cw.value === "Unknown") gaps.push("Current supplementary lighting is unknown");
  if (fw.value === "Unknown") gaps.push("Future lighting plans are unknown");
  if (!conversations.length) gaps.push("No conversation recorded yet");
  if (!openTasks) gaps.push("No open follow-up task");
  const decided = [...conversations].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at))[0];
  const qualification = buildQualification({ crop: pub("crop"), cw, fw, current, future, conversations, decided, openTasks });
  return { qualification, current: { ...current, working: cw }, future: { ...future, working: fw }, crop: pub("crop"), conflicts: sel.conflicts, hypothesis, gaps, latest_fit: decided ? { fit: decided.fit, reason: decided.fit_reason, on: decided.occurred_on, channel: decided.channel } : null };
}
