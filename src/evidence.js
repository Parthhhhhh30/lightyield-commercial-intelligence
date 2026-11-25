// Deterministic evidence check: a quote is valid only if it appears verbatim
// (whitespace/case-normalised) in the supplied source passage.
const norm = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();
export function quoteInSource(quote, source) {
  if (typeof quote !== "string" || norm(quote).length < 8) return false;
  return norm(source).includes(norm(quote));
}
export const LIGHTING = ["Yes", "No", "Unknown"];
export function validateExtraction(x, source, sourceId) {
  const errors = [];
  const need = ["crop", "lighting_status", "evidence_quote", "evidence_source_id", "unknown_information", "suggested_discovery_question"];
  if (!x || typeof x !== "object") return { ok: false, errors: ["not an object"] };
  for (const k of need) if (!(k in x)) errors.push(`missing ${k}`);
  if (!LIGHTING.includes(x.lighting_status)) errors.push("lighting_status not in enum");
  if (!Array.isArray(x.unknown_information)) errors.push("unknown_information not array");
  if (x.evidence_source_id !== sourceId) errors.push("evidence_source_id mismatch");
  const quoteOk = quoteInSource(x.evidence_quote, source);
  if (!quoteOk) errors.push("evidence_quote not found verbatim in source");
  return { ok: errors.length === 0, errors, quoteOk };
}
