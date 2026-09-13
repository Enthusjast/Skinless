PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS audit_logs (
  id               TEXT PRIMARY KEY,
  actor_user_id    TEXT,
  target_user_id   TEXT,
  target_resource  TEXT,
  action           TEXT NOT NULL,
  result           TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  request_id       TEXT NOT NULL,
  metadata         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  created_at       INTEGER NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_at
  ON audit_logs (action, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_at
  ON audit_logs (actor_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_created_at
  ON audit_logs (target_user_id, created_at DESC, id DESC);
