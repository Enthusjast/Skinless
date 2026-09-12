CREATE TABLE IF NOT EXISTS web_sessions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  csrf_token_hash    TEXT NOT NULL,
  device_label       TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  last_used_at       INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  revoked_at         INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_web_sessions_user_id ON web_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires_at ON web_sessions(expires_at);
