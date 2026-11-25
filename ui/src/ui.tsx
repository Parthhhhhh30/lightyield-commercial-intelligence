import type { ReactNode } from "react";
export const FLAG_TEXT: Record<string, string> = {
  quote_not_in_source: "Quotation not found verbatim in the source",
  claim_without_quote: "Claim has no supporting quotation",
  quote_not_about_claim: "Quotation does not state the claim (wrong subject, tense or vague)",
  quote_contradicts_claim: "Quotation does not support the claimed value",
  quote_is_injection_text: "Quotation is instruction-like text in the source",
  contradictory_source: "Source contains contradictory statements",
  value_not_in_source: "Value does not appear in the source",
  semantic_check_failed: "A second AI check judged the quotation does not support the claim",
  semantic_check_unavailable: "Second AI check unavailable; claim withheld (fails closed)",
  semantic_check_passed: "Second AI check agreed the quotation supports the claim (still needs your judgement)",
  lighting_historical_in_source: "The source only says the lighting was installed in the past (or later removed): current operation is not established",
  lighting_removal_in_source: "The source also says this lighting was removed, switched off or replaced: current use is not established",
  ai_quote_replaced: "The AI's quotation was not found in the source; the checker replaced it with the exact sentence that supports the claim (judge relevance yourself)",
  quote_recovered_from_source: "AI gave no quotation; the checker located this sentence in the source (judge relevance yourself)",
  ai_may_have_missed_cue: "Source may mention lighting; AI said Unknown. Check the source",
  possible_prompt_injection_in_source: "Source contains instruction-like text; it was treated as data only",
  entered_name_not_in_source: "Entered business name does not appear in the source text",
};
export const KIND: Record<string, string> = { crop: "Crop", lighting: "Current supplementary lighting", future: "Planned supplementary lighting", unknown_item: "Unknown information", question: "Discovery question" };
export const inputCls = "mt-1 w-full rounded border border-slate-400 bg-white p-2 text-sm";
export const btn = (c: string) => `rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${c}`;
export const primary = btn("bg-slate-900 text-white hover:bg-slate-700");
export const ghost = btn("border border-slate-400 hover:bg-slate-50");
export const Card = ({ title, children, id }: { title?: string; children: ReactNode; id?: string }) => (
  <section aria-labelledby={id} className="rounded-lg border border-slate-300 bg-white p-4">{title && <h2 id={id} className="mb-2 text-base font-semibold">{title}</h2>}{children}</section>
);
export const Err = ({ msg }: { msg: string | null }) => msg ? <div role="alert" data-testid="error" className="my-2 rounded border border-red-400 bg-red-50 p-2 text-sm text-red-900">{msg}</div> : null;
export const Pill = ({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "violet" | "sky" }) => {
  const t = { slate: "bg-slate-200 text-slate-800 border-slate-400", green: "bg-green-100 text-green-800 border-green-300", amber: "bg-amber-100 text-amber-900 border-amber-300", red: "bg-red-100 text-red-800 border-red-300", violet: "bg-violet-100 text-violet-800 border-violet-300", sky: "bg-sky-100 text-sky-800 border-sky-300" }[tone];
  return <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
};
