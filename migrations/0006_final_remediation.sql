-- Final remediation (additive only; no data is rewritten or removed).
-- tasks.lease_owner: fencing token for follow-up creation (a request whose lease expired cannot write over its replacement).
ALTER TABLE tasks ADD COLUMN lease_owner TEXT;
-- companies.evidence_rev: ACCOUNT-level revision, bumped atomically with every finding review in ANY run of the account.
-- companies.synced_evidence_rev: the account revision that was read BEFORE the evidence snapshot written to HubSpot (NULL = unknown => reported stale).
ALTER TABLE companies ADD COLUMN evidence_rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN synced_evidence_rev INTEGER;
