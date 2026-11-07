-- 禾序进销存 017_stock_query: 库存查询扩展（调价留痕）
-- 收发存（库存流水）由 cost_log 派生，无需新表；此处仅新增售价/进价调整的可追溯记录。
CREATE TABLE price_adjust_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  price_type TEXT NOT NULL CHECK(price_type IN ('retail','trade','purchase')),
  old_price REAL NOT NULL DEFAULT 0,
  new_price REAL NOT NULL DEFAULT 0,
  operator TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_price_adjust_product ON price_adjust_log(product_id, created_at);
CREATE INDEX idx_price_adjust_time ON price_adjust_log(created_at);
