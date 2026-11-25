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

## Public interactive demo

The [public demo](https://lightyield-demo.lightyield-commercial-intelligence.workers.dev) is a static build tested separately. Earlier results above do not apply to it, and its results do not apply to the live integrations.

Tested on 25 November 2026 with `npm run test:demo`, in Chromium at desktop (1366×900) and mobile (Pixel 7) sizes, locally and against the hosted URL in fresh, signed-out browser contexts. All 8 checks passed in each run:

- The full visitor journey: review with a required correction basis, explicit unknowns, simulated sync and read-back, qualification with sources kept separate, a discovery call and fit decision, a follow-up created and completed, state kept after reload, then reset.
- Follow-ups are blocked until the account is synced. Sync is blocked until crop, lighting and plans are reviewed.
- Separate browser contexts do not share state.
- No request leaves the demo's own origin. None goes to `/api` or `/auth`, and none uses a method other than GET. A `fetch` to the API or a provider host is blocked by the Content Security Policy. API paths on the host return no JSON and set no cookies. No browser console errors.

The existing mocked-API interface tests (`npm run test:ui-offline`, 27 tests) still pass on the operational build.

Demo limits: one fictional company. The extraction was written in advance, so the demo shows how claims are checked, not how well a model extracts them. Identity resolution, AI-suggested questions and recovery from failed CRM writes are not part of the demo.
