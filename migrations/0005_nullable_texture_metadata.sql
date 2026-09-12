CREATE TABLE texture_wardrobe_nullable (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  hash          TEXT NOT NULL,
  texture_type  TEXT NOT NULL CHECK (texture_type IN ('skin', 'cape')),
  name          TEXT NOT NULL,
  model         TEXT CHECK (model IN ('classic', 'slim') OR model IS NULL),
  width         INTEGER CHECK (width IS NULL OR width > 0),
  height        INTEGER CHECK (height IS NULL OR height > 0),
  size          INTEGER CHECK (size IS NULL OR size >= 0),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (user_id, hash, texture_type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO texture_wardrobe_nullable (
  id,
  user_id,
  hash,
  texture_type,
  name,
  model,
  width,
  height,
  size,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  hash,
  texture_type,
  name,
  model,
  CASE WHEN size = 0 THEN NULL ELSE width END,
  CASE WHEN size = 0 THEN NULL ELSE height END,
  CASE WHEN size = 0 THEN NULL ELSE size END,
  created_at,
  updated_at
FROM texture_wardrobe;

DROP TABLE texture_wardrobe;
ALTER TABLE texture_wardrobe_nullable RENAME TO texture_wardrobe;

CREATE INDEX IF NOT EXISTS idx_texture_wardrobe_user_id
  ON texture_wardrobe (user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_texture_wardrobe_hash
  ON texture_wardrobe (hash);
