PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id                     TEXT PRIMARY KEY,
  email                  TEXT UNIQUE NOT NULL,
  password               TEXT NOT NULL,
  salt                   TEXT NOT NULL,
  role                   TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  default_profile_id     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  email_verified_at      INTEGER,
  status                 TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'disabled', 'pending_deletion')),
  deletion_requested_at  INTEGER
);

INSERT INTO users_new (
  id,
  email,
  password,
  salt,
  role,
  created_at,
  updated_at,
  default_profile_id,
  email_verified_at,
  status,
  deletion_requested_at
)
SELECT
  id,
  email,
  password,
  salt,
  role,
  created_at,
  updated_at,
  default_profile_id,
  email_verified_at,
  status,
  NULL
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE account_challenges_new (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  purpose       TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_change', 'account_restore')),
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

INSERT INTO account_challenges_new (
  id,
  user_id,
  purpose,
  email,
  code_hash,
  attempts,
  last_sent_at,
  expires_at,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  purpose,
  email,
  code_hash,
  attempts,
  last_sent_at,
  expires_at,
  created_at,
  updated_at
FROM account_challenges;

DROP TABLE account_challenges;
ALTER TABLE account_challenges_new RENAME TO account_challenges;

CREATE INDEX IF NOT EXISTS idx_account_challenges_user_purpose
  ON account_challenges (user_id, purpose);
CREATE INDEX IF NOT EXISTS idx_account_challenges_expires_at
  ON account_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_account_challenges_attempts
  ON account_challenges (attempts);

PRAGMA foreign_keys = ON;
