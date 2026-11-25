// PUBLIC DEMO ONLY. One fictional grower. The company, its web page and the "extraction" below were written for the demo; nothing was retrieved from the web or
// produced by a live model. The extraction deliberately over-claims (lighting "Yes", plans "Planned") so that LightYield's real deterministic checks, run in the
// browser on this text, can be seen downgrading claims the quotations do not support.
export const DEMO_COMPANY = { id: "demo-fernbrook", name: "Fernbrook Glasshouses", domain: "fernbrook-glasshouses.example" };
export const DEMO_SOURCE_ID = "https://fernbrook-glasshouses.example/about";
export const DEMO_SOURCE_TEXT = [
  "Fernbrook Glasshouses is a family-run grower with 6 hectares of heated glass.",
  "We grow truss and cherry tomatoes for regional wholesale customers.",
  "In 2019 we trialled LED interlighting in one bay of Glasshouse 2.",
  "The trial ended after one season.",
  "Our heat comes from a combined heat and power plant installed in 2016.",
  "We are reviewing options for extending the winter season.",
  "We supply produce from March to November.",
].join(" ");
// Same shape the operational Worker accepts from the model (validated by parseAi before use).
export const DEMO_EXTRACTION = {
  business_name: "Fernbrook Glasshouses",
  crop_value: "Tomatoes",
  crop_quote: "We grow truss and cherry tomatoes for regional wholesale customers.",
  lighting_status: "Yes",
  lighting_quote: "In 2019 we trialled LED interlighting in one bay of Glasshouse 2.",
  future_plans: "Planned",
  future_quote: "We are reviewing options for extending the winter season.",
  unknown_information: ["Whether the 2019 interlighting trial led to any later decision"],
  discovery_questions: ["What would extending the winter season mean for your customers and margins?"],
};
