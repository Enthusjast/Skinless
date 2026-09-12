CREATE TABLE IF NOT EXISTS site_settings (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  registration_mode      TEXT NOT NULL DEFAULT 'open'
                         CHECK (registration_mode IN ('open', 'invite', 'closed')),
  max_profiles_per_user  INTEGER NOT NULL DEFAULT 5
                         CHECK (max_profiles_per_user BETWEEN 1 AND 50),
  max_textures_per_user  INTEGER NOT NULL DEFAULT 50
                         CHECK (max_textures_per_user BETWEEN 1 AND 500),
  enforce_join_ip        INTEGER NOT NULL DEFAULT 0
                         CHECK (enforce_join_ip IN (0, 1)),
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);

INSERT OR IGNORE INTO site_settings (
  id,
  registration_mode,
  max_profiles_per_user,
  max_textures_per_user,
  enforce_join_ip,
  created_at,
  updated_at
)
VALUES (
  1,
  'open',
  5,
  50,
  0,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);

CREATE TABLE IF NOT EXISTS registration_invites (
  id          TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  use_count   INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= use_limit),
  use_limit   INTEGER NOT NULL CHECK (use_limit BETWEEN 1 AND 1000),
  expires_at  INTEGER CHECK (expires_at IS NULL OR expires_at > 0),
  note        TEXT NOT NULL DEFAULT '',
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_registration_invites_created_at
  ON registration_invites (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_registration_invites_expires_at
  ON registration_invites (expires_at);
CREATE INDEX IF NOT EXISTS idx_registration_invites_created_by
  ON registration_invites (created_by);
