import { validateExtraction } from "./evidence.js";
const SOURCE_ID = "synthetic-src-1";
const SOURCE = "Example Glasshouse produces tomatoes in commercial greenhouses. The company website does not state whether supplementary LED lighting is installed.";
const SCHEMA = {
  type: "object",
  properties: {
    crop: { type: "string" },
    lighting_status: { type: "string", enum: ["Yes", "No", "Unknown"] },
    evidence_quote: { type: "string" },
    evidence_source_id: { type: "string" },
    unknown_information: { type: "array", items: { type: "string" } },
    suggested_discovery_question: { type: "string" },
  },
  required: ["crop", "lighting_status", "evidence_quote", "evidence_source_id", "unknown_information", "suggested_discovery_question"],
};
const enc = new TextEncoder();
async function authorised(req, env) {
  const secret = env.SMOKE_TOKEN;
  if (!secret || secret.length < 24) return false; // fail closed if unset/weak
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
  if (!m) return false;
  // Hash both sides so comparison is fixed-length, then constant-time compare.
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(m[1])), crypto.subtle.digest("SHA-256", enc.encode(secret))]);
  return crypto.subtle.timingSafeEqual(a, b);
}
const ALLOWED_MODELS = ["@cf/ibm-granite/granite-4.0-h-micro"];
export const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { "content-type": "application/json" } });

export const legacy = {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (!(await authorised(req, env))) return json({ error: "unauthorised" }, 401);

    if (url.pathname === "/d1-test") {
      await env.DB.exec("CREATE TABLE IF NOT EXISTS smoke (id TEXT PRIMARY KEY, note TEXT, created_at TEXT)");
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO smoke (id, note, created_at) VALUES (?, ?, ?)").bind(id, "SYNTHETIC phase0 record", new Date().toISOString()).run();
      const row = await env.DB.prepare("SELECT * FROM smoke WHERE id = ?").bind(id).first();
      return json({ wrote_id: id, read_back: row, pass: row?.id === id });
    }
    if (url.pathname === "/ai-test") {
      const requested = url.searchParams.get("model") || env.AI_MODEL || ALLOWED_MODELS[0];
      if (!ALLOWED_MODELS.includes(requested)) return json({ error: "model not allowed" }, 400);
      const model = requested;
      const t0 = Date.now();
      let out;
      try { out = await env.AI.run(model, {
        messages: [
          { role: "system", content: "Extract facts ONLY from the source. If lighting is not stated, lighting_status must be Unknown. evidence_quote must be copied verbatim from the source." },
          { role: "user", content: `source_id: ${SOURCE_ID}\nsource: ${SOURCE}\nReturn JSON.` },
        ],
        response_format: { type: "json_schema", json_schema: SCHEMA },
        max_tokens: 600,
      }); } catch (e) { return json({ model, error: String(e?.message || e).slice(0, 500), pass: false }, 502); }
      let parsed = out.response ?? out.choices?.[0]?.message?.content;
      if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { parsed = null; } }
      const v = validateExtraction(parsed, SOURCE, SOURCE_ID);
      return json({ model, ms: Date.now() - t0, usage: out.usage, parsed, validation: v, lighting_unknown: parsed?.lighting_status === "Unknown", pass: v.ok && parsed?.lighting_status === "Unknown" });
    }
    return json({ error: "not found" }, 404);
  },
};
