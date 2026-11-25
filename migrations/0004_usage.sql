-- Server-side usage counters (cost / abuse limits on AI-backed operations)
CREATE TABLE IF NOT EXISTS usage (key TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, bucket));
