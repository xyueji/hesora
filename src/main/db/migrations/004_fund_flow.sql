-- 004: 资金流水表 fund_flow
-- 记录每一笔资金变动（收款/付款/零售收款/销售收款等），金额恒为正，方向由 direction 区分。
CREATE TABLE fund_flow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,
  doc_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  date TEXT NOT NULL,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_fund_flow_account ON fund_flow(account_id);
CREATE INDEX idx_fund_flow_date ON fund_flow(date);
