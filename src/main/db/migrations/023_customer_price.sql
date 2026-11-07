-- 禾序进销存 023: 客户×商品专属价 + 变价记录
--
-- 说明：
-- 1) customer_product_price：按客户按商品设置专属售价，一个客户+商品组合唯一。
-- 2) price_change_log：变价历史（scope 区分客户专属价与价格等级两类来源），
--    方便追溯某客户某商品价格由谁在何时从多少改到多少。

CREATE TABLE customer_product_price (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customer(id),
  product_id INTEGER NOT NULL REFERENCES product(id),
  price REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(customer_id, product_id)
);

CREATE INDEX idx_cpp_customer ON customer_product_price(customer_id);
CREATE INDEX idx_cpp_product ON customer_product_price(product_id);

CREATE TABLE price_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK (scope IN ('customer_product', 'price_level')),
  customer_id INTEGER,
  product_id INTEGER NOT NULL,
  old_price REAL,
  new_price REAL NOT NULL,
  operator TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_pcl_product ON price_change_log(product_id, created_at);
CREATE INDEX idx_pcl_customer ON price_change_log(customer_id, created_at);
