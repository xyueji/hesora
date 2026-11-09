CREATE TABLE IF NOT EXISTS host_sessions (
  token_hash   TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES "user"(id),
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_host_sessions_device ON host_sessions(device_id);
