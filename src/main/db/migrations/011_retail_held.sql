CREATE TABLE retail_held (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id INTEGER NOT NULL REFERENCES "user"(id),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX idx_retail_held_operator ON retail_held(operator_id, id);
