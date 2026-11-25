// CP9 founder-observed recall defects (six-company run, 2026-11-24): SYNTHETIC reproductions of the sentence CONSTRUCTIONS that failed, plus previously unseen wording and the negative controls that must still fail.
// No real company text is stored here. "Before" = behaviour at 567a477 (measured by the diagnostic run recorded in docs/EVAL_PRECORRECTION_2026-11-24.md).
import assert from "node:assert";
import { assessCrop, assessLighting, buildFindings, classify } from "../../src/logic.js";
import { selectPassage } from "../../src/sources.js";
import { makeApp } from "../harness/fakes.mjs";
import { suite } from "./run.mjs";
const { t, done } = suite("CP9 recall corrections + safeguards");
const crop = (name, value, source, quote = source) => assessCrop({ crop_value: value, crop_quote: quote, business_name: name }, source, name);
const led = (source, status = "Yes", quote = source) => assessLighting({ lighting_status: status, lighting_quote: quote, business_name: "x" }, source);
const NAME = "Aldermoor Glass Ltd";

// ---- crop: constructions that failed on real pages (before -> after) ----
for (const [label, v, s, nm = NAME] of [
  ["'enables us to produce' (subject is 'us')", "strawberries", "The new system lets us produce strawberries all year round."],
  ["'not only does X grow Y' is not a negation", "strawberries", "Not only does Aldermoor Glass grow strawberries, it also packs them on site."],
  ["'grows not only Y but also Z'", "strawberries, raspberries", "Aldermoor Glass grows not only strawberries but also raspberries."],
  ["'Family-run X has been producing Y since 1980'", "tomatoes", "Family-run Aldermoor Glass has been producing tomatoes since 1980."],
  ["'we grow, pack and deliver ... varieties of A, B and C' (a clause without a growing verb must not reset the subject)", "tomatoes, cucumbers, peppers", "We grow, pack and deliver many different and specialised varieties of tomatoes, cucumbers and peppers."],
  ["'we focus totally on Y'", "tomatoes", "These days, we focus totally on tomatoes, and specifically baby plums."],
  ["previously unseen: cultivates, different crops", "basil, parsley", "Willowbrook Nurseries cultivates basil and flat-leaf parsley under glass.", "Willowbrook Nurseries Ltd"],
  ["previously unseen: passive WITH the company as agent", "basil", "Basil, grown under glass by Willowbrook Nurseries, is cut daily.", "Willowbrook Nurseries Ltd"],
]) t(`CROP accepted (was rejected): ${label}`, () => { const c = crop(nm, v, s); assert.equal(c.value, v, JSON.stringify(c)); assert.ok(c.quoteOk); });
for (const [label, v, s, nm = NAME] of [
  ["a DIFFERENT company with the same descriptor", "tomatoes", "Independent Brightfield Produce has been producing tomatoes since 1980."],
  ["'not only' does not hide a real negation", "strawberries", "Aldermoor Glass does not grow strawberries and not only this season."],
  ["aspiration/future ('aim to not only increase ... produce')", "strawberries", "We aim to not only increase the amount of strawberries we produce but also grow them sustainably."],
  ["third-party passive agent", "basil", "Basil, grown under glass by a neighbouring nursery, is sold to us.", "Willowbrook Nurseries Ltd"],
  ["'enables us' but about a competitor", "tomatoes", "Rival growers say the system enables them to produce tomatoes cheaply."],
  ["historical", "tomatoes", "Family-run Aldermoor Glass used to produce tomatoes until 2012."],
  ["removed/ceased", "cucumbers", "Aldermoor Glass has stopped growing cucumbers."],
  ["crop not in the source", "lettuce", "Family-run Aldermoor Glass has been producing tomatoes since 1980."],
  ["subject is an unrelated 'family-run' business in a clause without its own predicate", "peppers", "Family-run Brightfield Produce is near Ely and delivers many varieties of peppers."],
]) t(`CROP still rejected: ${label}`, () => { const c = crop(nm, v, s); assert.equal(c.value, "Unknown", JSON.stringify(c)); });
t("QUOTE RECOVERY (soft failure): an AI quote that exists but does not itself support the crop is replaced by another exact supporting sentence (flagged); with no such sentence it stays Unknown; a hard failure (negation/history) is never 'recovered'", () => {
  const src = "Our strawberries are award-winning. Aldermoor Glass grows strawberries under glass near Ely."; const r = crop(NAME, "strawberries", src, "Our strawberries are award-winning."); assert.equal(r.value, "strawberries"); assert.equal(r.quote, "Aldermoor Glass grows strawberries under glass near Ely."); assert.ok(r.flags.includes("ai_quote_replaced") && r.flags.includes("quote_recovered_from_source"));
  assert.equal(crop(NAME, "strawberries", "Our strawberries are award-winning. Visitors love them.", "Our strawberries are award-winning.").value, "Unknown");
  assert.equal(crop(NAME, "strawberries", "Aldermoor Glass used to grow strawberries until 2012. Aldermoor Glass grows strawberries under glass near Ely.", "Aldermoor Glass used to grow strawberries until 2012.").value, "Unknown", "a historical quote with a contradicting history is not rescued by a later sentence");
  assert.equal(crop(NAME, "strawberries", "Aldermoor Glass does not grow strawberries. Brightfield grows strawberries near Ely.", "Aldermoor Glass does not grow strawberries.").value, "Unknown"); });

