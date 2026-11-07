-- 禾序进销存 018: 序列号台账（serial_number / serial_flow）
--
-- 语义：
--   serial_number —— 每一条序列号一行的在库台账。同一商品下序列号唯一（UNIQUE(sn, product_id)），
--                    入库登记一次，之后只能核销（出库），保证"同一序列号不会被重复登记"。
--   serial_flow   —— 序列号流水，记录每一次入库/出库事件及其来源单据，用于"序列号流向"查询。
--
-- 本迁移不改动任何既有表，避免与其他并行开发的迁移冲突。

CREATE TABLE serial_number (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sn TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES product(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  batch_no TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_stock' CHECK(status IN ('in_stock','out')),
  in_qty REAL NOT NULL DEFAULT 1,
  out_qty REAL NOT NULL DEFAULT 0,
  in_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  out_date TEXT,
  in_source TEXT,
  in_source_id INTEGER,
  out_source TEXT,
  out_source_id INTEGER,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(sn, product_id)
);

CREATE INDEX idx_serial_number_product ON serial_number(product_id, status);
CREATE INDEX idx_serial_number_warehouse ON serial_number(warehouse_id);
CREATE INDEX idx_serial_number_sn ON serial_number(sn);

CREATE TABLE serial_flow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sn TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES product(id),
  doc_id INTEGER,
  doc_item_id INTEGER,
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  qty REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_serial_flow_sn ON serial_flow(sn);
CREATE INDEX idx_serial_flow_product ON serial_flow(product_id);
CREATE INDEX idx_serial_flow_doc ON serial_flow(doc_id);
