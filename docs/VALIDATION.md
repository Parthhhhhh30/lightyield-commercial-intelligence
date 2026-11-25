# Validation and limitations

## What was tested, and where

| Evidence | Scope | Where it ran |
|---|---|---|
| Offline regression | 25 stages passed, none failed or skipped: evidence checks, CRM failure handling, idempotency and isolation guards | The original private repository, commit `bc48e3c` (the code in this repository) |
| Live browser journey | 8 of 8 checks: research, review, HubSpot sync, conversation, follow-up and accessibility, with real Workers AI and a HubSpot developer test account | The original private repository, earlier commit `abcdb3c`; not rerun on `bc48e3c` |
| Real company research | Name-only research on several UK grower websites through the non-saving preview, reviewed by hand | Local preview; qualitative feedback only |
| Synthetic commercial workflow | One fictional company, run by hand from research to a completed HubSpot follow-up | Local database and a HubSpot developer test account |

On one real company website, the model proposed current LED use and a planned installation. Both were held as Unknown: the first came from a list of features, the second from a construction timeline.

## What this repository leaves out

This repository is a curated copy of the private project at commit `bc48e3c`, without its history. It leaves out:

- deployment and release scripts, hosted-environment configuration and provider account identifiers;
- live tests that need private accounts;
- the cleanup and hosted-audit tests that depend on those scripts;
- the test of a local launcher guard that reads the private configuration;
- internal reports and raw evaluation records about named companies.

Comments and test labels that named real companies were replaced with generic wording, and `wrangler.toml`, `.dev.vars.example` and `package.json` were rewritten for local use (no provider identifiers, no licence field). The application logic is otherwise unchanged. The offline tests included here were run on this copy, but the 25-stage regression above refers to the original repository.

## Known limitations

- **Measurements.** Research accuracy, time saved and any comparison with general AI tools have not been measured.
- **Customer use.** No real customer data, outreach or revenue is involved.
- **Unknown by design.** The checks favour leaving a finding Unknown over accepting a weak one. Some true facts written in narrative or indirect wording stay Unknown until a person adds them.
- **Free-text qualification.** Coverage, timing and the decision-maker are recorded as conversation text, not separate fields.
- **Provenance of human edits.** A reviewer can correct a public-source finding using something the customer said. The app labels this as a human edit, but it then appears under public evidence. In the demonstration, a "Not planned" correction rested on the conversation, not the website. The correct practice is to leave the public finding Unknown and record the customer's statement in the conversation.
- **HubSpot owner.** The task owner is stored as text, because owner lookup needs an extra HubSpot permission.
- **Provider retention.** Search queries and AI prompts are handled under the providers' own terms.
- **Readiness.** This is not a production-ready or security-reviewed service.
