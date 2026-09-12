CREATE TABLE tokens_migration_backup AS SELECT * FROM tokens;
CREATE TABLE server_sessions_migration_backup AS SELECT * FROM server_sessions;

DELETE FROM server_sessions;
DELETE FROM tokens;

PRAGMA foreign_keys = OFF;

-- Legacy 0001 compared names case-sensitively, so `Player` and `player` may
-- already coexist. Number every legacy profile globally in deterministic order:
-- ascending owning-user creation time (NULL as 0), then profile ID using
-- binary text order. A generated name is the reserved valid Minecraft-name
-- namespace `x` plus that row number as exactly 15 zero-padded digits. Keep the
-- oldest non-conflicting case variant unchanged; rename later variants and any
-- legacy name already in the reserved namespace to its generated name.

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

WITH ranked_profiles AS (
  SELECT
    p.id,
    p.user_id,
    p.name,
    p.skin_hash,
    p.cape_hash,
    p.skin_model,
    COALESCE(u.created_at, 0) AS created_at,
    COALESCE(u.updated_at, 0) AS updated_at,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(u.created_at, 0), p.id COLLATE BINARY
    ) AS global_profile_number,
    ROW_NUMBER() OVER (
      PARTITION BY lower(p.name)
      ORDER BY COALESCE(u.created_at, 0), p.id COLLATE BINARY
    ) AS case_variant_number,
    CASE WHEN length(p.name) = 16
      AND lower(substr(p.name, 1, 1)) = 'x'
      AND substr(p.name, 2) NOT GLOB '*[^0-9]*'
      THEN 1 ELSE 0 END AS is_reserved_name
  FROM profiles p
  INNER JOIN users u ON u.id = p.user_id
), named_profiles AS (
  SELECT
    ranked_profiles.*,
    'x' || printf('%015d', global_profile_number) AS generated_name
  FROM ranked_profiles
)
INSERT INTO profiles_new (id, user_id, name, skin_hash, cape_hash, skin_model, created_at, updated_at)
SELECT
  id,
  user_id,
  CASE WHEN case_variant_number > 1 OR is_reserved_name = 1 THEN generated_name ELSE name END,
  skin_hash,
  cape_hash,
  skin_model,
  created_at,
  updated_at
FROM named_profiles;

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
