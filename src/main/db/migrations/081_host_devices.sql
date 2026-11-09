CREATE TABLE IF NOT EXISTS host_devices (
  device_id    TEXT PRIMARY KEY,
  device_name  TEXT NOT NULL,
  secret_hash  TEXT NOT NULL,
  paired_at    TEXT NOT NULL,
  revoked_at   TEXT,
  last_seen_at TEXT
);
