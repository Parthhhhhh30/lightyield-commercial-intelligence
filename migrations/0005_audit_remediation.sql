-- Additive only (no data rewrite). Apply to a database BEFORE deploying code that uses these columns.
-- H2: operation ownership for company sync / identity changes (owner token; a stale operation cannot act on or release another's lease)
ALTER TABLE companies ADD COLUMN lease_owner TEXT;
-- M2: revision-aware sync. research_runs.rev increments on every finding review; companies.synced_run_rev records the revision that was actually synced.
ALTER TABLE research_runs ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN synced_run_rev INTEGER;
-- M1: task completion is an idempotent, outcome-aware operation
ALTER TABLE tasks ADD COLUMN completion_request_id TEXT;
ALTER TABLE tasks ADD COLUMN completion_state TEXT;          -- NULL | pending | done
-- M6: authenticated actor on audit events
ALTER TABLE events ADD COLUMN actor_github_id INTEGER;
ALTER TABLE events ADD COLUMN actor_login TEXT;
