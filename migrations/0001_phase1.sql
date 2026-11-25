CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  hubspot_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'not_synced', -- not_synced|syncing|synced|error|uncertain
  sync_error TEXT,
  synced_run_id TEXT,
  lease_until INTEGER,
  last_uncertain_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  source_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'pasted_text', -- never 'fetched' in Phase 1
  model TEXT,
  ai_status TEXT NOT NULL,                          -- ok|failed
  ai_error TEXT,
  ai_raw TEXT,
  neurons REAL,
  run_flags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_company_hash ON research_runs(company_id, source_sha256);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_runs(id),
  kind TEXT NOT NULL,            -- crop|lighting|unknown_item|question
  ai_value TEXT,
  value TEXT NOT NULL,           -- system-proposed (after deterministic downgrade)
  quote TEXT,
  quote_verified INTEGER NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'needs_review', -- needs_review|approved|edited|rejected
  final_value TEXT,
  note TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity, entity_id);
