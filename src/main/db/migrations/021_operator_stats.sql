-- 禾序进销存 021: 员工业绩统计 + 收支科目主档
--
-- 1) doc.operator：单据业务员（操作员用户名，NULL 允许——旧数据无业务员归属）。
--    由 purchase/sale/retail 等销售类单据创建入口写入，员工业绩报表按此列 GROUP BY。
-- 2) income_category：收支科目主档（其他收入/其他支出等资金单据的科目字典）。
--    kind CHECK 区分收入/支出；disabled 软停用，保留历史单据引用。

ALTER TABLE doc ADD COLUMN operator TEXT;

CREATE TABLE income_category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_income_category_kind ON income_category(kind, disabled);
