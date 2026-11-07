CREATE TABLE IF NOT EXISTS platform_log (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  operator TEXT,
  detail TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  created_at TEXT NOT NULL
);