// ---- lighting: present-state constructions that classified as null ----
for (const [label, s] of [
  ["'has recently been installed' (present perfect)", "The 3 ha LED lighting installation has recently been installed within one of the glasshouses at our main site."],
  ["'sunlight, supplemented by LED lights'", "Each plant has access to sunlight through the day, supplemented by LED lights."],
  ["'LED lights simulate sunlight'", "LED lights simulate sunlight on darker days, alongside climate control."],
  ["'LED grow light system enables us to'", "Our LED grow light system in one of our greenhouses enables us to grow cucumbers all year round."],
  ["'electricity to power LED lights'", "The digester output is delivered to the glasshouse as electricity to power LED lights and heat."],
  ["previously unseen: 'topped up with'", "Sunlight in the main house is topped up with LED lights in winter."],
  ["previously unseen: 'boosted by'", "Photosynthesis is boosted by LED lighting in every bay."],
  ["previously unseen: LED as subject of 'extend'", "LED fittings extend the day length in winter."],
]) t(`LIGHTING affirmative (was not evidence): ${label}`, () => { assert.equal(classify(s), "affirmative", s); assert.equal(led(s).value, "Yes", JSON.stringify(led(s))); });
for (const [label, s] of [
  ["historical + participle", "In 2014 the glasshouse was supplemented by LED lights."],
  ["removed", "Sunlight was supplemented by LED lights until they were switched off in 2019."],
  ["negated 'is not supplemented'", "Sunlight is not supplemented by LED lights."],
  ["third party", "The neighbouring nursery's sunlight is supplemented by LED lights."],
  ["future", "Sunlight will be supplemented by LED lights next winter."],
  ["capability only", "LED lights can simulate sunlight on darker days."],
  ["conditional", "LED lights would supplement the sunlight if funding is approved."],
  ["competitor LED subject", "A competitor's LED fittings extend the day length in winter."],
  ["supplier statement about its product at a customer", "Our supplier says LED lights simulate sunlight at customer sites."],
]) t(`LIGHTING must NOT be Yes: ${label}`, () => { assert.notEqual(led(s).value, "Yes", s + " -> " + JSON.stringify(led(s))); });
t("negation still supports 'No' for the new wording", () => { assert.equal(led("Sunlight is not supplemented by LED lights.", "No").value, "No"); });

// ---- unknowns and questions derived from the FINAL values ----
const ai = (over) => ({ business_name: NAME, crop_value: "tomatoes", crop_quote: "Family-run Aldermoor Glass has been producing tomatoes since 1980.", lighting_status: "Yes", lighting_quote: "To ensure our plants get enough light, we use multi-spectrum LEDs.", future_plans: "Unknown", future_quote: "", unknown_information: [], discovery_questions: [], ...over });
const SRC = "Family-run Aldermoor Glass has been producing tomatoes since 1980. To ensure our plants get enough light, we use multi-spectrum LEDs.";
const vals = (r, k) => r.findings.filter((f) => f.kind === k).map((f) => f.value);
t("CONSISTENCY: with lighting validated Yes, AI 'unknowns' that restate it as unknown and AI questions that ask whether LEDs are used are dropped; the derived coverage/capacity question remains; with lighting Unknown they are kept", () => {
  const A = ai({ unknown_information: ["Whether supplementary lighting is used is not stated", "Decision-maker is not stated"], discovery_questions: ["Do you use LED lighting in your glasshouses?", "What would make you extend the lighting?"] });
  const r = buildFindings(A, SRC, NAME); assert.equal(r.findings.find((f) => f.kind === "lighting").value, "Yes"); const u = vals(r, "unknown_item"), q = vals(r, "question");
  assert.ok(!u.some((x) => /supplementary lighting is used/i.test(x)), JSON.stringify(u)); assert.ok(!u.some((x) => /current supplementary lighting: not established/i.test(x)), "no derived 'lighting unknown' either"); assert.ok(u.some((x) => /installed lighting coverage and capacity/i.test(x))); assert.ok(!q.some((x) => /^Do you use LED lighting/.test(x))); assert.ok(q.includes("What would make you extend the lighting?")); assert.ok(q.some((x) => /areas or bays are lit/i.test(x)));
  const un = buildFindings(ai({ lighting_status: "Unknown", lighting_quote: "", unknown_information: ["Whether supplementary lighting is used is not stated"], discovery_questions: ["Do you use LED lighting in your glasshouses?"] }), "Family-run Aldermoor Glass has been producing tomatoes since 1980.", NAME); assert.equal(un.findings.find((f) => f.kind === "lighting").value, "Unknown"); assert.ok(vals(un, "unknown_item").some((x) => /supplementary lighting/i.test(x))); assert.ok(vals(un, "question").some((x) => /use supplementary lighting|LED lighting/.test(x))); });
