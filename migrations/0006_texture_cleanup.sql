CREATE TABLE IF NOT EXISTS texture_cleanup (
  hash         TEXT PRIMARY KEY,
  object_key   TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error   TEXT
);

CREATE INDEX IF NOT EXISTS idx_texture_cleanup_scheduled_at
  ON texture_cleanup (scheduled_at ASC, hash ASC);
