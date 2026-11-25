-- Auth
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, github_id INTEGER NOT NULL, login TEXT NOT NULL, csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
-- Identity / sync reliability
ALTER TABLE companies ADD COLUMN domain TEXT;
ALTER TABLE companies ADD COLUMN create_sent_at INTEGER;
ALTER TABLE companies ADD COLUMN identity_status TEXT NOT NULL DEFAULT 'unresolved'; -- unresolved|linked|ambiguous
ALTER TABLE companies ADD COLUMN candidates TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_hubspot ON companies(hubspot_id) WHERE hubspot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain) WHERE domain IS NOT NULL;
ALTER TABLE research_runs ADD COLUMN duration_ms INTEGER;
ALTER TABLE research_runs ADD COLUMN verifier_calls INTEGER NOT NULL DEFAULT 0;
-- Commercial workflow (human-entered)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, company_id TEXT NOT NULL REFERENCES companies(id),
  occurred_on TEXT NOT NULL, channel TEXT NOT NULL, grower_reported TEXT NOT NULL,
  current_led TEXT NOT NULL, future_led TEXT NOT NULL, need_or_concern TEXT,
  fit TEXT NOT NULL, fit_reason TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_company ON conversations(company_id, occurred_on);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), text TEXT NOT NULL,
  origin TEXT NOT NULL,            -- ai_suggestion|human
  status TEXT NOT NULL,            -- proposed|open|asked|dropped
  finding_id TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_company ON questions(company_id);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, company_id TEXT NOT NULL REFERENCES companies(id), text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, company_id TEXT NOT NULL REFERENCES companies(id),
  op_state TEXT NOT NULL,          -- creating|created|uncertain|failed
  hubspot_task_id TEXT, subject TEXT NOT NULL, owner_label TEXT NOT NULL, due_at TEXT NOT NULL,
  conversation_id TEXT, last_error TEXT, create_sent_at INTEGER, created_at TEXT NOT NULL, completed_at TEXT, completion_outcome TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_hubspot ON tasks(hubspot_task_id) WHERE hubspot_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);
