import { validateExtraction, quoteInSource } from "../src/evidence.js";
import assert from "node:assert";
const S = "Example Glasshouse produces tomatoes in commercial greenhouses. The company website does not state whether supplementary LED lighting is installed.";
const good = { crop: "tomatoes", lighting_status: "Unknown", evidence_quote: "does not state whether supplementary LED lighting is installed", evidence_source_id: "s1", unknown_information: ["lighting"], suggested_discovery_question: "q?" };
assert(validateExtraction(good, S, "s1").ok);
assert(!validateExtraction({ ...good, evidence_quote: "They use 400W LED lamps throughout" }, S, "s1").ok, "fabricated quote must fail");
assert(!validateExtraction({ ...good, lighting_status: "Maybe" }, S, "s1").ok);
assert(!quoteInSource("", S));
console.log("evidence checks: 4/4 pass (offline unit test of the verifier only; NOT an AI test)");
