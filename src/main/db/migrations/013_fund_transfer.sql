CREATE TABLE fund_transfer (
  id INTEGER PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  from_account_id INTEGER NOT NULL REFERENCES fund_account(id),
  to_account_id INTEGER NOT NULL REFERENCES fund_account(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  remark TEXT,
  operator_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_account_id <> to_account_id)
);

CREATE INDEX idx_fund_flow_account_period ON fund_flow(account_id, date, id);
