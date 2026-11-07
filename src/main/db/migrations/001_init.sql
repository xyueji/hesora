-- 禾序进销存 001_init: initial schema
CREATE TABLE app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  spec TEXT,
  category TEXT,
  base_unit TEXT NOT NULL,
  retail_price REAL NOT NULL DEFAULT 0,
  trade_price REAL NOT NULL DEFAULT 0,
  purchase_price REAL NOT NULL DEFAULT 0,
  min_stock REAL,
  images TEXT,
  remark TEXT,
  tracking_type TEXT NOT NULL DEFAULT 'none' CHECK(tracking_type IN ('none','batch','serial')),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE product_unit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  unit TEXT NOT NULL,
  rate REAL NOT NULL,
  is_base INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE product_barcode (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  barcode TEXT UNIQUE NOT NULL
);

CREATE TABLE product_price (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  price_level TEXT NOT NULL,
  price REAL NOT NULL,
  UNIQUE(product_id, price_level)
);

CREATE TABLE customer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  address TEXT,
  price_level TEXT,
  opening_receivable REAL NOT NULL DEFAULT 0,
  credit_limit REAL,
  remark TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE supplier (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  address TEXT,
  opening_payable REAL NOT NULL DEFAULT 0,
  remark TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE warehouse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE fund_account (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('cash','bank','wechat','alipay','other')),
  opening_balance REAL NOT NULL DEFAULT 0,
  remark TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

CREATE TABLE inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  batch_no TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  moving_cost REAL NOT NULL DEFAULT 0,
  UNIQUE(product_id, warehouse_id, batch_no)
);

CREATE TABLE cost_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  batch_no TEXT NOT NULL DEFAULT '',
  change_qty REAL NOT NULL,
  unit_cost REAL NOT NULL,
  after_qty REAL NOT NULL,
  after_cost REAL NOT NULL,
  source TEXT NOT NULL,
  source_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_inv_product ON inventory(product_id, warehouse_id);
CREATE INDEX idx_cost_product ON cost_log(product_id, warehouse_id);
