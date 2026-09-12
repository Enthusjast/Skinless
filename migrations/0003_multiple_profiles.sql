CREATE TABLE tokens_migration_backup AS SELECT * FROM tokens;
CREATE TABLE server_sessions_migration_backup AS SELECT * FROM server_sessions;

DELETE FROM server_sessions;
DELETE FROM tokens;

PRAGMA foreign_keys = OFF;

CREATE TABLE profiles_new (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  skin_hash   TEXT,
  cape_hash   TEXT,
  skin_model  TEXT NOT NULL DEFAULT 'classic' CHECK (skin_model IN ('classic', 'slim')),
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO profiles_new (id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at)
SELECT
  p.id,
  p.user_id,
  p.name,
  p.skin_hash,
  p.cape_hash,
  p.skin_model,
  COALESCE((SELECT u.created_at FROM users u WHERE u.id = p.user_id), 0),
  COALESCE((SELECT u.updated_at FROM users u WHERE u.id = p.user_id), 0)
FROM profiles p;

DROP TABLE profiles;
ALTER TABLE profiles_new RENAME TO profiles;

CREATE UNIQUE INDEX idx_profiles_name ON profiles(name COLLATE NOCASE);
CREATE INDEX idx_profiles_user_id ON profiles(user_id);

ALTER TABLE users ADD COLUMN default_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL;
UPDATE users
SET default_profile_id = (
  SELECT p.id
  FROM profiles p
  WHERE p.user_id = users.id
  ORDER BY p.created_at ASC, p.id ASC
  LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = users.id);

INSERT INTO tokens (access_token, client_token, user_id, profile_id, created_at, expires_at)
SELECT access_token, client_token, user_id, profile_id, created_at, expires_at
FROM tokens_migration_backup;

INSERT INTO server_sessions (server_id, profile_id, user_id, created_at, expires_at)
SELECT server_id, profile_id, user_id, created_at, expires_at
FROM server_sessions_migration_backup;

DROP TABLE server_sessions_migration_backup;
DROP TABLE tokens_migration_backup;

PRAGMA foreign_keys = ON;