t("an AI-listed unknown about the CROP is dropped when the crop is validated, kept when it is not", () => {
  const r = buildFindings(ai({ unknown_information: ["The crops grown are not stated"] }), SRC, NAME); assert.ok(!vals(r, "unknown_item").some((x) => /crops grown/i.test(x)));
  const n = buildFindings(ai({ crop_value: "Unknown", crop_quote: "", unknown_information: ["The crops grown are not stated"] }), "Aldermoor Glass is based near Ely.", NAME); assert.ok(vals(n, "unknown_item").some((x) => /crops/i.test(x))); });

// ---- passage selection by relevance, with subject context ----
t("PASSAGE SELECTION: a relevant LED sentence late on a long page is no longer cut by the character cap; a pronoun sentence brings its preceding sentence; page order and the cap are preserved", () => {
  const filler = Array.from({ length: 30 }, (_, i) => `Aldermoor Glass grows variety ${i} of lettuce in the main glasshouse near Ely every season.`).join(" "), text = filler + " The newest bay is lit by LED lighting in winter.";
  const p = selectPassage(text, 600); assert.ok(p.length <= 600 + 2); assert.match(p, /lit by LED lighting/); assert.ok(p.indexOf("variety") < p.indexOf("LED lighting"), "page order kept");
  const ctx = selectPassage("Aldermoor Glass grows basil under glass near Ely. It is lit by LED lighting in winter. Visitors are welcome on Saturdays at the farm shop.", 120); assert.match(ctx, /Aldermoor Glass grows basil/); assert.match(ctx, /It is lit by LED lighting/); });
t("name-only discovery: the search query carries the sector hint (generic names such as a colour or a fruit otherwise return unrelated sites) and is still only the name + optional location + fixed words", async () => {
  const app = await makeApp(), calls = []; Object.assign(app.env, { TAVILY_API_KEY: "tvly-TESTKEY-not-real-123456" }); app.env.SOURCE_FETCH = async (u, i) => { calls.push(JSON.parse(i.body)); return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } }); }; const s = await app.login();
  try { await app.post(s, "/api/discover", { businessName: "Blue Gables" }); await app.post(s, "/api/discover", { businessName: "Blue Gables", location: "East Yorkshire" }); assert.equal(calls[0].query, "Blue Gables UK glasshouse grower official website"); assert.equal(calls[1].query, "Blue Gables East Yorkshire glasshouse grower official website"); assert.equal(calls[0].search_depth, "basic"); } finally { app.restore(); } });
t("END TO END (real Worker code, fake AI replaying a weak quote and stale unknowns): the supported crop is recovered, lighting is Yes, unknowns/questions agree with the final findings, nothing is stored in HubSpot", async () => {
  const app = await makeApp(); const s = await app.login(); app.AI.extract = () => ai({ crop_quote: "Our tomatoes are delicious.", unknown_information: ["Whether supplementary lighting is used is not stated"], discovery_questions: ["Do you use LED lighting?"] });
  try { const r = await app.post(s, "/api/research", { businessName: NAME, sourceId: "fixture://x", sourceText: "Our tomatoes are delicious. " + SRC, force: true }); assert.equal(r.status, 200); const f = (k) => r.j.findings.find((x) => x.kind === k); assert.equal(f("crop").value, "tomatoes"); assert.match(f("crop").quote, /producing tomatoes since 1980/); assert.ok(f("crop").flags.includes("ai_quote_replaced"));
    assert.ok(!r.j.findings.some((x) => x.kind === "unknown_item" && /supplementary lighting is used/i.test(x.value))); assert.ok(!r.j.findings.some((x) => x.kind === "question" && /^Do you use LED lighting/.test(x.value))); assert.equal(app.hs.companies.size, 0); } finally { app.restore(); } });
await done();
