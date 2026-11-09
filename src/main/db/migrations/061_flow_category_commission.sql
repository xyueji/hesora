-- 禾序进销存 061: P3 功能（进出类别字典 / 内部领用 / 商品提成率）
--
-- flow_category：进出类别字典（如 进货/退货入库/销售/领用），kind 区分入/出方向
-- doc_item.commission_rate：销售明细提成率（%），下单时从商品带出、可改

CREATE TABLE flow_category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('in','out')),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

ALTER TABLE doc_item ADD COLUMN commission_rate REAL NOT NULL DEFAULT 0;

-- doc_item.remark：内部领用明细记录领用人/用途（约定格式「领用人:xxx 用途:xxx」）
ALTER TABLE doc_item ADD COLUMN remark TEXT;

-- product.commission_rate：商品默认提成率（product.service insertProduct/update 引用该列；
-- 若无此列，所有走 createProductService 的内存库测试建 product 即失败）。
ALTER TABLE product ADD COLUMN commission_rate REAL NOT NULL DEFAULT 0;

-- doc.type CHECK 约束扩展：新增 'internal_use'（SQLite 无法直接改 CHECK，须重建表）。
-- 步骤：建临时表 → 拷贝 → 删原表 → 改名 → 重建索引。legacy_alter_table/foreign_keys
-- 由 migrate.ts 事务外 pragma 控制；此文件运行时 foreign_keys 已由调用方关闭。
CREATE TABLE doc_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('purchase','sale','retail','purchase_return','sale_return','transfer','stocktake','assemble','disassemble','receipt','payment','other_out','other_in','internal_use')),
  date TEXT NOT NULL,
  partner_id INTEGER,
  warehouse_id INTEGER,
  warehouse_in_id INTEGER,
  account_id INTEGER,
  total_amount REAL NOT NULL DEFAULT 0,
  remark TEXT,
  source_doc_id INTEGER REFERENCES doc_new(id),
  operator TEXT,
  external_no TEXT,
  invoice_status TEXT NOT NULL DEFAULT 'none',
  express_com TEXT,
  express_no TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('draft','done')),
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_by TEXT,
  review_at TEXT,
  review_remark TEXT,
  charge_type TEXT NOT NULL DEFAULT 'normal',
  prepaid_amount REAL NOT NULL DEFAULT 0,
  reversal_of INTEGER REFERENCES doc_new(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
INSERT INTO doc_new (id, no, type, date, partner_id, warehouse_id, warehouse_in_id, account_id, total_amount, remark, source_doc_id, operator, external_no, invoice_status, express_com, express_no, delivery_status, status, reviewed_at, reviewed_by, review_by, review_at, review_remark, charge_type, prepaid_amount, reversal_of, created_at, updated_at)
SELECT id, no, type, date, partner_id, warehouse_id, warehouse_in_id, account_id, total_amount, remark, source_doc_id, operator, external_no, invoice_status, express_com, express_no, delivery_status, status, reviewed_at, reviewed_by, review_by, review_at, review_remark, charge_type, prepaid_amount, reversal_of, created_at, updated_at FROM doc;
DROP TABLE doc;
ALTER TABLE doc_new RENAME TO doc;

-- 重建 doc 上的索引（表重建后随原表删除）
CREATE INDEX idx_doc_type_date ON doc(type, date);
CREATE INDEX idx_doc_source ON doc(source_doc_id) WHERE source_doc_id IS NOT NULL;
CREATE INDEX idx_doc_charge_type ON doc(charge_type) WHERE charge_type <> 'normal';
CREATE INDEX idx_doc_external_no ON doc(external_no) WHERE external_no IS NOT NULL;
CREATE UNIQUE INDEX idx_doc_reversal_of ON doc(reversal_of) WHERE reversal_of IS NOT NULL;
