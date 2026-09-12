CREATE TABLE IF NOT EXISTS texture_wardrobe (
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

CREATE INDEX IF NOT EXISTS idx_texture_wardrobe_user_id
  ON texture_wardrobe (user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_texture_wardrobe_hash
  ON texture_wardrobe (hash);

WITH texture_sources AS (
  SELECT
    p.user_id,
    p.skin_hash AS hash,
    'skin' AS texture_type,
    p.skin_model AS model,
    NULL AS width,
    NULL AS height,
    NULL AS size,
    COALESCE(p.created_at, u.created_at, 0) AS created_at,
    COALESCE(p.updated_at, u.updated_at, 0) AS updated_at,
    p.id AS profile_id
  FROM profiles p
  INNER JOIN users u ON u.id = p.user_id
  WHERE p.skin_hash IS NOT NULL

  UNION ALL

  SELECT
    p.user_id,
    p.cape_hash AS hash,
    'cape' AS texture_type,
    NULL AS model,
    NULL AS width,
    NULL AS height,
    NULL AS size,
    COALESCE(p.created_at, u.created_at, 0) AS created_at,
    COALESCE(p.updated_at, u.updated_at, 0) AS updated_at,
    p.id AS profile_id
  FROM profiles p
  INNER JOIN users u ON u.id = p.user_id
  WHERE p.cape_hash IS NOT NULL
), ranked_sources AS (
  SELECT
    texture_sources.*,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, hash, texture_type
      ORDER BY created_at ASC, updated_at ASC, profile_id ASC
    ) AS source_number
  FROM texture_sources
)
INSERT OR IGNORE INTO texture_wardrobe (
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
  lower(hex(randomblob(16))),
  user_id,
  hash,
  texture_type,
  CASE texture_type WHEN 'skin' THEN 'Imported skin' ELSE 'Imported cape' END,
  model,
  width,
  height,
  size,
  created_at,
  updated_at
FROM ranked_sources
WHERE source_number = 1;
