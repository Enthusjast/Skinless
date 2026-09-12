ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'disabled'));

UPDATE users
SET email_verified_at = updated_at
WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS pending_registrations (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  profile_name  TEXT NOT NULL COLLATE NOCASE,
  invite_id     TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  FOREIGN KEY (invite_id) REFERENCES registration_invites(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_registrations_email
  ON pending_registrations (email COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_registrations_profile_name
  ON pending_registrations (profile_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_pending_registrations_expires_at
  ON pending_registrations (expires_at);

CREATE TABLE IF NOT EXISTS registration_challenges (
  id                      TEXT PRIMARY KEY,
  pending_registration_id TEXT NOT NULL UNIQUE,
  code_hash               TEXT NOT NULL,
  attempts                INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  last_sent_at            INTEGER NOT NULL,
  expires_at              INTEGER NOT NULL,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  FOREIGN KEY (pending_registration_id) REFERENCES pending_registrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_registration_challenges_expires_at
  ON registration_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_registration_challenges_attempts
  ON registration_challenges (attempts);
