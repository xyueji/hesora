-- 禾序进销存 016: 商品价格等级 / 保质期 / 批次效期
--
-- 说明：
-- 1) product_price 表已在 001_init.sql 中建立，且已带 `id INTEGER PRIMARY KEY AUTOINCREMENT` 主键，
--    因此**不需要**再执行 `ALTER TABLE product_price ADD COLUMN id INTEGER`（重复添加会报错）。
--    该表此前完全未被使用，本次起由 price-level.service 负责读写。
-- 2) 保质期字段挂在商品主档上：保质期天数 + 预警提前天数。
-- 3) 批次效期单独建表：一个商品在同一仓库下的同一批次号唯一，可记录生产日期与到期日期。

ALTER TABLE product ADD COLUMN shelf_life_days INTEGER;
ALTER TABLE product ADD COLUMN shelf_life_warn_days INTEGER;

CREATE TABLE product_batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  batch_no TEXT NOT NULL,
  production_date TEXT,
  expire_date TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(product_id, warehouse_id, batch_no)
);

CREATE INDEX idx_product_batch_product ON product_batch(product_id, warehouse_id);
CREATE INDEX idx_product_batch_expire ON product_batch(expire_date);
