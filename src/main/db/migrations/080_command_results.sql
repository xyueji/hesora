CREATE TABLE IF NOT EXISTS command_results (
  request_id   TEXT PRIMARY KEY,
  channel      TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_command_results_device ON command_results(device_id, created_at);
