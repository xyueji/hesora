-- 禾序进销存 002: generic document tables
CREATE TABLE doc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('purchase','sale','retail','purchase_return','sale_return','transfer','stocktake','assemble','disassemble','receipt','payment','other_out','other_in')),
  date TEXT NOT NULL,
  partner_id INTEGER,
  warehouse_id INTEGER,
  warehouse_in_id INTEGER,
  account_id INTEGER,
  total_amount REAL NOT NULL DEFAULT 0,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('draft','done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE doc_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES doc(id),
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER,
  batch_no TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  rate REAL NOT NULL DEFAULT 1,
  qty REAL NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0
);

CREATE INDEX idx_doc_type_date ON doc(type, date);
CREATE INDEX idx_doc_item_doc ON doc_item(doc_id);
