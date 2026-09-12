CREATE TABLE IF NOT EXISTS account_challenges (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  purpose       TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_change')),
  email         TEXT NOT NULL COLLATE NOCASE,
  code_hash     TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  last_sent_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (user_id, purpose),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_challenges_user_purpose
  ON account_challenges (user_id, purpose);
CREATE INDEX IF NOT EXISTS idx_account_challenges_expires_at
  ON account_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_account_challenges_attempts
  ON account_challenges (attempts);
